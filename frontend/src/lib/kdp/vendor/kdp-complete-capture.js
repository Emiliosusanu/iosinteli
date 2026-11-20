export const KDP_COMPLETE_REPORT_STORES = Object.freeze(['AU','BE','BR','CA','DE','ES','FR','GB','IE','IN','IT','JP','MX','NL','PL','SE','US']);
const incomplete = (reason = 'capture_evidence_missing', captureReport, captureShape) => {
  throw Object.assign(new Error(`KDP_CAPTURE_INCOMPLETE: report capture is not complete (${reason})`), {
    status: 503, code: 'KDP_CAPTURE_INCOMPLETE', captureReason: reason, captureReport, captureShape,
  });
};
// An explicitly empty aggregate can accompany the empty dated list.
export function isExplicitEmptyKdpActivity(root, report, marketplace) {
  const buckets = root?.nestedHistogram?.histogramList;
  const aggregate = root?.histogram;
  return (report === 'kenp' || report === 'orders')
    && (marketplace === 'ALL' || KDP_COMPLETE_REPORT_STORES.includes(marketplace))
    && Array.isArray(buckets) && buckets.length === 0
    && (aggregate == null || (Array.isArray(aggregate.data) && aggregate.data.length === 0));
}
/** Inspect completion before parsing can turn absent rows into empty facts. */
export function assertCompleteKdpReport(root, date, normalizeDate, reportType, marketplace) {
  // Only fixed report names and structural counts may reach technical logs.
  // Never attach response bodies, book IDs, report URLs or session data.
  const report = ['royalties', 'orders', 'kenp'].includes(reportType) ? reportType : undefined;
  if (!root || typeof root !== 'object') return incomplete('report_root_missing', report);
  const list = root.nestedHistogram?.histogramList;
  const matches = Array.isArray(list)
    ? list.filter(row => normalizeDate(row?.title ?? row?.label ?? row?.name ?? row?.key) === date) : null;
  const shape = { nestedBuckets: Array.isArray(list) ? list.length : null,
    matchingDayBuckets: matches ? matches.length : null,
    aggregateRows: Array.isArray(root.histogram?.data) ? root.histogram.data.length : null, rows: null };
  const reject = reason => incomplete(reason, report, shape);
  // Observed KENP / processed-order storefront response: an explicit empty
  // histogramList, not an absent report. Allow only a known request scope;
  // before replacement pages / signed format units must reconcile with the
  // complete account report (see buildCompleteKdpCaptureEvidence).
  const scopedEmptyActivity = isExplicitEmptyKdpActivity(root, report, marketplace);
  if (matches && matches.length !== 1 && !scopedEmptyActivity) return reject(matches.length ? 'duplicate_day_buckets' : 'requested_day_missing');
  const bucket = scopedEmptyActivity ? { data: [] } : matches ? matches[0] : root.histogram;
  if (!bucket || !Array.isArray(bucket.data)) return reject('report_rows_missing');
  shape.rows = bucket.data.length;
  const containers = [root, root.histogram, root.nestedHistogram, bucket];
  for (const container of containers) {
    if (!container) continue;
    for (const meta of [container, container.props, container.pagination, container.pageInfo, container.metadata]) {
      if (!meta) continue;
      if (meta.complete === false || meta.isComplete === false || meta.partial === true || meta.truncated === true
        || meta.hasMore === true || meta.hasNextPage === true) return reject('explicit_partial_report');
      if ([meta.nextToken,meta.nextPageToken,meta.nextCursor].some(value => value !== undefined && value !== null && value !== ''))
        return reject('pagination_not_finished');
      if ((meta === container.pagination || meta === container.pageInfo)
          && [meta.totalCount,meta.rowCount,meta.recordCount].some(value => value !== undefined && (typeof value !== 'number' || value !== bucket.data.length)))
        return reject('pagination_count_mismatch');
    }
  }
  return true;
}

function kenpPagesByBook(capture) {
  const fail = () => incomplete('kenp_account_reconciliation_failed', 'kenp');
  if (!Number.isSafeInteger(capture.rowDaily?.kenp) || capture.rowDaily.kenp < 0 || !Array.isArray(capture.facts)) return fail();
  const books = new Map();
  let total = 0;
  for (const fact of capture.facts) {
    const pages = fact?.kenp;
    if (!Number.isSafeInteger(pages) || pages < 0) return fail();
    if (pages === 0) continue;
    const asin = String(fact.asin || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return fail();
    const next = (books.get(asin) || 0) + pages;
    total += pages;
    if (!Number.isSafeInteger(next) || !Number.isSafeInteger(total)) return fail();
    books.set(asin, next);
  }
  if (total !== capture.rowDaily.kenp) return fail();
  return books;
}

function orderUnitsByFormat(capture) {
  const fail = () => incomplete('orders_account_reconciliation_failed', 'orders');
  if (!Number.isSafeInteger(capture.rowDaily?.orders) || !Array.isArray(capture.facts)) return fail();
  const units = new Map();
  let total = 0;
  for (const fact of capture.facts) {
    if (!Number.isSafeInteger(fact?.units)) return fail();
    if (fact.units === 0) continue;
    const asin = String(fact.asin || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin) || !['ebook','paperback','hardcover','audiobook'].includes(fact.format)) return fail();
    const key = JSON.stringify([asin, fact.format]);
    const next = (units.get(key) || 0) + fact.units;
    total += fact.units;
    if (!Number.isSafeInteger(next) || !Number.isSafeInteger(total)) return fail();
    units.set(key, next);
  }
  if (total !== capture.rowDaily.orders) return fail();
  return units;
}

export function buildCompleteKdpCaptureEvidence({ accountId,date,revisionId,built,stores,results,unscopedComplete,unscopedEmptyKenp = false,unscopedEmptyOrders = false }) {
  if (!unscopedComplete || stores.length !== 17 || results.length !== stores.length
    || new Set(stores.map(store => store.key)).size !== 17
    || !Number.isFinite(built.rowDaily.royalties) || !/^[A-Z]{3}$/.test(built.rowEntry.income_currency)) return incomplete();
  if (unscopedEmptyOrders || results.some(result => result?.value?.scopedEmptyOrders === true)) {
    const fail = () => incomplete('orders_account_reconciliation_failed', 'orders');
    if (!stores.every(store => KDP_COMPLETE_REPORT_STORES.includes(store.key))) return fail();
    const expected = orderUnitsByFormat(built);
    const actual = new Map();
    for (const result of results) {
      if (result?.status !== 'fulfilled' || result.value?.captureReportsComplete !== true) return fail();
      for (const [key, units] of orderUnitsByFormat(result.value)) {
        const next = (actual.get(key) || 0) + units;
        if (!Number.isSafeInteger(next)) return fail();
        actual.set(key, next);
      }
    }
    for (const key of new Set([...expected.keys(), ...actual.keys()])) {
      if ((expected.get(key) || 0) !== (actual.get(key) || 0)) return fail();
    }
  }
  if (unscopedEmptyKenp || results.some(result => result?.value?.scopedEmptyKenp === true)) {
    const fail = () => incomplete('kenp_account_reconciliation_failed', 'kenp');
    if (!stores.every(store => KDP_COMPLETE_REPORT_STORES.includes(store.key))) return fail();
    const expected = kenpPagesByBook(built);
    const actual = new Map();
    for (const result of results) {
      if (result?.status !== 'fulfilled' || result.value?.captureReportsComplete !== true) return fail();
      for (const [asin, pages] of kenpPagesByBook(result.value)) {
        const next = (actual.get(asin) || 0) + pages;
        if (!Number.isSafeInteger(next)) return fail();
        actual.set(asin, next);
      }
    }
    if (expected.size !== actual.size || [...expected].some(([asin, pages]) => actual.get(asin) !== pages)) return fail();
  }
  return {
    version: 1,accountId,date,revisionId,
    unscoped: {complete:true,currency:built.rowEntry.income_currency,royalties:built.rowDaily.royalties},
    marketplaces: stores.map((store,index)=>{
      const result=results[index],native=result?.value;
      if (result?.status!=='fulfilled' || native?.captureReportsComplete!==true || !Array.isArray(native.facts)
        || ![native.rowDaily?.royalties,native.rowDaily?.orders,native.rowDaily?.kenp].every(Number.isFinite)) return incomplete();
      return {marketplace:store.key,currency:store.currency,complete:true,reportTypes:['royalties','orders','kenp'],
        factRows:native.facts.length,royalties:native.rowDaily.royalties,orders:native.rowDaily.orders,kenp:native.rowDaily.kenp};
    }),
  };
}
