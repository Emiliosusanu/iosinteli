import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AMAZON_OAUTH_RETURN_URL,
  parseAmazonOAuthCallback,
} from "../src/lib/amazonAuthContract.ts";

const login = readFileSync(new URL("../app/auth/login.tsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");
const amazonAuth = readFileSync(new URL("../src/lib/amazonAuth.ts", import.meta.url), "utf8");
const floating = readFileSync(new URL("../src/components/FloatingTabBar.tsx", import.meta.url), "utf8");

test("Amazon OAuth callback parses Nest fragment tokens like the web app", () => {
  const parsed = parseAmazonOAuthCallback(
    `${AMAZON_OAUTH_RETURN_URL}#accessToken=at&refreshToken=rt&mode=login`,
  );
  assert.equal(parsed.accessToken, "at");
  assert.equal(parsed.refreshToken, "rt");
  assert.equal(parsed.mode, "login");
  assert.equal(parsed.error, null);

  const connect = parseAmazonOAuthCallback(
    `${AMAZON_OAUTH_RETURN_URL}?mode=connect&accessToken=a&refreshToken=b`,
  );
  assert.equal(connect.mode, "connect");
  assert.equal(connect.accessToken, "a");

  const failed = parseAmazonOAuthCallback(`${AMAZON_OAUTH_RETURN_URL}#error=denied`);
  assert.equal(failed.error, "denied");
});

test("iOS Amazon login uses auth session capture + Nest store + Supabase mint", () => {
  assert.match(amazonAuth, /openAuthSessionAsync/);
  assert.match(amazonAuth, /storeNestSession/);
  assert.match(amazonAuth, /amazon-mobile-session/);
  assert.match(amazonAuth, /verifyOtp/);
  assert.match(login, /startAmazonLogin/);
  assert.doesNotMatch(login, /openBrowserAsync/);
  assert.match(accounts, /startAmazonConnect/);
  assert.doesNotMatch(accounts, /openBrowserAsync/);
});

test("floating tab bar follows light chrome with equal labeled slots", () => {
  assert.match(floating, /tabbar_background/);
  assert.match(floating, /tint=\{shell\.blurTint\}/);
  assert.doesNotMatch(floating, /rgba\(16, 16, 20/);
  assert.doesNotMatch(floating, /activePill|sliding/);
  assert.match(floating, /visual\.label/);
  assert.match(floating, /flex: 1/);
});
