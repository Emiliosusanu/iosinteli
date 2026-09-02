import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
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
  type AlertState,
} from "./notificationContract";
import {
  digestMetricsLine,
  notificationBodyWithTotals,
  shouldSendDigestHour,
  type DigestTotals,
} from "./notificationDigest";
import { netRoyaltiesKnown } from "./netRoyalties";
import { nestApiJson } from "./rulesApi";

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
 * Local alert evaluation: daily digests (all day), new orders, book attention,
 * and campaign overspend. Every alert body includes today's spend, orders, and ACoS.
 */
export async function runAlertCheck(_source: "background" | "foreground" = "background"): Promise<number> {
  if (LOCAL_NEW_ORDER_AUTHORITY) {
    throw new Error("local new-order authority is forbidden");
  }
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
    }>(PREFS_KEY, {});
    const anyOn =
      prefs.newOrder ||
      prefs.bookAttention ||
      prefs.campaignSpend ||
      prefs.dailyDigest;
    if (!anyOn) return 0;

    const today = toDateString(new Date());
    let alertState = rollAlertState(await readJson<AlertState>(ALERT_STATE_KEY, {}), today);

    const { fetchMobileOverview } = await import("./dashboardApi");
    const { resolveBackgroundScope } = await import("./backgroundFinancialSync");
    const scope = await resolveBackgroundScope();
    if (!scope || scope.profileIds.length === 0) return 0;
    if (
      !shouldEvaluateAlerts({
        hasSession: true,
        profileIds: scope.profileIds,
        adminFilterUserId: scope.viewAs,
      })
    ) {
      return 0;
    }

    // Commit cooldown only once we know we will evaluate (not on view-as / empty scope).
    await storage.setItem(ALERT_CHECK_LAST_RUN_KEY, String(now));

    const snapshot = await fetchMobileOverview({
      profileIds: scope.profileIds,
      filterUserId: scope.viewAs,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const currency = snapshot.scope.currency ?? "USD";
    const todayPoint = snapshot.today;
    const spend = Number(todayPoint.spend) || 0;
    const orders = Number(todayPoint.orders) || 0;
    const sales = Number(todayPoint.sales) || 0;
    const acos = todayPoint.acos ?? (sales > 0 ? (spend / sales) * 100 : null);

    let royalties: number | null = null;
    let net: number | null = null;
    if (prefs.includeKdpNet) {
      try {
        const { fetchKdpRoyaltiesRange } = await import("./queries");
        const kdp = await fetchKdpRoyaltiesRange(scope.profileIds, today, today);
        royalties = kdp.totalRoyalties ?? null;
        if (royalties != null) net = netRoyaltiesKnown(royalties, spend);
      } catch {
        royalties = null;
        net = null;
      }
    }

    const totals: DigestTotals = { spend, orders, acos, royalties, net };
    const includeKdpNet = !!prefs.includeKdpNet;

    const localHour = new Date().getHours();
    if (
      prefs.dailyDigest &&
      preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.periodCompare) &&
      shouldSendDigestHour(localHour, alertState.lastDigestHour, today, alertState.digestDay)
    ) {
      await scheduleLocalAlert({
        identifier: notificationIdentifier(NOTIFICATION_EVENTS.periodCompare, today, String(localHour)),
        event: NOTIFICATION_EVENTS.periodCompare,
        userId,
        title: "Today's performance",
        body: digestMetricsLine(totals, currency, includeKdpNet),
      });
      alertState = { ...alertState, digestDay: today, lastDigestHour: localHour };
      sent += 1;
    }

    if (prefs.newOrder && preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.newOrders)) {
      const delta = newOrderDelta(orders, alertState.ordersNotified ?? 0);
      if (delta > 0) {
        await scheduleLocalAlert({
          identifier: notificationIdentifier(NOTIFICATION_EVENTS.newOrders, today, String(orders)),
          event: NOTIFICATION_EVENTS.newOrders,
          userId,
          title: delta === 1 ? "1 new ad order" : `${delta} new ad orders`,
          body: notificationBodyWithTotals(
            `Ads-attributed orders today: ${orders}.`,
            totals,
            currency,
            includeKdpNet,
          ),
        });
        alertState = { ...alertState, ordersNotified: orders };
        sent += 1;
      }
    }

    if (prefs.campaignSpend && preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.campaignOverspend)) {
      const already = alertState.spendAlertDays?.[today];
      if (!already) {
        const { fetchAllCampaignBudgets } = await import("./queries");
        const budget = await fetchAllCampaignBudgets(scope.profileIds);
        if (spendExceedsBudget(spend, budget, prefs.spendThreshold)) {
          await scheduleLocalAlert({
            identifier: notificationIdentifier(NOTIFICATION_EVENTS.campaignOverspend, today),
            event: NOTIFICATION_EVENTS.campaignOverspend,
            userId,
            title: "Campaign overspending",
            body: notificationBodyWithTotals(
              "Today's ad spend is above your daily budget threshold.",
              totals,
              currency,
              includeKdpNet,
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
        profileIds: scope.profileIds,
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
          body: notificationBodyWithTotals(
            `${book.title || key} ACoS is above break-even.`,
            totals,
            currency,
            includeKdpNet,
          ),
        });
        alertState = markBookNotified(alertState, key);
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

/** Remote push + foreground resume: refresh cache and evaluate alerts when iOS wakes the app. */
export function installBackgroundSyncWakeHandlers(): void {
  if (backgroundWakeInstalled || Platform.OS === "web") return;
  backgroundWakeInstalled = true;

  Notifications.addNotificationReceivedListener((notification) => {
    const payload = parseNotificationPayload(notification.request.content.data);
    if (payload?.event === NOTIFICATION_EVENTS.test) return;
    void (async () => {
      const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
      await runDualSourceBackgroundRefresh("push", { force: true });
      try {
        const { runKdpIosHelperTick } = await import("./kdp/importer");
        await runKdpIosHelperTick("push");
      } catch (error) {
        devWarn("KDP helper push wake skipped", error);
      }
      await runAlertCheck("background");
    })();
  });
}

export async function refreshHomeCacheOpportunistic(): Promise<void> {
  if (LOCAL_NEW_ORDER_AUTHORITY) {
    throw new Error("local new-order authority is forbidden");
  }
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

if (!TaskManager.isTaskDefined(INTELIADS_BACKGROUND_TASK)) {
  TaskManager.defineTask(INTELIADS_BACKGROUND_TASK, async () => {
    try {
      const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
      await runDualSourceBackgroundRefresh("background");
      const { runKdpIosHelperTick } = await import("./kdp/importer");
      await runKdpIosHelperTick("background");
      await runAlertCheck("background");
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

if (!TaskManager.isTaskDefined(INTELIADS_NOTIFICATION_TASK)) {
  TaskManager.defineTask(INTELIADS_NOTIFICATION_TASK, async () => {
    try {
      const { runDualSourceBackgroundRefresh } = await import("./backgroundFinancialSync");
      await runDualSourceBackgroundRefresh("background");
      const { runKdpIosHelperTick } = await import("./kdp/importer");
      await runKdpIosHelperTick("background");
      await runAlertCheck("background");
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerForPushAsync(): Promise<{ token: string | null; type: string | null }> {
  if (Platform.OS === "web") return { token: null, type: null };
  try {
    if (!(await currentPermissionGranted())) return { token: null, type: null };

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

    // Prefer explicit env; otherwise Release/TestFlight → production, Metro debug → sandbox.
    // (A production-only APNs .p8 cannot deliver to sandbox tokens.)
    const configuredEnvironment = process.env.EXPO_PUBLIC_APNS_ENVIRONMENT;
    const environment =
      configuredEnvironment === "sandbox"
        ? "sandbox"
        : configuredEnvironment === "production"
          ? "production"
          : __DEV__
            ? "sandbox"
            : "production";

    if (userId) {
      try {
        if (previous.token && previous.userId && previous.userId !== userId) {
          await supabase
            .from("device_push_tokens")
            .delete()
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
    try {
      await supabase
        .from("device_push_tokens")
        .delete()
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
  // Keep remote-notification wakes registered even when alert prefs are off
  // so silent KDP helper pushes can still run locked-screen ticks.
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

  const wantsNotifications =
    prefs.newOrder || prefs.bookAttention || prefs.campaignSpend || prefs.dailyDigest;
  if (!wantsNotifications) {
    // Do not unregister INTELIADS_NOTIFICATION_TASK — KDP silent wakes need it.
    return { permission: "undetermined", backgroundRegistered };
  }

  let permission: "granted" | "denied" | "undetermined" = "undetermined";
  try {
    const current = await Notifications.getPermissionsAsync();
    const finalStatus =
      current.granted || !opts?.requestPermission || current.status === "denied"
        ? current
        : await Notifications.requestPermissionsAsync(IOS_ALERT_PERMISSIONS);
    permission = finalStatus.granted ? "granted" : finalStatus.status === "denied" ? "denied" : "undetermined";
  } catch (error) {
    devWarn("Could not request notification permission.", error);
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
      dailyDigest: prefs.dailyDigest,
      includeKdpNet: prefs.includeKdpNet,
      bookAttention: prefs.bookAttention,
      campaignSpend: prefs.campaignSpend,
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
}): Promise<boolean> {
  try {
    await notificationNestJson("/notifications/preferences", {
      method: "PUT",
      body: JSON.stringify({
        newOrder: !!prefs.newOrder,
        dailyReport: !!(prefs.dailyReport ?? prefs.dailyDigest),
        dailyDigest: !!prefs.dailyDigest,
        includeKdpNet: !!prefs.includeKdpNet,
        bookAttention: !!prefs.bookAttention,
        campaignSpend: !!prefs.campaignSpend,
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
