import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlight } from "../src/lib/kdp/singleFlight.ts";

test("overlapping background, foreground and manual wakes share one pass", async () => {
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const tick = createSingleFlight(async (reason) => {
    calls += 1;
    await gate;
    return { reason, days: 3 };
  });
  const background = tick("background");
  const foreground = tick("foreground");
  const manual = tick("manual");
  assert.equal(background, foreground);
  assert.equal(background, manual);
  release();
  assert.deepEqual(await background, { reason: "background", days: 3 });
  assert.equal(calls, 1);
  assert.deepEqual(await tick("manual"), { reason: "manual", days: 3 });
  assert.equal(calls, 2);
});

test("a failed pass releases the lock so the next wake retries", async () => {
  let calls = 0;
  const tick = createSingleFlight(async () => {
    if (++calls === 1) throw new Error("Load failed");
    return "retried";
  });
  const first = tick();
  assert.equal(first, tick());
  await assert.rejects(first, /Load failed/);
  assert.equal(await tick(), "retried");
  assert.equal(calls, 2);
});
