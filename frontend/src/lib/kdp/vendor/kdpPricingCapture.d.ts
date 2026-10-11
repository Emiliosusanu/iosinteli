/** Types for vendored Chrome `kdp-pricing-capture.js` (pure parsers + URL builders). */

export function pickRoyaltyRate(
  listPrice: number,
  royaltyRates: Array<{ threshold?: number; royaltyRate?: number }>,
): number | null;

export function computeKdpNetRoyalty(
  listPrice: number,
  printingCost: number,
  royaltyRates: Array<{ threshold?: number; royaltyRate?: number }>,
): number | null;

export function computeTargetBreakEvenAcos(
  netRoyalty: number,
  listPrice: number,
): number | null;

export function buildKdpGetSetupPageUrl(
  kdpBookId: string,
  format?: string,
  marketplace?: string,
): string | null;

export function extractKdpBookshelfLocale(tabUrl: string): string;

export function buildKdpGetSetupPageUrlCandidates(
  kdpBookId: string,
  options?: { locale?: string; format?: string; marketplace?: string },
): string[];

export function buildKdpPrintSetupEditorUrlCandidates(
  kdpBookId: string,
  options?: { locale?: string; format?: string },
): string[];

export function buildPricingAuthActionTabUrl(
  kdpBookId: string,
  options?: { locale?: string; format?: string },
): string | null;

export function shouldClearPricingGateForTabUrl(url: string): boolean;

export function extractKdpPricingEditorContext(url: string): {
  setupId: string;
  format: string;
  pricingRoute: boolean;
} | null;

export function isLikelyKdpPricingMutation(opts: {
  pageUrl?: string;
  requestUrl?: string;
  method?: string;
  body?: string;
}): boolean;

export function isKdpSetupPageSignInResponse(
  json: unknown,
  text: unknown,
  status: unknown,
): boolean;

export function isKdpSetupPageAuthFailure(opts: {
  fetchResult?: { status?: number; text?: string };
  json?: unknown;
}): boolean;

export function isKdpSetupPageTransportFailure(fetchResult?: {
  status?: number;
  text?: string;
}): boolean;

export function isKdpSetupPagePermanentMiss(fetched: unknown): boolean;

export function diagnoseKdpSetupPageFailure(opts: {
  fetchResult?: { status?: number; ok?: boolean; contentType?: string; finalUrl?: string; text?: string; redirected?: boolean };
  json?: unknown;
  url?: string;
  preferredMarketplace?: string;
}): string;

export function resolvePricingMarketplaceKey(json: unknown, preferredKey?: string): string;

export function parseKdpGetSetupPage(
  json: unknown,
  marketplaceKey?: string,
): {
  listPrice: number | null;
  printingCost: number | null;
  netRoyalty: number | null;
  royaltyRate: number | null;
  targetBreakEvenAcos: number | null;
  currency: string | null;
  marketplace: string | null;
  asin: string | null;
  bookTitle: string | null;
  expandedDistribution: boolean | null;
} | null;

export function hasKdpSetupPagePricing(pricing: unknown): boolean;

export function parseAllMarketplacePricingFromSetupPage(
  json: unknown,
  preferredKey?: string,
): Array<{
  marketplace: string;
  listPrice: number | null;
  printingCost: number | null;
  netRoyalty: number | null;
  royaltyRate: number | null;
  targetBreakEvenAcos: number | null;
  currency: string | null;
  expandedDistribution: boolean | null;
  royaltyPrograms?: unknown[];
  territories?: unknown[];
}>;

export function pickPrimaryMarketplacePricing(
  allRows: unknown[],
  preferredKey?: string,
): ReturnType<typeof parseKdpGetSetupPage>;

export function extractAsinFromSetupPageJson(json: unknown): string | null;

export function looksLikeAmazonAsin(value: unknown): boolean;

export function looksLikeKdpSetupBookId(value: unknown): boolean;

export function extractPrintSetupIdsFromJsonDeep(json: unknown): Array<{
  kdpBookId: string;
  format: string;
}>;

export function extractBookshelfPrintRowsFromHtml(html: string): Array<{
  kdpBookId: string;
  printAsin: string | null;
  digitalAsin?: string | null;
  displayedPrice?: string | null;
  currency?: string | null;
  printStatus?: "live" | "draft" | "in_review" | "unpublished" | "action_required" | null;
}>;

export function extractPrintSetupLinksFromHtml(html: string): Array<{
  kdpBookId: string;
  format: string;
}>;

export function extractSetupIdNearAsin(html: string, asin: string): string | null;

export function buildPrintSetupPairMaps(
  pairs: Array<{ kdpBookId: string; printAsin?: string | null; title?: string | null }>,
  options?: { widgetOnlyIds?: Iterable<string> },
): {
  setupByAsin: Map<string, string>;
  asinBySetup: Map<string, string>;
  titleBySetup: Map<string, string>;
};

export function resolveAsinFromSetupPairMaps(
  setupId: string,
  bookTitle: string | null | undefined,
  maps: ReturnType<typeof buildPrintSetupPairMaps>,
): string | null;

export function dedupePricingCandidates(
  candidates: Array<{ asin?: string | null; kdpBookId?: string; title?: string | null }>,
  options?: unknown,
): Array<{ asin: string | null; kdpBookId: string; title: string | null }>;

export function sortPricingCandidatesForFetch(
  candidates: Array<{ asin?: string | null; kdpBookId?: string; title?: string | null }>,
): Array<{ asin: string | null; kdpBookId: string; title: string | null }>;

export function collectWidgetOnlySetupIds(
  html: string,
  setupByAsin?: Map<string, string>,
): string[];
