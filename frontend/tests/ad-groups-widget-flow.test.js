import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { enabledSelectedProfileIds } from '../src/lib/booksProfileScope.ts';
import { matchesEntityStateFilter, statusLabel } from '../src/lib/campaigns.ts';
import { compareByAcosAscending, compareByAcosSpendImpressionsSync } from '../src/lib/overviewWidgets.ts';
import { overviewReadLabel } from '../src/lib/overviewReadEvidence.ts';
import { withAbortableQueryTimeout, withQueryTimeout } from '../src/lib/queryTimeout.ts';

const source = readFileSync(new URL('../app/more/ad-groups.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('groups.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fragment = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'AdGroupsScreen').map(n => n.getText(ast)).join('\n');
const js = ts.transpileModule(fragment, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  let cursor = 0, effects = [], states = [], dependencies = [];
  const h = { actor: 'owner', params: { flow: 'widget-1', enabledParents: '1', sort: 'acos-high' },
    app: { selectedProfileIds: ['p', 'disabled'], profiles: [{ id: 'p', profile_id: 'amazon-p', is_enabled: true }, { id: 'disabled', is_enabled: false }],
      primaryCurrency: 'USD', dateRange: { start: '2026-10-01', end: '2026-10-18' }, adminFilterUserId: null },
    response: { data: [], dataUpdatedAt: 1, isFetching: false, isLoading: false, isError: false, isRefetching: false, refetch() {} }, reads: [] };
  const element = (type, props, ...children) => ({ type, props: props ?? {}, children });
  const env = { exports: {}, React: { createElement: element }, styles: {},
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
    useMemo: fn => fn(), useEffect(fn, deps) { const i = cursor++; if (!dependencies[i] || deps.some((v, j) => v !== dependencies[i][j])) { effects.push(fn); dependencies[i] = deps; } },
    useRouter: () => ({}), useQueryClient: () => ({}), useReduceMotion: () => true,
    useTheme: () => ({ colors: {}, typography: {}, layout: {} }), useAuth: () => ({ user: h.actor ? { id: h.actor } : null }),
    useApp: () => h.app, useLocalSearchParams: () => h.params,
    useQuery: opts => { h.query = opts; return h.response; },
    enabledSelectedProfileIds, matchesEntityStateFilter, statusLabel, compareByAcosAscending, compareByAcosSpendImpressionsSync, overviewReadLabel,
    withAbortableQueryTimeout, withQueryTimeout, HOME_QUERY_TIMEOUT_MS: 20_000, LIST_PERIOD_QUERY_CACHE: {}, AD_GROUPS_LIST_LIMIT: 500,
    SORT_CONFIG: ['spend', 'orders', 'acos', 'acos-high', 'ctr'].map(key => ({ key, label: key })),
    fetchOverviewActiveAdGroups: async (ids, opts) => { h.reads.push({ kind: 'active', ids, opts }); return []; },
    fetchAdGroups: async (ids, campaign, opts) => { h.reads.push({ kind: 'legacy', ids, opts }); return []; },
    emptyCopy: () => ({ title: 'empty' }), Haptics: { ImpactFeedbackStyle: {}, impactAsync() {} }, Platform: { OS: 'ios' },
    isHomeQueryTimeout: () => false,
  };
  for (const name of ['SubScreen', 'EmptyState', 'FilterChrome', 'FilterSearchRow', 'View', 'IOSSearchBar', 'FilterIconButton', 'IOSSegmentedControl', 'ActiveFilterRow',
    'ActiveFilterChip', 'Text', 'ScreenSpinner', 'RetryState', 'FlatList', 'RefreshControl', 'Modal', 'SortSheetBody']) env[name] = name;
  vm.runInNewContext(js, env);
  h.render = () => { cursor = 0; h.tree = env.exports.default(); return h.tree; };
  h.flush = () => { const pending = effects; effects = []; pending.forEach(fn => fn()); };
  return h;
}
const nodes = tree => tree == null ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
const find = (h, id) => nodes(h.tree).find(n => n.props.testID === id);
const rows = h => nodes(h.tree).find(n => n.type === 'FlatList')?.props.data;

test('Home handoff reads the same authorized parent-aware period source, including complete query identity and a signal', async () => {
  const h = harness(); h.render(); h.flush(); h.render();
  const controller = new AbortController();
  await h.query.queryFn({ signal: controller.signal });
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].kind, 'active');
  assert.deepEqual(Array.from(h.reads[0].ids), ['p']);
  assert.equal(h.reads[0].opts.start, h.app.dateRange.start);
  assert.equal(h.reads[0].opts.end, h.app.dateRange.end);
  assert.equal(h.reads[0].opts.limit, 500);
  assert.equal(h.reads[0].opts.signal.aborted, true); // Wrapper closes transport ownership on settlement.
  assert.equal(h.query.enabled, true); assert.equal(h.query.retry, false);
  assert.deepEqual(Array.from(h.query.queryKey).slice(0, 3), ['ad-groups-list-v2', 'owner', 'self']);
  assert.ok(find(h, 'ad-groups-filter-chip-parents'));
});

test('clearing parent scope or switching state is local and changes the query identity, not the shared period/profile selection', async () => {
  const h = harness(); h.render(); h.flush(); h.render();
  const context = JSON.stringify(h.app);
  find(h, 'ad-groups-filter-chip-parents').props.onPress(); h.render();
  assert.equal(h.query.queryKey.at(-1), false);
  await h.query.queryFn({ signal: new AbortController().signal });
  assert.equal(h.reads[0].kind, 'legacy');
  assert.equal(JSON.stringify(h.app), context);
  const other = harness(); other.render(); other.flush(); other.render();
  find(other, 'ad-groups-state-segments').props.onChange('paused'); other.render();
  assert.equal(other.query.queryKey.at(-1), false);
});

test('a customer switch gates the old local context and cannot read the administrator RLS catalog', async () => {
  const h = harness(); h.render(); h.flush(); h.render();
  h.app.adminFilterUserId = 'customer'; h.render();
  assert.equal(h.query.enabled, false); assert.equal(rows(h), undefined);
  h.flush(); h.render();
  await h.query.queryFn({ signal: new AbortController().signal });
  assert.equal(h.reads[0].opts.filterUserId, 'customer');
  find(h, 'ad-groups-filter-chip-parents').props.onPress(); h.render();
  await assert.rejects(async () => h.query.queryFn({ signal: new AbortController().signal }), /enabled-parents/);
  assert.equal(h.reads.length, 1);
  assert.equal(nodes(h.tree).find(n => n.type === 'EmptyState').props.title, 'Enabled-parent context required');
});

test('context changes and logout cannot paint old rows, and navigation parameters win after re-entry', () => {
  const h = harness(); h.response.data = [{ id: 'old', state: 'enabled', total_sales: 10, total_acos: 50 }];
  h.render(); h.flush(); h.render(); assert.equal(rows(h).length, 1);
  h.params = { flow: 'widget-2', enabledParents: '1', sort: 'acos-high' }; h.render();
  assert.equal(h.query.enabled, false); assert.equal(rows(h), undefined);
  h.flush(); h.render(); assert.equal(h.query.enabled, true);
  h.actor = null; h.render(); assert.equal(h.query.enabled, false); assert.equal(rows(h), undefined);
});

test('ACoS sorting preserves a real zero and a failed refresh cannot display retained rows or a zero count', () => {
  const h = harness(); h.response.data = [
    { id: 'unknown', state: 'enabled', total_spend: 90, total_sales: 10, total_acos: null },
    { id: 'zero', state: 'active', total_spend: 0, total_sales: 10, total_acos: 0 },
    { id: 'high', state: 'enabled', total_spend: 5, total_sales: 10, total_acos: 50 },
  ];
  h.render(); h.flush(); h.render(); assert.deepEqual(Array.from(rows(h), r => r.id), ['high', 'zero', 'unknown']);
  h.response.isError = true; h.render();
  assert.equal(rows(h), undefined);
  assert.ok(nodes(h.tree).some(n => n.type === 'RetryState'));
});

test('Home supplies explicit enabled-parent and high-ACoS navigation context', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(home, /pathname: "\/more\/ad-groups", params: \{ flow: String\(Date.now\(\)\), enabledParents: "1", sort: "acos-high"/);
});
