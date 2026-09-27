import { test } from "node:test";
import assert from "node:assert/strict";
import { targetingPageNumbers, targetingTotalPages, TARGETING_PAGE_SIZE } from "../src/lib/targetingPage.ts";

test("targeting page size stays 500 like build 209", () => {
  assert.equal(TARGETING_PAGE_SIZE, 500);
});

test("targetingPageNumbers always includes first and last", () => {
  assert.deepEqual(targetingPageNumbers(1, 12), [1, 2, 3, 4, 5, 12]);
  assert.deepEqual(targetingPageNumbers(12, 12), [1, 8, 9, 10, 11, 12]);
  assert.deepEqual(targetingPageNumbers(6, 12), [1, 4, 5, 6, 7, 8, 12]);
});

test("targetingTotalPages matches catalog math", () => {
  assert.equal(targetingTotalPages(0), 1);
  assert.equal(targetingTotalPages(500), 1);
  assert.equal(targetingTotalPages(501), 2);
  assert.equal(targetingTotalPages(5666), 12);
  assert.equal(targetingTotalPages(1510), 4);
});
