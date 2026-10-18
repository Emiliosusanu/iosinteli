/** Keep a measured positive amount distinct from genuine zero usage. */
export function budgetUsageLabel(percent: number): string {
  if (!Number.isFinite(percent) || percent < 0) return "—";
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}
