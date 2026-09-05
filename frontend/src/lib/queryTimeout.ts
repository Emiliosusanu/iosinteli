export const HOME_QUERY_TIMEOUT_MS = 20_000;
export const TARGETING_QUERY_TIMEOUT_MS = 60_000;
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
