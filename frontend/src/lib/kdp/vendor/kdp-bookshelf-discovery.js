/** All-format page identities are separate from paperback pricing candidates.
 * Read observed Bookshelf widget IDs only; generic headings or HTTP 200 do not
 * prove an empty catalog. Complete HTML, a known shelf container and a sign-out
 * control are required before accepting a terminal page with no book cards. */
export function bookshelfPageEvidence(html, printRows = []) {
  const text = String(html || '');
  const keys = new Set();
  for (const match of text.matchAll(/\bid\s*=\s*["'](?:zme-indie-bookshelf-)?dual-itemset-itemset-metadata-title-([A-Z0-9]+)["']/gi))
    keys.add(`title:${match[1].toUpperCase()}`);
  for (const match of text.matchAll(/\bid\s*=\s*["'](?:zme-indie-bookshelf-)?dual-([a-z]+)-(?:price-asin|status-format)-([A-Z0-9]+)["']/gi))
    keys.add(`format:${match[1].toLowerCase()}:${match[2].toUpperCase()}`);
  for (const row of printRows) keys.add(`print:${row.kdpBookId}:${row.printAsin || ''}`);
  const shell = /\bid\s*=\s*["']refreshedbookshelftable["']/i.test(text);
  const signedIn = /(?:href\s*=\s*["'][^"']*(?:signout|sign-out|logout)|>\s*Sign out\s*<)/i.test(text);
  const fullDocument = /<\/html\s*>\s*$/i.test(text);
  const login = /<form\b[^>]*(?:signin|authportal)|<title[^>]*>[^<]*(?:sign[ -]?in|error)/i.test(text);
  const unparsedCards = /pod_bookshelf_formats|bookshelf-itemset-metadata-column/i.test(text);
  return { keys: [...keys], authenticated: shell && signedIn && fullDocument && !login,
    terminal: shell && signedIn && fullDocument && !login && !unparsedCards && keys.size === 0 };
}

/** Read-only Tabela refresh protocol observed in Amazon's Bookshelf UI.
 * query page= is ignored; the UI posts PAGE_CHANGED and reports exact counts. */
export function bookshelfRefreshRequest(page, timeoutMs) {
  if (!Number.isInteger(page) || page < 1) throw new Error('Bookshelf cursor invalid');
  return {
    url: 'https://kdp.amazon.com/bookshelf/refresh/ref=xx_xx_cont_xx',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' },
    body: JSON.stringify({ action: 'PAGE_CHANGED', pageNumber: page, recordsPerPage: 50,
      tableId: 'refreshedbookshelftable', filters: [], clientState: { viewVal: 'ALL' } }),
    timeoutMs,
  };
}
export function bookshelfRefreshEvidence(html, page, printRows = []) {
  const text = String(html || '');
  // Retain compatibility with a full authenticated Bookshelf document; it
  // cannot establish numbered pagination unless Amazon supplies the counts.
  if (!/\bid\s*=\s*["']mt-response-status["']/i.test(text)) return bookshelfPageEvidence(text, printRows);
  const field = id => {
    const match = text.match(new RegExp(`<div\\b[^>]*\\bid=["']${id}["'][^>]*>([^<]*)<\\/div>`, 'i'));
    return match ? match[1].trim() : null;
  };
  const integer = id => { const value = field(id); return value != null && /^\d+$/.test(value) ? Number(value) : NaN; };
  const currentPage = integer('currentPage'), size = integer('recordsPerPage'), totalTitles = integer('recordCount');
  if (field('mt-response-status') !== 'SUCCESS' || field('refreshMode') !== 'TABLE'
    || field('tableName') !== 'refreshedbookshelftable' || currentPage !== page
    || !Number.isSafeInteger(size) || size < 1 || size > 50 || !Number.isSafeInteger(totalTitles)
    || !/<div\b[^>]*\bid=["']itemRecords["']/i.test(text)
    || !/<div\b[^>]*\bid=["']refreshMode["'][^>]*>\s*TABLE\s*<\/div>/i.test(text))
    throw new Error('Bookshelf refresh incomplete; cursor retained');
  const evidence = bookshelfPageEvidence(text, printRows);
  const titles = evidence.keys.filter(key => key.startsWith('title:'));
  const expected = Math.min(size, Math.max(0, totalTitles - (page - 1) * size));
  if (titles.length !== expected) throw new Error('Bookshelf refresh row coverage incomplete; cursor retained');
  return { ...evidence, authenticated: true, totalTitles,
    terminal: page * size >= totalTitles };
}
