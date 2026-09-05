import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  formatUpdatedAgo,
  isPlaceholderMetric,
  motion,
  PRESS_SCALE,
  shouldCrossfadeMetric,
  syncChrome,
} from "../src/lib/motion.ts";
import { bidBotOperationalCopy } from "../src/lib/bidBotContract.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");
const tabs = readFileSync(new URL("../app/(tabs)/_layout.tsx", import.meta.url), "utf8");

test("motion tokens match the premium duration bands", () => {
  assert.equal(motion.pressFeedback, 100);
  assert.equal(motion.fastState, 140);
  assert.equal(motion.contentChange, 200);
  assert.equal(motion.segmentTransition, 200);
  assert.equal(motion.sheetTransition, 280);
  assert.equal(motion.glassSettle, 260);
  assert.equal(motion.staggerStep, 45);
  assert.equal(PRESS_SCALE, 0.972);
});

test("verified metrics do not invent a zero start", () => {
  assert.equal(isPlaceholderMetric("—"), true);
  assert.equal(shouldCrossfadeMetric("—", "$9.11"), false);
  assert.equal(shouldCrossfadeMetric("$8.38", "$9.11"), true);
  assert.equal(shouldCrossfadeMetric("$0.00", "$9.11"), true);
  assert.equal(shouldCrossfadeMetric("$8.38", "$8.38"), false);
});

test("sync chrome stays editorial", () => {
  assert.deepEqual(
    syncChrome({ failedRefresh: true, refreshing: false, stale: false, warning: false }),
    { state: "failed", compact: "Failed", label: "Couldn't refresh" },
  );
  assert.equal(
    syncChrome({ failedRefresh: false, refreshing: true, stale: false, warning: false }).state,
    "refreshing",
  );
  assert.match(formatUpdatedAgo("2026-08-25T17:30:00.000Z", Date.parse("2026-08-25T17:32:00.000Z")), /Updated 2m ago/);
});

test("BidBot copy is operational, not an AI mascot", () => {
  assert.equal(bidBotOperationalCopy({ autoMode: "off" }).title, "BidBot Off");
  assert.equal(bidBotOperationalCopy({ autoMode: "high_confidence", pendingCount: 3 }).title, "BidBot Recommendations ready");
  assert.equal(bidBotOperationalCopy({ autoMode: "aggressive" }).title, "BidBot Monitoring");
});

test("Home uses the motion system and does not replay entrance or haptic navigation", () => {
  assert.match(home, /FirstReveal/);
  assert.match(home, /VerifiedValue/);
  assert.match(home, /HorizonPane/);
  assert.match(home, /color=\{profitColor\}/);
  assert.match(home, /testID="home-hero-gross"/);
  assert.match(home, /tone="hero"/);
  assert.match(home, /playHaptic\("select"/);
  assert.match(home, /from "@\/src\/lib\/hapticPolicy"/);
  assert.doesNotMatch(home, /Haptics\.impactAsync/);
  assert.doesNotMatch(home, /FadeOnChange|sparkles|confetti/);
  assert.doesNotMatch(home, /home-horizon|home-today-7d/);
  assert.match(tabs, /animation: "none"/);
  assert.match(charts, /playHaptic\("select"\)/);
  assert.match(charts, /ChartScrubCursor/);
  assert.match(charts, /VerifiedValue/);
  assert.match(charts, /makeSmoothPath/);
  assert.match(charts, /netPosFill/);
  assert.match(charts, /netNegFill/);
  assert.match(charts, /yAxisTicks/);
  assert.match(charts, /NetReadoutChip/);
  assert.doesNotMatch(charts, /Haptics\.impactAsync/);
});

test("VerifiedValue and scrub cursor stay on opacity/transform tokens", () => {
  const motionSrc = readFileSync(new URL("../src/components/Motion.tsx", import.meta.url), "utf8");
  const glass = readFileSync(new URL("../src/components/GlassPanel.tsx", import.meta.url), "utf8");
  assert.match(motionSrc, /function VerifiedValue/);
  assert.match(motionSrc, /color\?: string/);
  assert.match(motionSrc, /translateY/);
  assert.match(motionSrc, /function ChartScrubCursor/);
  assert.match(motionSrc, /function StaggerReveal/);
  assert.match(motionSrc, /withSpring/);
  assert.match(motionSrc, /motion\.fastState/);
  assert.match(motionSrc, /motion\.contentChange/);
  assert.doesNotMatch(motionSrc, /confetti|sparkles|BounceIn/);
  assert.match(glass, /BlurView/);
  assert.match(glass, /tint=\{dark \? "dark" : "light"\}/);
  assert.doesNotMatch(glass, /systemChromeMaterial/);
  assert.match(glass, /strength === "chrome"/);
  assert.match(home, /AppScreen/);
  assert.match(home, /GlassPanel/);
});
