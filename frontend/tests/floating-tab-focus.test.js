import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveFocusedTabName } from "../src/lib/tabFocus.ts";

const routes = [
  { name: "index" },
  { name: "campaigns" },
  { name: "targeting" },
  { name: "products" },
  { name: "more" },
];

test("resolveFocusedTabName prefers tab segment over stale state.index", () => {
  assert.equal(
    resolveFocusedTabName("/targeting", ["(tabs)", "targeting"], routes, 0),
    "targeting",
  );
  assert.equal(
    resolveFocusedTabName("/campaigns", ["(tabs)", "campaigns"], routes, 0),
    "campaigns",
  );
  assert.equal(
    resolveFocusedTabName("/", ["(tabs)", "index"], routes, 2),
    "index",
  );
});

test("resolveFocusedTabName maps nested / stack routes to owning tab", () => {
  assert.equal(
    resolveFocusedTabName("/keyword/abc", ["keyword", "abc"], routes, 0),
    "targeting",
  );
  assert.equal(
    resolveFocusedTabName("/campaign/xyz", ["campaign", "xyz"], routes, 0),
    "campaigns",
  );
  assert.equal(
    resolveFocusedTabName("/more/accounts", ["more", "accounts"], routes, 0),
    "more",
  );
  assert.equal(
    resolveFocusedTabName("/product/B00", ["product", "B00"], routes, 0),
    "products",
  );
});
