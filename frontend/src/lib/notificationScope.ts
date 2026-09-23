/**
 * Which Amazon Ads profiles background refresh and local notifications use.
 * Header selection is the source of truth so today's totals cover every
 * *enabled* selected profile — never disabled accounts in the active total.
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

/**
 * Drop disabled profiles from a selection before notification / background totals.
 * Missing `is_enabled` counts as enabled (Nest contract). If profiles cannot be
 * loaded, keep the selection unchanged (fail-open).
 */
export function filterToEnabledProfileSelection(
  selectedIds: readonly string[],
  profiles: Array<{ id: string; profile_id?: string | null; is_enabled?: boolean | null }>,
): string[] {
  const wanted = uniqueProfileIds(selectedIds);
  if (!wanted.length) return [];
  if (!profiles.length) return wanted;
  const enabled = profiles.filter((profile) => profile.is_enabled !== false);
  if (!enabled.length) return [];
  const keys = new Set<string>();
  for (const profile of enabled) {
    keys.add(String(profile.id));
    if (profile.profile_id) keys.add(String(profile.profile_id));
  }
  return wanted.filter((id) => keys.has(id));
}

/** Nest `/dashboard/mobile` wants Amazon ads profile_id for every selected row. */
export function adsProfileIdsForSelection(
  selectedIds: readonly string[],
  profiles: Array<{ id: string; profile_id?: string | null; is_enabled?: boolean | null }>,
): string[] {
  const wanted = filterToEnabledProfileSelection(selectedIds, profiles);
  if (!wanted.length) return [];
  if (!profiles.length) return wanted;
  return uniqueProfileIds(wanted.map((id) => nestAdsId(id, profiles)));
}
