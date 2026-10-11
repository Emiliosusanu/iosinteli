import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const asin = n => `B${String(n).padStart(9, "0")}`;
const own = id => ({ id, user_id: "user" });
function harness({ accounts = [own("selected")], titles = [], fail, repeat = false } = {}) {
  const calls = [], writes = [];
  const supabase = { from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const query = {
      select() { return this; }, eq(key, expected) { call.filters.push([key, expected]); return this; },
      in(key, expected) { call.filters.push([key, expected]); return this; },
      order(key) { call.orders.push(key); return this; }, range(from, to) { call.range = [from, to]; return this; },
      abortSignal() { return this; },
      insert() { writes.push(table); throw Error("unexpected write"); },
      upsert() { writes.push(table); throw Error("unexpected write"); },
      then(resolve, reject) {
        if (fail?.(call)) return Promise.resolve({ data: null, error: Error("failed") }).then(resolve, reject);
        let data = (table === "kdp_accounts" ? accounts : titles).filter(row => call.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
        data = [...data].sort((a, b) => {
          for (const key of call.orders) { const d = String(a[key]).localeCompare(String(b[key])); if (d) return d; }
          return 0;
        });
        const from = repeat ? 0 : call.range[0];
        data = data.slice(from, from + call.range[1] - call.range[0] + 1);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  const source = fs.readFileSync(new URL("../src/lib/kdp/catalogAccount.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Set, Map, Error, Date,
    require(id) {
      if (id.includes("supabase")) return { supabase };
      if (id.includes("backgroundBudget")) return { withKdpTaskRequest: async (deadline, op) => {
        if (deadline != null && deadline <= Date.now()) throw Error("budget exhausted");
        return await op(deadline != null ? {} : undefined);
      } };
      throw Error("Unexpected dependency " + id);
    },
  });
  return { calls, writes, run: opts => module.exports.assertCapturedKdpCatalogAccount({ userId: "user", accountId: "selected", capturedAsins: [asin(1)], ...opts }) };
}
const title = (n, account_id = "selected") => ({ account_id, asin: asin(n) });
const rejectsCode = async (promise, code) => assert.rejects(promise, error => error.code === code);

test("existing overlap accepts newly published books and incremental catalog captures", async () => {
  const h = harness({ titles: [title(1), title(2)] });
  const result = await h.run({ capturedAsins: [asin(1).toLowerCase(), asin(999)] });
  assert.equal(result.reason, "existing_catalog_overlap"); assert.equal(result.overlapCount, 1);
  assert.deepEqual(h.writes, []);
});
test("all 1,501 identities are read, including selected overlap after the old cap", async () => {
  const h = harness({ titles: Array.from({ length: 1501 }, (_, n) => title(n)) });
  assert.equal((await h.run({ capturedAsins: [asin(1500)] })).knownCatalogCount, 1501);
  assert.equal(h.calls.filter(c => c.table === "kdp_titles").length, 4);
});
test("other owned catalog on a later page rejects even when selected catalog overlaps", async () => {
  const h = harness({ accounts: [own("selected"), own("zother")], titles: [...Array.from({ length: 1000 }, (_, n) => title(n)), title(2000, "zother")] });
  await rejectsCode(h.run({ capturedAsins: [asin(1), asin(2000)] }), "account_conflict");
  assert.deepEqual(h.writes, []);
});
test("empty destination cannot absorb a different owned account's catalog", async () => {
  const h = harness({ accounts: [own("selected"), own("other")], titles: [title(1, "other")] });
  await rejectsCode(h.run({ allowInitialCapture: true }), "account_conflict");
});
test("unrelated catalog cannot replace an accepted selected catalog", async () => {
  const h = harness({ titles: [title(2)] }); await rejectsCode(h.run(), "catalog_no_overlap");
});
for (const capturedAsins of [[], ["unknown"], [null, undefined, ""]]) {
  test(`missing or invalid capture preserves accepted data (${JSON.stringify(capturedAsins)})`, async () => {
    const h = harness({ titles: [title(1)] }); await rejectsCode(h.run({ capturedAsins }), "catalog_missing");
    assert.equal(h.calls.length, 0); assert.deepEqual(h.writes, []);
  });
}
test("foreign destination and foreign catalog are excluded by ownership reads", async () => {
  const h = harness({ accounts: [own("selected"), { id: "foreign", user_id: "other" }], titles: [title(1), title(1, "foreign")] });
  assert.equal((await h.run()).reason, "existing_catalog_overlap");
  await rejectsCode(h.run({ accountId: "foreign" }), "account_not_owned");
});
test("first capture requires focused foreground confirmation and never infers Ads links", async () => {
  const h = harness(); await rejectsCode(h.run(), "initial_capture_required");
  assert.equal((await h.run({ allowInitialCapture: true })).reason, "initial_foreground_capture");
  await rejectsCode(h.run({ allowInitialCapture: true, deadlineAtMs: Date.now() + 22_000 }), "initial_capture_required");
  assert.deepEqual(h.writes, []);
});
for (const table of ["kdp_accounts", "kdp_titles"]) {
  test(`failed ${table} identity lookup never means empty catalog`, async () => {
    const h = harness({ fail: c => c.table === table }); await rejectsCode(h.run({ allowInitialCapture: true }), "catalog_lookup_failed"); assert.deepEqual(h.writes, []);
  });
}
test("a later catalog page failure cannot authorize a partial catalog", async () => {
  const h = harness({ titles: Array.from({ length: 1000 }, (_, n) => title(n)), fail: c => c.table === "kdp_titles" && c.range[0] === 500 });
  await rejectsCode(h.run(), "catalog_lookup_failed");
});
test("expired background budget prevents later identity reads and all writes", async () => {
  const h = harness({ titles: [title(1)] }); await assert.rejects(h.run({ deadlineAtMs: Date.now() - 1 }), /budget exhausted/); assert.deepEqual(h.writes, []);
});
test("repeated full pages fail closed instead of infinite paging", async () => {
  const h = harness({ titles: Array.from({ length: 500 }, (_, n) => title(n)), repeat: true });
  await rejectsCode(h.run(), "catalog_lookup_failed"); assert.equal(h.calls.filter(c => c.table === "kdp_titles").length, 2);
});
test("owned account filters are bounded and ownership itself is fully paginated", async () => {
  const accounts = [own("selected"), ...Array.from({ length: 1001 }, (_, n) => own(`other-${n}`))];
  const h = harness({ accounts, titles: [title(1)] }); await h.run();
  assert.equal(h.calls.filter(c => c.table === "kdp_accounts").length, 3);
  assert.equal(h.calls.filter(c => c.table === "kdp_titles").every(c => c.filters[0][1].length <= 100), true);
});
