import { supabase } from "../supabase.ts";
import { nestApiJson } from "../rulesApi.ts";

type AnyRow = Record<string, unknown>;

async function upsert(
  table: string,
  rows: AnyRow[],
  onConflict: string,
): Promise<void> {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
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
}): Promise<void> {
  const date = String(opts.rowDaily.date || opts.rowEntry.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Atomic KDP day write requires YYYY-MM-DD");
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const revisionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const value = token === "x" ? Number.parseInt(randomHex(), 16) : (Number.parseInt(randomHex(), 16) & 0x3) | 0x8;
    return value.toString(16);
  });
  const identity = { account_id: opts.accountId, date, revision_id: revisionId };
  const result = await nestApiJson<{
    ok?: boolean;
    factRows?: number;
    submittedBookDailyRows?: number;
    staged?: boolean; quarantined?: boolean; candidateId?: string;
    accountId?: string; date?: string; revisionId?: string;
  }>(
    opts.reviewOnly ? "/kdp-sync/stage-correction" : "/kdp-sync/replace-day",
    {
      method: "POST",
      body: JSON.stringify({
        accountId: opts.accountId,
        date,
        revisionId,
        includeAds: false,
        dailyData: { ...opts.rowDaily, ...identity },
        entry: { ...opts.rowEntry, ...identity },
        bookDailyRows: opts.rowsBookDaily.map((row) => ({ ...row, ...identity })),
        factRows: opts.factRows.map((row) => ({ ...row, ...identity })),
      }),
    },
    `Atomic KDP write failed for ${date}; existing data was preserved.`,
  );
  if (opts.reviewOnly && result?.staged === true && result?.quarantined === true
    && result?.ok === false && /^[0-9a-f-]{36}$/i.test(String(result.candidateId || ""))
    && result.accountId === opts.accountId && result.date === date && result.revisionId === revisionId) return;
  if (opts.reviewOnly) throw new Error(`KDP correction staging was not acknowledged for ${date}; existing data was preserved`);
  if (
    result?.ok !== true ||
    Number(result.factRows) !== opts.factRows.length ||
    Number(result.submittedBookDailyRows) !== opts.rowsBookDaily.length
  ) {
    throw new Error(`Atomic KDP write acknowledgement mismatch for ${date}; existing data was preserved`);
  }
}

export async function writeKdpCatalog(opts: {
  accountId: string;
  bookRows: AnyRow[];
  formatRows: AnyRow[];
  titleRows: AnyRow[];
}): Promise<void> {
  if (opts.bookRows.length) {
    await upsert("kdp_books", opts.bookRows, "account_id,id");
  }
  if (opts.formatRows.length) {
    await upsert("kdp_book_formats", opts.formatRows, "account_id,id");
  }
  if (opts.titleRows.length) {
    await upsert("kdp_titles", opts.titleRows, "account_id,asin");
  }
}

/** Persist calculator pricing captured from KDP print setup. */
export async function writeKdpPricing(opts: {
  accountId: string;
  titleRows: AnyRow[];
  marketplaceRows: AnyRow[];
}): Promise<void> {
  const stamp = (row: AnyRow) => ({ ...row, account_id: opts.accountId });
  await upsert(
    "kdp_titles",
    opts.titleRows.map(stamp),
    "account_id,asin",
  );
  await upsert(
    "kdp_title_marketplace_pricing",
    opts.marketplaceRows.map(stamp),
    "account_id,asin,marketplace",
  );
}
