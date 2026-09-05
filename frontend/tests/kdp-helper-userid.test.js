import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");
const rulesApi = readFileSync(new URL("../src/lib/rulesApi.ts", import.meta.url), "utf8");
const overview = readFileSync(new URL("../src/lib/kdp/activityOverview.ts", import.meta.url), "utf8");

test("KDP helper resolves Nest JWT user when Supabase AS session is empty", () => {
  assert.match(importer, /resolveHelperUserId/);
  assert.match(importer, /loadLastMobileHomeScope/);
  assert.match(importer, /15 min sync skipped · sign in required/);
  assert.match(importer, /supabase_session_missing/);
  assert.match(importer, /Amazon session missing for KDP writes/);
  assert.match(rulesApi, /export async function resolveHelperUserId/);
  assert.match(rulesApi, /readJwtSub\(token\)/);
});

test("stale 15 min sync shows warn tone after two cadences", () => {
  assert.match(overview, /SYNC_EVERY_MS \* 2/);
  assert.match(overview, /steadyFresh/);
});
