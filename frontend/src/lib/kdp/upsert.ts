import { supabase } from "../supabase.ts";

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
}): Promise<void> {
  const stamp = (row: AnyRow) => ({ ...row, account_id: opts.accountId });
  await upsert("kdp_daily_data", [stamp(opts.rowDaily)], "account_id,date");
  await upsert("kdp_entries", [stamp(opts.rowEntry)], "account_id,date");
  await upsert(
    "kdp_book_daily_data",
    opts.rowsBookDaily.map(stamp),
    "account_id,date,asin",
  );
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
