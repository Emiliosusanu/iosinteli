/**
 * Temporary Home period isolation traces for Phase A Core Online.
 * Prefix only — no secrets / tokens / emails.
 */

const PREFIX = "[inteliads:period-trace]";
const t0 = Date.now();

export type PeriodTraceId =
  | "today"
  | "yesterday"
  | "7d"
  | "week"
  | "month"
  | "unknown";

function ms() {
  return Date.now() - t0;
}

export function periodTrace(
  marker: string,
  period: PeriodTraceId,
  fields: Record<string, string | number | boolean | null | undefined> = {},
) {
  if (typeof __DEV__ !== "undefined" && __DEV__ === false) {
    // Always emit during Phase A physical builds — Release still needs these for recert logs.
  }
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(`${PREFIX} ${marker} ms=${ms()} period=${period}${parts ? ` ${parts}` : ""}`);
}
