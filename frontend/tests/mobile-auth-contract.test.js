import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canRetryMobileRequestAfter401,
  mobileGuestMayMutate,
  mobileSellerMaySendFilterUserId,
  nestSessionFlagAllowsWrites,
  nestTokenMatchesSupabaseUser,
  pickMobileApiToken,
  readJwtSub,
  shouldRefreshNestToken,
} from "../src/lib/mobileAuthContract.ts";

function fakeJwt(sub) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `${header}.${payload}.sig`;
}

const rulesApi = readFileSync(new URL("../src/lib/rulesApi.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const bidBot = readFileSync(new URL("../src/lib/bidBotContract.ts", import.meta.url), "utf8");
const sync = readFileSync(new URL("../src/lib/syncContract.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/lib/settingsContract.ts", import.meta.url), "utf8");

test("Amazon login sends the Supabase bearer when Nest JWT is absent", () => {
  assert.deepEqual(
    pickMobileApiToken({
      nestSessionAllowed: true,
      nestAccessToken: "",
      supabaseAccessToken: "sb-access",
    }),
    { token: "sb-access", source: "supabase" },
  );
  assert.equal(
    shouldRefreshNestToken(
      pickMobileApiToken({
        nestSessionAllowed: true,
        nestAccessToken: "",
        supabaseAccessToken: "sb-access",
      })?.source,
    ),
    false,
  );
  assert.match(rulesApi, /pickMobileApiToken/);
  assert.match(rulesApi, /session\?\.access_token/);
  assert.match(rulesApi, /shouldRefreshNestToken/);
  assert.doesNotMatch(rulesApi, /if \(!\(await nestSessionAllowed\(\)\)\) \{\s*throw new NestApiError/);
});

test("password login prefers the Nest access JWT", () => {
  assert.deepEqual(
    pickMobileApiToken({
      nestSessionAllowed: true,
      nestAccessToken: "nest-access",
      supabaseAccessToken: "sb-access",
    }),
    { token: "nest-access", source: "nest" },
  );
  assert.equal(shouldRefreshNestToken("nest"), true);
});

test("invalidated Nest session still allows a Supabase seller bearer", () => {
  assert.deepEqual(
    pickMobileApiToken({
      nestSessionAllowed: false,
      nestAccessToken: "stale-nest",
      supabaseAccessToken: "sb-access",
    }),
    { token: "sb-access", source: "supabase" },
  );
});

test("missing and empty bearers are 401 locally", () => {
  assert.equal(
    pickMobileApiToken({
      nestSessionAllowed: true,
      nestAccessToken: "   ",
      supabaseAccessToken: "",
    }),
    null,
  );
  assert.equal(
    pickMobileApiToken({
      nestSessionAllowed: false,
      nestAccessToken: "nest-access",
      supabaseAccessToken: null,
    }),
    null,
  );
});

test("hasNestToken stays Nest-JWT-only so seller Overview stays on RLS", () => {
  assert.match(rulesApi, /export async function hasNestToken/);
  const hasNest = rulesApi.slice(rulesApi.indexOf("export async function hasNestToken"));
  assert.match(hasNest, /ACCESS_KEY/);
  assert.doesNotMatch(hasNest.slice(0, 280), /getSession/);
  assert.match(app, /queryFn: hasNestToken/);
});

test("seller session cannot inject admin view-as", () => {
  assert.equal(
    mobileSellerMaySendFilterUserId({ hasNestAdminSession: false, adminFilterUserId: "other-user" }),
    false,
  );
  assert.equal(
    mobileSellerMaySendFilterUserId({ hasNestAdminSession: true, adminFilterUserId: "customer" }),
    true,
  );
  assert.equal(
    mobileSellerMaySendFilterUserId({ hasNestAdminSession: true, adminFilterUserId: "" }),
    false,
  );
  assert.match(app, /isAdminViewer \? adminFilterUserId : null/);
  assert.match(queries, /if \(filterUserId && \(await hasNestToken\(\)\)\)/);
});

test("guest and view-as cannot mutate production entities", () => {
  assert.equal(mobileGuestMayMutate(true), false);
  assert.equal(mobileGuestMayMutate(false), true);
  assert.match(rulesApi, /if \(guestMode\) throw new NestApiError\(SIGN_IN_TO_MUTATE_MESSAGE, 401\)/);
  assert.match(bidBot, /!params.guestMode && !params.adminFilterUserId/);
  assert.match(sync, /canMutateSync/);
  assert.match(settings, /if \(input.guestMode\)/);
  assert.doesNotMatch(mutations, /adminFilterUserId: filterUserId/);
});

test("Accounts Nest fallback does not require a Nest JWT", () => {
  assert.match(queries, /Amazon login sends the Supabase bearer via nestApiFetch/);
  assert.match(queries, /return fetchNestAmazonProfiles\(\)\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(
    queries.slice(queries.indexOf("if (!linkedIds.length)"), queries.indexOf("if (!linkedIds.length)") + 420),
    /if \(!\(await hasNestToken\(\)\)\) return \[\]/,
  );
});

test("leftover Nest JWT is ignored until nestLogin marks the session live", () => {
  assert.equal(nestSessionFlagAllowsWrites(undefined), false);
  assert.equal(nestSessionFlagAllowsWrites(null), false);
  assert.equal(nestSessionFlagAllowsWrites(false), false);
  assert.equal(nestSessionFlagAllowsWrites(true), true);
  assert.match(rulesApi, /storage\.getItem<boolean>\(SESSION_VALID_KEY, false\)/);
  assert.deepEqual(
    pickMobileApiToken({
      nestSessionAllowed: nestSessionFlagAllowsWrites(undefined),
      nestAccessToken: "leftover-nest",
      supabaseAccessToken: "sb-access",
    }),
    { token: "sb-access", source: "supabase" },
  );
});

test("Amazon login URL is public and clears leftover Nest tokens", () => {
  assert.match(mutations, /await nestLogout\(\)/);
  assert.match(mutations, /\/auth\/amazon\/login/);
  assert.match(mutations, /allowAnonymous: true/);
});

test("leftover Nest JWT for another user is dropped", () => {
  const nest = fakeJwt("user-a");
  assert.equal(readJwtSub(nest), "user-a");
  assert.equal(nestTokenMatchesSupabaseUser({ nestAccessToken: nest, supabaseUserId: "user-a" }), true);
  assert.equal(nestTokenMatchesSupabaseUser({ nestAccessToken: nest, supabaseUserId: "user-b" }), false);
  assert.match(rulesApi, /nestTokenMatchesSupabaseUser/);
  assert.match(rulesApi, /readSupabaseSession/);
});

test("dead Nest JWT falls back to Supabase; expired Supabase refreshes on 401", () => {
  assert.equal(canRetryMobileRequestAfter401("GET"), true);
  assert.equal(canRetryMobileRequestAfter401("HEAD"), true);
  assert.equal(canRetryMobileRequestAfter401("PATCH"), true);
  assert.equal(canRetryMobileRequestAfter401("POST"), true);
  assert.match(rulesApi, /await nestLogout\(\)/);
  assert.match(rulesApi, /readSupabaseAccessToken/);
  assert.match(rulesApi, /refreshSupabaseAccessToken/);
  assert.match(rulesApi, /refreshSupabaseAccessToken/);
});
