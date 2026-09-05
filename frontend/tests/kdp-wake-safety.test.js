import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const repo = join(new URL("../..", import.meta.url).pathname);
const wake = readFileSync(join(repo, "supabase/functions/kdp-wake-push/index.ts"), "utf8");
const migration = join(repo, "supabase/migrations/20260905120000_device_push_tokens_sender_parity.sql");

test("kdp wake skips disabled/stale tokens and caps fan-out", () => {
  assert.match(wake, /KDP_WAKE_MAX_TOKENS_PER_TICK/);
  assert.match(wake, /KDP_WAKE_STALE_TOKEN_DAYS/);
  assert.match(wake, /disabled_at/);
  assert.match(wake, /invalidated_at/);
  assert.match(wake, /skippedStale/);
  assert.match(wake, /invalidated_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(wake, /\.delete\(\)\.in\("token"/);
});

test("send-push skips disabled tokens and soft-invalidates dead ones", () => {
  const send = readFileSync(join(repo, "supabase/functions/send-push/index.ts"), "utf8");
  assert.match(send, /disabled_at/);
  assert.match(send, /invalidated_at/);
  assert.match(send, /!t\.disabled_at/);
  assert.match(send, /invalidated_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(send, /\.delete\(\)\.in\("token"/);
});

test("sender-parity migration adds Nest columns", () => {
  assert.equal(existsSync(migration), true);
  const sql = readFileSync(migration, "utf8");
  assert.match(sql, /disabled_at/);
  assert.match(sql, /invalidated_at/);
  assert.match(sql, /last_seen_at/);
  assert.match(sql, /bundle_id/);
});
