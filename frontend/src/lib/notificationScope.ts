/**
 * Which Amazon Ads profiles background refresh and local notifications use.
 * Header selection is the source of truth so today's totals cover every
 * selected profile — not a stale last-Home snapshot.
 */
import type { MobileHomeCacheScope } from "./mobileHomeSnapshot.ts";

function nestAdsId(
  selectedId: string,
  profiles: Array<{ id: string; profile_id?: string | null }>,
): string {
  const match = profiles.find(
    (profile) => profile.id === selectedId || profile.profile_id === selectedId,
  );
  return String(match?.profile_id || selectedId);
}

export function uniqueProfileIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Accepts the live array, a JSON array string, or AppContext's double-encoded string. */
export function parseSelectedProfileIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return uniqueProfileIds(raw);
  if (typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    return parseSelectedProfileIds(JSON.parse(trimmed));
  } catch {
    return [];
  }
}

export function mergeBackgroundScope(input: {
  selectedIds: readonly string[];
  lastHome: MobileHomeCacheScope | null;
  sessionUserId: string | null;
}): MobileHomeCacheScope | null {
  const userId = String(input.sessionUserId || input.lastHome?.userId || "").trim();
  if (!userId) return null;
  const home =
    input.lastHome?.userId && input.lastHome.userId === userId ? input.lastHome : null;
  const selected = uniqueProfileIds(input.selectedIds);
  const profileIds = selected.length ? selected : uniqueProfileIds(home?.profileIds ?? []);
  if (!profileIds.length) return null;
  return {
    userId,
    viewAs: home?.viewAs ?? null,
    profileIds,
    currency: home?.currency ?? null,
  };
}

/** Nest `/dashboard/mobile` wants Amazon ads profile_id for every selected row. */
export function adsProfileIdsForSelection(
  selectedIds: readonly string[],
  profiles: Array<{ id: string; profile_id?: string | null }>,
): string[] {
  const wanted = uniqueProfileIds(selectedIds);
  if (!wanted.length) return [];
  if (!profiles.length) return wanted;
  return uniqueProfileIds(wanted.map((id) => nestAdsId(id, profiles)));
}
