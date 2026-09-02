/** Pure notification routing, preference, and dedup helpers. No Expo / network. */

import { DEEP_LINK_HREFS, isAllowedAppHref } from "./deepLinkContract.ts";

export const NOTIFICATION_EVENTS = {
  test: "test",
  newOrders: "new-orders",
  bookAttention: "book-attention",
  campaignOverspend: "campaign-overspend",
  periodCompare: "period-compare",
} as const;

/** Backend is the sole new-order authority. Local evaluators must not generate this type. */
export const LOCAL_NEW_ORDER_AUTHORITY = false;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

export const NOTIFICATION_ROUTES = {
  tabs: DEEP_LINK_HREFS.overview,
  campaigns: DEEP_LINK_HREFS.campaigns,
  books: DEEP_LINK_HREFS.books,
  settings: DEEP_LINK_HREFS.settings,
  sync: DEEP_LINK_HREFS.sync,
  bidBot: DEEP_LINK_HREFS.bidBot,
  rules: DEEP_LINK_HREFS.ruleHistory,
} as const;

export type NotificationPrefsInput = {
  newOrder?: boolean;
  dailyReport?: boolean;
  dailyDigest?: boolean;
  includeKdpNet?: boolean;
  bookAttention?: boolean;
  campaignSpend?: boolean;
  spendThreshold?: number;
};

export type AlertState = {
  day?: string;
  ordersNotified?: number;
  spendAlertDay?: string;
  spendAlertDays?: Record<string, true>;
  bookAlerts?: Record<string, true>;
  campaignLeakDays?: Record<string, true>;
  periodAlertMonth?: string;
  bookPeriodAlerts?: Record<string, true>;
  digestDay?: string;
  lastDigestHour?: number;
};

export type NotificationPayload = {
  event: NotificationEvent;
  userId: string;
  asin?: string;
};

export type NotificationRoute = {
  href: string;
  reason: string;
};

const EVENT_SET = new Set<string>(Object.values(NOTIFICATION_EVENTS));
const ASIN_RE = /^[A-Z0-9]{8,16}$/i;

export function preferenceAllowsEvent(prefs: NotificationPrefsInput, event: NotificationEvent): boolean {
  if (event === NOTIFICATION_EVENTS.test) return true;
  if (event === NOTIFICATION_EVENTS.newOrders) return !!prefs.newOrder;
  if (event === NOTIFICATION_EVENTS.bookAttention) return !!prefs.bookAttention;
  if (event === NOTIFICATION_EVENTS.campaignOverspend) return !!prefs.campaignSpend;
  if (event === NOTIFICATION_EVENTS.periodCompare) {
    return !!(prefs.dailyReport || prefs.dailyDigest);
  }
  return false;
}

export function normalizedSpendThreshold(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 25;
}

/** Same formula Settings documents: spend > sum(daily budgets) * (1 + threshold/100). */
export function spendExceedsBudget(spend: number, budget: number, thresholdPercent: unknown): boolean {
  if (!(budget > 0) || !Number.isFinite(spend)) return false;
  return spend > budget * (1 + normalizedSpendThreshold(thresholdPercent) / 100);
}

export function newOrderDelta(currentOrders: number, alreadyNotified: number): number {
  const current = Number.isFinite(currentOrders) ? currentOrders : 0;
  const notified = Number.isFinite(alreadyNotified) ? alreadyNotified : 0;
  return current > notified ? current - notified : 0;
}

export function bookNeedsAttention(book: {
  sales?: number | null;
  acos?: number | null;
  breakeven_acos?: number | null;
}): boolean {
  const sales = Number(book.sales) || 0;
  const acos = Number(book.acos) || 0;
  const breakeven = Number(book.breakeven_acos) || 0;
  return sales > 0 && breakeven > 0 && acos > breakeven * 1.1;
}

function addCalendarDaysLocal(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function pruneDatedKeysLocal(map: Record<string, true> | undefined, keepDays: string[]): Record<string, true> {
  const keep = new Set(keepDays);
  const next: Record<string, true> = {};
  for (const key of Object.keys(map ?? {})) {
    if (keep.has(key.slice(0, 10))) next[key] = true;
  }
  return next;
}

export function rollAlertState(state: AlertState, today: string): AlertState {
  const yesterday = addCalendarDaysLocal(today, -1);
  const keepDays = [today, yesterday];
  if (state.day === today) {
    return {
      ...state,
      bookAlerts: { ...(state.bookAlerts ?? {}) },
      spendAlertDays: { ...(state.spendAlertDays ?? {}) },
      campaignLeakDays: { ...(state.campaignLeakDays ?? {}) },
      bookPeriodAlerts: { ...(state.bookPeriodAlerts ?? {}) },
      periodAlertMonth: state.periodAlertMonth,
    };
  }
  const spendAlertDays = pruneDatedKeysLocal(state.spendAlertDays, keepDays);
  if (state.spendAlertDay && keepDays.includes(state.spendAlertDay)) {
    spendAlertDays[state.spendAlertDay] = true;
  }
  return {
    day: today,
    ordersNotified: 0,
    spendAlertDay: spendAlertDays[today] ? today : undefined,
    spendAlertDays,
    bookAlerts: {},
    campaignLeakDays: pruneDatedKeysLocal(state.campaignLeakDays, keepDays),
    periodAlertMonth: state.periodAlertMonth,
    bookPeriodAlerts: { ...(state.bookPeriodAlerts ?? {}) },
  };
}

export function canNotifyBookToday(state: AlertState, key: string): boolean {
  return !!key && !state.bookAlerts?.[key];
}

export function markBookNotified(state: AlertState, key: string): AlertState {
  if (!key) return state;
  return { ...state, bookAlerts: { ...(state.bookAlerts ?? {}), [key]: true } };
}

export function safeAsin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const asin = value.trim();
  return ASIN_RE.test(asin) ? asin.toUpperCase() : null;
}

export function parseNotificationPayload(raw: unknown): NotificationPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const event = typeof data.event === "string" ? data.event : "";
  if (!EVENT_SET.has(event)) return null;
  const userId = typeof data.userId === "string" ? data.userId.trim() : "";
  if (!userId) return null;
  const asin = safeAsin(data.asin);
  const payload: NotificationPayload = { event: event as NotificationEvent, userId };
  if (asin) payload.asin = asin;
  return payload;
}

export function isSafeNotificationHref(href: string): boolean {
  return isAllowedAppHref(href);
}

export function routeForNotification(
  payload: NotificationPayload | null,
  currentUserId: string | null | undefined,
): NotificationRoute {
  if (!payload) return { href: NOTIFICATION_ROUTES.tabs, reason: "unknown-or-malformed" };
  if (!currentUserId) return { href: NOTIFICATION_ROUTES.tabs, reason: "unauthenticated" };
  if (payload.userId !== currentUserId) return { href: NOTIFICATION_ROUTES.tabs, reason: "wrong-user" };

  if (payload.event === NOTIFICATION_EVENTS.test) {
    return { href: NOTIFICATION_ROUTES.settings, reason: "test" };
  }
  if (payload.event === NOTIFICATION_EVENTS.newOrders || payload.event === NOTIFICATION_EVENTS.campaignOverspend) {
    return { href: NOTIFICATION_ROUTES.campaigns, reason: payload.event };
  }
  if (payload.event === NOTIFICATION_EVENTS.periodCompare) {
    return { href: NOTIFICATION_ROUTES.tabs, reason: payload.event };
  }
  if (payload.event === NOTIFICATION_EVENTS.bookAttention) {
    if (payload.asin) return { href: `/product/${payload.asin}`, reason: "book" };
    return { href: NOTIFICATION_ROUTES.books, reason: "book-list" };
  }
  return { href: NOTIFICATION_ROUTES.tabs, reason: "unknown-event" };
}

export function notificationIdentifier(event: NotificationEvent, day: string, entity?: string): string {
  const extra = entity ? `.${entity}` : "";
  return `io.inteliads.${event}.${day}${extra}`;
}

export function shouldEvaluateAlerts(input: {
  hasSession: boolean;
  profileIds: unknown;
  adminFilterUserId?: string | null;
  guest?: boolean;
}): boolean {
  if (input.guest) return false;
  if (!input.hasSession) return false;
  if (typeof input.adminFilterUserId === "string" && input.adminFilterUserId.length > 0) return false;
  return Array.isArray(input.profileIds) && input.profileIds.length > 0;
}

export function buildNotificationPayload(event: NotificationEvent, userId: string, asin?: string | null): NotificationPayload {
  const payload: NotificationPayload = { event, userId };
  const safe = safeAsin(asin);
  if (safe) payload.asin = safe;
  return payload;
}
