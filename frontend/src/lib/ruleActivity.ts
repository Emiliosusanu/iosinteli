// Presentation-only helpers for Rule Activity. Does not evaluate, schedule, or mutate rules.
import { formatAuditWhen, presentExecutionOutcome, type ExecutionTone } from "./ruleExecutionPresentation";
import {
  activityChangedCount,
  activityCountsLabel,
  activityEvaluatedCount,
  activityFailedCount,
  activityIsInProgress,
} from "./ruleActivityContract";
import type { RuleExecutionWithName } from "./types";

export {
  RULE_ACTIVITY_LIMIT,
  activityCapCopy,
  activityChangedCount,
  activityCountsLabel,
  activityEvaluatedCount,
  activityFailedCount,
  activityIsInProgress,
  activityNavParams,
  activityRecentCopy,
  canReadRuleActivity,
  ruleActivityQueryKey,
} from "./ruleActivityContract";

export type ActivityRowPresentation = {
  executionId: string;
  ruleId: string | null;
  ruleName: string;
  rawStatus: string;
  statusLabel: string;
  outcomeLabel: string;
  secondaryLine: string;
  countsLabel: string | null;
  changed: number;
  failed: number;
  evaluated: number | null;
  executedAt: string;
  whenAbsolute: string | null;
  whenRelative: string | null;
  tone: ExecutionTone;
  inProgress: boolean;
  accessibilityLabel: string;
};

export function presentActivityRow(run: RuleExecutionWithName): ActivityRowPresentation {
  const changed = activityChangedCount(run);
  const failed = activityFailedCount(run);
  const evaluated = activityEvaluatedCount(run);
  const presented = presentExecutionOutcome({ status: run.status, changed, failed });
  const ruleName = run.optimization_rules?.name?.trim() || "Untitled rule";
  const when = formatAuditWhen(run.executed_at);
  const countsLabel = activityCountsLabel({ status: run.status, changed, failed });
  const inProgress = activityIsInProgress(run.status);
  const outcomeSpoken = presented.outcome.replace(/\.$/, "");
  const secondaryLine = countsLabel
    ? `${presented.statusLabel} · ${countsLabel}`
    : presented.statusLabel === outcomeSpoken
      ? presented.statusLabel
      : `${presented.statusLabel} · ${outcomeSpoken}`;
  const whenSpoken = when.absolute
    ? `Ran ${when.absolute}${when.relative ? `. ${when.relative}` : ""}`
    : "Run time unavailable";

  return {
    executionId: run.id,
    ruleId: run.rule_id,
    ruleName,
    rawStatus: run.status ?? "",
    statusLabel: presented.statusLabel,
    outcomeLabel: presented.outcome,
    secondaryLine,
    countsLabel,
    changed,
    failed,
    evaluated,
    executedAt: run.executed_at ?? "",
    whenAbsolute: when.absolute,
    whenRelative: when.relative,
    tone: presented.tone,
    inProgress,
    accessibilityLabel: [
      ruleName,
      presented.statusLabel,
      countsLabel ?? outcomeSpoken,
      whenSpoken,
      "Button",
      "Opens execution details",
    ].join(". "),
  };
}
