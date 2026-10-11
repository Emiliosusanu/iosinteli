export const HOME_QUERY_TIMEOUT_MS = 20_000;
export const TARGETING_QUERY_TIMEOUT_MS = 60_000;
/**
 * Display-only title/cover fill after mobile_targeting_page_v1.
 * Must stay well under TARGETING_QUERY_TIMEOUT_MS so the list paints;
 * retail/Open Library gap-fill must never sit on this critical path.
 */
// Page rows are already authoritative and globally ranked when the RPC returns.
// Title/cover enrichment is display-only, so it must never hold the first paint
// behind a slow KDP/Open Library read.
export const TARGETING_PAGE_DISPLAY_ENRICH_MS = 2_500;
/** Nest targeting lists and their local metric enrichment share one page budget. */
export const NEST_TARGETING_LIST_BUDGET_MS = TARGETING_QUERY_TIMEOUT_MS;
export const TARGETING_PAGE_METRICS_BUDGET_MS = TARGETING_QUERY_TIMEOUT_MS;
/** Keyword / search-term funnel reads many entity pages — longer than a Home KPI. */
export const ADS_ENGINE_FUNNEL_TIMEOUT_MS = 45_000;
/** One globally ranked Search Terms page; never leave the screen spinning indefinitely. */
export const SEARCH_TERMS_PAGE_TIMEOUT_MS = 20_000;
/**
 * Book detail → campaigns list. Must fail closed to RetryState — never spin forever
 * while product_ads / placement / metric pages crawl a long date range.
 */
export const BOOK_CAMPAIGNS_TIMEOUT_MS = 45_000;
/**
 * Campaigns tab complete list (limit:0, multi-profile Nest + placement).
 * Home's 20s default aborts US+CA aggregations as "Couldn't load campaigns".
 */
export const CAMPAIGNS_LIST_TIMEOUT_MS = 60_000;
/** Placement share bars on Campaigns rows — soft budget; list paints without them. */
export const CAMPAIGNS_PLACEMENT_BUDGET_MS = 8_000;
/** Create → book picker. Nest /campaigns/creation/book-candidates must not hang forever.
 *  Soft-retry once on timeout in Create UI; resume also warms this cache. */
export const CAMPAIGN_CREATION_BOOKS_TIMEOUT_MS = 45_000;
/** Create → marketplace chips after book select. */
export const CAMPAIGN_CREATION_MARKETPLACES_TIMEOUT_MS = 30_000;
/** Targeting / Campaigns book filter options — must not gate the list forever. */
export const TARGETING_BOOK_OPTIONS_TIMEOUT_MS = 25_000;
/** Placement mix is decorative on book campaign rows — never block the list. */
export const BOOK_CAMPAIGN_PLACEMENT_BUDGET_MS = 8_000;
/**
 * Book detail campaign metrics. Soft-budget inside BOOK_CAMPAIGNS_TIMEOUT_MS —
 * paint campaign rows with zeros rather than spinning until the outer 45s abort.
 */
export const BOOK_CAMPAIGN_METRICS_BUDGET_MS = 25_000;
export const HOME_QUERY_TIMEOUT_MESSAGE = "HOME_QUERY_TIMEOUT";

export function isHomeQueryTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === HOME_QUERY_TIMEOUT_MESSAGE;
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

/** Finite bound for list/network reads. Cached data is left in place by the caller. */
export async function withQueryTimeout<T>(
  promise: Promise<T>,
  ms = HOME_QUERY_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw abortError();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        onAbort = () => reject(abortError());
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => reject(new Error(HOME_QUERY_TIMEOUT_MESSAGE)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort && signal) signal.removeEventListener("abort", onAbort);
  }
}

export function queryStillWaiting(query: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
}): boolean {
  return query.isPending && query.data == null && !query.isError;
}

export type HomeWidgetPhase =
  | "loading"
  | "success"
  | "empty"
  | "stale"
  | "offline"
  | "error"
  | "timeout";

export function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { status?: unknown; statusCode?: unknown };
  const status = record.status ?? record.statusCode;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function isOfflineLikeError(error: unknown): boolean {
  if (!error || isHomeQueryTimeout(error)) return false;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Network request failed|Failed to fetch|offline|internet connection|NetworkError/i.test(message) ||
    (name === "TypeError" && /fetch|network/i.test(message))
  );
}

/** Every Home widget must leave `loading` for a terminal phase. */
export function homeWidgetStatus(input: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
  error?: unknown;
  isEmpty?: boolean;
  status?: number;
}): HomeWidgetPhase {
  const hasData = input.data != null;
  const empty = input.isEmpty === true || (Array.isArray(input.data) && input.data.length === 0);
  if (input.isError) {
    if (hasData && !empty) return "stale";
    if (isHomeQueryTimeout(input.error)) return "timeout";
    const status = input.status ?? httpStatusOf(input.error);
    if (isOfflineLikeError(input.error)) return "offline";
    if (status === 401 || status === 500) return "error";
    return "error";
  }
  if (queryStillWaiting(input)) return "loading";
  if (empty) return "empty";
  return "success";
}
