export type DailySpendPoint = { date: string; spend: number };

export type MonthlyBudgetForecast = {
  monthToDateSpend: number;
  projectedMonthSpend: number;
  monthlyBudget: number;
  daysInMonth: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedBudgetPct: number | null;
};

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function sumRange(byDate: ReadonlyMap<string, number>, end: Date, count: number): number {
  let sum = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const day = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - offset));
    sum += byDate.get(isoDate(day)) ?? 0;
  }
  return sum;
}

function priorCompleteMonthAverage(byDate: ReadonlyMap<string, number>, now: Date, monthsAgo: number): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - monthsAgo;
  const start = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  let total = 0;
  for (let day = 1; day <= days; day += 1) {
    total += byDate.get(isoDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day)))) ?? 0;
  }
  return total / days;
}

/** Mirrors the web dashboard's calendar-aware monthly spend forecast. */
export function buildMonthlyBudgetForecast(
  points: readonly DailySpendPoint[],
  todayIso: string,
  dailyBudget: number,
): MonthlyBudgetForecast {
  const parsed = new Date(`${todayIso}T00:00:00.000Z`);
  const now = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = Math.max(1, now.getUTCDate());
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  const monthPrefix = todayIso.slice(0, 7);
  const byDate = new Map<string, number>();
  for (const point of points) {
    const amount = Number(point.spend);
    if (!point.date || !Number.isFinite(amount)) continue;
    byDate.set(point.date.slice(0, 10), (byDate.get(point.date.slice(0, 10)) ?? 0) + amount);
  }

  const monthToDateSpend = [...byDate.entries()]
    .filter(([date]) => date.startsWith(monthPrefix) && date <= todayIso)
    .reduce((sum, [, spend]) => sum + spend, 0);
  const mtdDaily = monthToDateSpend / daysElapsed;
  const recent7 = sumRange(byDate, now, Math.min(7, daysElapsed)) / Math.min(7, daysElapsed);
  const recent14 = sumRange(byDate, now, Math.min(14, daysElapsed)) / Math.min(14, daysElapsed);
  const historyDaily =
    priorCompleteMonthAverage(byDate, now, 1) * 0.5 +
    priorCompleteMonthAverage(byDate, now, 2) * 0.3 +
    priorCompleteMonthAverage(byDate, now, 3) * 0.2;

  let forecastDaily: number;
  if (daysElapsed <= 3) forecastDaily = mtdDaily * 0.55 + historyDaily * 0.45;
  else if (daysElapsed <= 10) forecastDaily = recent7 * 0.45 + mtdDaily * 0.35 + historyDaily * 0.2;
  else if (daysElapsed <= 20) forecastDaily = recent7 * 0.5 + recent14 * 0.2 + mtdDaily * 0.3;
  else forecastDaily = recent7 * 0.55 + mtdDaily * 0.45;

  let projectedMonthSpend = monthToDateSpend + forecastDaily * daysRemaining;
  if (daysElapsed >= 22) {
    const straightLine = mtdDaily * daysInMonth;
    projectedMonthSpend = projectedMonthSpend * 0.35 + straightLine * 0.65;
  }
  const monthlyBudget = Math.max(0, Number(dailyBudget) || 0) * daysInMonth;

  return {
    monthToDateSpend,
    projectedMonthSpend,
    monthlyBudget,
    daysInMonth,
    daysElapsed,
    daysRemaining,
    projectedBudgetPct: monthlyBudget > 0 ? (projectedMonthSpend / monthlyBudget) * 100 : null,
  };
}
