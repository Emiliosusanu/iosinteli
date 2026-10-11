/**
 * Dual-source background refresh: iPhone pulls Ads + linked KDP from InteliAds cloud
 * while Chrome helper may be offline. KDP still originates from Chrome/server import —
 * this device refreshes reads and can nudge Amazon Ads sync when stale.
 */
import { storage } from "@/src/utils/storage";
import { supabase } from "./supabase";
import { FINANCIAL_QUERY_ROOTS } from "./financialReadVersion";
import {
  loadLastMobileHomeScope,
  persistMobileHomeSnapshot,
  stampMobileHomeSource,
  type MobileHomeCacheScope,
} from "./mobileHomeSnapshot";
import { adsProfileIdsForSelection, filterToEnabledProfileSelection, mergeBackgroundScope, parseSelectedProfileIds } from "./notificationScope";
import { activatedAdsProfileIds, activatedProfileIds } from "./notificationAuthority";
import { buildVerifiedFinancialWidgetPayload, nativeFinancialScopeKey } from "./widgetFinance";

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

/** Scope for background work — live header selection, then last Home snapshot. */
export async function resolveBackgroundScope(): Promise<MobileHomeCacheScope | null> {
  const fromHome = await loadLastMobileHomeScope().catch(() => null);
  let sessionUserId: string | null = null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    sessionUserId = session?.user?.id ?? null;
  } catch {
    sessionUserId = null;
  }
  const selectedIds = parseSelectedProfileIds(await storage.getItem(PROFILES_KEY, ""));
  return mergeBackgroundScope({
    selectedIds,
    lastHome: fromHome,
    sessionUserId,
  });
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

/** Refresh Home + verified rolling-7-day widget finance from cloud (Chrome may be offline). */
export async function refreshDualSourceFinancialCache(
  source: "background" | "foreground" | "push" = "background",
): Promise<boolean> {
  const scope = await resolveBackgroundScope();
  if (!scope) return false;

  try {
    const { fetchMobileOverview } = await import("./dashboardApi");
    const { fetchAmazonProfiles, fetchKdpRoyaltiesRange } = await import("./queries");
    const { selectKdpRoyaltyScopeForSelection } = await import("./kdpRoyaltyScope");
    const profiles = await fetchAmazonProfiles(scope.userId, scope.viewAs).catch(() => []);
    // Home financials are full-portfolio. The header/profile picker only filters
    // Ads Engine, so a background wake must not persist a narrower snapshot
    // under a different scope and leave Home cold on the next launch.
    const portfolioAdsIds = activatedAdsProfileIds(profiles);
    const selectedAdsIds = adsProfileIdsForSelection(scope.profileIds, profiles);
    const queryIds = portfolioAdsIds.length
      ? portfolioAdsIds
      : selectedAdsIds.length
        ? selectedAdsIds
        : filterToEnabledProfileSelection(scope.profileIds, profiles);
    if (!queryIds.length) return false;
    const portfolioScope = { ...scope, profileIds: queryIds };
    const snapshot = await fetchMobileOverview({
      profileIds: queryIds,
      filterUserId: scope.viewAs,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    await persistMobileHomeSnapshot(
      portfolioScope,
      stampMobileHomeSource(snapshot, "nest"),
    );

    let widgetRoyaltiesReadCompleted = false;
    let widgetPayload: ReturnType<typeof buildVerifiedFinancialWidgetPayload> = null;
    try {
      const portfolioSelection = activatedProfileIds(profiles);
      const royaltyIds = selectKdpRoyaltyScopeForSelection(
        profiles,
        portfolioSelection.length
          ? portfolioSelection
          : filterToEnabledProfileSelection(scope.profileIds, profiles),
      ).profileIds;
      if (royaltyIds.length) {
        const royalties = await fetchKdpRoyaltiesRange(
          royaltyIds,
          snapshot.sevenDay.start,
          snapshot.sevenDay.end,
        );
        widgetRoyaltiesReadCompleted = true;
        widgetPayload = buildVerifiedFinancialWidgetPayload({
          snapshot,
          royalties,
          currencySymbol: "$",
        });
      } else {
        widgetRoyaltiesReadCompleted = true;
      }
    } catch (error) {
      devWarn("KDP background read skipped", error);
    }

    // WidgetKit never receives partial money. A verified empty/unlinked KDP
    // scope clears the prior scope; a transient read error leaves the last
    // verified value until WidgetKit's six-hour freshness gate expires.
    try {
      const { updateNativeFinancialSnapshot } = await import("inteliads-native-sync");
      if (widgetPayload) {
        await updateNativeFinancialSnapshot(widgetPayload);
      } else if (widgetRoyaltiesReadCompleted) {
        await updateNativeFinancialSnapshot({
          verified: false,
          asOfMs: Date.now(),
          periodLabel: "Last 7 days",
          scopeKey: nativeFinancialScopeKey(snapshot),
          reload: true,
        });
      }
    } catch (error) {
      devWarn("Widget finance publish skipped", error);
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
  // Warm Create book catalog even when Create isn't mounted — kill/relaunch
  // stress otherwise hits a cold Nest /book-candidates under the screen timeout.
  void warmCampaignCreationBooksCache();
}

/** Prefetch Nest Create book-candidates into React Query (best-effort). */
export async function warmCampaignCreationBooksCache(): Promise<void> {
  try {
    const { fetchCampaignCreationBooks } = await import("./mutations");
    const { CAMPAIGN_CREATION_BOOKS_QUERY_KEY } = await import("./campaignCreationStock");
    const { appQueryClient } = await import("./queryClient");
    const { CAMPAIGN_CREATION_BOOKS_TIMEOUT_MS, withQueryTimeout } = await import("./queryTimeout");
    const existing = appQueryClient.getQueryData(CAMPAIGN_CREATION_BOOKS_QUERY_KEY);
    if (existing) return;
    const data = await withQueryTimeout(
      fetchCampaignCreationBooks(),
      CAMPAIGN_CREATION_BOOKS_TIMEOUT_MS,
    );
    appQueryClient.setQueryData(CAMPAIGN_CREATION_BOOKS_QUERY_KEY, data);
  } catch (error) {
    devWarn("Create books warm skipped", error);
  }
}

/** React Query roots worth invalidating after a background refresh / AppState resume. */
export function backgroundFinancialQueryRoots(): string[] {
  return [
    FINANCIAL_QUERY_ROOTS.mobileOverview,
    FINANCIAL_QUERY_ROOTS.kdpRoyalties,
    FINANCIAL_QUERY_ROOTS.kdpRoyaltiesToday,
    FINANCIAL_QUERY_ROOTS.kdpRoyaltiesYesterday,
    FINANCIAL_QUERY_ROOTS.kdpRoyaltiesSevenDay,
    FINANCIAL_QUERY_ROOTS.topBooks,
    FINANCIAL_QUERY_ROOTS.products,
    FINANCIAL_QUERY_ROOTS.campaignMetrics,
    FINANCIAL_QUERY_ROOTS.campaignMetricsToday,
    // List tabs + Create: resume must not keep overnight / background-stale rows.
    "campaigns-list-range-v3",
    "mobile-targeting-page-v1",
    "targeting-book-options-v2",
    "campaign-filter-books",
    "campaign-creation-books",
    "campaign-creation-book-activity",
  ];
}
