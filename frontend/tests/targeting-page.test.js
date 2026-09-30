import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendTargetingPageRows,
  targetingPageNumbers,
  targetingTotalPages,
  TARGETING_PAGE_SIZE,
} from "../src/lib/targetingPage.ts";

test("targeting first paint uses a compact globally ranked page", () => {
  assert.equal(TARGETING_PAGE_SIZE, 100);
});

test("targetingPageNumbers always includes first and last", () => {
  assert.deepEqual(targetingPageNumbers(1, 12), [1, 2, 3, 4, 5, 12]);
  assert.deepEqual(targetingPageNumbers(12, 12), [1, 8, 9, 10, 11, 12]);
  assert.deepEqual(targetingPageNumbers(6, 12), [1, 4, 5, 6, 7, 8, 12]);
});

test("progressive targeting pages preserve server order and remove duplicate boundary rows", () => {
  const head = [{ id: "a" }, { id: "b" }];
  const tail = [{ id: "c" }, { id: "d" }];
  const next = [{ id: "d" }, { id: "e" }, { id: "f" }];
  assert.deepEqual(
    appendTargetingPageRows(head, tail, next).map((row) => row.id),
    ["c", "d", "e", "f"],
  );
});

test("targetingTotalPages matches catalog math", () => {
  assert.equal(targetingTotalPages(0), 1);
  assert.equal(targetingTotalPages(100), 1);
  assert.equal(targetingTotalPages(101), 2);
  assert.equal(targetingTotalPages(5666), 57);
  assert.equal(targetingTotalPages(1510), 16);
});
