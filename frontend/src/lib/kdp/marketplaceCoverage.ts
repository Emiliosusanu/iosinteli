import { allKdpMarketplaceTargets } from "./marketplace.ts";

type Row = Record<string, unknown>;

export function kdpFactSnapshotsMatch(expected: Row[], actual: Row[]): boolean {
  const fingerprint = (rows: Row[]) => rows.map((row) => [
    String(row.asin || "").trim().toUpperCase(),
    String(row.format || "").trim().toLowerCase(),
    String(row.marketplace || "").trim().toUpperCase(),
    String(row.currency || "").trim().toUpperCase(),
    Number(row.units || 0), Number(row.royalties || 0), Number(row.kenp || 0),
  ].join("|")).sort();
  return JSON.stringify(fingerprint(expected)) === JSON.stringify(fingerprint(actual));
}

export function hasVerifiedNativeCoverage(dailyUpdatedAt: unknown, marker: Row | null | undefined): boolean {
  if (!dailyUpdatedAt || marker?.daily_updated_at !== dailyUpdatedAt || !Array.isArray(marker.marketplaces)) return false;
  const covered = new Set(marker.marketplaces.map((value) => String(value).toUpperCase()));
  return allKdpMarketplaceTargets().every((target) => covered.has(target.key));
}

/** A versioned server receipt is emitted only after SQL compared the complete
 * stored native facts and wrote their coverage marker in that transaction. */
export function hasTransactionalNativeCoverage(receipt: Row | null | undefined, expected: { accountId: string; date: string; revisionId: string; factCount: number; bookCount: number; marketplaces?: string[] }) {
  const scope = ['AU','BE','BR','CA','DE','ES','FR','GB','IE','IN','IT','JP','MX','NL','PL','SE','US'];
  return receipt?.ok === true && receipt.coverageVerified === true && receipt.coverageVersion === 1
    && receipt.accountId === expected.accountId && receipt.date === expected.date
    && receipt.revisionId === expected.revisionId
    && Number(receipt.factRows) === expected.factCount && Number(receipt.verifiedFactRows) === expected.factCount
    && Number(receipt.submittedBookDailyRows) === expected.bookCount
    && typeof receipt.dailyUpdatedAt === 'string' && Number.isFinite(Date.parse(receipt.dailyUpdatedAt))
    && Array.isArray(receipt.coverageMarketplaces)
    && JSON.stringify([...receipt.coverageMarketplaces].sort()) === JSON.stringify(scope)
    && Array.isArray(expected.marketplaces)
    && JSON.stringify([...expected.marketplaces].sort()) === JSON.stringify(scope);
}
