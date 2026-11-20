import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { allKdpMarketplaceTargets } from '../src/lib/kdp/marketplace.ts';
import { hasVerifiedNativeCoverage, kdpFactSnapshotsMatch, hasTransactionalNativeCoverage } from '../src/lib/kdp/marketplaceCoverage.ts';
import { evaluateRoyaltyOverwriteSafety } from '../src/lib/kdp/royaltyOverwriteSafety.ts';
import { mapKdpMarketplacesSettled } from '../src/lib/kdp/vendor/kdp-report-scheduler.js';
import { withKdpTaskRequest } from '../src/lib/kdp/backgroundBudget.ts';
import * as capture from '../src/lib/kdp/vendor/kdp-complete-capture.js';
import { buildKdpFromJsons, findKdpReportRoot, normalizeHistogramTitleToYmd } from '../src/lib/kdp/vendor/kdpVendor.generated.js';

const importer = readFileSync(new URL('../src/lib/kdp/importer.ts', import.meta.url), 'utf8');
const writer = readFileSync(new URL('../src/lib/kdp/upsert.ts', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const targets = allKdpMarketplaceTargets();
const date = '2026-09-22';
const accountId = '11111111-1111-4111-8111-111111111111';
const asin = 'B0DIGI1234';
const group = 'DIGITAL=' + asin;
const titlesJson = { reportsMetadata: { books: { [group]: { asins: { digital: asin } } } } };
const bucket = (data, props) => ({ nestedHistogram: {
  props, histogramList: [{ title: 'Sep 22, 2026', data }],
} });
const emptyKenp = () => ({ nestedHistogram: { histogramList: [] } });
const incomplete = error => error.code === 'KDP_CAPTURE_INCOMPLETE';

test('complete-capture companion fingerprint includes the reviewed iOS empty-order reconciliation', () => {
  const source = readFileSync(new URL('../src/lib/kdp/vendor/kdp-complete-capture.js', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '687cee4caaea6f37b2ef4f5cdbdfffd58e48b5b1b782555fd927565faaa2e255');
});

test('native report scope includes all 17 stores independently of Ads selection', () => {
  assert.deepEqual(targets.map(t => t.key).sort(), capture.KDP_COMPLETE_REPORT_STORES);
  assert.deepEqual(targets.find(t => t.key === 'BR'), { key: 'BR', filterToken: 'Amazon.com.br', currency: 'BRL' });
  assert.match(importer, /const marketplaceTargets = allKdpMarketplaceTargets\(\)/);
  assert.doesNotMatch(importer, /marketplaceTargetsFromProfiles|fetchAmazonProfiles/);
});

function rawReport(type, market, currency, zero) {
  const [royalties, units, pages] = zero ? [0, 0, 0]
    : ({ ALL: [-3.25, -1, 16], US: [-6.25, -2, 11], CA: [4, 1, 5] })[market] || [0, 0, 0];
  const row = values => ({ bin: group, values });
  if (type === 'royalties') {
    return bucket(royalties ? [row({ TotalRoyalties: royalties, DigitalRoyalties: royalties })] : [],
      { preferredCurrency: royalties || market === 'ALL' ? currency : undefined });
  }
  if (type === 'orders') return bucket(units ? [row({ TotalOrders: units, DigitalOrders: units })] : []);
  return pages ? bucket([row({ TotalKENP: pages })]) : emptyKenp();
}

function harness({ zero = false, transformReport, response, markets = targets, previous } = {}) {
  const calls = [], reads = [], catalogReads = [], receipts = [];
  const writerExports = {};
  const writerModules = {
    '../supabase.ts': { supabase: { from: table => {
      catalogReads.push(table);
      throw new Error('Unexpected coverage fallback');
    } } },
    './marketplaceCoverage.ts': { hasTransactionalNativeCoverage },
    './backgroundBudget.ts': { withKdpTaskRequest },
    './vendor/kdp-complete-capture.js': capture,
    '../rulesApi.ts': { nestApiJson: async (url, request) => {
      const body = JSON.parse(request.body);
      calls.push({ url, body });
      const identity = { accountId: body.accountId, date: body.date, revisionId: body.revisionId };
      if (url.endsWith('/stage-correction')) {
        return { ...identity, ok: false, staged: true, quarantined: true,
          candidateId: '44444444-4444-4444-8444-444444444444' };
      }
      const receipt = { ...identity, ok: true, completeCaptureVerified: true, captureVerificationVersion: 1,
        coverageVerified: true, coverageVersion: 1, coverageMarketplaces: body.marketplaces,
        factRows: body.factRows.length, verifiedFactRows: body.factRows.length,
        submittedBookDailyRows: body.bookDailyRows.length, dailyUpdatedAt: '2026-10-09T20:45:00Z' };
      return response ? response(receipt) : receipt;
    } },
  };
  vm.runInNewContext(compile(writer), { exports: writerExports, require: path => writerModules[path] });
  const start = importer.indexOf('async function fetchDayPayloads(');
  const end = importer.indexOf('async function resolveAccountId(', start);
  const exports = {};
  const baseline = { select: () => baseline, eq: () => baseline,
    maybeSingle: async () => ({ data: previous ?? null, error: null }) };
  vm.runInNewContext(compile(importer.slice(start, end).replace('async function syncOneDay', 'export async function syncOneDay')), {
    exports, ...capture, buildKdpFromJsons, findKdpReportRoot, normalizeHistogramTitleToYmd,
    fetchJsonForType: async (type, day, currency, target) => {
      const market = target?.key ?? 'ALL';
      reads.push({ type, day, currency, market });
      const report = rawReport(type, market, currency, zero);
      return transformReport ? transformReport(report, type, market) : report;
    },
    supabase: { from: () => baseline },
    evaluateRoyaltyOverwriteSafety, allKdpMarketplaceTargets,
    appendKdpActivity: async () => {}, writeKdpDay: writerExports.writeKdpDay,
    saveHelperLastDayReceipt: async (account, receipt) => receipts.push({ account, ...receipt }),
    mapKdpMarketplacesSettled, withKdpTaskRequest, taskRequestTimeout: () => undefined,
  });
  return { calls, reads, catalogReads, receipts, run: () => exports.syncOneDay(accountId, date, titlesJson, markets) };
}

test('real importer, parser and writer send reconciled signed USD and native reports for one revision', async () => {
  const h = harness();
  await h.run();
  assert.equal(h.reads.length, 54);
  assert.equal(h.calls.length, 1);
  const [{ url, body }] = h.calls;
  assert.deepEqual(h.receipts, [{ account: accountId, date, revisionId: body.revisionId,
    dailyUpdatedAt: '2026-10-09T20:45:00Z' }]);
  const { captureEvidence: evidence } = body;
  assert.equal(url, '/kdp-sync/replace-day');
  assert.equal(body.includeAds, false);
  assert.deepEqual(body.marketplaces, targets.map(t => t.key));
  assert.deepEqual(evidence.unscoped, { complete: true, currency: 'USD', royalties: -3.25 });
  assert.equal(body.dailyData.orders, -1);
  assert.equal(body.bookDailyRows[0].kenp, 16);
  assert.deepEqual([evidence.version, evidence.accountId, evidence.date, evidence.revisionId],
    [1, accountId, date, body.revisionId]);
  for (const row of [body.dailyData, body.entry, ...body.bookDailyRows, ...body.factRows]) {
    assert.deepEqual([row.account_id, row.date, row.revision_id], [accountId, date, body.revisionId]);
  }
  for (const [i, store] of evidence.marketplaces.entries()) {
    const target = targets[i];
    assert.equal(store.marketplace, target.key);
    assert.equal(store.currency, target.currency);
    assert.equal(store.complete, true);
    assert.deepEqual(store.reportTypes, ['royalties', 'orders', 'kenp']);
    const facts = body.factRows.filter(fact => fact.marketplace === store.marketplace);
    assert.ok(facts.every(fact => fact.currency === store.currency));
    assert.deepEqual([store.factRows, store.orders, store.kenp, store.royalties], [
      facts.length, facts.reduce((n, fact) => n + fact.units, 0),
      facts.reduce((n, fact) => n + fact.kenp, 0), facts.reduce((n, fact) => n + fact.royalties, 0),
    ]);
  }
  const us = evidence.marketplaces.find(store => store.marketplace === 'US');
  assert.deepEqual([us.orders, us.royalties, us.kenp], [-2, -6.25, 11]);
  assert.equal(h.catalogReads.length, 0);
});

test('an explicit account and 17-store zero can submit a correction without inventing facts', async () => {
  const h = harness({ zero: true, previous: { royalties: 49, orders: 8, kenp: 200 } });
  await h.run();
  assert.equal(h.calls.length, 1);
  const [{ url, body }] = h.calls;
  assert.equal(url, '/kdp-sync/replace-day');
  assert.equal(body.factRows.length, 0);
  assert.equal(body.captureEvidence.marketplaces.length, 17);
  assert.ok(body.captureEvidence.marketplaces.every(m => m.orders === 0 && m.royalties === 0 && m.kenp === 0));
});

test('missing requested date names the failed report and market without logging payloads', async () => {
  const h = harness({ transformReport: (report, type, market) => market === 'CA' && type === 'orders'
    ? { nestedHistogram: { histogramList: [{ title: '2026-09-21', data: [{ privateTitle: 'not for logs' }] }] } }
    : report });
  await assert.rejects(h.run(), error => error.code === 'KDP_CAPTURE_INCOMPLETE'
    && error.captureReason === 'requested_day_missing'
    && error.message.includes(`[${date} CA orders]`)
    && !error.message.includes('not for logs'));
  assert.equal(h.calls.length, 0);
  assert.equal(h.receipts.length, 0);
});

test('explicit empty storefront orders require exact signed book-format reconciliation before upload', async () => {
  const h = harness({ transformReport: (report, type, market) => type === 'orders' && !['ALL','US','CA'].includes(market)
    ? { nestedHistogram: { histogramList: [] } } : report });
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.receipts.length, 1);
  assert.equal(h.calls[0].body.dailyData.orders, -1);
  for (const transformReport of [
    (report, type, market) => type === 'orders' && market === 'CA' ? { nestedHistogram: { histogramList: [] } } : report,
    (report, type, market) => type === 'orders' && market === 'ALL' ? { nestedHistogram: { histogramList: [] } } : report,
    (report, type, market) => type === 'orders' && market === 'MX' ? { nestedHistogram: { histogramList: [], hasMore: true } } : report,
    (report, type, market) => {
      if (type !== 'orders') return report;
      if (market === 'MX') return { nestedHistogram: { histogramList: [] } };
      return market === 'CA' ? bucket([{ bin: 'DIGITAL=B0OTHER123', values: { TotalOrders: 1, DigitalOrders: 1 } }]) : report;
    },
  ]) {
    const broken = harness({ transformReport });
    await assert.rejects(broken.run(), incomplete);
    assert.equal(broken.calls.length, 0);
    assert.equal(broken.receipts.length, 0);
  }
});

test('empty aggregates are accepted only with complete, reconciled dated activity', async () => {
  const empty = extra => ({ nestedHistogram: { histogramList: [] }, histogram: { data: [], ...extra } });
  const valid = harness({ transformReport: (report, type, market) =>
    market === 'MX' && (type === 'orders' || type === 'kenp') ? empty() : report });
  await valid.run();
  assert.equal(valid.calls.length, 1);
  assert.equal(valid.receipts.length, 1);
  for (const [market, response] of [
    ['CA', empty()],
    ['MX', empty({ data: [{ bin: group, values: { TotalOrders: 1 } }] })],
    ['MX', empty({ pagination: { nextCursor: 'next' } })],
    ['MX', empty({ data: undefined })],
  ]) {
    const rejected = harness({ transformReport: (report, type, scope) =>
      type === 'orders' && scope === market ? response : report });
    await assert.rejects(rejected.run(), incomplete);
    assert.equal(rejected.calls.length, 0);
    assert.equal(rejected.receipts.length, 0);
  }
});

test('one wake tries each day once, advances the queue, and retains failed days for the next wake', async () => {
  const start = importer.indexOf('    let totalDays = 0;');
  const end = importer.indexOf('    // planSync advances', start);
  assert.ok(start >= 0 && end > start);
  const code = compile(`async function run() {${importer.slice(start, end)} return {deferred,totalDays};} exports.run = run;`);
  const later = '2026-09-21';
  const tried = [];
  const env = { exports: {}, deferred: [later], state: {}, today: date, yesterday: later,
    opts: {}, tz: 'UTC', wakeMode: 'processing', deadlineAtMs: undefined,
    deferredDayLimitForWake: () => 3, canStartReportDay: () => true,
    planSync: (() => { let n = 0; return () => ({
      nextState: {}, due: true, continueSoon: ++n === 1,
      ranges: [{ from: date, to: date, kind: 'steady' }],
    }); })(),
    eachYmd: from => [from], journalDeferredDays: (queue, days) => [...new Set([...queue, ...days])],
    acknowledgeDeferredDays: (queue, days) => queue.filter(day => !days.includes(day)),
    orderDaysForWake: queue => [...queue].sort().reverse(),
    saveHelperDeferredDays: async () => {}, saveHelperSyncState: async () => {},
    setKdpHelperRunning: () => {}, accountId, titlesJson, marketplaceTargets: targets,
    syncOneDay: async (_, day) => { tried.push(day); if (day === date) throw new Error('Incomplete capture'); },
    isRateLimited: () => false, cloudMissingDays: async () => [], addDaysYmd: () => later, ONBOARDING_DAYS: 90,
  };
  vm.runInNewContext(code, env);
  const result = await env.exports.run();
  assert.deepEqual(tried, [date, later]);
  assert.deepEqual(result.deferred, [date]);
  assert.equal(result.totalDays, 1);
});

test('raw response gaps, duplicates and pagination fail before any write or staging', async () => {
  for (const [market, family, mutate, error] of [
    ['ALL', 'royalties', () => ({}), incomplete],
    ['ALL', 'orders', () => bucket([{ bin: group, values: { TotalOrders: '' } }]), incomplete],
    ['CA', 'orders', () => ({ nestedHistogram: { histogramList: [{ title: '2026-09-21', data: [] }] } }), incomplete],
    ['CA', 'kenp', () => { throw new Error('native fetch failed'); }, /native fetch failed/],
    ['BR', 'kenp', () => ({ ...emptyKenp(), pagination: { nextCursor: 'fixture-cursor' } }), incomplete],
    ['CA', 'orders', emptyKenp, incomplete],
    ['US', 'kenp', () => bucket([{ bin: group, values: { TotalKENP: 1.5 } }]), incomplete],
    ['US', 'royalties', report => ({ nestedHistogram: { ...report.nestedHistogram,
      histogramList: [...report.nestedHistogram.histogramList, ...report.nestedHistogram.histogramList] } }), incomplete],
  ]) {
    const h = harness({ transformReport: (report, type, scope) =>
      type === family && scope === market ? mutate(report) : report });
    await assert.rejects(h.run(), error, market + ' ' + family);
    assert.equal(h.calls.length, 0);
  }
});

test('empty KENP reports require exact account and storefront page counts per ASIN', async () => {
  for (const report of [
    emptyKenp(), bucket([{ bin: group, values: { TotalKENP: 15 } }]),
    bucket([{ bin: 'B0OTHER123', values: { TotalKENP: 16 } }]),
  ]) {
    const h = harness({ transformReport: (raw, type, scope) => type === 'kenp' && scope === 'ALL' ? report : raw });
    await assert.rejects(h.run(), { code: 'KDP_CAPTURE_INCOMPLETE', captureReason: 'kenp_account_reconciliation_failed' });
    assert.equal(h.calls.length, 0);
  }
});

test('Chrome parser guards stop proof when raw money or units could disappear during parsing', async () => {
  for (const [type, report] of [
    ['royalties', bucket([
      { bin: group, values: { TotalRoyalties: -6.25, DigitalRoyalties: -6.25 } },
      { bin: asin, values: { TotalRoyalties: 0, DigitalRoyalties: 0 } },
    ], { preferredCurrency: 'USD' })],
    ['royalties', bucket([
      { bin: group + 'X', values: { TotalRoyalties: -6.25, DigitalRoyalties: -6.25 } },
    ], { preferredCurrency: 'USD' })],
    ['royalties', bucket([
      { bin: 'PRINT=B0PRNT1234', values: { TotalRoyalties: 6.25 } },
    ], { preferredCurrency: 'USD' })],
    ['orders', bucket([{ bin: group, values: { TotalOrders: 0, DigitalOrders: 2 } }])],
    ['orders', bucket([{ bin: group, values: { TotalOrders: 2, PaperbackOrders: 2 } }])],
  ]) {
    const h = harness({ transformReport: (raw, family, scope) => type === family && scope === 'US' ? report : raw });
    await assert.rejects(h.run(), incomplete);
    assert.equal(h.calls.length, 0);
  }
});

test('nonempty royalties cannot attest to the request currency when response currency is missing or different', async () => {
  for (const [market, currency] of [['ALL', undefined], ['ALL', 'EUR'], ['CA', undefined], ['CA', 'USD']]) {
    const h = harness({ transformReport: (raw, type, scope) => {
      if (type === 'royalties' && scope === market) raw.nestedHistogram.props.preferredCurrency = currency;
      return raw;
    } });
    await assert.rejects(h.run(), incomplete);
    assert.equal(h.calls.length, 0);
  }
});

test('partial or duplicate scope cannot replace a day, and partial regressions remain review-only', async () => {
  for (const markets of [targets.slice(0, 1), [...targets.slice(1), targets[1]]]) {
    const h = harness({ markets });
    await assert.rejects(h.run(), incomplete);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ markets: targets.slice(0, 1), zero: true, previous: { royalties: 20, orders: 3, kenp: 0 } });
  await assert.rejects(h.run(), /existing verified royalties/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/kdp-sync/stage-correction');
  assert.equal('captureEvidence' in h.calls[0].body, false);
});

test('writer rejects missing or mismatched receipts with no coverage readback or retry write', async () => {
  for (const patch of [
    { completeCaptureVerified: undefined }, { completeCaptureVerified: false }, { captureVerificationVersion: 2 },
    { coverageVerified: undefined }, { coverageVerified: false }, { coverageVersion: 2 },
    { accountId: 'other' }, { date: '2026-09-23' }, { revisionId: 'another revision' },
    { verifiedFactRows: 999 }, { submittedBookDailyRows: 999 }, { coverageMarketplaces: ['US'] },
    { dailyUpdatedAt: 'unknown' }, { ok: false, pending: true }, { pending: true },
  ]) {
    const h = harness({ response: receipt => ({ ...receipt, ...patch }) });
    await assert.rejects(h.run(), { code: 'KDP_ACK_INCOMPLETE' });
    assert.equal(h.receipts.length, 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.catalogReads.length, 0);
  }
});

test('older partial coverage and changed snapshots cannot seal backfill', () => {
  const updated = '2026-10-09T20:45:00.000Z';
  assert.equal(hasVerifiedNativeCoverage(updated, { daily_updated_at: updated, marketplaces: ['US', 'CA', 'GB', 'AU'] }), false);
  assert.equal(hasVerifiedNativeCoverage(updated, { daily_updated_at: updated, marketplaces: targets.map(t => t.key) }), true);
  assert.equal(hasVerifiedNativeCoverage('newer', { daily_updated_at: updated, marketplaces: targets.map(t => t.key) }), false);
  assert.equal(kdpFactSnapshotsMatch([], []), true);
});
