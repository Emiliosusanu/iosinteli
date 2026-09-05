/**
 * Calendar-date helpers for the KDP iPhone helper.
 *
 * These mirror the Chrome extension's date math exactly (UTC-noon anchored
 * YMD arithmetic) so both importers agree on which day a report belongs to.
 * All dates are plain `YYYY-MM-DD` strings in the user's local (or KDP) zone.
 */

export function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Today (or any Date) as YYYY-MM-DD in the given IANA time zone. */
export function ymdInTz(date: Date, timeZone?: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // en-CA formats as YYYY-MM-DD.
    const s = fmt.format(date);
    if (isYmd(s)) return s;
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
      date.getUTCDate(),
    )}`;
  }
}

/** Local hour (0-23) in the given IANA time zone. */
export function hourInTz(date: Date, timeZone?: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour: "2-digit",
      hour12: false,
    });
    const h = parseInt(fmt.format(date), 10);
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/** Add (or subtract) whole days to a YMD, returning a new YMD. */
export function addDaysYmd(ymd: string, deltaDays: number): string {
  if (!isYmd(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(deltaDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
    dt.getUTCDate(),
  )}`;
}

/** Inclusive list of YMDs from `fromYmd` to `toYmd`. Empty if reversed/invalid. */
export function eachYmd(fromYmd: string, toYmd: string): string[] {
  if (!isYmd(fromYmd) || !isYmd(toYmd) || fromYmd > toYmd) return [];
  const out: string[] = [];
  let cur = fromYmd;
  // Guard against pathological ranges (>2 years) so a bad cursor can't hang.
  for (let i = 0; i < 800 && cur <= toYmd; i++) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

/** Whole days between two YMDs (b - a). Negative if b is before a. */
export function daysBetweenYmd(aYmd: string, bYmd: string): number {
  if (!isYmd(aYmd) || !isYmd(bYmd)) return 0;
  const toMs = (s: string) => {
    const [y, m, d] = s.split("-").map((v) => parseInt(v, 10));
    return Date.UTC(y, m - 1, d, 12, 0, 0);
  };
  return Math.round((toMs(bYmd) - toMs(aYmd)) / 86_400_000);
}
