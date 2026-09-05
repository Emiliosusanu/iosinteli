export type BiddingStrategyCode = "AUTO_FOR_SALES" | "LEGACY_FOR_SALES" | "MANUAL";

export type EntityStateFilter = "all" | "enabled" | "paused";

/** Targets page default state chip: Active (entity + enabled parents). */
export const DEFAULT_TARGETING_STATE_FILTER: EntityStateFilter = "enabled";

/** Coerce remembered Targets state; missing/invalid → Active. */
export function resolveTargetingStateFilter(raw: unknown): EntityStateFilter {
  if (raw === "all" || raw === "enabled" || raw === "paused") return raw;
  return DEFAULT_TARGETING_STATE_FILTER;
}

export const BIDDING_STRATEGY_OPTIONS: {
  code: BiddingStrategyCode;
  label: string;
  hint: string;
}[] = [
  { code: "AUTO_FOR_SALES", label: "Up & Down", hint: "" },
  { code: "LEGACY_FOR_SALES", label: "Down Only", hint: "" },
  { code: "MANUAL", label: "Fixed", hint: "" },
];

export function biddingStrategyLabel(strategy: string | null | undefined): string {
  const normalized = String(strategy ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized || normalized === "manual" || normalized.includes("fixed")) return "Fixed";
  if (
    normalized.includes("autoforsales") ||
    normalized === "auto" ||
    (normalized.includes("up") && normalized.includes("down"))
  ) {
    return "Up & Down";
  }
  if (normalized.includes("legacyforsales") || normalized.includes("downonly") || normalized.includes("down")) {
    return "Down Only";
  }
  return String(strategy);
}

/** Normalize Amazon / DB bidding strategy strings to Nest PATCH codes. */
export function normalizeBiddingStrategyCode(
  strategy: string | null | undefined,
): BiddingStrategyCode | null {
  const normalized = String(strategy ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized) return null;
  if (normalized.includes("autoforsales") || (normalized.includes("up") && normalized.includes("down"))) {
    return "AUTO_FOR_SALES";
  }
  if (normalized.includes("legacyforsales") || normalized.includes("downonly")) {
    return "LEGACY_FOR_SALES";
  }
  if (normalized === "manual" || normalized.includes("fixed")) return "MANUAL";
  if (normalized === "auto") return "AUTO_FOR_SALES";
  if (normalized.includes("down")) return "LEGACY_FOR_SALES";
  return null;
}

export function isDynamicBiddingStrategy(strategy: string | null | undefined): boolean {
  const code = normalizeBiddingStrategyCode(strategy);
  return code === "AUTO_FOR_SALES" || code === "LEGACY_FOR_SALES";
}

export function statusLabel(state: string | null | undefined): string {
  const normalized = String(state ?? "").toLowerCase();
  if (normalized === "enabled" || normalized === "active") return "Active";
  if (normalized === "paused") return "Paused";
  if (normalized === "archived") return "Archived";
  return state ? String(state) : "-";
}

export function hasPeriodData(row: Record<string, unknown>): boolean {
  return (
    Number(row.total_spend ?? row.spend ?? 0) > 0 ||
    Number(row.total_sales ?? row.sales ?? 0) > 0 ||
    Number(row.total_orders ?? row.orders ?? 0) > 0 ||
    Number(row.total_clicks ?? row.clicks ?? 0) > 0 ||
    Number(row.total_impressions ?? row.impressions ?? 0) > 0
  );
}

export function normalizeEntityState(state: string | null | undefined): "enabled" | "paused" | "archived" | "other" {
  const normalized = String(state ?? "").toLowerCase();
  if (normalized === "enabled" || normalized === "active") return "enabled";
  if (normalized === "paused") return "paused";
  if (normalized === "archived") return "archived";
  return "other";
}

/**
 * Default list visibility: non-archived enabled + paused (legacy helper).
 * Prefer matchesEntityStateFilter + active parents for Targeting defaults.
 */
export function shouldShowActiveOrPausedWithData(row: Record<string, unknown>, state: string | null | undefined): boolean {
  const normalized = normalizeEntityState(state);
  if (normalized === "archived") return false;
  if (normalized === "enabled" || normalized === "paused") return true;
  return hasPeriodData(row);
}

/** UI state chip: Active / Paused / All (never surfaces archived). */
export function matchesEntityStateFilter(
  state: string | null | undefined,
  filter: EntityStateFilter,
): boolean {
  const normalized = normalizeEntityState(state);
  if (normalized === "archived") return false;
  if (filter === "all") return normalized === "enabled" || normalized === "paused" || normalized === "other";
  if (filter === "enabled") return normalized === "enabled";
  return normalized === "paused";
}

/**
 * Live Ads surface: entity itself + parent campaign/ad group must match the
 * Active filter. Fail closed when Active — unknown/missing parent state hides
 * the row so paused parents cannot leak into the default list.
 */
export function matchesLiveTargetingRow(
  opts: {
    entityState: string | null | undefined;
    campaignState?: string | null;
    adGroupState?: string | null;
    filter: EntityStateFilter;
  },
): boolean {
  if (!matchesEntityStateFilter(opts.entityState, opts.filter)) return false;
  if (opts.filter !== "enabled") return true;
  if (normalizeEntityState(opts.campaignState) !== "enabled") {
    return false;
  }
  // Callers that pass adGroupState (even null) require an enabled ad group.
  if ("adGroupState" in opts && normalizeEntityState(opts.adGroupState) !== "enabled") {
    return false;
  }
  return true;
}
