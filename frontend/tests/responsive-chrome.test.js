/**
 * Responsive floating dock + frosted Overview sticky chrome.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { dockScaleForWidth } from "../src/lib/dockScale.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tabBar = readFileSync(join(root, "src/components/FloatingTabBar.tsx"), "utf8");
const header = readFileSync(
  join(root, "src/components/OverviewHeaderV3.tsx"),
  "utf8",
);

test("dockScaleForWidth grows tap targets across sm/md/lg", () => {
  const sm = dockScaleForWidth(350);
  const md = dockScaleForWidth(400);
  const lg = dockScaleForWidth(430);
  const xl = dockScaleForWidth(800);
  assert.equal(sm.tier, "sm");
  assert.equal(md.tier, "md");
  assert.equal(lg.tier, "lg");
  assert.ok(sm.segmentMinHeight >= 48);
  assert.ok(md.segmentMinHeight > sm.segmentMinHeight);
  assert.ok(lg.icon >= md.icon);
  assert.ok(xl.maxWidth >= lg.maxWidth);
  assert.ok(xl.icon >= lg.icon);
});

test("FloatingTabBar uses solid theme-synced dock and is adaptive", () => {
  assert.match(tabBar, /PressableScale/);
  assert.match(tabBar, /dockScaleForWidth/);
  assert.match(tabBar, /tab-rail-\$\{scale\.tier\}/);
  assert.match(tabBar, /tabbar_background/);
  assert.match(tabBar, /shadow\.floating/);
  assert.match(tabBar, /withSpring/);
  assert.match(tabBar, /activePill/);
  // Mockup: SF Symbols, vertical active capsule, blue selected icon, no primary glow.
  assert.match(tabBar, /house\.fill/);
  assert.match(tabBar, /megaphone\.fill/);
  assert.match(tabBar, /books\.vertical/);
  assert.match(tabBar, /flexDirection: "column"/);
  assert.match(tabBar, /selectedFg|tabbar_selected_fg/);
  assert.doesNotMatch(tabBar, /shadowOpacity:\s*0\.42/);
  assert.doesNotMatch(tabBar, /InteliAdsIcon/);
  assert.doesNotMatch(tabBar, /BlurView/);
});

test("Overview sticky chrome uses native BlurView frost + stadium period", () => {
  assert.match(header, /BlurView/);
  assert.match(header, /tint=\{chrome\.scheme === "dark" \? "dark"/);
  assert.match(header, /systemChromeMaterialLight/);
  assert.match(header, /overview-sticky-blur-/);
  assert.match(header, /stickyRgbSV/);
  assert.match(header, /home-header-compact/);
  assert.match(header, /home-period/);
  assert.match(header, /sun\.max/);
  assert.match(header, /roomy/);
});
