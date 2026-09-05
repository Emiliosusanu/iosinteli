// Scope and count helpers for Rule Activity. No React Native or formatter imports.
import type { RuleExecution } from "./types";

/** Matches `fetchRuleExecutions` — recent window, not lifetime history. */
export const RULE_ACTIVITY_LIMIT = 30;

export function canReadRuleActivity(params: {
  userId?: string | null;
  guestMode: boolean;
  viewingCustomer: boolean;
  profileCount: number;
}): boolean {
  return !!params.userId && !params.guestMode && !params.viewingCustomer && params.profileCount > 0;
}

export function ruleActivityQueryKey(
  userId: string | undefined,
  adminFilterUserId: string | null | undefined,
  profileIds: string[],
) {
  return ["rule-history-page", userId ?? "guest", adminFilterUserId ?? "self", profileIds] as const;
}

export function activityChangedCount(run: Pick<RuleExecution, "entities">): number {
  return Number(run.entities || 0);
}

export function activityFailedCount(run: Pick<RuleExecution, "errors_count">): number {
  return Number(run.errors_count || 0);
}

/** Only when the run actually stored an evaluated count. Never `changed + failed`. */
export function activityEvaluatedCount(run: Pick<RuleExecution, "entities_checked">): number | null {
  if (run.entities_checked == null || !Number.isFinite(Number(run.entities_checked))) return null;
  return Number(run.entities_checked);
}

export function activityIsInProgress(status: string | null | undefined): boolean {
  const key = String(status ?? "").toLowerCase();
  return key === "running" || key === "pending";
}

export function activityCountsLabel(input: {
  status?: string | null;
  changed: number;
  failed: number;
}): string | null {
  if (activityIsInProgress(input.status)) return null;
  if (input.failed > 0 && input.changed > 0) return `${input.changed} changed · ${input.failed} failed`;
  if (input.failed > 0) return `${input.failed} failed`;
  if (input.changed > 0) return `${input.changed} changed`;
  return null;
}

export function activityRecentCopy(): string {
  return "Recent activity. Newest first.";
}

export function activityCapCopy(): string {
  return `Showing the latest ${RULE_ACTIVITY_LIMIT} runs. Older history is not loaded.`;
}

export function activityNavParams(row: {
  executionId: string;
  ruleName: string;
  executedAt: string;
  rawStatus: string;
  changed: number;
}) {
  return {
    id: row.executionId,
    ruleName: row.ruleName,
    executedAt: row.executedAt,
    status: row.rawStatus,
    entities: String(row.changed),
  };
}
