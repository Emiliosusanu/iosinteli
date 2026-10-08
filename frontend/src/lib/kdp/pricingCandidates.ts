/**
 * Pure candidate discovery for paperback pricing (no I/O).
 */
import {
  buildPrintSetupPairMaps,
  collectWidgetOnlySetupIds,
  dedupePricingCandidates,
  extractBookshelfPrintRowsFromHtml,
  extractPrintSetupIdsFromJsonDeep,
  extractPrintSetupLinksFromHtml,
  extractSetupIdNearAsin,
  looksLikeAmazonAsin,
  looksLikeKdpSetupBookId,
  sortPricingCandidatesForFetch,
} from "./vendor/kdpPricingCapture.js";

type AnyRow = Record<string, unknown>;

export type PricingCandidate = {
  asin: string | null;
  kdpBookId: string;
  title: string | null;
};

function normalizeSetupId(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function collectPricingCandidatesForIos(opts: {
  booksObj: Record<string, unknown> | null | undefined;
  formatRows: AnyRow[];
  titlesJson: unknown;
  bookshelfHtml: string;
  storedSetupByAsin: Map<string, string>;
}): { candidates: PricingCandidate[]; pairMaps: ReturnType<typeof buildPrintSetupPairMaps> } {
  const seen = new Set<string>();
  const out: PricingCandidate[] = [];
  const pairRows: Array<{ kdpBookId: string; printAsin: string | null; title: string | null }> =
    [];

  const bookshelfRows = extractBookshelfPrintRowsFromHtml(opts.bookshelfHtml || "");
  const inactiveSetupIds = new Set<string>();
  const authoritativeSetupByAsin = new Map<string, string>();
  const inactiveStatuses = new Set(["draft", "in_review", "unpublished", "action_required"]);

  // The current Bookshelf is authoritative for edition identity. KDP may leave
  // historical setup IDs in reports and in our saved metadata after a paperback
  // is unpublished/recreated. Prefer an explicit live row, otherwise accept an
  // unknown-status current row. Explicit inactive rows must never be retried.
  for (const row of bookshelfRows) {
    const id = normalizeSetupId(row.kdpBookId);
    const asin = String(row.printAsin || "").trim().toUpperCase();
    const status = String(row.printStatus || "").trim().toLowerCase();
    if (inactiveStatuses.has(status)) inactiveSetupIds.add(id);
    if (!looksLikeAmazonAsin(asin) || !looksLikeKdpSetupBookId(id)) continue;
    if (inactiveStatuses.has(status)) continue;
    const existing = authoritativeSetupByAsin.get(asin);
    if (status === "live" || !existing) authoritativeSetupByAsin.set(asin, id);
  }

  const add = (asin: string | null, kdpBookId: string, title: string | null = null) => {
    const id = normalizeSetupId(kdpBookId);
    if (!looksLikeKdpSetupBookId(id)) return;
    if (inactiveSetupIds.has(id)) return;
    const a = asin ? String(asin).trim().toUpperCase() : "";
    const authoritativeId = a ? authoritativeSetupByAsin.get(a) : null;
    if (authoritativeId && authoritativeId !== id) return;
    const key = a ? `${a}:${id}` : `id:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairRows.push({ kdpBookId: id, printAsin: a || null, title });
    out.push({ asin: a || null, kdpBookId: id, title });
  };

  for (const fr of opts.formatRows || []) {
    if (String(fr?.format || "").toLowerCase() !== "paperback") continue;
    const asin = String(fr?.asin || "")
      .trim()
      .toUpperCase();
    if (!looksLikeAmazonAsin(asin)) continue;
    const fromBooks =
      opts.booksObj &&
      Object.values(opts.booksObj).find((meta) => {
        const as = (meta as AnyRow)?.asins as AnyRow | undefined;
        return (
          String(as?.print || "")
            .trim()
            .toUpperCase() === asin
        );
      });
    const setupFromBook = (fromBooks as AnyRow)?.printSetupIds as AnyRow | undefined;
    // The live Bookshelf href is authoritative. KDP can replace its internal
    // setup ID after an edition is unpublished/recreated while reports and our
    // database still contain the old ID. Using the historical value first
    // produces a permanent 404 and can starve every live title behind it.
    const setupId =
      extractSetupIdNearAsin(opts.bookshelfHtml, asin) ||
      setupFromBook?.paperback ||
      opts.storedSetupByAsin.get(asin);
    if (setupId) add(asin, String(setupId), null);
  }

  for (const meta of Object.values(opts.booksObj || {})) {
    if (!meta || typeof meta !== "object") continue;
    const row = meta as AnyRow;
    const as = row.asins && typeof row.asins === "object" ? (row.asins as AnyRow) : {};
    const asin = String(as.print || "")
      .trim()
      .toUpperCase();
    const setupIds =
      row.printSetupIds && typeof row.printSetupIds === "object"
        ? (row.printSetupIds as AnyRow)
        : {};
    const kdpBookId =
      extractSetupIdNearAsin(opts.bookshelfHtml, asin) ||
      setupIds.paperback ||
      opts.storedSetupByAsin.get(asin) ||
      null;
    if (asin && kdpBookId) {
      add(asin, String(kdpBookId), row.titleName == null ? null : String(row.titleName));
    }
  }

  for (const link of extractPrintSetupIdsFromJsonDeep(opts.titlesJson)) {
    if (link.format !== "paperback") continue;
    add(null, link.kdpBookId);
  }

  for (const row of bookshelfRows) {
    add(row.printAsin, row.kdpBookId);
  }

  for (const link of extractPrintSetupLinksFromHtml(opts.bookshelfHtml || "")) {
    if (link.format === "paperback") add(null, link.kdpBookId);
  }

  for (const [asin, setupId] of opts.storedSetupByAsin.entries()) {
    add(asin, setupId);
  }

  const pairMaps = buildPrintSetupPairMaps(pairRows, {
    widgetOnlyIds: collectWidgetOnlySetupIds(
      opts.bookshelfHtml || "",
      buildPrintSetupPairMaps(pairRows).setupByAsin,
    ),
  });

  const paperbackAsins = new Set<string>();
  for (const fr of opts.formatRows || []) {
    if (String(fr?.format || "").toLowerCase() !== "paperback") continue;
    const asin = String(fr?.asin || "")
      .trim()
      .toUpperCase();
    if (looksLikeAmazonAsin(asin)) paperbackAsins.add(asin);
  }
  for (const asin of opts.storedSetupByAsin.keys()) paperbackAsins.add(asin);

  for (const asin of paperbackAsins) {
    if (out.some((c) => c.asin === asin)) continue;
    const setupId =
      pairMaps.setupByAsin.get(asin) ||
      opts.storedSetupByAsin.get(asin) ||
      extractSetupIdNearAsin(opts.bookshelfHtml || "", asin);
    if (setupId) add(asin, setupId);
  }

  let candidates = dedupePricingCandidates(out, {
    pairMaps,
    storedSetupByAsin: opts.storedSetupByAsin,
    bookshelfHtml: opts.bookshelfHtml,
  });
  candidates = sortPricingCandidatesForFetch(candidates);
  return { candidates, pairMaps };
}
