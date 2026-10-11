import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { evaluateRoyaltyOverwriteSafety } from "../src/lib/kdp/royaltyOverwriteSafety.ts";

const upsert = readFileSync(new URL("../src/lib/kdp/upsert.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");

test("iOS day writes only through the authenticated atomic endpoint", () => {
  const dayWriter = upsert.slice(
    upsert.indexOf("export async function writeKdpDay"),
    upsert.indexOf("async function verifyNativeDayCoverage"),
  );
  assert.match(dayWriter, /\/kdp-sync\/replace-day/);
  assert.match(dayWriter, /revisionId/);
  assert.match(dayWriter, /includeAds: false/);
  assert.match(dayWriter, /factRows/);
  assert.match(dayWriter, /acknowledgement mismatch/);
  assert.doesNotMatch(dayWriter, /supabase\.from/);
  assert.doesNotMatch(dayWriter, /kdp_daily_data/);
});

test("iOS refuses the Levopppc/VPS1 stable-activity zero regression", () => {
  assert.deepEqual(
    evaluateRoyaltyOverwriteSafety({
      previous: { royalties: 266.89, orders: 19, kenp: 4210 },
      incoming: { royalties: 0, orders: 19, kenp: 4210 },
    }),
    { safe: false, reason: "stable_activity_zero_royalties" },
  );
  assert.match(importer, /existing verified royalties and activity preserved/);
  assert.match(importer, /Incomplete KDP \$\{scope\} response/);
});

test("iOS preserves verified activity when an incomplete report retains royalties", () => {
  assert.deepEqual(evaluateRoyaltyOverwriteSafety({
    previous: { royalties: 49.76, orders: 8, kenp: 200 },
    incoming: { royalties: 0, orders: 0, kenp: 0 },
  }), { safe: false, reason: "positive_snapshot_all_zero" });
  assert.deepEqual(evaluateRoyaltyOverwriteSafety({
    previous: { royalties: 49.76, orders: 8, kenp: 200 },
    incoming: { royalties: 49.76, orders: 0, kenp: 200 },
  }), { safe: false, reason: "stable_royalties_zero_orders" });
  assert.deepEqual(evaluateRoyaltyOverwriteSafety({
    previous: { royalties: 49.76, orders: 8, kenp: 200 },
    incoming: { royalties: 49.76, orders: 8, kenp: 0 },
  }), { safe: false, reason: "stable_royalties_zero_kenp" });
  assert.equal(evaluateRoyaltyOverwriteSafety({
    previous: { royalties: 49.76, orders: 8, kenp: 200 },
    incoming: { royalties: 45.12, orders: 7, kenp: 180 },
  }).safe, true);
  assert.equal(evaluateRoyaltyOverwriteSafety({ incoming: { royalties: 0, orders: 0, kenp: 0 } }).safe, true);
});
