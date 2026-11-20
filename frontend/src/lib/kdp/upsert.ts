import { supabase } from "../supabase.ts";
import { nestApiJson } from "../rulesApi.ts";
import { hasTransactionalNativeCoverage } from "./marketplaceCoverage.ts";
import { withKdpTaskRequest } from "./backgroundBudget.ts";
import {
  buildCompleteKdpCaptureEvidence, KDP_COMPLETE_REPORT_STORES,
  type KdpCaptureEvidence, type KdpCaptureSnapshot, type KdpCompleteCapture,
} from "./vendor/kdp-complete-capture.js";

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
  built: KdpCaptureSnapshot & { rowsBookDaily: AnyRow[] };
  factRows: AnyRow[];
  deadlineAtMs?: number;
} & (
  | { reviewOnly: true; completeCapture?: never }
  | { reviewOnly?: false; completeCapture: KdpCompleteCapture }
)): Promise<{ date: string; revisionId: string; dailyUpdatedAt: string } | void> {
  const { accountId, built: { rowDaily, rowEntry, rowsBookDaily }, factRows } = opts;
  const date = String(rowDaily.date || rowEntry.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Atomic KDP day write requires YYYY-MM-DD");
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const revisionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = token === "x" ? Number.parseInt(randomHex(), 16) : (Number.parseInt(randomHex(), 16) & 0x3) | 0x8;
    return value.toString(16);
  });
  const identity = { account_id: accountId, date, revision_id: revisionId };
  const marketplaces = opts.completeCapture?.stores.map(store => store.key);
  let captureEvidence: KdpCaptureEvidence | undefined;
  if (!opts.reviewOnly) {
    const scope = KDP_COMPLETE_REPORT_STORES;
    if (!opts.completeCapture || marketplaces?.length !== scope.length
      || !scope.every(store => marketplaces.includes(store))) {
      throw Object.assign(new Error("KDP capture requires all native marketplaces; existing data preserved"),
        { status: 503, code: "KDP_CAPTURE_INCOMPLETE" });
    }
    captureEvidence = buildCompleteKdpCaptureEvidence({
      ...opts.completeCapture, accountId, date, revisionId, built: opts.built,
    });
  }

  const result = await withKdpTaskRequest(opts.deadlineAtMs, signal => nestApiJson<{
    ok?: boolean; pending?: boolean;
    factRows?: number;
    submittedBookDailyRows?: number;
    staged?: boolean; quarantined?: boolean; candidateId?: string;
    accountId?: string; date?: string; revisionId?: string;
    coverageVerified?: boolean; coverageVersion?: number; coverageMarketplaces?: string[];
    verifiedFactRows?: number; dailyUpdatedAt?: string;
    completeCaptureVerified?: boolean; captureVerificationVersion?: number;
  }>(
    opts.reviewOnly ? "/kdp-sync/stage-correction" : "/kdp-sync/replace-day",
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        accountId,
        date,
        revisionId,
        includeAds: false,
        ...(captureEvidence ? { marketplaces, captureEvidence } : {}),
        dailyData: { ...rowDaily, ...identity },
        entry: { ...rowEntry, ...identity },
        bookDailyRows: rowsBookDaily.map((row) => ({ ...row, ...identity })),
        factRows: factRows.map((row) => ({ ...row, ...identity })),
      }),
    },
    `Atomic KDP write failed for ${date}; retry remains pending.`,
  ));
  if (opts.reviewOnly && result?.staged === true && result?.quarantined === true
    && result?.ok === false && /^[0-9a-f-]{36}$/i.test(String(result.candidateId || ""))
    && result.accountId === accountId && result.date === date && result.revisionId === revisionId) return;
  if (opts.reviewOnly) throw new Error(`KDP correction staging was not acknowledged for ${date}; existing data was preserved`);
  const unacknowledged = (message: string) => Object.assign(
    new Error(`${message} for ${date}; retry remains pending`),
    { status: 503, code: "KDP_ACK_INCOMPLETE" },
  );
  if (result?.ok !== true || result.pending === true
    || result.accountId !== accountId || result.date !== date || result.revisionId !== revisionId
    || Number(result.factRows) !== factRows.length
    || Number(result.submittedBookDailyRows) !== rowsBookDaily.length) {
    throw unacknowledged("Atomic KDP write acknowledgement mismatch");
  }
  if (result.completeCaptureVerified !== true || result.captureVerificationVersion !== 1) {
    throw unacknowledged("KDP complete-capture receipt missing or invalid");
  }
  if (!result.dailyUpdatedAt || !hasTransactionalNativeCoverage(result, { accountId, date, revisionId,
    factCount: factRows.length, bookCount: rowsBookDaily.length, marketplaces })) {
    throw unacknowledged("KDP transaction coverage receipt mismatch");
  }
  return { date, revisionId, dailyUpdatedAt: result.dailyUpdatedAt };
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
