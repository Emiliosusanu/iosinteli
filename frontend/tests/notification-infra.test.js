import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_ROUTES,
  bookNeedsAttention,
  buildNotificationPayload,
  canNotifyBookToday,
  isSafeNotificationHref,
  markBookNotified,
  newOrderDelta,
  notificationIdentifier,
  parseNotificationPayload,
  preferenceAllowsEvent,
  rollAlertState,
  routeForNotification,
  shouldEvaluateAlerts,
  spendExceedsBudget,
} from "../src/lib/notificationContract.ts";

const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/contexts/AuthContext.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");

const prefsOn = { newOrder: true, bookAttention: true, campaignSpend: true, spendThreshold: 25 };
const prefsOff = { newOrder: false, bookAttention: false, campaignSpend: false, spendThreshold: 25 };

test("disabled preferences do not schedule and threshold is used", () => {
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.newOrders), false);
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.bookAttention), false);
  assert.equal(preferenceAllowsEvent(prefsOff, NOTIFICATION_EVENTS.campaignOverspend), false);
  assert.equal(preferenceAllowsEvent(prefsOn, NOTIFICATION_EVENTS.newOrders), true);
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
  assert.equal(routeForNotification(null, user).href, NOTIFICATION_ROUTES.tabs);
  assert.equal(
    routeForNotification(parseNotificationPayload({ event: "new-orders", userId: user, url: "/more/bid-bot" }), user).href,
    NOTIFICATION_ROUTES.campaigns,
  );
  assert.equal(parseNotificationPayload({ event: "new-orders", userId: user, url: "https://evil.test" })?.event, "new-orders");
  assert.equal(parseNotificationPayload({ url: "/more/bid-bot" }), null);
  assert.equal(parseNotificationPayload({ event: "new-orders", userId: "" }), null);
  assert.equal(isSafeNotificationHref("/more/bid-bot"), false);
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
  assert.match(notifications, /\.delete\(\)/);
  assert.match(auth, /clearNotificationIdentity/);
  assert.match(app, /clearNotificationIdentity/);
  assert.match(app, /requestPermission: false/);
  assert.match(app, /requestPermission: wants/);
  assert.match(notifications, /shouldSetBadge: false/);
  assert.match(notifications, /Ads-attributed orders/);
  assert.doesNotMatch(notifications, /data: \{ url: "\/\(tabs\)" \}/);
});
