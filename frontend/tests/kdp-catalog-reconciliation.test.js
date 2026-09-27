import assert from "node:assert/strict";
import test from "node:test";

import { staleCatalogRowIds } from "../src/lib/kdp/catalogReconciliation.ts";

test("Bookshelf reconciliation removes only identities absent from a non-empty current snapshot", () => {
  assert.deepEqual(
    staleCatalogRowIds(
      ["old-paperback", "current-paperback", "current-paperback"],
      [{ id: "current-paperback" }],
    ),
    ["old-paperback"],
  );
});

test("empty or malformed snapshots never request catalog deletion", () => {
  assert.deepEqual(staleCatalogRowIds(["keep-me"], []), []);
  assert.deepEqual(staleCatalogRowIds(["keep-me"], [{ id: "" }]), []);
});
