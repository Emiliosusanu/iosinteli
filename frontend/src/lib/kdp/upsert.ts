import { supabase } from "../supabase.ts";
import { nestApiJson } from "../rulesApi.ts";
import Constants from "expo-constants";
import { hasVerifiedNativeCoverage, kdpFactSnapshotsMatch, hasTransactionalNativeCoverage } from "./marketplaceCoverage.ts";
import { withKdpTaskRequest } from "./backgroundBudget.ts";

type AnyRow = Record<string, unknown>;

async function upsert(
  table: string,
  rows: AnyRow[],
  onConflict: string,
  deadlineAtMs?: number,
): Promise<void> {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await withKdpTaskRequest(deadlineAtMs, async signal => {
      const query = supabase.from(table).upsert(chunk, { onConflict });
      return await (signal ? query.abortSignal(signal) : query);
    });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export async function writeKdpDay(opts: {
  accountId: string;
  rowDaily: AnyRow;
  rowEntry: AnyRow;
  rowsBookDaily: AnyRow[];
  factRows: AnyRow[];
  reviewOnly?: boolean;
  marketplaces?: string[];
  deadlineAtMs?: number;
}): Promise<void> {
  const date = String(opts.rowDaily.date || opts.rowEntry.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Atomic KDP day write requires YYYY-MM-DD");
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const revisionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = token === "x" ? Number.parseInt(randomHex(), 16) : (Number.parseInt(randomHex(), 16) & 0x3) | 0x8;
    return value.toString(16);
  });
  const identity = { account_id: opts.accountId, date, revision_id: revisionId };
  const result = await withKdpTaskRequest(opts.deadlineAtMs, signal => nestApiJson<{
    ok?: boolean;
    factRows?: number;
    submittedBookDailyRows?: number;
    staged?: boolean; quarantined?: boolean; candidateId?: string;
    accountId?: string; date?: string; revisionId?: string;
    coverageVerified?: boolean; coverageVersion?: number; coverageMarketplaces?: string[];
    verifiedFactRows?: number; dailyUpdatedAt?: string;
  }>(
    opts.reviewOnly ? "/kdp-sync/stage-correction" : "/kdp-sync/replace-day",
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        accountId: opts.accountId,
        date,
        revisionId,
        includeAds: false,
        ...(!opts.reviewOnly && opts.marketplaces?.length === 17 ? { marketplaces: opts.marketplaces } : {}),
        dailyData: { ...opts.rowDaily, ...identity },
        entry: { ...opts.rowEntry, ...identity },
        bookDailyRows: opts.rowsBookDaily.map((row) => ({ ...row, ...identity })),
        factRows: opts.factRows.map((row) => ({ ...row, ...identity })),
      }),
    },
    `Atomic KDP write failed for ${date}; existing data was preserved.`,
  ));
  if (opts.reviewOnly && result?.staged === true && result?.quarantined === true
    && result?.ok === false && /^[0-9a-f-]{36}$/i.test(String(result.candidateId || ""))
    && result.accountId === opts.accountId && result.date === date && result.revisionId === revisionId) return;
  if (opts.reviewOnly) throw new Error(`KDP correction staging was not acknowledged for ${date}; existing data was preserved`);
  if (
    result?.ok !== true ||
    result.accountId !== opts.accountId || result.date !== date || result.revisionId !== revisionId ||
    Number(result.factRows) !== opts.factRows.length ||
    Number(result.submittedBookDailyRows) !== opts.rowsBookDaily.length
  ) {
    throw new Error(`Atomic KDP write acknowledgement mismatch for ${date}; existing data was preserved`);
  }
  if (result.coverageVerified === true) {
    if (!hasTransactionalNativeCoverage(result, { accountId: opts.accountId, date, revisionId,
      factCount: opts.factRows.length, bookCount: opts.rowsBookDaily.length, marketplaces: opts.marketplaces })) {
      throw new Error(`KDP transaction coverage receipt mismatch for ${date}; retry remains pending`);
    }
    return; // SQL verified actual stored metrics + marker atomically; no 85-page mobile readback.
  }
  if (opts.marketplaces?.length) {
    await verifyNativeDayCoverage(opts.accountId, date, revisionId, opts.factRows, opts.marketplaces, opts.deadlineAtMs);
  }
}

/** Only a complete source capture and matching cloud readback can seal a day. */
async function verifyNativeDayCoverage(accountId: string, date: string, revisionId: string,
  expectedFacts: AnyRow[], marketplaces: string[], deadlineAtMs?: number): Promise<void> {
  const fail = () => new Error(`KDP native marketplace coverage unverified for ${date}; retry remains pending`);
  const { data: day, error: dayError } = await withKdpTaskRequest(deadlineAtMs, async signal => {
    const query = supabase.from("kdp_daily_data")
      .select("updated_at").eq("account_id", accountId).eq("date", date);
    return await (signal ? query.abortSignal(signal) : query).maybeSingle();
  });
  if (dayError || !day?.updated_at) throw fail();
  const actual: AnyRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await withKdpTaskRequest(deadlineAtMs, async signal => {
      const query = supabase.from("kdp_daily_facts")
      .select("asin,format,marketplace,currency,units,royalties,kenp,revision_id")
      .eq("account_id", accountId).eq("date", date)
      .order("asin").order("format").order("marketplace").order("currency")
      .range(offset, offset + 999);
      return await (signal ? query.abortSignal(signal) : query);
    });
    if (error || !Array.isArray(data)) throw fail();
    actual.push(...data);
    if (data.length < 1000) break;
  }
  if (actual.some((row) => row.revision_id !== revisionId) || !kdpFactSnapshotsMatch(expectedFacts, actual)) throw fail();
  const marker = { account_id: accountId, date, revision_id: revisionId,
    marketplaces, fact_count: actual.length, daily_updated_at: day.updated_at,
    producer_version: `ios-${Constants.expoConfig?.version || Constants.nativeAppVersion || "unknown"}+${Constants.expoConfig?.ios?.buildNumber || Constants.nativeBuildVersion || "unknown"}` };
  if (!hasVerifiedNativeCoverage(day.updated_at, marker)) throw fail();
  const { error } = await withKdpTaskRequest(deadlineAtMs, async signal => {
    const query = supabase.from("kdp_marketplace_day_coverage")
      .upsert(marker, { onConflict: "account_id,date" });
    return await (signal ? query.abortSignal(signal) : query);
  });
  if (error) throw fail();
  const [covered, current] = await withKdpTaskRequest(deadlineAtMs, async signal => {
    const coveredRead = supabase.from("kdp_marketplace_day_coverage")
      .select("revision_id,daily_updated_at,marketplaces,fact_count")
      .eq("account_id", accountId).eq("date", date);
    const currentRead = supabase.from("kdp_daily_data").select("updated_at")
      .eq("account_id", accountId).eq("date", date);
    const results = await Promise.allSettled([
      (signal ? coveredRead.abortSignal(signal) : coveredRead).maybeSingle(),
      (signal ? currentRead.abortSignal(signal) : currentRead).maybeSingle(),
    ]);
    if (results[0].status === "rejected") throw results[0].reason;
    if (results[1].status === "rejected") throw results[1].reason;
    return [results[0].value, results[1].value] as const;
  });
  if (covered.error || current.error || covered.data?.revision_id !== revisionId
    || covered.data?.fact_count !== actual.length
    || !hasVerifiedNativeCoverage(current.data?.updated_at, covered.data)) throw fail();
}

export async function writeKdpCatalog(opts: {
  accountId: string;
  bookRows: AnyRow[];
  formatRows: AnyRow[];
  titleRows: AnyRow[];
  deadlineAtMs?: number;
}): Promise<void> {
  if (opts.bookRows.length) {
    await upsert("kdp_books", opts.bookRows, "account_id,id", opts.deadlineAtMs);
  }
  if (opts.formatRows.length) {
    await upsert("kdp_book_formats", opts.formatRows, "account_id,id", opts.deadlineAtMs);
  }
  if (opts.titleRows.length) {
    await upsert("kdp_titles", opts.titleRows, "account_id,asin", opts.deadlineAtMs);
  }
}

/** Persist calculator pricing captured from KDP print setup. */
export async function writeKdpPricing(opts: {
  accountId: string;
  titleRows: AnyRow[];
  marketplaceRows: AnyRow[];
  deadlineAtMs?: number;
}): Promise<void> {
  const stamp = (row: AnyRow) => ({ ...row, account_id: opts.accountId });
  await upsert(
    "kdp_titles",
    opts.titleRows.map(stamp),
    "account_id,asin",
    opts.deadlineAtMs,
  );
  await upsert(
    "kdp_title_marketplace_pricing",
    opts.marketplaceRows.map(stamp),
    "account_id,asin,marketplace",
    opts.deadlineAtMs,
  );
}
