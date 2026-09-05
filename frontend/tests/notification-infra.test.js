import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_ROUTES,
  SERVER_NOTIFICATION_TYPES,
  bookNeedsAttention,
  buildNotificationPayload,
  canNotifyBookToday,
  isSafeNotificationHref,
  markBookNotified,
  newOrderDelta,
  normalizeNotificationEvent,
  notificationIdentifier,
  parseNotificationPayload,
  preferenceAllowsEvent,
  rollAlertState,
  routeForNotification,
  shouldEvaluateAlerts,
  spendExceedsBudget,
} from "../src/lib/notificationContract.ts";
import {
  acosDirection,
  addCalendarDays,
  bookAlertLabel,
  booksWithAcosRise,
  monthToDateWindows,
  pickZeroOrderLeaks,
} from "../src/lib/notificationPeriod.ts";

const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/contexts/AuthContext.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");

const prefsOn = { newOrder: true, bookAttention: true, campaignSpend: true, dailyDigest: true, spendThreshold: 25 };
const prefsOff = { newOrder: false, bookAttention: false, campaignSpend: false, spendThreshold: 25 };

test("disabled preferences do not schedule and threshold is used", () => {
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.newOrders), false);
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.bookAttention), false);
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.campaignOverspend), false);
  assert.equal(preferenceAllowsEvent(prefsOn, NOTIFICATION_EVENTS.newOrders), true);
  assert.equal(preferenceAllowsEvent(prefsOn, NOTIFICATION_EVENTS.periodCompare), true);
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.periodCompare), false);
  assert.equal(preferenceAllowsEvent({ campaignSpend: true }, NOTIFICATION_EVENTS.periodCompare), false);
  assert.equal(spendExceedsBudget(120, 100, 25), false);
  assert.equal(spendExceedsBudget(126, 100, 25), true);
  assert.equal(spendExceedsBudget(110, 100, undefined), false);
  assert.equal(spendExceedsBudget(10, 0, 25), false);
});

test("routes book and campaign events, and rejects unsafe payloads", () => {
  const user = "user-a";
  assert.deepEqual(
    routeForNotification(buildNotificationPayload(NOTIFICATION_EVENTS.bookAttention, user, "B0QAASIN01"), user),
    { href: "/product/B0QAASIN01", reason: "book" },
  );
  assert.deepEqual(
    routeForNotification(buildNotificationPayload(NOTIFICATION_EVENTS.campaignOverspend, user), user),
    { href: NOTIFICATION_ROUTES.campaigns, reason: NOTIFICATION_EVENTS.campaignOverspend },
  );
  assert.deepEqual(
    routeForNotification(buildNotificationPayload(NOTIFICATION_EVENTS.newOrders, user), user),
    { href: NOTIFICATION_ROUTES.campaigns, reason: NOTIFICATION_EVENTS.newOrders },
  );
  assert.deepEqual(
    routeForNotification(buildNotificationPayload(NOTIFICATION_EVENTS.periodCompare, user), user),
    { href: NOTIFICATION_ROUTES.tabs, reason: NOTIFICATION_EVENTS.periodCompare },
  );
  assert.equal(routeForNotification(null, user).href, NOTIFICATION_ROUTES.tabs);
  assert.equal(
    routeForNotification(parseNotificationPayload({ event: "new-orders", userId: user, url: "/more/bid-bot" }), user).href,
    NOTIFICATION_ROUTES.campaigns,
  );
  assert.equal(parseNotificationPayload({ event: "new-orders", userId: user, url: "https://evil.test" })?.event, "new-orders");
  assert.equal(parseNotificationPayload({ url: "/more/bid-bot" }), null);
  assert.equal(parseNotificationPayload({ event: "new-orders", userId: "" }), null);
  assert.equal(isSafeNotificationHref("/more/bid-bot"), true);
  assert.equal(isSafeNotificationHref("https://evil.test"), false);
  assert.equal(isSafeNotificationHref("/product/../campaign/1"), false);
  assert.equal(isSafeNotificationHref("/product/B0QAASIN01"), true);
});

test("stale notification for another user cannot open that user's entity", () => {
  const payload = buildNotificationPayload(NOTIFICATION_EVENTS.bookAttention, "user-a", "B0QAASIN01");
  assert.deepEqual(routeForNotification(payload, "user-b"), { href: NOTIFICATION_ROUTES.tabs, reason: "wrong-user" });
  assert.equal(routeForNotification(payload, null).reason, "unauthenticated");
  assert.match(layout, /parseNotificationPayload/);
  assert.match(layout, /routeForNotification/);
  assert.match(layout, /isSafeNotificationHref/);
  assert.doesNotMatch(layout, /data\?\.url/);
});

test("same-day dedup window suppresses a second book or overspend stamp", () => {
  const rolled = rollAlertState({}, "2026-08-23");
  assert.equal(rolled.ordersNotified, 0);
  assert.equal(newOrderDelta(4, 4), 0);
  assert.equal(newOrderDelta(6, 4), 2);
  assert.equal(canNotifyBookToday(rolled, "B0QAASIN01"), true);
  const after = markBookNotified(rolled, "B0QAASIN01");
  assert.equal(canNotifyBookToday(after, "B0QAASIN01"), false);
  const nextDay = rollAlertState(after, "2026-08-24");
  assert.equal(canNotifyBookToday(nextDay, "B0QAASIN01"), true);
  assert.equal(notificationIdentifier(NOTIFICATION_EVENTS.campaignOverspend, "2026-08-23"), "io.inteliads.campaign-overspend.2026-08-23");
  const keptMonth = rollAlertState(
    { day: "2026-08-24", periodAlertMonth: "2026-08", campaignLeakDays: { "2026-08-24:Alpha": true } },
    "2026-08-25",
  );
  assert.equal(keptMonth.periodAlertMonth, "2026-08");
  assert.equal(keptMonth.campaignLeakDays?.["2026-08-24:Alpha"], true);
});

test("period compare uses last month same days and never invents a book title", () => {
  assert.deepEqual(monthToDateWindows("2026-08-25"), {
    thisMonth: { start: "2026-08-01", end: "2026-08-25" },
    lastMonthSamePeriod: { start: "2026-07-01", end: "2026-07-25" },
  });
  assert.equal(addCalendarDays("2026-08-25", -1), "2026-08-24");
  assert.equal(acosDirection(31, 24), "up");
  assert.equal(acosDirection(20, 28), "down");
  assert.deepEqual(
    pickZeroOrderLeaks([
      { name: " ", spend: 90, orders: 0 },
      { name: "Alpha", spend: 12, orders: 0 },
      { name: "Beta", spend: 40, orders: 0 },
    ]),
    [{ name: "Beta", spend: 40 }, { name: "Alpha", spend: 12 }],
  );
  assert.equal(bookAlertLabel({ title: "  ", asin: "B0QAASIN01" }), "B0QAASIN01");
  assert.deepEqual(
    booksWithAcosRise(
      [{ asin: "B0QAASIN01", title: "Real Book", acos: 40, sales: 20 }],
      [{ asin: "B0QAASIN01", acos: 28, sales: 18 }],
    ),
    [{ key: "B0QAASIN01", label: "Real Book", currentAcos: 40, priorAcos: 28 }],
  );
  assert.doesNotMatch(notifications, /last month same days/);
  assert.doesNotMatch(notifications, /fetchNamedCampaignTotals/);
  assert.match(notifications, /runDualSourceBackgroundRefresh/);
  assert.match(notifications, /resolveBackgroundScope/);
});

test("server wire-format events map onto canonical events and route correctly", () => {
  const user = "user-a";
  // Server sends ads_new_orders / daily_ads_summary / transport_test — not our
  // canonical ids. They must normalize, not fall through to null.
  assert.equal(normalizeNotificationEvent(SERVER_NOTIFICATION_TYPES.adsNewOrders), NOTIFICATION_EVENTS.newOrders);
  assert.equal(normalizeNotificationEvent(SERVER_NOTIFICATION_TYPES.dailyAdsSummary), NOTIFICATION_EVENTS.periodCompare);
  assert.equal(normalizeNotificationEvent(SERVER_NOTIFICATION_TYPES.transportTest), NOTIFICATION_EVENTS.test);
  assert.equal(normalizeNotificationEvent("new-orders"), NOTIFICATION_EVENTS.newOrders);
  assert.equal(normalizeNotificationEvent("garbage"), null);
  assert.equal(normalizeNotificationEvent(42), null);

  // A real backend "new orders" push must deep-link to Campaigns, not Overview.
  const newOrders = parseNotificationPayload({
    event: SERVER_NOTIFICATION_TYPES.adsNewOrders,
    userId: user,
    eventId: "evt-1",
    reportDate: "2026-09-03",
    deltaOrders: 3,
  });
  assert.equal(newOrders?.event, NOTIFICATION_EVENTS.newOrders);
  assert.equal(routeForNotification(newOrders, user).href, NOTIFICATION_ROUTES.campaigns);

  const daily = parseNotificationPayload({ event: SERVER_NOTIFICATION_TYPES.dailyAdsSummary, userId: user });
  assert.equal(routeForNotification(daily, user).href, NOTIFICATION_ROUTES.tabs);

  const testPush = parseNotificationPayload({ event: SERVER_NOTIFICATION_TYPES.transportTest, userId: user });
  assert.equal(routeForNotification(testPush, user).reason, "test");
});

test("push arrival repaints live screens and self-heals device tokens", () => {
  // A landed push emits a refresh the app subscribes to (AppContext owns queryClient).
  assert.match(notifications, /subscribeNotificationRefresh/);
  assert.match(notifications, /emitNotificationRefresh/);
  assert.match(app, /subscribeNotificationRefresh/);
  assert.match(app, /refetchType: "active"/);
  // Heavy KDP WebView replay is gated to silent wakes, not every visible banner.
  assert.match(notifications, /if \(silent\) \{/);
  // Re-registering a live device clears prior disable/invalidate so the sender resumes.
  assert.match(notifications, /disabled_at: null/);
  assert.match(notifications, /invalidated_at: null/);
  assert.match(notifications, /bundle_id: "io\.inteliads\.app"/);
});

test("alert evaluation requires session and selected profiles, and skips view-as", () => {
  assert.equal(shouldEvaluateAlerts({ hasSession: true, profileIds: ["p1"] }), true);
  assert.equal(shouldEvaluateAlerts({ hasSession: false, profileIds: ["p1"] }), false);
  assert.equal(shouldEvaluateAlerts({ hasSession: true, profileIds: [] }), false);
  assert.equal(shouldEvaluateAlerts({ hasSession: true, profileIds: ["p1"], adminFilterUserId: "customer" }), false);
  assert.equal(shouldEvaluateAlerts({ hasSession: true, profileIds: ["p1"], guest: true }), false);
  assert.equal(bookNeedsAttention({ sales: 10, acos: 40, breakeven_acos: 30 }), true);
  assert.equal(bookNeedsAttention({ sales: 10, acos: 31, breakeven_acos: 30 }), false);
  assert.equal(bookNeedsAttention({ sales: 0, acos: 90, breakeven_acos: 20 }), false);
});

test("token association and sign-out detach live in product code", () => {
  assert.match(notifications, /userId/);
  assert.match(notifications, /device_push_tokens/);
  assert.match(notifications, /clearNotificationIdentity/);
  // Soft-disable on detach (Nest parity); hard-delete would desync senders.
  assert.match(notifications, /disabled_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(notifications, /\.delete\(\)\s*\n\s*\.eq\("token"/);
  assert.match(auth, /clearNotificationIdentity/);
  assert.match(app, /clearNotificationIdentity/);
  assert.match(app, /requestPermission: false/);
  assert.match(app, /requestPermission: wants/);
  assert.match(notifications, /shouldSetBadge: false/);
  assert.match(notifications, /LOCAL_NEW_ORDER_AUTHORITY/);
  assert.match(notifications, /LOCAL_NEW_ORDER_AUTHORITY &&/);
  assert.doesNotMatch(notifications, /local new-order authority is forbidden/);
  assert.match(app, /runDualSourceBackgroundRefresh/);
  assert.match(app, /runAlertCheck\("foreground"\)/);
  assert.doesNotMatch(app, /setInterval\(\(\) => void runAlertCheck/);
  assert.match(notifications, /ALERT_CHECK_COOLDOWN_MS/);
  assert.match(notifications, /ALERT_CHECK_LAST_RUN_KEY/);
  assert.match(notifications, /adminFilterUserId: scope\.viewAs/);
  assert.doesNotMatch(notifications, /data: \{ url: "\/\(tabs\)" \}/);
  // Mass-use: prefs default OFF; Nest owns morning digest.
  assert.match(app, /newOrder: false/);
  assert.match(app, /dailyDigest: false/);
  assert.match(app, /bookAttention: false/);
  assert.match(app, /campaignSpend: false/);
  // All-off still syncs explicit OFF to Nest (no stale ON prefs).
  assert.match(notifications, /Still push explicit OFF to Nest/);
  assert.match(notifications, /newOrder: false,\s*\n\s*dailyDigest: false/);
});
