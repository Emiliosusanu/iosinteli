import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHART_MAX_DAY_STEP_PX,
  dayBarStep,
  dayXLayout,
} from "../src/lib/chartLayout.ts";

const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");

test("few days stay compact instead of stretching full plot width", () => {
  const plot = 300;
  const inset = 14;
  const three = dayXLayout(3, plot, inset);
  assert.equal(three.step, CHART_MAX_DAY_STEP_PX);
  assert.equal(three.span, CHART_MAX_DAY_STEP_PX * 2);
  assert.equal(three.xAt(0), inset);
  assert.equal(three.xAt(2), inset + CHART_MAX_DAY_STEP_PX * 2);
  // Must not use the full 300px span for 3 days.
  assert.ok(three.span < plot * 0.4);

  const month = dayXLayout(30, plot, inset);
  assert.ok(month.step < CHART_MAX_DAY_STEP_PX);
  assert.ok(Math.abs(month.span - plot) < 0.01);
});

test("touch mapping follows the compact span, not empty right gutter", () => {
  const layout = dayXLayout(3, 300, 14);
  assert.equal(layout.indexAtX(14), 0);
  assert.equal(layout.indexAtX(14 + CHART_MAX_DAY_STEP_PX), 1);
  assert.equal(layout.indexAtX(14 + CHART_MAX_DAY_STEP_PX * 2), 2);
  // Far right empty space still resolves to the last day.
  assert.equal(layout.indexAtX(290), 2);
});

test("bar step is capped for short windows", () => {
  assert.equal(dayBarStep(3, 300), CHART_MAX_DAY_STEP_PX);
  assert.ok(dayBarStep(30, 300) < CHART_MAX_DAY_STEP_PX);
});

test("Charts use dayXLayout for series and selection", () => {
  assert.match(charts, /from "\.\.\/lib\/chartLayout"/);
  assert.match(charts, /dayXLayout\(/);
  assert.match(charts, /dayBarStep\(/);
  assert.doesNotMatch(charts, /inset \+ \(i \/ denom\) \* plot/);
  assert.doesNotMatch(charts, /inset \+ \(index \/ denom\) \* plot/);
});
