/** Configurable default bid for one-tap “Add Exact” on search terms. */

/** Server + iOS share this default when Settings has no override. */
export const DEFAULT_EXACT_HARVEST_BID = 0.85;
export const EXACT_HARVEST_BID_MIN = 0.02;
export const EXACT_HARVEST_BID_MAX = 100;

export const EXACT_HARVEST_BID_SETTING_KEY = "exactHarvestBid";
export const EXACT_HARVEST_BID_STORAGE_KEY = "inteliads.exactHarvestBid";

export const EXACT_HARVEST_BID_LABEL = "Default Exact bid";
export const EXACT_HARVEST_BID_SUBTITLE = "Used when you tap Add Exact on campaign search terms";

export function coalesceExactHarvestBid(raw: unknown, fallback = DEFAULT_EXACT_HARVEST_BID): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < EXACT_HARVEST_BID_MIN) return EXACT_HARVEST_BID_MIN;
  if (n > EXACT_HARVEST_BID_MAX) return EXACT_HARVEST_BID_MAX;
  return Math.round(n * 100) / 100;
}
