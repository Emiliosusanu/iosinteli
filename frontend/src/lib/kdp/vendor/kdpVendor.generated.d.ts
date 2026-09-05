export const KDP_PAGE_HOOK_JS: string;
export const KDP_VENDOR_FUNCTIONS: string[];

export function buildKdpFromJsons(input: {
  ymd: string;
  titlesJson: unknown;
  royaltiesJson: unknown;
  ordersJson: unknown;
  kenpJson: unknown;
  adsJson?: unknown;
  adsEntityId?: unknown;
}): {
  booksObj: Record<string, unknown>;
  rowsBookDaily: Record<string, unknown>[];
  rowDaily: Record<string, unknown>;
  rowEntry: Record<string, unknown>;
  facts: unknown[];
};

export function buildTitlesRows(input: {
  accountId: string;
  booksObj: unknown;
}): {
  bookRows: Record<string, unknown>[];
  formatRows: Record<string, unknown>[];
  titleRows: Record<string, unknown>[];
};

export function extractBooksObj(titlesJson: unknown): Record<string, unknown>;
export function pickTemplateTypeByUrl(url: string): string | null;
export function updateUrlDates(url: string, from: string, to: string): string;
export function updatePostData(postData: unknown, from: string, to: string): string | null;
export function findFirstRange(obj: unknown): { startDate?: string; endDate?: string } | null;
export function detectUsesYmdDates(input: unknown): boolean;
export function rangeIsoPreserveCapturedOffsets(input: unknown): { from: string; to: string };
export function tryParseJson(text: string): unknown;
export function looksLikeHtmlErrorPage(text: string): boolean;
export function normalizeTemplateUrlForType(type: string, url: string): string;
export function addDaysYmd(ymd: string, delta: number): string;
export function eachYmd(from: string, to: string): string[];
