// Formatting helpers for currency, percentages, large numbers, dates

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  MXN: "MX$",
  BRL: "R$",
  INR: "₹",
  AED: "AED ",
  SAR: "SAR ",
  SEK: "kr ",
  PLN: "zł ",
  TRY: "₺",
  SGD: "S$",
};

export function getCurrencySymbol(code?: string | null) {
  if (!code) return "$";
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

export function formatCurrency(value: number, currency?: string | null, opts?: { compact?: boolean }) {
  const symbol = getCurrencySymbol(currency);
  if (value == null || isNaN(value)) return `${symbol}—`;
  if (opts?.compact) {
    return `${symbol}${formatCompact(value)}`;
  }
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCompact(value: number) {
  if (value == null || isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(value < 100 ? 2 : 0);
}

export function formatInt(value: number) {
  if (value == null || isNaN(value)) return "—";
  return Math.round(value).toLocaleString();
}

export function formatPercent(value: number, decimals = 1) {
  if (value == null || isNaN(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function formatDelta(value: number) {
  if (value == null || isNaN(value)) return "0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateLong(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Date range helpers
export function toDateString(d: Date) {
  return d.toISOString().split("T")[0];
}

export function rangePresets() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const last7 = new Date(today);
  last7.setDate(today.getDate() - 6);

  const last30 = new Date(today);
  last30.setDate(today.getDate() - 29);

  const last90 = new Date(today);
  last90.setDate(today.getDate() - 89);

  return {
    today: { start: toDateString(today), end: toDateString(today), label: "Today" },
    yesterday: { start: toDateString(yesterday), end: toDateString(yesterday), label: "Yesterday" },
    last7: { start: toDateString(last7), end: toDateString(today), label: "Last 7 days" },
    last30: { start: toDateString(last30), end: toDateString(today), label: "Last 30 days" },
    last90: { start: toDateString(last90), end: toDateString(today), label: "Last 90 days" },
  };
}

export function previousRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const days = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const prevEnd = new Date(s);
  prevEnd.setDate(s.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - (days - 1));
  return { start: toDateString(prevStart), end: toDateString(prevEnd) };
}

export function safeDivide(a: number, b: number) {
  if (!b || isNaN(a) || isNaN(b)) return 0;
  return a / b;
}
