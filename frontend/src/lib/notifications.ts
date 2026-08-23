import { Platform } from "react-native";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import type { NotificationPrefs } from "@/src/contexts/AppContext";
import { storage } from "@/src/utils/storage";
import { supabase } from "./supabase";
import {
  fetchCampaignMetricsRange,
  aggregateDailyMetrics,
  fetchAllCampaignBudgets,
  fetchTopBooksRange,
  ADMIN_FILTER_KEY,
} from "./queries";
import { toDateString } from "./format";
import { TEST_NOTIFICATION_BODY, TEST_NOTIFICATION_TITLE } from "./settingsContract";
import {
  NOTIFICATION_EVENTS,
  bookNeedsAttention,
  buildNotificationPayload,
  canNotifyBookToday,
  markBookNotified,
  newOrderDelta,
  notificationIdentifier,
  preferenceAllowsEvent,
  rollAlertState,
  shouldEvaluateAlerts,
  spendExceedsBudget,
  type AlertState,
} from "./notificationContract";

export const INTELIADS_BACKGROUND_TASK = "io.inteliads.app.background-refresh";
export const INTELIADS_NOTIFICATION_TASK = "io.inteliads.app.notification-response";

const PROFILES_KEY = "inteliads.selectedProfiles";
const PREFS_KEY = "inteliads.notifications";
const ALERT_STATE_KEY = "inteliads.alertState";
const DEVICE_PUSH_TOKEN_KEY = "inteliads.devicePushToken";

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

export async function runAlertCheck(source: "background" | "foreground" = "background"): Promise<number> {
  try {
    const prefs = await readJson<Partial<NotificationPrefs>>(PREFS_KEY, {});
    if (
      !preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.newOrders) &&
      !preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.bookAttention) &&
      !preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.campaignOverspend)
    ) {
      return 0;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    const adminFilterUserId = await storage.getItem(ADMIN_FILTER_KEY, "");
    const profileIds = await readJson<string[]>(PROFILES_KEY, []);
    if (
      !shouldEvaluateAlerts({
        hasSession: !!session && !!userId,
        profileIds,
        adminFilterUserId: typeof adminFilterUserId === "string" ? adminFilterUserId : null,
      })
    ) {
      return 0;
    }

    const today = toDateString(new Date());
    const state = rollAlertState(await readJson<AlertState>(ALERT_STATE_KEY, {}), today);
    const queued: Array<{
      identifier: string;
      title: string;
      body: string;
      event: (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
      asin?: string;
    }> = [];

    let agg = { spend: 0, orders: 0 };
    try {
      const daily = aggregateDailyMetrics(await fetchCampaignMetricsRange(profileIds, today, today));
      agg = daily.reduce((a, m) => ({ spend: a.spend + m.spend, orders: a.orders + m.orders }), { spend: 0, orders: 0 });
    } catch (e) {
      devWarn("alert: metrics fetch failed", e);
    }

    if (preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.newOrders)) {
      const delta = newOrderDelta(agg.orders, state.ordersNotified ?? 0);
      if (delta > 0) {
        queued.push({
          identifier: notificationIdentifier(NOTIFICATION_EVENTS.newOrders, today),
          event: NOTIFICATION_EVENTS.newOrders,
          title: "New orders",
          body: `${delta} new Ads-attributed orders today (${agg.orders} total).`,
        });
        state.ordersNotified = agg.orders;
      }
    }

    if (preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.campaignOverspend) && state.spendAlertDay !== today) {
      try {
        const budget = await fetchAllCampaignBudgets(profileIds);
        if (spendExceedsBudget(agg.spend, budget, prefs.spendThreshold)) {
          const pct = Math.round((agg.spend / budget - 1) * 100);
          queued.push({
            identifier: notificationIdentifier(NOTIFICATION_EVENTS.campaignOverspend, today),
            event: NOTIFICATION_EVENTS.campaignOverspend,
            title: "Ad spend is high",
            body: `Today is ${pct}% over the $${budget.toFixed(0)}/day budget.`,
          });
          state.spendAlertDay = today;
        }
      } catch (e) {
        devWarn("alert: budget fetch failed", e);
      }
    }

    if (preferenceAllowsEvent(prefs, NOTIFICATION_EVENTS.bookAttention)) {
      try {
        const books = await fetchTopBooksRange({ profileIds, start: today, end: today, limit: 5 });
        for (const book of books) {
          if (!bookNeedsAttention(book)) continue;
          const key = book.asin || book.sku || "";
          if (!canNotifyBookToday(state, key)) continue;
          queued.push({
            identifier: notificationIdentifier(NOTIFICATION_EVENTS.bookAttention, today, key),
            event: NOTIFICATION_EVENTS.bookAttention,
            title: "Book needs attention",
            body: `${book.title ?? key}: ACoS ${Math.round(book.acos)}% vs break-even ${Math.round(book.breakeven_acos)}%.`,
            asin: book.asin || undefined,
          });
          Object.assign(state, markBookNotified(state, key));
        }
      } catch (e) {
        devWarn("alert: books fetch failed", e);
      }
    }

    await storage.setItem(ALERT_STATE_KEY, JSON.stringify(state));

    for (const item of queued) {
      try {
        await scheduleLocalAlert({ ...item, userId: userId! });
      } catch (e) {
        devWarn("Could not schedule notification.", e);
      }
    }
    return queued.length;
  } catch (e) {
    devWarn(`runAlertCheck(${source}) failed.`, e);
    return 0;
  }
}

try {
  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }) as any,
  });
} catch (error) {
  devWarn("Notification handler unavailable.", error);
}

if (!TaskManager.isTaskDefined(INTELIADS_BACKGROUND_TASK)) {
  TaskManager.defineTask(INTELIADS_BACKGROUND_TASK, async () => {
    try {
      await runAlertCheck("background");
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

if (!TaskManager.isTaskDefined(INTELIADS_NOTIFICATION_TASK)) {
  TaskManager.defineTask(INTELIADS_NOTIFICATION_TASK, async () => {
    return BackgroundTask.BackgroundTaskResult.Success;
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

    if (userId) {
      try {
        if (previous.token && previous.userId && previous.userId !== userId) {
          await supabase
            .from("device_push_tokens")
            .delete()
            .eq("token", previous.token)
            .eq("user_id", previous.userId);
        }
        await supabase
          .from("device_push_tokens")
          .upsert(
            { user_id: userId, token, platform: Platform.OS, token_type: type, updated_at: new Date().toISOString() },
            { onConflict: "token" },
          );
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
  }
  await storage.removeItem(DEVICE_PUSH_TOKEN_KEY);
  await storage.removeItem(ALERT_STATE_KEY);
}

export async function configureNotifications(
  prefs: NotificationPrefs,
  opts?: { requestPermission?: boolean },
): Promise<{
  permission: "granted" | "denied" | "undetermined";
  backgroundRegistered: boolean;
}> {
  const wantsNotifications = prefs.newOrder || prefs.bookAttention || prefs.campaignSpend;
  if (!wantsNotifications) {
    try {
      await BackgroundTask.unregisterTaskAsync(INTELIADS_BACKGROUND_TASK);
    } catch {}
    try {
      await Notifications.unregisterTaskAsync(INTELIADS_NOTIFICATION_TASK);
    } catch {}
    return { permission: "undetermined", backgroundRegistered: false };
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

  let backgroundRegistered = false;
  try {
    const available = await TaskManager.isAvailableAsync();
    const status = await BackgroundTask.getStatusAsync();
    if (available && status === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(INTELIADS_BACKGROUND_TASK, { minimumInterval: 15 });
      backgroundRegistered = true;
    }
  } catch (error) {
    devWarn("Background refresh task unavailable.", error);
  }

  return { permission, backgroundRegistered };
}

export async function sendTestNotification(userId?: string | null): Promise<boolean> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return false;
    const { data: { session } } = await supabase.auth.getSession();
    const owner = userId ?? session?.user?.id ?? null;
    if (!owner) return false;

    const today = toDateString(new Date());
    await scheduleLocalAlert({
      identifier: notificationIdentifier(NOTIFICATION_EVENTS.test, today),
      event: NOTIFICATION_EVENTS.test,
      userId: owner,
      title: TEST_NOTIFICATION_TITLE,
      body: TEST_NOTIFICATION_BODY,
    });
    return true;
  } catch (e) {
    devWarn("sendTestNotification failed", e);
    return false;
  }
}
