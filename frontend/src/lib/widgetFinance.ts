import type { FinancialWidgetSnapshotPayload } from "inteliads-native-sync";
import type { KdpRoyaltyRange } from "./queries.ts";
import type { MobileHomeSnapshot } from "./mobileHomeSnapshot.ts";

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function nativeFinancialScopeKey(snapshot: MobileHomeSnapshot): string {
  return [
    snapshot.scope.userId,
    [...snapshot.scope.profileIds].sort().join(","),
    String(snapshot.scope.currency || "none").toUpperCase(),
  ].join(":");
}

/**
 * A WidgetKit money snapshot exists only when Ads and KDP returned verified
 * values for the same rolling-seven-day period. Missing/no-sync never becomes
 * zero. A successful zero row remains a real $0.
 */
export function buildVerifiedFinancialWidgetPayload(input: {
  snapshot: MobileHomeSnapshot;
  royalties: KdpRoyaltyRange;
  currencySymbol?: string;
  nowMs?: number;
}): FinancialWidgetSnapshotPayload | null {
  const { snapshot, royalties } = input;
  const currency = String(snapshot.scope.currency || "").toUpperCase();
  if (currency !== "USD") return null;
  if (snapshot.sevenDay.state !== "verified" && snapshot.sevenDay.state !== "verified_zero") {
    return null;
  }
  if (!royalties.hasKdpData) return null;

  const adSpend = finite(snapshot.sevenDay.spend);
  const gross = finite(royalties.totalRoyalties);
  if (adSpend == null || gross == null) return null;

  return {
    verified: true,
    asOfMs: input.nowMs ?? Date.now(),
    periodLabel: `${shortDate(snapshot.sevenDay.start)}–${shortDate(snapshot.sevenDay.end)}`,
    scopeKey: nativeFinancialScopeKey(snapshot),
    currencySymbol: input.currencySymbol || "$",
    royalties: gross,
    adSpend,
    net: gross - adSpend,
    reload: true,
  };
}

