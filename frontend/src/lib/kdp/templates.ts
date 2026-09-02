/**
 * Captured KDP request templates — same shape the Chrome extension stores.
 * Classified with the vendored `pickTemplateTypeByUrl`.
 */
import { pickTemplateTypeByUrl } from "./vendor/kdpVendor.generated.js";

export type KdpTemplateType =
  | "royalties"
  | "orders"
  | "kenp"
  | "titles"
  | "titles_latest"
  | "royalties_titles"
  | "orders_titles"
  | "kenp_titles"
  | "ads";

export interface KdpCapturedTemplate {
  type: KdpTemplateType;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  capturedAt: string;
}

export const REQUIRED_TEMPLATE_TYPES: readonly KdpTemplateType[] = [
  "royalties",
  "orders",
  "kenp",
];

export const KDP_CAPTURE_PAGES: readonly { type: KdpTemplateType; url: string }[] = [
  { type: "royalties", url: "https://kdpreports.amazon.com/reports/royalties" },
  { type: "orders", url: "https://kdpreports.amazon.com/reports/orders" },
  { type: "kenp", url: "https://kdpreports.amazon.com/reports/kenpc" },
];

export function classifyCapturedUrl(url: string): KdpTemplateType | null {
  const t = pickTemplateTypeByUrl(url);
  if (!t) return null;
  return t as KdpTemplateType;
}

export function hasRequiredTemplates(
  templates: Partial<Record<KdpTemplateType, KdpCapturedTemplate>>,
): boolean {
  return REQUIRED_TEMPLATE_TYPES.every((t) => {
    const row = templates[t];
    return !!row && typeof row.url === "string" && row.url.length > 0;
  });
}

export function mergeCapturedTemplate(
  current: Partial<Record<KdpTemplateType, KdpCapturedTemplate>>,
  incoming: {
    url: string;
    method?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: string | null;
  },
): Partial<Record<KdpTemplateType, KdpCapturedTemplate>> {
  const type = classifyCapturedUrl(incoming.url);
  if (!type) return current;
  const next = { ...current };
  next[type] = {
    type,
    url: incoming.url,
    method: incoming.method || "GET",
    requestHeaders: incoming.requestHeaders && typeof incoming.requestHeaders === "object"
      ? incoming.requestHeaders
      : {},
    requestBody: incoming.requestBody ?? null,
    capturedAt: new Date().toISOString(),
  };
  return next;
}
