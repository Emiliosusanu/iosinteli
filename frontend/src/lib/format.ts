// Formatting helpers for currency, percentages, large numbers, dates
import type { DateRange } from "./types";

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

/** Percent from Amazon/Nest only — never coerce null/missing to 0%. */
export function formatOptionalPercent(value: unknown, decimals = 1) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return formatPercent(n, decimals);
}

/** Parse a user-typed number. A lone comma is treated as the decimal mark (`0,65` → 0.65). */
export function parseLocaleNumber(raw: string): number {
  const trimmed = String(raw ?? "").trim().replace(/\s/g, "");
  if (!trimmed) return Number.NaN;
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  if (hasComma && !hasDot) return Number(trimmed.replace(",", "."));
  return Number(trimmed);
}

export function formatDelta(value: number) {
  if (value == null || isNaN(value)) return "0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatDateShort(iso: string) {
  const d = parseDateOnly(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateLong(iso: string) {
  const d = parseDateOnly(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Date range helpers
export function toDateString(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateOnly(iso: string) {
  if (iso.includes("T")) return new Date(iso);
  return new Date(`${iso}T12:00:00`);
}

export function rangePresets(now = new Date()) {
  const today = parseDateOnly(toDateString(now));
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const last7 = new Date(today);
  last7.setDate(today.getDate() - 6);

  const last30 = new Date(today);
  last30.setDate(today.getDate() - 29);

  const last60 = new Date(today);
  last60.setDate(today.getDate() - 59);

  const last90 = new Date(today);
  last90.setDate(today.getDate() - 89);

  return {
    today: { start: toDateString(today), end: toDateString(today), label: "Today" },
    yesterday: { start: toDateString(yesterday), end: toDateString(yesterday), label: "Yesterday" },
    thisMonth: { start: toDateString(thisMonth), end: toDateString(today), label: "This month" },
    last7: { start: toDateString(last7), end: toDateString(today), label: "Last 7 days" },
    last30: { start: toDateString(last30), end: toDateString(today), label: "Last 30 days" },
    last60: { start: toDateString(last60), end: toDateString(today), label: "Last 60 days" },
    last90: { start: toDateString(last90), end: toDateString(today), label: "Last 90 days" },
    allTime: { start: "2018-01-01", end: toDateString(today), label: "All time" },
  };
}

export function isDynamicRangeLabel(label?: string | null) {
  return (
    label === "Today" ||
    label === "Yesterday" ||
    label === "This month" ||
    label === "Last 7 days" ||
    label === "Last 30 days" ||
    label === "Last 60 days" ||
    label === "Last 90 days" ||
    label === "All time"
  );
}

export function presetRangeFromLabel(label?: string | null, now = new Date()): DateRange | null {
  const presets = rangePresets(now);
  switch (label) {
    case "Today":
      return presets.today;
    case "Yesterday":
      return presets.yesterday;
    case "This month":
      return presets.thisMonth;
    case "Last 7 days":
      return presets.last7;
    case "Last 30 days":
      return presets.last30;
    case "Last 60 days":
      return presets.last60;
    case "Last 90 days":
      return presets.last90;
    case "All time":
      return presets.allTime;
    default:
      return null;
  }
}

export function normalizeDateRange(range?: Partial<DateRange> | null, now = new Date()): DateRange {
  const fallback = rangePresets(now).thisMonth;
  if (!range?.start || !range?.end) return fallback;

  const dynamic = presetRangeFromLabel(range.label, now);
  if (dynamic) return dynamic;

  const today = parseDateOnly(toDateString(now));
  const start = parseDateOnly(range.start);
  const end = parseDateOnly(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fallback;
  if (start > today) return fallback;

  const cappedEnd = end > today ? today : end;
  if (start > cappedEnd) return fallback;

  return {
    start: toDateString(start),
    end: toDateString(cappedEnd),
    label: range.label || formatDateRangeLabel({ start: toDateString(start), end: toDateString(cappedEnd) }),
  };
}

export function formatDateRangeLabel(range: Pick<DateRange, "start" | "end">) {
  const start = parseDateOnly(range.start);
  const end = parseDateOnly(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Custom range";

  if (toDateString(start) === toDateString(end)) {
    return start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  if (sameMonth && start.getDate() === 1 && end.getDate() === monthEnd.getDate()) {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  if (sameMonth) {
    const month = start.toLocaleDateString(undefined, { month: "short" });
    return `${month} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }

  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
  return sameYear ? `${startLabel} - ${endLabel}, ${end.getFullYear()}` : `${startLabel}, ${start.getFullYear()} - ${endLabel}`;
}

export function previousRange(start: string, end: string) {
  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
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
