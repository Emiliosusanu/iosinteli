/**
 * Dual-source background refresh: iPhone pulls Ads + linked KDP from InteliAds cloud
 * while Chrome helper may be offline. KDP still originates from Chrome/server import —
 * this device refreshes reads and can nudge Amazon Ads sync when stale.
 */
import { storage } from "@/src/utils/storage";
import { supabase } from "./supabase";
import { toDateString } from "./format";
import { FINANCIAL_QUERY_ROOTS } from "./financialReadVersion";
import {
  loadLastMobileHomeScope,
  persistMobileHomeSnapshot,
  stampMobileHomeSource,
  type MobileHomeCacheScope,
} from "./mobileHomeSnapshot";

export const BACKGROUND_REFRESH_COOLDOWN_MS = 15 * 60_000;
export const ADS_SYNC_TRIGGER_COOLDOWN_MS = 30 * 60_000;
export const ADS_SYNC_STALE_MS = 2 * 60 * 60_000;

const LAST_REFRESH_KEY = "inteliads.backgroundRefreshLastRun";
const LAST_ADS_TRIGGER_KEY = "inteliads.backgroundAdsTriggerLastRun";
const PROFILES_KEY = "inteliads.selectedProfiles";

function devWarn(message: string, error?: unknown) {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.warn(`[inteliads:background] ${message}`, error ?? "");
}

async function readLastRun(key: string): Promise<number> {
  try {
    const raw = await storage.getItem(key, "");
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function writeLastRun(key: string): Promise<void> {
  await storage.setItem(key, String(Date.now()));
}

/** Scope for background work — prefers last Home scope, falls back to saved profile IDs. */
export async function resolveBackgroundScope(): Promise<MobileHomeCacheScope | null> {
  const fromHome = await loadLastMobileHomeScope();
  if (fromHome?.userId && fromHome.profileIds.length > 0) return fromHome;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;
    const profileIds = await storage.getItem<string[]>(PROFILES_KEY, []);
    if (!Array.isArray(profileIds) || profileIds.length === 0) return null;
    return { userId, viewAs: null, profileIds, currency: null };
  } catch {
    return null;
  }
}

async function maybeTriggerAdsSync(snapshotGeneratedAt: string | null | undefined): Promise<void> {
  const lastTrigger = await readLastRun(LAST_ADS_TRIGGER_KEY);
  if (Date.now() - lastTrigger < ADS_SYNC_TRIGGER_COOLDOWN_MS) return;

  const generated = snapshotGeneratedAt ? Date.parse(snapshotGeneratedAt) : Number.NaN;
  const adsStale =
    !Number.isFinite(generated) || Date.now() - generated > ADS_SYNC_STALE_MS;
  if (!adsStale) return;

  try {
    const { triggerSync } = await import("./mutations");
    await triggerSync();
    await writeLastRun(LAST_ADS_TRIGGER_KEY);
  } catch (error) {
    devWarn("Ads sync trigger skipped", error);
  }
}

/** Refresh Home snapshot + today's KDP royalties from cloud (Chrome may be offline). */
export async function refreshDualSourceFinancialCache(
  source: "background" | "foreground" | "push" = "background",
): Promise<boolean> {
  const scope = await resolveBackgroundScope();
  if (!scope) return false;

  try {
    const { fetchMobileOverview } = await import("./dashboardApi");
    const snapshot = await fetchMobileOverview({
      profileIds: scope.profileIds,
      filterUserId: scope.viewAs,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    await persistMobileHomeSnapshot(scope, stampMobileHomeSource(snapshot, "nest"));

    const today = toDateString(new Date());
    try {
      const { fetchKdpRoyaltiesRange } = await import("./queries");
      await fetchKdpRoyaltiesRange(scope.profileIds, today, today);
    } catch (error) {
      devWarn("KDP background read skipped", error);
    }

    if (source === "background") {
      void maybeTriggerAdsSync(snapshot.freshness?.lastSuccessfulAdsSync ?? snapshot.generatedAt);
    }
    return true;
  } catch (error) {
    devWarn(`dual-source refresh skipped (${source})`, error);
    return false;
  }
}

/** Rate-limited wrapper used by background task, push wake, and AppState resume. */
export async function runDualSourceBackgroundRefresh(
  source: "background" | "foreground" | "push" = "background",
  opts?: { force?: boolean },
): Promise<void> {
  if (!opts?.force && source === "background") {
    const lastRun = await readLastRun(LAST_REFRESH_KEY);
    if (Date.now() - lastRun < BACKGROUND_REFRESH_COOLDOWN_MS) return;
  }
  const ok = await refreshDualSourceFinancialCache(source);
  if (ok) await writeLastRun(LAST_REFRESH_KEY);
}

/** React Query roots worth invalidating after a background refresh. */
export function backgroundFinancialQueryRoots(): string[] {
  return [
    FINANCIAL_QUERY_ROOTS.mobileOverview,
    FINANCIAL_QUERY_ROOTS.kdpRoyalties,
    FINANCIAL_QUERY_ROOTS.kdpRoyaltiesToday,
    FINANCIAL_QUERY_ROOTS.kdpRoyaltiesYesterday,
    FINANCIAL_QUERY_ROOTS.kdpRoyaltiesSevenDay,
    FINANCIAL_QUERY_ROOTS.topBooks,
    FINANCIAL_QUERY_ROOTS.campaignMetricsToday,
  ];
}
