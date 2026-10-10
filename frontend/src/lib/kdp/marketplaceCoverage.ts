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
