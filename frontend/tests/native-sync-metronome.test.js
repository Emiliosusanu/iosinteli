import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const notifications = readFileSync(join(root, "src/lib/notifications.ts"), "utf8");
const importer = readFileSync(join(root, "src/lib/kdp/importer.ts"), "utf8");
const appJson = readFileSync(join(root, "app.json"), "utf8");
const infoPlist = readFileSync(join(root, "ios/InteliAds/Info.plist"), "utf8");
const entitlements = readFileSync(join(root, "ios/InteliAds/InteliAds.entitlements"), "utf8");
const manager = readFileSync(
  join(root, "modules/inteliads-native-sync/ios/BackgroundRefreshManager.swift"),
  "utf8",
);
const moduleJs = readFileSync(join(root, "modules/inteliads-native-sync/src/index.ts"), "utf8");

test("native dual BGTask IDs match Royaltix pattern under inteliads bundle", () => {
  assert.match(manager, /io\.inteliads\.app\.refresh/);
  assert.match(manager, /io\.inteliads\.app\.processing/);
  assert.match(manager, /15 \* 60/);
  assert.match(manager, /BGAppRefreshTaskRequest/);
  assert.match(manager, /BGProcessingTaskRequest/);
  assert.match(manager, /requiresExternalPower = false/);
  assert.match(manager, /EXTaskLaunchReasonBackgroundTask/);
  assert.match(manager, /setPendingWakeKind\("recent"\)/);
  assert.match(manager, /setPendingWakeKind\("processing"\)/);
});

test("Info.plist and app.json permit refresh + processing + expo worker", () => {
  for (const src of [infoPlist, appJson]) {
    assert.match(src, /io\.inteliads\.app\.refresh/);
    assert.match(src, /io\.inteliads\.app\.processing/);
    assert.match(src, /com\.expo\.modules\.backgroundtask\.processing/);
  }
});

test("App Group is wired for widget snapshot sharing", () => {
  assert.match(entitlements, /group\.io\.inteliads\.app/);
  assert.match(moduleJs, /group\.io\.inteliads\.app/);
  assert.equal(existsSync(join(root, "ios/InteliAdsSyncWidget/InteliAdsSyncStatusWidget.swift")), true);
  assert.equal(existsSync(join(root, "ios/SyncActivityShared/InteliAdsWidgetSnapshot.swift")), true);
});

test("JS registers native metronome and publishes sync snapshots", () => {
  assert.match(notifications, /registerNativeMetronome/);
  assert.match(notifications, /inteliads-native-sync/);
  assert.match(notifications, /resolveLockedPhoneKdpWakeMode/);
  assert.match(importer, /publishKdpSyncSnapshot/);
  assert.match(importer, /updateNativeSyncSnapshot/);
  assert.match(importer, /scheduleNativeMetronome/);
  assert.match(moduleJs, /consumeNativeWakeKind/);
});

test("config plugin is listed for entitlements + BG identifiers", () => {
  assert.match(appJson, /withInteliAdsNativeSync\.js/);
});
