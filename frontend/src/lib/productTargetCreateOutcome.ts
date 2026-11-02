export type ProductTargetSubmitFailure = {
  message?: string;
  statusCode?: number;
  code?: string;
};

const GENERIC_EMPTY_CREATE = "Amazon did not create any product targets.";

/**
 * A finished Amazon rejection can be submitted again on purpose.
 * A timeout, a dropped connection, or an unconfirmed batch must not.
 */
export function productTargetResubmitBlocked(failure: ProductTargetSubmitFailure | null): boolean {
  if (!failure) return false;
  if (failure.code === "PRODUCT_TARGET_CREATE_REJECTED") return false;
  if (failure.code === "PRODUCT_TARGET_CREATE_UNCONFIRMED") return true;
  if (failure.message === GENERIC_EMPTY_CREATE) return true;
  if (/timed out|timeout|not confirm|no response|unreachable/i.test(failure.message || "")) return true;
  const status = failure.statusCode;
  if (status == null || status === 408 || status === 429 || status >= 500) return true;
  return false;
}

export function failureFromUnknown(error: unknown): ProductTargetSubmitFailure {
  if (!error || typeof error !== "object") return {};
  const row = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    errorCode?: unknown;
  };
  const status = typeof row.status === "number"
    ? row.status
    : typeof row.statusCode === "number"
      ? row.statusCode
      : undefined;
  const code = typeof row.errorCode === "string"
    ? row.errorCode
    : typeof row.code === "string"
      ? row.code
      : undefined;
  return {
    message: typeof row.message === "string" ? row.message : undefined,
    statusCode: status,
    code,
  };
}

export function unconfirmedCreateNotice(failure: ProductTargetSubmitFailure): string {
  const message = failure.message?.trim() || "";
  if (/not confirm|did not confirm|refresh the ad group/i.test(message)) return message;
  return "Amazon did not confirm this. It was not submitted again.";
}
