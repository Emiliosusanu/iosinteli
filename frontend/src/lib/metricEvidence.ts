/** Missing observations are not measured zeros. */
export function optionalMetric(value: unknown, allowNegative = false): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && (allowNegative || number >= 0) ? number : null;
}

export function knownMetricSum(values: readonly unknown[]): number | null {
  const numbers = values.map(value => optionalMetric(value));
  return numbers.length && numbers.every(value => value != null)
    ? numbers.reduce<number>((sum, value) => sum + value!, 0) : null;
}
