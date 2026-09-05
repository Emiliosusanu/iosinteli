import type { DataCoverageOverview, DataCoverageRow } from "./queries";

export type DiagnosticTone = "good" | "warning" | "danger" | "inactive";

export type SourcePresentation = {
  statusLabel: string;
  tone: DiagnosticTone;
  summary: string;
};

export const KDP_IPHONE_BOUNDARY =
  "KDP royalties are imported by the Chrome extension or the iPhone helper. This iPhone refreshes linked KDP and Amazon Ads spend from InteliAds in the background.";

export function adsSourcePresentation(
  ads: DataCoverageOverview["ads"],
): SourcePresentation {
  if (ads.status === "error") {
    return {
      statusLabel: "Couldn't check",
      tone: "danger",
      summary: "Amazon Ads data could not be loaded for the selected profiles.",
    };
  }
  if (ads.status === "missing") {
    return {
      statusLabel: "Setup incomplete",
      tone: "warning",
      summary: "No campaigns are available for the selected profiles.",
    };
  }
  if (ads.status === "empty") {
    return {
      statusLabel: "No activity in period",
      tone: "inactive",
      summary: "Amazon Ads loaded successfully with no activity in the selected period.",
    };
  }
  return {
    statusLabel: "Available",
    tone: "good",
    summary: "Amazon Ads activity is available for the selected period.",
  };
}

export function kdpSourcePresentation(
  kdp: DataCoverageOverview["kdp"],
): SourcePresentation {
  if (kdp.status === "error") {
    return {
      statusLabel: "Couldn't check",
      tone: "danger",
      summary: "Linked KDP royalty data could not be loaded.",
    };
  }
  if (kdp.status === "missing") {
    return {
      statusLabel: "Not linked",
      tone: "warning",
      summary: "No KDP account is linked to the selected Amazon profiles.",
    };
  }
  if (kdp.status === "empty") {
    return {
      statusLabel: "No data in period",
      tone: "inactive",
      summary: "KDP is linked, but no imported royalty rows exist in the selected period.",
    };
  }
  return {
    statusLabel: "Available",
    tone: "good",
    summary: "Imported KDP royalties are available for the selected period.",
  };
}

export function coverageStatusLabel(row: DataCoverageRow): string {
  if (row.status === "error") return "Couldn't check";
  if (row.status === "missing") return "Missing";
  if (row.status === "empty") {
    return row.scope === "period" ? "None in period" : "None";
  }
  return "Available";
}

export function coverageCountLabel(row: DataCoverageRow): string {
  return row.count == null ? "—" : String(row.count);
}

export function rowsForScope(
  rows: DataCoverageRow[],
  scope: DataCoverageRow["scope"],
): DataCoverageRow[] {
  return rows.filter((row) => row.scope === scope);
}

export function sourceAccessibilityLabel(params: {
  title: string;
  status: string;
  summary: string;
  details?: string[];
}): string {
  return [
    params.title,
    params.status,
    params.summary,
    ...(params.details ?? []),
  ].filter(Boolean).join(". ");
}

export function hasMixedCurrencies(currencies: Array<string | null | undefined>): boolean {
  return new Set(currencies.map((currency) => currency?.trim()).filter(Boolean)).size > 1;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
};

export function formatCoverageMoney(
  value: number | null | undefined,
  currency: string,
  mixedCurrencies: boolean,
): string {
  if (mixedCurrencies || value == null || Number.isNaN(value)) return "—";
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCoverageCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString();
}

export function adsMetricFacts(params: {
  ads: DataCoverageOverview["ads"];
  currency: string;
  mixedCurrencies: boolean;
}): string[] {
  const money = (value: number | null, label: string) =>
    `${label} ${formatCoverageMoney(value, params.currency, params.mixedCurrencies)}`;
  return [
    money(params.ads.spend, "Amazon Ads spend"),
    money(params.ads.attributedSales, "Ad-attributed sales"),
    `Ad-attributed orders ${formatCoverageCount(params.ads.attributedOrders)}`,
  ];
}

export function kdpMetricFacts(params: {
  kdp: DataCoverageOverview["kdp"];
  currency: string;
  mixedCurrencies: boolean;
}): string[] {
  return [
    `Imported KDP royalties ${formatCoverageMoney(params.kdp.royalties, params.currency, params.mixedCurrencies)}`,
    `KDP orders ${formatCoverageCount(params.kdp.orders)}`,
  ];
}
