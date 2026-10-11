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
