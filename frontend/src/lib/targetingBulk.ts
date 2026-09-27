import {
  getEntityBidCooldown,
  getPlacementAdjCooldown,
  type EntityBidCooldownFields,
  type EntityBidCooldownInfo,
} from "./bidCooldown.ts";

export const PLACEMENT_ADJ_MIN = 0;
export const PLACEMENT_ADJ_MAX = 900;

export type PlacementAdjField = "top_of_search" | "product_pages" | "rest_of_search";
export type BulkDeltaMode = "increase_usd" | "decrease_usd" | "increase_pct" | "decrease_pct";
export type BulkCooldownKind = "entity_bid" | "placement_adj";

export type BulkCooldownFn = (
  row: EntityBidCooldownFields,
  cooldownHours?: number,
  nowMs?: number,
) => EntityBidCooldownInfo;

export function cooldownFnForBulk(kind: BulkCooldownKind = "entity_bid"): BulkCooldownFn {
  return kind === "placement_adj" ? getPlacementAdjCooldown : getEntityBidCooldown;
}

export function clampPlacementAdj(value: number): number {
  if (!Number.isFinite(value)) return PLACEMENT_ADJ_MIN;
  return Math.max(PLACEMENT_ADJ_MIN, Math.min(PLACEMENT_ADJ_MAX, Math.round(value)));
}

/** Placement bulk uses percentage points. 0% + 10 stays 10 (multiply would stay 0). */
export function applyPlacementAdjPoints(base: number | null | undefined, signedPoints: number): number {
  const current = Number.isFinite(Number(base)) ? Number(base) : 0;
  return clampPlacementAdj(current + signedPoints);
}

export function signedBulkAmount(mode: BulkDeltaMode, amount: number): number {
  const n = Math.abs(Number(amount) || 0);
  return mode.startsWith("decrease") ? -n : n;
}

export function indexRowsById<T extends { id?: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = String(row?.id ?? "").trim();
    if (id) map.set(id, row);
  }
  return map;
}

export function partitionSelectedByCooldown(
  selectedIds: readonly string[],
  rowById: Map<string, EntityBidCooldownFields & { id?: string }>,
  cooldownHours?: number,
  nowMs: number = Date.now(),
  cooldownFn: BulkCooldownFn = getEntityBidCooldown,
): { cooldownIds: string[]; readyIds: string[]; missingIds: string[] } {
  const cooldownIds: string[] = [];
  const readyIds: string[] = [];
  const missingIds: string[] = [];
  for (const raw of selectedIds) {
    const id = String(raw);
    const row = rowById.get(id);
    if (!row) {
      missingIds.push(id);
      continue;
    }
    if (cooldownFn(row, cooldownHours, nowMs).isInCooldown) cooldownIds.push(id);
    else readyIds.push(id);
  }
  return { cooldownIds, readyIds, missingIds };
}

export function groupPlacementFieldsByCampaign(
  selectedIds: readonly string[],
  rowById: Map<string, { campaign_id?: string; placement_key?: string }>,
): Map<string, PlacementAdjField[]> {
  const grouped = new Map<string, PlacementAdjField[]>();
  const seen = new Set<string>();
  for (const raw of selectedIds) {
    const row = rowById.get(String(raw));
    const campaignId = String(row?.campaign_id || String(raw).split("::")[0] || "").trim();
    const field = String(row?.placement_key || String(raw).split("::")[1] || "").trim() as PlacementAdjField;
    if (!campaignId) continue;
    if (field !== "top_of_search" && field !== "product_pages" && field !== "rest_of_search") continue;
    const key = `${campaignId}::${field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = grouped.get(campaignId) ?? [];
    list.push(field);
    grouped.set(campaignId, list);
  }
  return grouped;
}
