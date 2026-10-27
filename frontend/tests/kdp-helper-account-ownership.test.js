import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness({ accounts = [], bridges = [], nest = [], failure, createFailure = false } = {}) {
  const calls = [], writes = [];
  const supabase = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    let value;
    const query = {
      select() { return this; },
      eq(key, expected) { call.filters.push([key, expected]); return this; },
      in(key, expected) { call.filters.push([key, expected]); return this; },
      order() { return this; },
      range(from, to) { call.range = [from, to]; return this; },
      insert(row) { value = row; writes.push({ table, row }); return this; },
      single() { return this; },
      then(resolve, reject) {
        if (failure?.(call)) return Promise.resolve({ data: null, error: Error("database unavailable") }).then(resolve, reject);
        if (value) return Promise.resolve(createFailure ? { data: null, error: Error("insert failed") }
          : { data: { id: "new-owned", ...value }, error: null }).then(resolve, reject);
        let data = (table === "kdp_accounts" ? accounts : bridges).filter(row =>
          call.filters.every(([key, expected]) => Array.isArray(expected) ? expected.includes(row[key]) : row[key] === expected));
        if (call.range) data = data.slice(call.range[0], call.range[1] + 1);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const source = fs.readFileSync(new URL("../src/lib/kdp/accounts.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Set, Error,
    require(id) {
      if (id.includes("mutations")) return { fetchKdpAccounts: async () => nest };
      if (id.includes("supabase")) return { supabase };
      throw Error("Unexpected dependency: " + id);
    },
  });
  return { ...module.exports, calls, writes,
    resolve: profileIds => module.exports.resolveHelperAccountId({ userId: "current-user", profileIds: profileIds ?? ["ads-us"] }) };
}

const own = (id, extra = {}) => ({ id, user_id: "current-user", name: id, ...extra });
const bridge = (kid, extra = {}) => ({ kdp_account_id: kid, amazon_profile_id: "ads-us", is_paused: false, ...extra });

test("resolves an existing owned bridge without any pre-proof writes", async () => {
  const h = harness({ accounts: [own("owned"), own("other")], bridges: [bridge("owned")],
    nest: [{ id: "owned", name: "Web account", linked_amazon_profile_ids: [] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(await h.resolve())), { accountId: "owned", name: "Web account" });
  assert.deepEqual(h.writes, []);
});

test("foreign bridge and legacy rows cannot choose another user's destination", async () => {
  const h = harness({ accounts: [own("owned"), { id: "foreign", name: "Private", user_id: "someone-else", amazon_profile_id: "ads-us" }],
    bridges: [bridge("foreign")], nest: [{ id: "foreign", name: "Private", linked_amazon_profile_ids: ["ads-us"] }] });
  assert.equal((await h.resolve()).accountId, "owned");
  assert.equal(h.calls.filter(call => call.table === "kdp_accounts").every(call => call.filters.some(([key, value]) => key === "user_id" && value === "current-user")), true);
  assert.deepEqual(h.writes, []);
});

test("multiple owned active bridge matches require explicit account selection", async () => {
  const h = harness({ accounts: [own("one"), own("two")], bridges: [bridge("one"), bridge("two")] });
  await assert.rejects(h.resolve(), /Choose the KDP import account/);
  assert.deepEqual(h.writes, []);
});

test("multiple legacy matches never pick the first row silently", async () => {
  const h = harness({ accounts: [own("one", { amazon_profile_id: "ads-us" }), own("two", { amazon_profile_id: "ads-us" })] });
  await assert.rejects(h.resolve(), /Choose the KDP import account/);
  assert.deepEqual(h.writes, []);
});

test("paused-only links do not override an ambiguous owned account list", async () => {
  const h = harness({ accounts: [own("one"), own("two")], bridges: [bridge("one", { is_paused: true })] });
  await assert.rejects(h.resolve(), /Choose the KDP import account/);
  assert.deepEqual(h.writes, []);
});

for (const stage of ["owned", "bridge", "legacy"]) {
  test(`a failed ${stage} lookup is unknown and cannot create a duplicate or attach profiles`, async () => {
    const h = harness({ accounts: [own("owned")], failure: call => stage === "owned"
      ? call.table === "kdp_accounts" && Boolean(call.range)
      : stage === "bridge" ? call.table === "kdp_account_amazon_profiles"
        : call.table === "kdp_accounts" && !call.range });
    await assert.rejects(h.resolve(), /database unavailable/);
    assert.deepEqual(h.writes, []);
  });
}

test("a new destination is owned and cannot pre-link selected Ads profiles", async () => {
  const h = harness({ nest: [{ id: "foreign", name: "Foreign", linked_amazon_profile_ids: ["ads-us"] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(await h.resolve())), { accountId: "new-owned", name: "KDP" });
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{ table: "kdp_accounts", row: { user_id: "current-user", name: "KDP" } }]);
});

test("insert failure is reported without an invented import destination", async () => {
  const h = harness({ createFailure: true });
  await assert.rejects(h.resolve(), /insert failed/);
});

test("all owned rows are paginated before deciding account uniqueness", async () => {
  const accounts = Array.from({ length: 1001 }, (_, i) => own(`owned-${i}`));
  const h = harness({ accounts, bridges: [bridge("owned-1000")] });
  assert.equal((await h.resolve()).accountId, "owned-1000");
  assert.equal(h.calls.filter(call => call.range).length, 2);
  assert.deepEqual(h.writes, []);
});
