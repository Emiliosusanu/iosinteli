function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Same window as rangePresets().allTime. Lifetime totals already sit on the row. */
export function isAllTimeProductTargetWindow(start: string, end: string, today = localDay()): boolean {
  return start === "2018-01-01" && end === today;
}
