import { test } from "node:test";
import assert from "node:assert/strict";
import { createForegroundRefreshGate } from "../src/lib/foregroundRefreshGate.ts";

test("rapid foreground transitions share one real read", async () => {
  const gate = createForegroundRefreshGate();
  let resolveRead;
  let calls = 0;
  const read = () => {
    calls++;
    return new Promise((resolve) => { resolveRead = resolve; });
  };
  const first = gate("owner-a", read);
  const second = gate("owner-a", read);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRead(true);
  await Promise.all([first, second]);
  await gate("owner-a", read);
  assert.equal(calls, 1);
});

test("a failed refresh retries immediately and owners have separate clocks", async () => {
  const gate = createForegroundRefreshGate();
  let calls = 0;
  await gate("owner-a", async () => { calls++; return false; });
  await gate("owner-a", async () => { calls++; return true; });
  await gate("owner-a", async () => { calls++; return true; });
  await gate("owner-b", async () => { calls++; return true; });
  assert.equal(calls, 3);
});
