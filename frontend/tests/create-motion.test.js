import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const motion = readFileSync(
  new URL("../src/components/CreateMotion.tsx", import.meta.url),
  "utf8",
);
const create = readFileSync(
  new URL("../app/campaign/create.tsx", import.meta.url),
  "utf8",
);

test("CreateMotion exposes reveal, sticky fade, and UI-thread press scale", () => {
  assert.match(motion, /export function CreateReveal/);
  assert.match(motion, /export function CreateStickyReveal/);
  assert.match(motion, /export function CreateScalePressable/);
  assert.match(motion, /FadeInDown/);
  assert.match(motion, /useReducedMotion/);
  assert.match(motion, /scale: 0\.97|0\.97/);
  assert.match(motion, /playHaptic/);
  assert.match(motion, /withTiming/);
});

test("Create campaign wires motion helpers into marketplace and sticky chrome", () => {
  assert.match(create, /CreateReveal/);
  assert.match(create, /CreateStickyReveal/);
  assert.match(create, /CreateScalePressable/);
  assert.match(create, /playHaptic\("select"/);
  assert.match(create, /playHaptic\("success"/);
  assert.match(create, /hapticSelect/);
});
