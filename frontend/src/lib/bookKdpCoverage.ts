import { identityAsinsForBookRow } from "./booksListActivity.ts";
import { aggregateKdpDailyRows } from "./kdpRoyaltiesTrace.ts";

/** Coverage follows the accounts owning this book, not every account in the
 * selected portfolio. A gap in another publisher's history must not mark a
 * complete book partial; shared-ASIN books still require all owning accounts.
 */
export function createBookKdpCoverage(
  coverageRows: readonly { account_id?: string | null; date?: string | null }[] | null,
  identities: readonly { account_id?: string | null; asin?: string | null }[],
  selectedAccountIds: readonly string[],
  range: { start: string; end: string },
) {
  const allowed = new Set(selectedAccountIds);
  const owners = new Map<string, Set<string>>();
  for (const row of identities) {
    const asin = String(row.asin ?? "").trim().toUpperCase();
    const account = String(row.account_id ?? "");
    if (!asin || !allowed.has(account)) continue;
    const ids = owners.get(asin) ?? new Set<string>();
    ids.add(account); owners.set(asin, ids);
  }
  const rowsByAccount = new Map<string, Array<{ account_id: string; date: string }>>();
  for (const row of coverageRows ?? []) {
    const account = String(row.account_id ?? ""), date = String(row.date ?? "");
    if (!allowed.has(account) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.start || date > range.end) continue;
    const rows = rowsByAccount.get(account) ?? [];
    rows.push({ account_id: account, date }); rowsByAccount.set(account, rows);
  }
  const complete = new Set(selectedAccountIds.filter(account =>
    coverageRows != null && aggregateKdpDailyRows(rowsByAccount.get(account) ?? [], 1, {
      ...range, source: "kdp_daily_data",
    }).coverage === "complete",
  ));
  return (book: Parameters<typeof identityAsinsForBookRow>[0]): "ready" | "partial" => {
    const accounts = new Set(identityAsinsForBookRow(book).flatMap(asin => [...(owners.get(asin) ?? [])]));
    return accounts.size > 0 && [...accounts].every(account => complete.has(account)) ? "ready" : "partial";
  };
}
