import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

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

test("expired native wakes reject late completion and only one race winner publishes", () => {
  const gate = manager.slice(manager.indexOf("private final class CompletionGate"));
  const dir = mkdtempSync(join(tmpdir(), "inteliads-wake-gate-"));
  try {
    const path = join(dir, "gate.swift");
    writeFileSync(path, `import Foundation\n${gate}\n
private let expired = CompletionGate()
precondition(expired.markExpired())
precondition(!expired.markCompleted())
precondition(!expired.markExpired())
private let completed = CompletionGate()
precondition(completed.markCompleted())
precondition(!completed.markExpired())
precondition(!completed.markCompleted())
for _ in 0..<1000 {
  let gate = CompletionGate()
  let lock = NSLock()
  var winners = 0
  DispatchQueue.concurrentPerform(iterations: 20) { index in
    let won = index % 2 == 0 ? gate.markExpired() : gate.markCompleted()
    if won { lock.lock(); winners += 1; lock.unlock() }
  }
  precondition(winners == 1)
}
print("wake gate races passed")
`);
    assert.match(execFileSync("xcrun", ["swift", path], { encoding: "utf8" }), /races passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal((manager.match(/guard let self, gate\.markCompleted\(\) else \{ return \}/g) ?? []).length, 2);
  assert.equal((manager.match(/guard gate\.markExpired\(\) else \{ return \}/g) ?? []).length, 2);
});

test("a healthy native wake preserves the importer's pending or login-required status", () => {
  assert.doesNotMatch(manager, /status: ok \? "Updated"/);
  assert.doesNotMatch(manager, /completedAt: ok \? Date\(\)/);
  assert.match(manager, /"successScope": "task_manager_wake"/);
  assert.match(manager, /Unknown TaskManager results[\s\S]*ok = false/);
});
