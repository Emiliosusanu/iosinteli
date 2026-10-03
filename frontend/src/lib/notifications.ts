import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { getNativeApnsEnvironment } from "inteliads-native-sync";
import type { NotificationPrefs } from "@/src/contexts/AppContext";
import { storage } from "@/src/utils/storage";
import { supabase } from "./supabase";
import { toDateString } from "./format";
import { TEST_NOTIFICATION_BODY, TEST_NOTIFICATION_TITLE } from "./settingsContract";
import {
  LOCAL_NEW_ORDER_AUTHORITY,
  NOTIFICATION_EVENTS,
  buildNotificationPayload,
  notificationIdentifier,
  parseNotificationPayload,
  preferenceAllowsEvent,
  rollAlertState,
  shouldEvaluateAlerts,
  spendExceedsBudget,
  newOrderDelta,
  bookNeedsAttention,
  canNotifyBookToday,
  markBookNotified,
  canNotifyKdpStall,
  markKdpStallNotified,
  clearKdpStallNotified,
  anyNotificationPrefEnabled,
  type AlertState,
} from "./notificationContract";
import { kdpStallAlertCopy } from "./kdpIngestFreshness";
import {
  digestTitleForHour,
  formatDigestBody,
  honestTotalsFromDayPoint,
  isMorningDigestHour,
  mixedCurrencyDigestNote,
  shouldSendDigestHour,
  type HonestDigestTotals,
} from "./notificationDigest";
import { netRoyaltiesKnown } from "./netRoyalties";
import {
  activatedAdsProfileIds,
  activatedProfileIds,
  countFreshCompletedProfiles,
  digestCoverageLine,
  digestFetchGroupsForMoney,
  digestMoneyAdsProfileIds,
  digestNativeCurrencyFetchGroups,
  nestMoneyHiddenForDigest,
} from "./notificationAuthority";
import { adsProfileIdsForSelection, filterToEnabledProfileSelection, uniqueProfileIds } from "./notificationScope";
import { nestApiJson } from "./rulesApi";
import { resolveApnsEnvironment } from "./apnsEnvironment";

export const INTELIADS_BACKGROUND_TASK = "io.inteliads.app.background-refresh";
export const INTELIADS_NOTIFICATION_TASK = "io.inteliads.app.notification-response";

const PROFILES_KEY = "inteliads.selectedProfiles";
const PREFS_KEY = "inteliads.notifications";
const ALERT_STATE_KEY = "inteliads.alertState";
const ALERT_CHECK_LAST_RUN_KEY = "inteliads.alertCheckLastRun";
const DEVICE_PUSH_TOKEN_KEY = "inteliads.devicePushToken";

/** Minimum gap between local alert evaluations (AppState resume can fire often). */
export const ALERT_CHECK_COOLDOWN_MS = 15 * 60_000;

function devWarn(message: string, error?: unknown) {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.warn(`[inteliads:notifications] ${message}`, error ?? "");
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key, "");
    if (!raw || typeof raw !== "string") return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type StoredPushToken = {
  token?: string;
  type?: string;
  userId?: string;
  platform?: string;
  updatedAt?: string;
};

const IOS_ALERT_PERMISSIONS = {
  ios: { allowAlert: true, allowBadge: true, allowSound: true },
} as const;

async function currentPermissionGranted(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    return !!current.granted;
  } catch {
    return false;
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.status === "denied") return false;
  const req = await Notifications.requestPermissionsAsync(IOS_ALERT_PERMISSIONS);
  return req.granted;
}

async function scheduleLocalAlert(input: {
  identifier: string;
  title: string;
  body: string;
  event: (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
  userId: string;
  asin?: string;
}): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: input.identifier,
    content: {
      title: input.title,
      body: input.body,
      sound: "default",
      data: buildNotificationPayload(input.event, input.userId, input.asin),
    },
    trigger: null,
  });
}

async function writeAlertState(state: AlertState): Promise<void> {
  await storage.setItem(ALERT_STATE_KEY, JSON.stringify(state));
}

/**
 * Local alert evaluation: daily digests (all day), book attention,
 * and campaign overspend. New-order alerts are Nest-only while
 * LOCAL_NEW_ORDER_AUTHORITY is false.
 * Every alert body includes today's spend, orders, and ACoS.
 */
export async function runAlertCheck(_source: "background" | "foreground" = "background"): Promise<number> {
  let sent = 0;
  try {
    if (!(await currentPermissionGranted())) return 0;

    const lastRun = await readJson<number>(ALERT_CHECK_LAST_RUN_KEY, 0);
    const now = Date.now();
    if (now - lastRun < ALERT_CHECK_COOLDOWN_MS) {
      devWarn(
        `runAlertCheck cooldown (${Math.ceil((ALERT_CHECK_COOLDOWN_MS - (now - lastRun)) / 1000)}s left, source=${_source})`,
      );
      return 0;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return 0;

    const prefs = await readJson<{
      newOrder?: boolean;
      bookAttention?: boolean;
      campaignSpend?: boolean;
      dailyDigest?: boolean;
      includeKdpNet?: boolean;
      spendThreshold?: number;
      kdpDataStale?: boolean;
    }>(PREFS_KEY, {});
    if (!anyNotificationPrefEnabled(prefs)) return 0;

    const today = toDateString(new Date());
    let alertState = rollAlertState(await readJson<AlertState>(ALERT_STATE_KEY, {}), today);

    const { fetchMobileOverview } = await import("./dashboardApi");
    const { resolveBackgroundScope } = await import("./backgroundFinancialSync");
    const scope = await resolveBackgroundScope();
    if (!scope) return 0;

    // View-as / guest: keep existing early return. Profile authority is activated below.
    if (
      !shouldEvaluateAlerts({
        hasSession: true,
        // Fail-open placeholder so empty Overview selection does not block activated digests
        // when view-as is unset; real ads ids are resolved after profiles load.
        profileIds: scope.profileIds.length ? scope.profileIds : ["_activated"],
        adminFilterUserId: scope.viewAs,
      })
    ) {
      return 0;
    }

    const { fetchAmazonProfiles } = await import("./queries");
    const { knownKdpRoyaltyTotal, selectKdpRoyaltyScopeForSelection } = await import(
      "./kdpRoyaltyScope"
    );
    const profiles = await fetchAmazonProfiles(userId, scope.viewAs).catch(() => []);
    // No profile metadata → refuse digests (avoids one Nest call with mixed ids
    // and a guessed currency — frankensum Spend/ACoS).
    if (!profiles.length) return 0;

    // Spend/orders/ACoS = every activated profile, matching Home's financial
    // portfolio. The header picker only filters Ads Engine and must never make a
    // notification look like an account-wide total while showing a subset.
    let queryIds = digestMoneyAdsProfileIds(scope.profileIds, profiles);
    if (!queryIds.length) {
      queryIds = adsProfileIdsForSelection(scope.profileIds, profiles);
    }
    if (!queryIds.length) {
      queryIds = activatedAdsProfileIds(profiles);
    }
    if (!queryIds.length) return 0;

    // Commit cooldown only once we know we will evaluate (not on view-as / empty authority).
    await storage.setItem(ALERT_CHECK_LAST_RUN_KEY, String(now));

    const includeKdpNet = !!prefs.includeKdpNet;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localHour = new Date().getHours();
    const morningDigest = isMorningDigestHour(localHour);
    const displayCurrency = String(scope.currency || "USD").toUpperCase() || "USD";

    type CurrencyGroupFetch = {
      currency: string;
      adsIds: string[];
      selectionIds: string[];
    };

    // Multi-market USD: one Nest /dashboard/mobile call (Frankfurter FX) so
    // Spend / orders / ACoS match the Home chip — not separate CAD+USD lines
    // that looked "wrong" vs Overview.
    let fetchGroups: CurrencyGroupFetch[] = digestFetchGroupsForMoney(
      profiles,
      queryIds,
      displayCurrency,
    );
    if (!fetchGroups.length) {
      fetchGroups = [
        {
          currency: displayCurrency,
          adsIds: queryIds,
          selectionIds: uniqueProfileIds([...scope.profileIds, ...queryIds]),
        },
      ];
    }

    const todayLines: HonestDigestTotals[] = [];
    const digestLines: HonestDigestTotals[] = [];
    const groupToday: {
      currency: string;
      adsIds: string[];
      spend: number | null;
      orders: number | null;
      line: HonestDigestTotals;
    }[] = [];

    // Prefer one USD FX Nest call when multi-market; if Nest fail-closes
    // (currency null / state missing), fall back to native per-currency lines
    // so Spend/orders/ACoS are not all n/a while Overview still paints.
    if (
      fetchGroups.length === 1 &&
      fetchGroups[0].currency === "USD" &&
      displayCurrency === "USD"
    ) {
      try {
        const probe = await fetchMobileOverview({
          profileIds: fetchGroups[0].adsIds,
          filterUserId: scope.viewAs,
          timeZone,
        });
        if (nestMoneyHiddenForDigest(probe)) {
          const native = digestNativeCurrencyFetchGroups(profiles, queryIds);
          if (native.length) fetchGroups = native;
        } else {
          // Reuse probe as the only group fetch below via stash.
          (fetchGroups[0] as CurrencyGroupFetch & { _probe?: typeof probe })._probe = probe;
        }
      } catch {
        const native = digestNativeCurrencyFetchGroups(profiles, queryIds);
        if (native.length) fetchGroups = native;
      }
    }

    for (const group of fetchGroups) {
      if (!group.adsIds.length) continue;
      const snapshot =
        (group as CurrencyGroupFetch & { _probe?: Awaited<ReturnType<typeof fetchMobileOverview>> })
          ._probe ??
        (await fetchMobileOverview({
          profileIds: group.adsIds,
          filterUserId: scope.viewAs,
          timeZone,
        }));
      const currency = String(snapshot.scope.currency || group.currency || "USD").toUpperCase() || "USD";

      let todayHonest = honestTotalsFromDayPoint(snapshot.today, currency);
      const digestPoint = morningDigest ? snapshot.yesterday : snapshot.today;
      let digestHonest = honestTotalsFromDayPoint(digestPoint, currency);

      if (includeKdpNet) {
        try {
          const { fetchKdpRoyaltiesRange } = await import("./queries");
          const royaltyIds = selectKdpRoyaltyScopeForSelection(
            profiles,
            group.selectionIds,
          ).profileIds;
          if (royaltyIds.length) {
            const todayKdp = await fetchKdpRoyaltiesRange(royaltyIds, today, today);
            const todayRoyalties = knownKdpRoyaltyTotal(todayKdp);
            todayHonest = {
              ...todayHonest,
              royalties: todayRoyalties,
              net:
                todayRoyalties != null && todayHonest.spend != null
                  ? netRoyaltiesKnown(todayRoyalties, todayHonest.spend)
                  : null,
            };

            const digestDate = morningDigest
              ? String(snapshot.yesterday?.date || "").slice(0, 10)
              : today;
            if (digestDate) {
              const digestKdp =
                digestDate === today
                  ? todayKdp
                  : await fetchKdpRoyaltiesRange(royaltyIds, digestDate, digestDate);
              const digestRoyalties = knownKdpRoyaltyTotal(digestKdp);
              digestHonest = {
                ...digestHonest,
                royalties: digestRoyalties,
                net:
                  digestRoyalties != null && digestHonest.spend != null
                    ? netRoyaltiesKnown(digestRoyalties, digestHonest.spend)
                    : null,
              };
            }
          }
        } catch {
          /* keep lines without KDP net */
        }
      }

      todayLines.push(todayHonest);
      digestLines.push(digestHonest);
      groupToday.push({
        currency,
        adsIds: group.adsIds,
        spend: todayHonest.spend,
        orders: todayHonest.orders,
        line: todayHonest,
      });
    }

    if (!todayLines.length) return 0;

    let coverageLine: string | null = null;
    try {
      const { fetchProfileSyncLogs } = await import("./queries");
      const logs = await fetchProfileSyncLogs(queryIds);
      const updatedCount = countFreshCompletedProfiles(logs, queryIds, now);
      coverageLine = digestCoverageLine({
        activatedCount: queryIds.length,
        updatedCount,
        currencies: todayLines.map((line) => line.currency),
        displayCurrency: todayLines[0]?.currency ?? "USD",
      });
    } catch {
      coverageLine = null;
    }

    const mixedNote = mixedCurrencyDigestNote(todayLines.map((line) => line.currency));
    const totalsBody = (headline: string, lines: HonestDigestTotals[]) =>
      `${headline}\n${formatDigestBody({
        lines,
        includeKdpNet,
        coverageLine: null,
        mixedCurrencyNote: mixedNote,
      })}`;

    // Book / KDP royalty scope across activated UUID+ads ids (fail-open to Overview).
    const authoritySelection = activatedProfileIds(profiles);
    const enabledSelected = filterToEnabledProfileSelection(
      authoritySelection.length ? authoritySelection : scope.profileIds,
      profiles,
    );
    const royaltyIds = selectKdpRoyaltyScopeForSelection(
      profiles,
      enabledSelected.length ? enabledSelected : queryIds,
    ).profileIds;

    if (
      prefs.dailyDigest &&
      preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.periodCompare) &&
      shouldSendDigestHour(localHour, alertState.lastDigestHour, today, alertState.digestDay)
    ) {
      await scheduleLocalAlert({
        identifier: notificationIdentifier(NOTIFICATION_EVENTS.periodCompare, today, String(localHour)),
        event: NOTIFICATION_EVENTS.periodCompare,
        userId,
        title: digestTitleForHour(localHour),
        body: formatDigestBody({
          lines: digestLines,
          includeKdpNet,
          coverageLine,
          mixedCurrencyNote: mixedNote,
        }),
      });
      alertState = { ...alertState, digestDay: today, lastDigestHour: localHour };
      sent += 1;
    }

    // Orders are dimensionless — sum known counts across currency groups.
    let ordersTotal: number | null = null;
    {
      let sum = 0;
      let known = false;
      for (const group of groupToday) {
        if (group.orders != null) {
          sum += group.orders;
          known = true;
        }
      }
      if (known) ordersTotal = sum;
    }

    if (
      LOCAL_NEW_ORDER_AUTHORITY &&
      prefs.newOrder &&
      preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.newOrders) &&
      ordersTotal != null
    ) {
      const delta = newOrderDelta(ordersTotal, alertState.ordersNotified ?? 0);
      if (delta > 0) {
        await scheduleLocalAlert({
          identifier: notificationIdentifier(NOTIFICATION_EVENTS.newOrders, today, String(ordersTotal)),
          event: NOTIFICATION_EVENTS.newOrders,
          userId,
          title: delta === 1 ? "1 new ad order" : `${delta} new ad orders`,
          body: totalsBody(`Today so far · ${ordersTotal} orders total.`, todayLines),
        });
        alertState = { ...alertState, ordersNotified: ordersTotal };
        sent += 1;
      }
    }

    if (prefs.campaignSpend && preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.campaignOverspend)) {
      const already = alertState.spendAlertDays?.[today];
      if (!already) {
        const { fetchAllCampaignBudgets } = await import("./queries");
        let overspent = false;
        for (const group of groupToday) {
          // Never treat null/missing spend as $0 for overspend.
          if (group.spend == null) continue;
          const budget = await fetchAllCampaignBudgets(group.adsIds);
          if (spendExceedsBudget(group.spend, budget, prefs.spendThreshold)) {
            overspent = true;
            break;
          }
        }
        if (overspent) {
          await scheduleLocalAlert({
            identifier: notificationIdentifier(NOTIFICATION_EVENTS.campaignOverspend, today),
            event: NOTIFICATION_EVENTS.campaignOverspend,
            userId,
            title: "Campaign overspending",
            body: totalsBody(
              "Today's ad spend is above your daily budget threshold.",
              todayLines,
            ),
          });
          alertState = {
            ...alertState,
            spendAlertDay: today,
            spendAlertDays: { ...(alertState.spendAlertDays ?? {}), [today]: true },
          };
          sent += 1;
        }
      }
    }

    if (prefs.bookAttention && preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.bookAttention)) {
      const { fetchTopBooksRange } = await import("./queries");
      const books = await fetchTopBooksRange({
        profileIds: queryIds,
        kdpProfileIds: royaltyIds,
        start: today,
        end: today,
        limit: 5,
        filterUserId: scope.viewAs,
      });
      for (const book of books) {
        if (!bookNeedsAttention(book)) continue;
        const key = (book.asin || book.sku || "").trim().toUpperCase();
        if (!key || !canNotifyBookToday(alertState, key)) continue;
        await scheduleLocalAlert({
          identifier: notificationIdentifier(NOTIFICATION_EVENTS.bookAttention, today, key),
          event: NOTIFICATION_EVENTS.bookAttention,
          userId,
          asin: book.asin ?? undefined,
          title: "Book needs attention",
          body: totalsBody(`${book.title || key} ACoS is above break-even.`, todayLines),
        });
        alertState = markBookNotified(alertState, key);
        sent += 1;
      }
    }

    if (prefs.kdpDataStale && preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.kdpDataStale)) {
      const { loadScopedKdpFreshness } = await import("./kdpIngestMonitor");
      const kdpScopeIds = enabledSelected.length
        ? enabledSelected
        : filterToEnabledProfileSelection(scope.profileIds, profiles);
      const rows = await loadScopedKdpFreshness(kdpScopeIds, now);
      for (const row of rows) {
        if (!row.stale) {
          alertState = clearKdpStallNotified(alertState, row.accountId);
          continue;
        }
        if (!canNotifyKdpStall(alertState, row.accountId, now)) continue;
        const copy = kdpStallAlertCopy(row.name);
        await scheduleLocalAlert({
          identifier: notificationIdentifier(NOTIFICATION_EVENTS.kdpDataStale, today, row.accountId),
          event: NOTIFICATION_EVENTS.kdpDataStale,
          userId,
          title: copy.title,
          body: totalsBody(copy.body, todayLines),
        });
        alertState = markKdpStallNotified(alertState, row.accountId, now);
        sent += 1;
      }
    }

    await writeAlertState(alertState);
  } catch (error) {
    devWarn("runAlertCheck skipped", error);
  }
  return sent;
}

export async function runBackgroundSyncWhenReady(): Promise<void> {
  await syncNotificationTimeZone();
  const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
  await runDualSourceBackgroundRefresh("background");
  await runAlertCheck("background");
}

let backgroundWakeInstalled = false;

export type NotificationRefreshReason = "push-visible" | "push-silent";
type NotificationRefreshListener = (reason: NotificationRefreshReason) => void;
const notificationRefreshListeners = new Set<NotificationRefreshListener>();

/**
 * Let the app (which owns the React Query client) repaint live screens the
 * instant a push lands. The plain notifications module can't reach queryClient,
 * so it emits and AppContext subscribes — same pattern as the bulk outbox drain.
 */
export function subscribeNotificationRefresh(listener: NotificationRefreshListener): () => void {
  notificationRefreshListeners.add(listener);
  return () => {
    notificationRefreshListeners.delete(listener);
  };
}

function emitNotificationRefresh(reason: NotificationRefreshReason): void {
  for (const listener of notificationRefreshListeners) {
    try {
      listener(reason);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Remote push + foreground resume: refresh cache and evaluate alerts when iOS wakes the app. */
export function installBackgroundSyncWakeHandlers(): void {
  if (backgroundWakeInstalled || Platform.OS === "web") return;
  backgroundWakeInstalled = true;

  Notifications.addNotificationReceivedListener((notification) => {
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const payload = parseNotificationPayload(data);
    // Test / transport-test carries no new financial data — don't churn the app.
    if (payload?.event === NOTIFICATION_EVENTS.test) return;
    const silent =
      data.silent === true ||
      data.event === "kdp-wake" ||
      data["content-available"] === 1;
    void (async () => {
      try {
        const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
        await runDualSourceBackgroundRefresh("push", { force: true });
      } catch (error) {
        devWarn("push financial refresh skipped", error);
      }
      // Heavy KDP WebView replay only for silent wakes (Royaltix). A visible
      // Ads-order banner already refreshes today's KDP read above; the interval,
      // resume, and background tasks cover the rest — no need to replay here.
      if (silent) {
        try {
          const { runKdpIosHelperTick } = await import("./kdp/importer");
          const { resolveLockedPhoneKdpWakeMode } = await import("./kdp/backgroundWake");
          const wakeMode = await resolveLockedPhoneKdpWakeMode("push");
          await runKdpIosHelperTick("push", { wakeMode });
        } catch (error) {
          devWarn("KDP helper push wake skipped", error);
        }
      }
      try {
        await runAlertCheck("background");
      } catch (error) {
        devWarn("push alert check skipped", error);
      }
      // Poke live React Query so an open Overview/Campaigns paints the new data.
      emitNotificationRefresh(silent ? "push-silent" : "push-visible");
    })();
  });
}

export async function refreshHomeCacheOpportunistic(): Promise<void> {
  const { refreshDualSourceFinancialCache } = await import("./backgroundFinancialSync");
  await refreshDualSourceFinancialCache("foreground");
}


try {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
      const silent =
        data.silent === true ||
        data.event === "kdp-wake" ||
        data["content-available"] === 1;
      if (silent) {
        return {
          shouldShowAlert: false,
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        } as any;
      }
      return {
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      } as any;
    },
  });
} catch (error) {
  devWarn("Notification handler unavailable.", error);
}

function defineLaunchSafeTask(
  name: string,
  runner: () => Promise<(typeof BackgroundTask)["BackgroundTaskResult"]["Success"]>,
) {
  try {
    if (TaskManager.isTaskDefined(name)) return;
    TaskManager.defineTask(name, runner);
  } catch (error) {
    // AppContext/AuthContext import this module on launch. A missing or
    // half-linked TaskManager must not abort JS before the first paint.
    devWarn(`Task ${name} unavailable.`, error);
  }
}

defineLaunchSafeTask(INTELIADS_BACKGROUND_TASK, async () => {
  try {
    try {
      const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
      await runDualSourceBackgroundRefresh("background");
    } catch (error) {
      devWarn("background financial refresh skipped", error);
    }
    try {
      const { runKdpIosHelperTick } = await import("./kdp/importer");
      const { resolveLockedPhoneKdpWakeMode } = await import("./kdp/backgroundWake");
      const wakeMode = await resolveLockedPhoneKdpWakeMode("background");
      await runKdpIosHelperTick(wakeMode === "processing" ? "processing" : "background", {
        wakeMode,
      });
    } catch (error) {
      devWarn("KDP helper background wake skipped", error);
    }
    try {
      await runAlertCheck("background");
    } catch (error) {
      devWarn("background alert check skipped", error);
    }
    try {
      const { drainBulkOutbox } = await import("./bulkOutbox");
      await drainBulkOutbox();
    } catch (error) {
      devWarn("background outbox drain skipped", error);
    }
    try {
      const { refreshOpenNestBulkJobs } = await import("./nestBulkJobs");
      await refreshOpenNestBulkJobs();
    } catch (error) {
      devWarn("background nest bulk poll skipped", error);
    }
    // Leftover nightly/deferred is expected work, not a failed wake (iOS throttles false).
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Success;
  }
});

defineLaunchSafeTask(INTELIADS_NOTIFICATION_TASK, async () => {
  try {
    try {
      const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
      await runDualSourceBackgroundRefresh("background");
    } catch (error) {
      devWarn("notification financial refresh skipped", error);
    }
    try {
      const { runKdpIosHelperTick } = await import("./kdp/importer");
      const { resolveLockedPhoneKdpWakeMode } = await import("./kdp/backgroundWake");
      // Push defaults to recent; native pending kind still wins if set.
      const wakeMode = await resolveLockedPhoneKdpWakeMode("push");
      await runKdpIosHelperTick("push", { wakeMode });
    } catch (error) {
      devWarn("KDP helper notification wake skipped", error);
    }
    try {
      await runAlertCheck("background");
    } catch (error) {
      devWarn("notification alert check skipped", error);
    }
    try {
      const { drainBulkOutbox } = await import("./bulkOutbox");
      await drainBulkOutbox();
    } catch (error) {
      devWarn("notification outbox drain skipped", error);
    }
    try {
      const { refreshOpenNestBulkJobs } = await import("./nestBulkJobs");
      await refreshOpenNestBulkJobs();
    } catch (error) {
      devWarn("notification nest bulk poll skipped", error);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Success;
  }
});

export async function registerForPushAsync(opts?: {
  requestPermission?: boolean;
}): Promise<{ token: string | null; type: string | null }> {
  if (Platform.OS === "web") return { token: null, type: null };
  try {
    const granted = opts?.requestPermission
      ? await ensureNotificationPermission()
      : await currentPermissionGranted();
    if (!granted) return { token: null, type: null };

    const device = await Notifications.getDevicePushTokenAsync();
    const token = (device?.data as string) ?? null;
    const type = (device?.type as string) ?? null;
    if (!token) return { token: null, type: null };

    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const previous = await readJson<StoredPushToken>(DEVICE_PUSH_TOKEN_KEY, {});

    await storage.setItem(
      DEVICE_PUSH_TOKEN_KEY,
      JSON.stringify({
        token,
        type,
        platform: Platform.OS,
        userId,
        updatedAt: new Date().toISOString(),
      }),
    );

    // Prefer explicit env, then the environment in the signed iOS provisioning
    // profile. A locally archived Release build can still be development-signed,
    // so __DEV__ alone cannot distinguish sandbox from production APNs tokens.
    const configuredEnvironment = process.env.EXPO_PUBLIC_APNS_ENVIRONMENT;
    const signedEnvironment = Platform.OS === "ios" ? await getNativeApnsEnvironment() : null;
    const environment = resolveApnsEnvironment({
      configured: configuredEnvironment,
      signed: signedEnvironment,
      isDevelopment: __DEV__,
    });

    if (userId) {
      try {
        if (previous.token && previous.userId && previous.userId !== userId) {
          await supabase
            .from("device_push_tokens")
            .update({
              disabled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("token", previous.token)
            .eq("user_id", previous.userId);
          try {
            await notificationNestJson("/notifications/device-token", {
              method: "DELETE",
              body: JSON.stringify({ token: previous.token }),
            });
          } catch {}
        }
        await supabase
          .from("device_push_tokens")
          .upsert(
            {
              user_id: userId,
              token,
              platform: Platform.OS,
              token_type: type,
              environment,
              bundle_id: "io.inteliads.app",
              last_seen_at: new Date().toISOString(),
              // A live device re-registering proves the token is deliverable —
              // clear any prior disable/invalidate so the sender stops skipping it,
              // even when the Nest PUT below is unreachable.
              disabled_at: null,
              invalidated_at: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "token" },
          );
        try {
          await notificationNestJson("/notifications/device-token", {
            method: "PUT",
            body: JSON.stringify({
              token,
              tokenType: type,
              platform: Platform.OS,
              environment,
              bundleId: "io.inteliads.app",
            }),
          });
        } catch (e) {
          devWarn("nest device token persist skipped", e);
        }
      } catch (e) {
        devWarn("push token persist skipped (table/RLS not set up?)", e);
      }
    }

    return { token, type };
  } catch (e) {
    devWarn("registerForPushAsync failed", e);
    return { token: null, type: null };
  }
}

export async function clearNotificationIdentity(): Promise<void> {
  resetSyncedTimeZone();
  const stored = await readJson<StoredPushToken>(DEVICE_PUSH_TOKEN_KEY, {});
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {}
  try {
    await Notifications.clearLastNotificationResponseAsync();
  } catch {}
  if (stored.token && stored.userId) {
    // Soft-disable (Nest parity): keep the row so senders skip it; do not hard-delete.
    try {
      await supabase
        .from("device_push_tokens")
        .update({
          disabled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("token", stored.token)
        .eq("user_id", stored.userId);
    } catch (e) {
      devWarn("push token detach skipped", e);
    }
    try {
      await notificationNestJson("/notifications/device-token", {
        method: "DELETE",
        body: JSON.stringify({ token: stored.token }),
      });
    } catch {}
  }
  await storage.removeItem(DEVICE_PUSH_TOKEN_KEY);
  await storage.removeItem(ALERT_STATE_KEY);
}

export async function ensureBackgroundRefreshRegistered(): Promise<boolean> {
  let ok = false;
  try {
    const available = await TaskManager.isAvailableAsync();
    const status = await BackgroundTask.getStatusAsync();
    if (available && status === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(INTELIADS_BACKGROUND_TASK, { minimumInterval: 15 });
      ok = true;
    }
  } catch (error) {
    devWarn("Background refresh task unavailable.", error);
  }
  // Royaltix-parity dual BGTask metronome (BGAppRefresh + BGProcessing @ 15m).
  // Expo's processing worker alone is not enough for locked-phone cadence.
  try {
    const { registerNativeMetronome } = await import("inteliads-native-sync");
    const nativeOk = await registerNativeMetronome(true);
    ok = ok || nativeOk;
  } catch (error) {
    devWarn("Native dual BGTask metronome unavailable.", error);
  }
  // Keep remote-notification wakes registered even when alert prefs are off:
  // KDP silent wakes need it so the helper can still run locked-screen ticks.
  try {
    await Notifications.registerTaskAsync(INTELIADS_NOTIFICATION_TASK);
  } catch (error) {
    devWarn("Background notification task unavailable.", error);
  }
  installBackgroundSyncWakeHandlers();
  return ok;
}

export async function configureNotifications(
  prefs: NotificationPrefs,
  opts?: { requestPermission?: boolean },
): Promise<{
  permission: "granted" | "denied" | "undetermined";
  backgroundRegistered: boolean;
}> {
  const backgroundRegistered = await ensureBackgroundRefreshRegistered();

  const wantsNotifications = anyNotificationPrefEnabled(prefs);

  // Always read OS permission — even when alert prefs are off — so KDP silent
  // push registration can still proceed when the user already granted access.
  let permission: "granted" | "denied" | "undetermined" = "undetermined";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (!wantsNotifications) {
      permission = current.granted ? "granted" : current.status === "denied" ? "denied" : "undetermined";
      // Still push explicit OFF to Nest so mass-use defaults cannot leave stale ON prefs.
      void persistNotificationPreferences({
        newOrder: false,
        dailyReport: false,
      });
      // Keep APNs registration when already granted — KDP silent wakes need the token.
      if (permission === "granted") {
        void registerForPushAsync();
        installBackgroundSyncWakeHandlers();
      }
      return { permission, backgroundRegistered };
    }
    const finalStatus =
      current.granted || !opts?.requestPermission || current.status === "denied"
        ? current
        : await Notifications.requestPermissionsAsync(IOS_ALERT_PERMISSIONS);
    permission = finalStatus.granted ? "granted" : finalStatus.status === "denied" ? "denied" : "undetermined";
  } catch (error) {
    devWarn("Could not request notification permission.", error);
    if (!wantsNotifications) return { permission, backgroundRegistered };
  }

  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("inteliads-alerts", {
        name: "InteliAds alerts",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180, 120, 180],
        lightColor: "#007AFF",
        sound: "default",
      });
    } catch (error) {
      devWarn("Could not configure Android notification channel.", error);
    }
  }

  try {
    await Notifications.registerTaskAsync(INTELIADS_NOTIFICATION_TASK);
  } catch (error) {
    devWarn("Background notification task unavailable.", error);
  }

  installBackgroundSyncWakeHandlers();

  if (permission === "granted") {
    void syncNotificationTimeZone();
    void persistNotificationPreferences({
      newOrder: prefs.newOrder,
      dailyReport: prefs.dailyDigest,
    });
    void registerForPushAsync();
  }

  return { permission, backgroundRegistered };
}

export function deviceIanaTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.includes("/") ? zone : null;
  } catch {
    return null;
  }
}

let lastSyncedTimeZone = "";

function resetSyncedTimeZone() {
  lastSyncedTimeZone = "";
}

/**
 * Preference / timezone / device-token Nest calls use the shared mobile
 * bearer (Nest JWT or Supabase session?.access_token).
 */
async function notificationNestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return nestApiJson<T>(path, init);
}

export async function syncNotificationTimeZone(): Promise<string | null> {
  const timeZone = deviceIanaTimeZone();
  if (!timeZone || timeZone === lastSyncedTimeZone) return timeZone;
  try {
    await notificationNestJson("/notifications/timezone", {
      method: "PUT",
      body: JSON.stringify({ timeZone }),
    });
    lastSyncedTimeZone = timeZone;
    return timeZone;
  } catch (e) {
    devWarn("timezone sync skipped", e);
    return timeZone;
  }
}

export async function persistNotificationPreferences(prefs: {
  newOrder?: boolean;
  dailyReport?: boolean;
  dailyDigest?: boolean;
  includeKdpNet?: boolean;
  bookAttention?: boolean;
  campaignSpend?: boolean;
  spendThreshold?: number;
}): Promise<boolean> {
  try {
    // Nest ValidationPipe uses forbidNonWhitelisted. Only send fields the
    // live preferences DTO accepts (newOrder + dailyReport). Extra iOS-only
    // keys (dailyDigest, includeKdpNet, kdpDataStale, …) would 400 and leave
    // Nest prefs OFF.
    await notificationNestJson("/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify({
        newOrder: !!prefs.newOrder,
        dailyReport: !!(prefs.dailyReport ?? prefs.dailyDigest),
      }),
    });
    return true;
  } catch (e) {
    devWarn("notification preference sync skipped", e);
    return false;
  }
}

export async function requestServerTestPush(userId?: string | null): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const owner = userId ?? session?.user?.id ?? null;
    if (!owner) return false;

    // Primary: Supabase Edge Function "send-push" delivers a real APNs push.
    // The user's session token identifies the recipient (RLS-safe).
    try {
      const { data, error } = await supabase.functions.invoke("send-push", {
        body: { test: true },
      });
      const sent = (data as { sent?: number } | null)?.sent ?? 0;
      if (!error && sent > 0) return true;
    } catch (e) {
      devWarn("supabase send-push skipped", e);
    }

    // Fallback: legacy Nest sender, if it is ever deployed.
    await notificationNestJson("/notifications/test-push", {
      method: "POST",
      body: JSON.stringify({ userId: owner }),
    });
    return true;
  } catch (e) {
    devWarn("requestServerTestPush skipped", e);
    return false;
  }
}

export async function sendTestNotification(userId?: string | null): Promise<"server" | "local" | false> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return false;
    const { data: { session } } = await supabase.auth.getSession();
    const owner = userId ?? session?.user?.id ?? null;
    if (!owner) return false;

    // Local first: Nest POST /notifications/test-push is not deployed on production
    // (404). Still probe the server afterward so a future sender lights up Settings.
    const today = toDateString(new Date());
    await scheduleLocalAlert({
      identifier: notificationIdentifier(NOTIFICATION_EVENTS.test, today),
      event: NOTIFICATION_EVENTS.test,
      userId: owner,
      title: TEST_NOTIFICATION_TITLE,
      body: TEST_NOTIFICATION_BODY,
    });

    const serverOk = await requestServerTestPush(owner);
    return serverOk ? "server" : "local";
  } catch (e) {
    devWarn("sendTestNotification failed", e);
    return false;
  }
}
