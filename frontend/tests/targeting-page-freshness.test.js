import { test } from "node:test";
import assert from "node:assert/strict";

import { isTargetingPageFresh, shouldRevalidateTargetingPageOnVisit } from "../src/lib/targetingPageFreshness.ts";

test("restored targeting pages stay marked updating until a current response arrives", () => {
  const selection = 1_000;
  assert.equal(isTargetingPageFresh(999, selection, true, false), false);
  assert.equal(isTargetingPageFresh(1_001, selection, false, false), false);
  assert.equal(isTargetingPageFresh(1_001, selection, true, true), false);
  assert.equal(isTargetingPageFresh(1_001, selection, true, false), true);
  assert.equal(isTargetingPageFresh(1_000, selection, true, false), false);
  assert.equal(isTargetingPageFresh(0, selection, true, false), false);
  // Changing any scoped key starts a new selection, including sort/page/book.
  assert.equal(isTargetingPageFresh(1_001, 1_002, true, false), false);
});

test("a retained Targeting tab revalidates on a warm visit after the cache window", () => {
  assert.equal(shouldRevalidateTargetingPageOnVisit(1_000, 1_044, 45), false);
  assert.equal(shouldRevalidateTargetingPageOnVisit(1_000, 1_045, 45), true);
  assert.equal(shouldRevalidateTargetingPageOnVisit(1_000, 999, 45), true);
  assert.equal(shouldRevalidateTargetingPageOnVisit(0, 1_000, 45), false);
});
