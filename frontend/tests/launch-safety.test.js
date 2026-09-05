import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supabase = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
const native = readFileSync(new URL("../src/components/ios/Native.tsx", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const accountsUi = readFileSync(new URL("../src/lib/accountsUi.ts", import.meta.url), "utf8");
const glass = readFileSync(new URL("../src/components/GlassPanel.tsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const nativeSync = readFileSync(
  new URL("../modules/inteliads-native-sync/src/index.ts", import.meta.url),
  "utf8",
);
const appJson = readFileSync(new URL("../app.json", import.meta.url), "utf8");

test("empty Supabase env cannot throw at createClient", () => {
  assert.match(supabase, /SAFE_SUPABASE_URL/);
  assert.match(supabase, /createClient\(SAFE_SUPABASE_URL, SAFE_SUPABASE_ANON_KEY/);
  assert.match(supabase, /unavailable\.supabase\.co/);
});

test("theme clamps unknown / unspecified schemes to light or dark", () => {
  assert.match(theme, /raw === "dark" \? "dark" : "light"/);
  assert.doesNotMatch(theme, /as ColorScheme/);
});

test("ExpoUI SwiftUI is lazy so Overview SF Symbols do not import-crash", () => {
  assert.match(native, /function nativeSwift/);
  assert.match(native, /swiftUiMemo !== undefined/);
  assert.doesNotMatch(native, /const swiftUi = loadSwiftUi\(\)/);
});

test("Select all planner exists and AppContext guards a missing export", () => {
  assert.match(accountsUi, /export function planSelectAllSameCurrency/);
  assert.match(appContext, /typeof planSelectAllSameCurrency === "function"/);
});

test("chrome blur uses stock iOS tints", () => {
  assert.match(glass, /tint=\{dark \? "dark" : "light"\}/);
  assert.doesNotMatch(glass, /systemChromeMaterial/);
});

test("TaskManager.defineTask cannot abort AppContext import", () => {
  assert.match(notifications, /function defineLaunchSafeTask/);
  assert.match(notifications, /TaskManager\.defineTask\(name, runner\)/);
  assert.doesNotMatch(
    notifications,
    /if \(!TaskManager\.isTaskDefined\([\s\S]*TaskManager\.defineTask\(/,
  );
});

test("InteliAdsNativeSync is optional at module load", () => {
  assert.match(nativeSync, /requireOptionalNativeModule\("InteliAdsNativeSync"\)/);
  assert.doesNotMatch(nativeSync, /requireNativeModule\("InteliAdsNativeSync"\)/);
});

test("shipping build number is 56", () => {
  assert.match(appJson, /"buildNumber": "56"/);
});
