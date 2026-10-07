import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { evaluateRoyaltyOverwriteSafety } from "../src/lib/kdp/royaltyOverwriteSafety.ts";

const upsert = readFileSync(new URL("../src/lib/kdp/upsert.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");

test("iOS day writes only through the authenticated atomic endpoint", () => {
  const dayWriter = upsert.slice(
    upsert.indexOf("export async function writeKdpDay"),
    upsert.indexOf("export async function writeKdpCatalog"),
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
  assert.match(importer, /existing positive royalties preserved/);
  assert.match(importer, /Incomplete KDP \$\{scope\} response/);
});
