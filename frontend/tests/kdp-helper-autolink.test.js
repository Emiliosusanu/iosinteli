import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness({ currentUser = "user", result = { linked: [], skipped: [] }, error } = {}) {
  const calls = [];
  const source = fs.readFileSync(new URL("../src/lib/kdp/autoLink.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports,
    require() { return {
      resolveHelperUserId: async () => currentUser,
      nestApiJson: async (...args) => { calls.push(args); if (error) throw error; return result; },
    }; },
  });
  return { run: overrides => module.exports.autoLinkKdpProfilesAfterCapture({
    userId: "user", accountId: "owned", catalogAsins: ["B0ABCD1234"], catalogVerified: true, acknowledgedDays: 1, ...overrides,
  }), calls };
}

for (const [label, overrides] of [
  ["unverified catalog", { catalogVerified: false }], ["empty catalog", { catalogAsins: [] }],
  ["invalid ASIN", { catalogAsins: ["unknown"] }], ["failed financial ACK", { acknowledgedDays: 0 }],
  ["fractional ACK count", { acknowledgedDays: 0.5 }], ["missing account", { accountId: "" }],
  ["missing user", { userId: "" }], ["short background budget", { deadlineAtMs: Date.now() + 22_000 }],
]) {
  test(`${label} never sends attribution requests`, async () => {
    const h = harness();
    assert.equal((await h.run(overrides)).skipped, true);
    assert.equal(h.calls.length, 0);
  });
}

test("identity switch before optional auto-link skips the request", async () => {
  const h = harness({ currentUser: "someone-else" });
  assert.equal((await h.run()).reason, "identity_changed");
  assert.equal(h.calls.length, 0);
});

test("verified capture uses server ASIN proof without sending selected profile ids", async () => {
  const h = harness({ result: { linked: [{ profileId: "proven" }], skipped: [] } });
  assert.equal((await h.run()).linked, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "/setup/auto-link");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])), { method: "POST" });
});

test("transient API failure queues optional linking without claiming success", async () => {
  const h = harness({ error: Error("503") });
  assert.equal((await h.run()).reason, "linking_retry");
  assert.equal(h.calls.length, 1);
});

test("empty or malformed API receipt cannot be reported as linked", async () => {
  const h = harness({ result: {} });
  assert.equal((await h.run()).ok, false);
});
