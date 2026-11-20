import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { normalizeDateRange, presetRangeFromLabel, shortDateRangeContextLabel } from "../src/lib/format.ts";

const source = readFileSync(new URL("../src/hooks/useDateRangeRollover.ts", import.meta.url), "utf8");

function harness(initial = "2026-10-17T23:59:50", state = "active") {
  let now = new Date(initial), ref, effect, cleanup, previous, listener, removed = 0, serial = 0;
  const timers = new Map(), updates = [];
  const appState = { currentState: state, addEventListener: (_, fn) => {
    listener = fn; return { remove() { listener = undefined; removed++; } };
  } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } },
    setTimeout: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; },
    clearTimeout: (id) => timers.delete(id),
    require(name) {
      if (name === "react") return {
        useRef: (value) => ref ??= { current: value },
        useEffect: (fn, deps) => {
          if (!previous || deps.some((x, i) => !Object.is(x, previous[i]))) effect = fn;
          previous = deps;
        },
      };
      if (name === "react-native") return { AppState: appState };
      return { presetRangeFromLabel };
    },
  });
  return {
    updates, timers,
    render(range, ready = true, onChange = (next) => updates.push(next)) {
      exports.useDateRangeRollover(range, ready, onChange);
      if (effect) { cleanup?.(); const fn = effect; effect = undefined; cleanup = fn(); }
    },
    now(value) { now = new Date(value); },
    event(state) { appState.currentState = state; listener?.(state); },
    fire() { const [id, timer] = [...timers][0]; timers.delete(id); timer.fn(); },
    unmount() { cleanup?.(); },
    get removed() { return removed; },
  };
}

test("relative period advances at local midnight with one timer and no duplicate same-day writes", () => {
  const h = harness();
  h.render({ start: "2026-10-01", end: "2026-10-17", label: "This month" });
  assert.equal(h.updates.length, 0);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 10_000);
  h.now("2026-10-18T00:00:00"); h.fire();
  assert.deepEqual(h.updates, [{ start: "2026-10-01", end: "2026-10-18", label: "This month" }]);
  h.event("active"); h.event("active");
  assert.equal(h.updates.length, 1);
  assert.equal(h.timers.size, 1);
  h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.removed, 1);
});

test("background/inactive cancels the timer; resume catches up multiple days", () => {
  const h = harness();
  h.render({ start: "2026-10-11", end: "2026-10-17", label: "Last 7 days" });
  h.event("inactive"); assert.equal(h.timers.size, 0);
  h.event("background"); h.now("2026-10-21T10:00:00");
  assert.equal(h.updates.length, 0);
  h.event("active");
  assert.deepEqual(h.updates, [{ start: "2026-10-15", end: "2026-10-21", label: "Last 7 days" }]);
  assert.equal(h.timers.size, 1);
});

test("hydration gates rollover, and custom dates do not drift or schedule wakes", () => {
  const h = harness("2026-10-18T00:10:00");
  const old = { start: "2026-10-01", end: "2026-10-17", label: "This month" };
  h.render(old, false); assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
  h.event("active"); assert.equal(h.updates.length, 0);
  const custom = { start: "2026-09-01", end: "2026-09-07", label: "Custom range" };
  h.render(custom, true); h.event("active");
  assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
  h.now("2026-11-01T12:00:00"); h.event("active");
  assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
});

test("latest explicit selection and setter supersede the previous preset callback", () => {
  const h = harness();
  h.render({ start: "2026-10-17", end: "2026-10-17", label: "Today" });
  const calls = [];
  h.render({ start: "2026-10-17", end: "2026-10-17", label: "Today" }, true, (value) => calls.push(value));
  h.now("2026-10-18T00:00:00"); h.fire();
  assert.equal(h.updates.length, 0); assert.equal(calls[0].end, "2026-10-18");
  h.render({ start: "2026-09-02", end: "2026-09-03", label: "Custom range" });
  assert.equal(h.timers.size, 0);
  h.event("active"); assert.equal(calls.length, 1); assert.equal(h.updates.length, 0);
});

test("all presets resolve at month/year/leap boundaries; stale labels show literal dates", () => {
  for (const now of [new Date(2026, 10, 1), new Date(2027, 0, 1), new Date(2028, 1, 29)]) {
    for (const label of ["Today", "Yesterday", "This month", "Last 7 days", "Last 30 days", "Last 60 days", "Last 90 days", "All time"]) {
      const range = presetRangeFromLabel(label, now);
      assert.deepEqual(normalizeDateRange({ start: "2026-01-01", end: "2026-01-02", label }, now), range);
      assert.equal(shortDateRangeContextLabel(range, now), label);
    }
  }
  const old = { start: "2026-10-01", end: "2026-10-17", label: "This month" };
  assert.notEqual(shortDateRangeContextLabel(old, new Date(2026, 9, 18)), "This month");
});

test("midnight wake follows the local calendar on both DST transitions", () => {
  for (const [local, hours] of [["2026-03-29T00:00:00", 23], ["2026-10-25T00:00:00", 25]]) {
    const script = `const n=new Date(${JSON.stringify(local)}); process.stdout.write(String((new Date(n.getFullYear(),n.getMonth(),n.getDate()+1)-n)/3600000));`;
    assert.equal(Number(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: "Europe/Bucharest" } }).toString()), hours);
  }
});

test("cold inactive startup waits for foreground; disposed callbacks cannot persist a range", () => {
  const h = harness("2026-10-18T10:00:00", "background");
  const range = { start: "2026-10-17", end: "2026-10-17", label: "Today" };
  h.render(range); assert.equal(h.updates.length, 0); assert.equal(h.timers.size, 0);
  h.event("active"); assert.equal(h.updates[0].end, "2026-10-18");
  const abandoned = [...h.timers.values()][0].fn;
  h.unmount(); h.now("2026-10-19T00:00:00"); abandoned();
  assert.equal(h.updates.length, 1); assert.equal(h.timers.size, 0);
});

test("late AppContext hydration cannot replace an explicit date selection or persist its old default", async () => {
  const code = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("AppContext.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let hydrate, setter;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
      && node.arguments[0]?.getText(ast).includes("const [ids, dr, nf, filterUser")) hydrate = node.arguments[0];
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "setDateRange") setter = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(hydrate); assert.ok(setter);
  assert.match(code, /useDateRangeRollover\(dateRange, hydrated, setDateRange\)/);
  for (const explicit of [false, true]) {
    let resolve, range;
    const pending = new Promise((done) => { resolve = done; });
    const writes = [];
    const exports = {};
    vm.runInNewContext(ts.transpileModule(`exports.hydrate = ${hydrate.getText(ast)}; exports.set = ${setter.getText(ast)};`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, {
      exports, dateRangeRevisionRef: { current: 0 }, useCallback: (fn) => fn,
      storage: { getItem: (key) => key === "date" ? pending : Promise.resolve(""),
        setItem: async (key, value) => { if (key === "date") writes.push(JSON.parse(value)); } },
      STORAGE_KEYS: { dateRange: "date", selectedProfiles: "ids", notifications: "notification", exactHarvestBid: "bid" },
      ADMIN_FILTER_KEY: "admin", getKdpRoyaltySource: async () => "ios_helper",
      normalizeKdpRoyaltySource: (v) => v, setKdpRoyaltySourceState() {}, setAdminFilterUserIdState() {},
      setSelectedProfileIdsState() {}, setNotificationsState() {}, setDefaultExactBidState() {}, setHydrated() {},
      normalizeDateRange: (value) => normalizeDateRange(value, new Date(2026, 9, 18)),
      setDateRangeState: (value) => { range = value; },
    });
    exports.hydrate();
    const chosen = { start: "2026-09-02", end: "2026-09-03", label: "Custom range" };
    if (explicit) exports.set(chosen);
    resolve(JSON.stringify({ start: "2026-10-01", end: "2026-10-17", label: "This month" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(writes.length, 1);
    if (explicit) assert.deepEqual(range, chosen);
    else assert.equal(range.end, "2026-10-18");
    assert.deepEqual(writes[0], range);
  }
});
