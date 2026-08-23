// Presentation-only helpers for Rule Execution Detail. Does not evaluate or mutate.
import { formatCurrency, formatInt, formatPercent } from "./format";
import { executionStatusLabel, relativeTime } from "./rulePresentation";

export function formatAuditDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatAuditWhen(iso: string | null | undefined): { absolute: string | null; relative: string | null } {
  const absolute = formatAuditDateTime(iso);
  if (!iso || !absolute) return { absolute: null, relative: null };
  return { absolute, relative: relativeTime(iso) };
}

const STATE_LABELS: Record<string, string> = {
  enabled: "Enabled",
  enable: "Enabled",
  paused: "Paused",
  pause: "Paused",
  archived: "Archived",
  disabled: "Disabled",
  active: "Active",
  true: "Enabled",
  false: "Paused",
};

export function friendlyEntityType(type: string | null | undefined): string {
  const tt = (type ?? "").toLowerCase();
  if (tt.includes("search")) return "Search term";
  if (tt.includes("keyword")) return "Keyword";
  if (tt.includes("auto")) return "Auto target";
  if (tt.includes("target") || tt.includes("product")) return "Product target";
  if (tt.includes("campaign")) return "Campaign";
  if (tt.includes("group")) return "Ad group";
  if (!type) return "Item";
  return type.replace(/_/g, " ");
}

function isStateAction(actionType: string): boolean {
  const a = actionType.toLowerCase();
  return a.includes("pause") || a.includes("enable") || a.includes("resume");
}

function isMoneyAction(actionType: string): boolean {
  const a = actionType.toLowerCase();
  return a.includes("bid") || a.includes("budget");
}

function isPercentAction(actionType: string): boolean {
  const a = actionType.toLowerCase();
  return a.includes("placement") || a.includes("percent");
}

export function formatHistoricValue(actionType: string | null | undefined, value: unknown, currency = "USD"): string | null {
  if (value == null || value === "") return null;
  const action = String(actionType ?? "");
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if (STATE_LABELS[key]) return STATE_LABELS[key];
    if (!Number.isFinite(Number(value))) return value.trim();
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (isStateAction(action) && (n === 0 || n === 1)) return n === 1 ? "Enabled" : "Paused";
  if (isPercentAction(action)) return formatPercent(n, Number.isInteger(n) ? 0 : 1);
  if (isMoneyAction(action)) return formatCurrency(n, currency);
  return Number.isInteger(n) ? formatInt(n) : String(n);
}

export function formatBeforeAfter(
  actionType: string | null | undefined,
  oldValue: unknown,
  newValue: unknown,
  currency = "USD",
): string | null {
  const before = formatHistoricValue(actionType, oldValue, currency);
  const after = formatHistoricValue(actionType, newValue, currency);
  if (before && after) return `${before} → ${after}`;
  return after ?? before;
}

export function describeEntityAction(actionType: string | null | undefined): string {
  const a = (actionType ?? "").toLowerCase();
  if (a.includes("pause")) return "Paused";
  if (a.includes("enable") || a.includes("resume")) return "Enabled";
  if (a.includes("negat")) return "Added as negative";
  if (a.includes("positive") || a.includes("harvest")) return "Added as target";
  if (a.includes("placement")) return "Changed placement %";
  if (a.includes("budget")) return "Changed budget";
  if (a.includes("increase_bid")) return "Increased bid";
  if (a.includes("decrease_bid")) return "Decreased bid";
  if (a.includes("set_bid")) return "Set bid";
  if (a.includes("bid")) return "Changed bid";
  if (!actionType) return "Updated";
  return actionType.replace(/_/g, " ");
}

export function entityResultLabel(success: boolean, oldValue: unknown, newValue: unknown): "Changed" | "Failed" | "No change" {
  if (!success) return "Failed";
  const before = oldValue == null ? "" : String(oldValue);
  const after = newValue == null ? "" : String(newValue);
  if (before !== "" && after !== "" && before === after) return "No change";
  return "Changed";
}

export function safeExecutionError(text: string | null | undefined): string | null {
  if (!text) return null;
  const raw = String(text).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower.includes("bearer ") ||
    lower.includes("authorization") ||
    lower.includes("access_token") ||
    lower.includes("refresh_token") ||
    lower.includes("api key") ||
    lower.includes("apikey")
  ) {
    return "Amazon rejected this change.";
  }
  if (raw.length > 180) return `${raw.slice(0, 160).trim()}…`;
  return raw;
}

export type ExecutionTone = "good" | "warning" | "danger" | "inactive";

export function presentExecutionOutcome(input: {
  status?: string | null;
  changed: number;
  failed: number;
}): { statusLabel: string; outcome: string; tone: ExecutionTone } {
  const statusLabel = executionStatusLabel(input.status) ?? "Unknown status";
  const key = String(input.status ?? "").toLowerCase();
  if (key === "failed") {
    return { statusLabel, outcome: "This run failed.", tone: "danger" };
  }
  if (key === "partial_fail" || key === "partial_failed") {
    return {
      statusLabel,
      outcome:
        input.failed > 0
          ? `Finished with ${input.failed} ${input.failed === 1 ? "failure" : "failures"}.`
          : "Finished with some failures.",
      tone: "warning",
    };
  }
  if (key === "running" || key === "pending") {
    return { statusLabel, outcome: "This run is still in progress.", tone: "inactive" };
  }
  if (input.failed > 0 && (key === "completed" || key === "success" || key === "reapplied" || !key)) {
    return {
      statusLabel: key ? statusLabel : "Partial fail",
      outcome: `Finished with ${input.failed} ${input.failed === 1 ? "failure" : "failures"}.`,
      tone: "warning",
    };
  }
  if (input.changed === 0) {
    return { statusLabel: key ? statusLabel : "Completed", outcome: "No changes needed.", tone: "inactive" };
  }
  return {
    statusLabel: key ? statusLabel : "Completed",
    outcome: `Changed ${input.changed} ${input.changed === 1 ? "entity" : "entities"}.`,
    tone: "good",
  };
}
