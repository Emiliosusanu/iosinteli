const origin = Date.now();
const marks = new Map<string, number>([["js_start", origin]]);

/** QA timing marks. Labels only — never pass emails, tokens, ASINs, or profile IDs. */
export function markPerf(label: string): void {
  const now = Date.now();
  const last = marks.get("last") ?? origin;
  marks.set(label, now);
  marks.set("last", now);
  // eslint-disable-next-line no-console
  console.info(`[inteliads:perf] ${label} +${now - last}ms t=${now - origin}ms`);
}

export function readPerfMark(label: string): number | null {
  return marks.get(label) ?? null;
}

export function perfSince(label: string): number | null {
  const at = marks.get(label);
  return at == null ? null : Date.now() - at;
}
