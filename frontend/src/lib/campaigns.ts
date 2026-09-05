export function biddingStrategyLabel(strategy: string | null | undefined): string {
  const normalized = String(strategy ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!normalized || normalized === "manual" || normalized.includes("fixed")) return "Fixed";
  if (
    normalized.includes("autoforsales") ||
    normalized === "auto" ||
    (normalized.includes("up") && normalized.includes("down"))
  ) {
    return "Up & Down";
  }
  if (normalized.includes("legacyforsales") || normalized.includes("downonly") || normalized.includes("down")) {
    return "Down Only";
  }
  return String(strategy);
}

export function statusLabel(state: string | null | undefined): string {
  const normalized = String(state ?? "").toLowerCase();
  if (normalized === "enabled" || normalized === "active") return "Active";
  if (normalized === "paused") return "Paused";
  if (normalized === "archived") return "Archived";
  return state ? String(state) : "-";
}

export function hasPeriodData(row: Record<string, unknown>): boolean {
  return (
    Number(row.total_spend ?? row.spend ?? 0) > 0 ||
    Number(row.total_sales ?? row.sales ?? 0) > 0 ||
    Number(row.total_orders ?? row.orders ?? 0) > 0 ||
    Number(row.total_clicks ?? row.clicks ?? 0) > 0 ||
    Number(row.total_impressions ?? row.impressions ?? 0) > 0
  );
}

export function shouldShowActiveOrPausedWithData(row: Record<string, unknown>, state: string | null | undefined): boolean {
  const normalized = String(state ?? "").toLowerCase();
  // Show every synced non-archived entity (enabled + paused), even with $0 in
  // the selected period — hiding paused zeros made lists look incomplete.
  if (normalized === "archived") return false;
  if (normalized === "enabled" || normalized === "active" || normalized === "paused") return true;
  return hasPeriodData(row);
}
