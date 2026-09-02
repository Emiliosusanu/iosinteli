/**
 * Device QA command channel.
 *
 * Physical AX Activate is a no-op on this iOS 26 host tunnel, and CoreDevice is
 * unavailable for XCUITest. The filter/date harness pushes a one-shot command
 * into AsyncStorage, relaunches, and this module applies route + date + filter
 * seeds, then clears the key.
 */
import { presetRangeFromLabel } from "./format";
import type { DateRange } from "./types";

export const QA_COMMAND_KEY = "inteliads.qa.command";

export type QaRoute =
  | "/(tabs)"
  | "/(tabs)/campaigns"
  | "/(tabs)/targeting"
  | "/(tabs)/products"
  | "/(tabs)/more";

export type QaCommand = {
  id?: string;
  route?: QaRoute;
  /** Exact TopBar preset label, e.g. "Last 7 days". */
  dateLabel?: string;
  /** Overview Month/Week. Applied by setting dateRange to the matching shape. */
  periodMode?: "month" | "week";
  /** Shift Overview/global range by N months (month mode) or weeks (week mode). */
  periodShift?: number;
  campaignsState?: "all" | "enabled" | "paused";
  campaignsSort?: "top" | "spend" | "orders" | "acos";
  targetsSegment?: "keywords" | "asins" | "auto" | "category" | "placement";
  targetsPerf?: "all" | "wasting" | "high_acos" | "no_sales" | "profitable";
  targetsSort?: "spend" | "acos" | "orders";
  booksSort?: "net" | "spend" | "acos" | "orders";
};

let pendingFilters: QaCommand | null = null;

export function parseQaCommand(raw: unknown): QaCommand | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return value as QaCommand;
}

export function takePendingQaFilters(): QaCommand | null {
  const next = pendingFilters;
  pendingFilters = null;
  return next;
}

export function stashPendingQaFilters(cmd: QaCommand | null) {
  pendingFilters = cmd;
}

export function dateRangeForQaCommand(cmd: QaCommand, now = new Date()): DateRange | null {
  if (cmd.dateLabel) {
    const preset = presetRangeFromLabel(cmd.dateLabel, now);
    if (preset) return preset;
  }
  if (cmd.periodMode === "week") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { start: ymd(start), end: ymd(end), label: "Last 7 days" };
  }
  if (cmd.periodMode === "month") {
    return presetRangeFromLabel("This month", now);
  }
  return null;
}
