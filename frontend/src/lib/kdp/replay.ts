/**
 * Rebuild a captured KDP request for a single YMD — same rewrite the
 * Chrome extension uses (`updateUrlDates` / `updatePostData`).
 */
import {
  detectUsesYmdDates,
  findFirstRange,
  looksLikeHtmlErrorPage,
  normalizeTemplateUrlForType,
  rangeIsoPreserveCapturedOffsets,
  tryParseJson,
  updatePostData,
  updateUrlDates,
} from "./vendor/kdpVendor.generated.js";
import type { KdpCapturedTemplate, KdpTemplateType } from "./templates.ts";
import { patchKdpBodyCurrency, patchKdpUrlCurrency } from "./currency.ts";

export interface PageFetchResult {
  ok: boolean;
  status: number;
  text: string;
  contentType?: string;
  finalUrl?: string;
  redirected?: boolean;
}

export interface RebuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export function rebuildTemplateForDay(
  template: KdpCapturedTemplate,
  type: KdpTemplateType,
  ymd: string,
  opts: { preferredCurrency?: string | null } = {},
): RebuiltRequest {
  const body0 = template.requestBody;
  const bodyObj = body0 ? tryParseJson(body0) : null;
  const capturedRange = bodyObj ? findFirstRange(bodyObj) : null;
  const useYmd = detectUsesYmdDates({ url: template.url, bodyObj, capturedRange });
  const range = useYmd
    ? { from: String(ymd), to: String(ymd) }
    : rangeIsoPreserveCapturedOffsets({
        from: ymd,
        to: ymd,
        capturedStartIso: capturedRange?.startDate,
        capturedEndIso: capturedRange?.endDate,
      });
  const normalizedUrl = normalizeTemplateUrlForType(type, template.url);
  const url = patchKdpUrlCurrency(
    updateUrlDates(normalizedUrl, range.from, range.to),
    opts.preferredCurrency,
  );
  const datedBody = bodyObj
    ? updatePostData(JSON.stringify(bodyObj), range.from, range.to)
    : updatePostData(body0, range.from, range.to);
  const body = patchKdpBodyCurrency(datedBody, opts.preferredCurrency);

  const method = String(template.method || "GET");
  const headers: Record<string, string> = {
    ...(template.requestHeaders && typeof template.requestHeaders === "object"
      ? template.requestHeaders
      : {}),
  };
  const keys = Object.keys(headers).map((k) => k.toLowerCase());
  if (!keys.includes("accept")) headers.accept = "application/json, text/plain, */*";
  if (!keys.includes("x-requested-with")) headers["x-requested-with"] = "XMLHttpRequest";
  if (!keys.includes("content-type") && method.toUpperCase() !== "GET" && body != null) {
    headers["content-type"] = "application/json";
  }
  // Browser supplies cookies via credentials:include — drop any captured Cookie.
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "cookie") delete headers[k];
  }

  return {
    url,
    method,
    headers,
    body: method.toUpperCase() === "GET" ? null : body == null ? null : String(body),
  };
}

export function parseKdpJsonOrThrow(result: PageFetchResult, label: string): unknown {
  const st = Number(result?.status || 0);
  const text = String(result?.text || "");
  if (!result?.ok) {
    const short = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`${label} fetch failed (${st || "no_status"})${short ? `: ${short}` : ""}`);
  }
  if (looksLikeHtmlErrorPage(text)) {
    throw new Error(`${label} fetch returned HTML (likely logged out)`);
  }
  const json = tryParseJson(text);
  if (!json) {
    const short = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`${label} fetch returned non-JSON${short ? `: ${short}` : ""}`);
  }
  return json;
}
