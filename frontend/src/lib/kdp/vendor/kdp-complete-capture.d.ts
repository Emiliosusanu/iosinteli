import type { buildKdpFromJsons } from "./kdpVendor.generated.js";

export const KDP_COMPLETE_REPORT_STORES: readonly string[];
type ReportType = "royalties" | "orders" | "kenp";

export function isExplicitEmptyKdpActivity(root: unknown, report: ReportType, marketplace: string): boolean;

export function assertCompleteKdpReport(
  root: unknown, date: string, normalizeDate: (value: unknown) => string | null,
  reportType: ReportType, marketplace: string,
): true;

export type KdpCaptureSnapshot = Pick<ReturnType<typeof buildKdpFromJsons>, "rowDaily" | "rowEntry" | "facts">;
export type KdpCompleteCapture = {
  stores: readonly { key: string; currency: string }[];
  results: readonly PromiseSettledResult<KdpCaptureSnapshot & {
    captureReportsComplete: true;
    scopedEmptyKenp: boolean;
    scopedEmptyOrders?: boolean;
  }>[];
  unscopedComplete: true;
  unscopedEmptyKenp?: boolean;
  unscopedEmptyOrders?: boolean;
};

export type KdpCaptureEvidence = {
  version: 1;
  accountId: string;
  date: string;
  revisionId: string;
  unscoped: { complete: true; currency: string; royalties: number };
  marketplaces: {
    marketplace: string;
    currency: string;
    complete: true;
    reportTypes: ["royalties", "orders", "kenp"];
    factRows: number;
    royalties: number;
    orders: number;
    kenp: number;
  }[];
};

export function buildCompleteKdpCaptureEvidence(input: KdpCompleteCapture & {
  accountId: string;
  date: string;
  revisionId: string;
  built: KdpCaptureSnapshot;
}): KdpCaptureEvidence;
