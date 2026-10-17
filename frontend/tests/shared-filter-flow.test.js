import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sharedMarketProfileIds } from "../src/lib/overviewMarketplace.ts";

const source = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");

function harness() {
  const states = [], effects = [], pending = [], writes = [];
  let cursor = 0, currentParams = {}, customer = null, nextEffects = [];
  const context = {
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
    },
    useRef(initial) { const [ref] = context.useState({ current: initial }); return ref; },
    useEffect(fn, deps) {
      const i = cursor++;
      const old = effects[i];
      if (!old || deps.some((d, j) => d !== old.deps[j])) {
        nextEffects.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
      }
    },
    useTheme: () => ({}), useRouter: () => ({}), useQueryClient: () => ({}), useInvalidateAds: () => ({}),
    useApp: () => ({ selectedProfileIds: ["us"], primaryCurrency: "USD", dateRange: {}, profiles: [], adminFilterUserId: customer }),
    useAuth: () => ({ user: { id: "owner" } }), useLocalSearchParams: () => currentParams,
    DEFAULT_TARGETING_STATE_FILTER: "enabled", EMPTY_TARGETING_ADVANCED_FILTERS: {},
    SEGMENTS: ["keywords", "asins", "auto", "category", "placement"].map(key => ({ key })),
    PERF_FILTERS: ["all", "wasting", "high_acos", "profitable"].map(key => ({ key })),
    SORT_OPTIONS: ["acos", "spend"].map(key => ({ key })),
    markPerf() {}, takePendingQaFilters: () => null,
    loadTargetingFilterMemory: scope => new Promise(resolve => pending.push({ scope, resolve })),
    saveTargetingFilterMemory: (value, scope) => { writes.push({ value, scope }); },
    saveBulkSelectionMemory() {}, refreshOutboxCounts() {},
    drainBulkOutbox: () => Promise.resolve(), refreshOpenNestBulkJobs: () => Promise.resolve(),
    normalizeTargetingAdvancedFilters: value => value, resolveTargetingStateFilter: value => value,
  };
  const body = source.slice(source.indexOf("export default function TargetingScreen()"), source.indexOf("  async function refreshOutboxCounts()"));
  const js = ts.transpileModule(body.replace("export default ", "") +
    "return {segment, perf, sort, bookAsin, stateFilter, selectedIds, setPerf}; }", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.createContext(context);
  vm.runInContext(js, context);
  return {
    pending, writes,
    render(params = currentParams, owner = customer) {
      currentParams = params; customer = owner; cursor = 0; nextEffects = [];
      const result = context.TargetingScreen();
      for (const run of nextEffects) run();
      return result;
    },
  };
}

test("market US and All only select enabled profiles belonging to the supplied customer", () => {
  const profiles = [
    { id: "us", country_code: "US", is_enabled: true },
    { id: "ca", country_code: "CA", is_enabled: true },
    { id: "disabled", country_code: "US", is_enabled: false },
  ];
  assert.deepEqual(sharedMarketProfileIds(profiles, "us"), ["us"]);
  assert.deepEqual(sharedMarketProfileIds(profiles, null), ["us", "ca"]);
  assert.deepEqual(sharedMarketProfileIds([], "US"), []);
  assert.deepEqual(sharedMarketProfileIds(profiles.slice(1), "US"), []);
});

test("Targets never saves defaults before memory hydration", async () => {
  const h = harness(); h.render();
  assert.equal(h.writes.length, 0);
  h.pending[0].resolve({ segment: "asins", perf: "profitable", bookAsin: "B000000001" });
  await Promise.resolve();
  const state = h.render();
  assert.equal(state.segment, "asins"); assert.equal(state.perf, "profitable");
  assert.equal(h.writes.at(-1).value.bookAsin, "B000000001");
});

test("late memory cannot overwrite widget navigation, including a second widget", async () => {
  const h = harness(); h.render();
  h.render({ flow: "widget-1", segment: "keywords", perf: "wasting" });
  h.pending[0].resolve({ segment: "asins", perf: "profitable", bookAsin: "B000000001" });
  await Promise.resolve();
  let state = h.render();
  assert.equal(state.segment, "keywords"); assert.equal(state.perf, "wasting"); assert.equal(state.bookAsin, null);
  h.render({ flow: "widget-2", segment: "keywords", perf: "all" });
  state = h.render(); assert.equal(state.perf, "all");
});

test("customer switch cancels old hydration and writes only to the new customer scope", async () => {
  const h = harness(); h.render({}, "customer-a"); h.render({}, "customer-b");
  h.pending[0].resolve({ perf: "profitable", bookAsin: "B000000001" });
  await Promise.resolve(); h.render(); assert.equal(h.writes.length, 0);
  h.pending[1].resolve({ perf: "wasting" }); await Promise.resolve();
  const state = h.render(); assert.equal(state.perf, "wasting"); assert.equal(state.bookAsin, null);
  assert.equal(h.writes.at(-1).scope, "owner:customer-b");
});

test("Reset changes local filters without changing shared market or dates", () => {
  const reset = source.slice(source.indexOf('testID="targeting-reset-local"'), source.indexOf('>Reset filters</Text>'));
  assert.match(reset, /setAdvanced/); assert.match(reset, /setSearch/); assert.match(reset, /setBookAsin/);
  assert.doesNotMatch(reset, /setDateRange|selectMarket|setSelectedProfileIds/);
});
