/**
 * Pure KDP helper overview rows for Sync UI (no I/O).
 */
import { NIGHTLY_BACKFILL_DAYS, SYNC_EVERY_MS, type KdpSyncState } from "./planner.ts";
import { isYmd } from "./dates.ts";

export type KdpHelperOverviewRow = {
  id: string;
  title: string;
  detail?: string;
  tone: "ok" | "warn" | "danger" | "neutral";
};

function formatAgo(atMs: number, nowMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return "not yet";
  const sec = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 36) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** Human rows for Sync: 15m cadence, nightly 30-day seal, currency, errors. */
export function buildKdpHelperOverview(args: {
  state: KdpSyncState;
  deferredDays: string[];
  currency: "EUR" | "USD" | null;
  lastMessage?: string | null;
  lastError?: string | null;
  running?: boolean;
  nowMs?: number;
}): KdpHelperOverviewRow[] {
  const nowMs = args.nowMs ?? Date.now();
  const deferred = (args.deferredDays ?? []).filter(isYmd);
  const rows: KdpHelperOverviewRow[] = [];

  rows.push({
    id: "currency",
    title: args.currency ? `Replay currency ${args.currency}` : "Replay currency unknown",
    detail: args.currency
      ? "KDP helper requests use this preferredCurrency"
      : "Set after the next successful helper tick",
    tone: args.currency ? "ok" : "warn",
  });

  const steadyAt = args.state.lastSteadyAtMs;
  const steadyAge = Number.isFinite(steadyAt) && steadyAt > 0 ? nowMs - steadyAt : null;
  const steadyFresh = steadyAge != null && steadyAge < SYNC_EVERY_MS * 2;
  const steadyStale = steadyAge != null && steadyAge >= SYNC_EVERY_MS * 2;
  rows.push({
    id: "steady",
    title: steadyAt > 0 ? "15 min sync" : "15 min sync — not run yet",
    detail:
      steadyAt > 0
        ? `${steadyFresh ? "Completed" : steadyStale ? "Overdue" : "Last run"} · ${formatAgo(steadyAt, nowMs)}`
        : "Helper pulls today + yesterday about every 15 minutes",
    tone: steadyAt > 0 ? (steadyFresh ? "ok" : steadyStale ? "warn" : "neutral") : "warn",
  });

  const nightlyYmd = args.state.lastNightlyYmd;
  const nightlyOpen = args.state.nightlyStartedYmd;
  if (nightlyYmd && isYmd(nightlyYmd)) {
    rows.push({
      id: "nightly",
      title: "Night backfill completed",
      detail: `${nightlyYmd} · ${NIGHTLY_BACKFILL_DAYS} days sealed`,
      tone: "ok",
    });
  } else if (nightlyOpen && isYmd(nightlyOpen)) {
    rows.push({
      id: "nightly",
      title: "Night backfill in progress",
      detail: deferred.length
        ? `Opened ${nightlyOpen} · ${deferred.length} day${deferred.length === 1 ? "" : "s"} left`
        : `Opened ${nightlyOpen} · finishing leftover days`,
      tone: "warn",
    });
  } else {
    rows.push({
      id: "nightly",
      title: "Night backfill",
      detail: `Runs after 02:00 · last ${NIGHTLY_BACKFILL_DAYS} days`,
      tone: "neutral",
    });
  }

  if (args.state.onboardingDone) {
    rows.push({
      id: "onboarding",
      title: "Onboarding backfill done",
      detail: args.state.milestone30Done ? "30→90 milestones sealed" : "Sealed",
      tone: "ok",
    });
  } else if (args.state.milestone30Done) {
    rows.push({
      id: "onboarding",
      title: "Onboarding: 30-day milestone done",
      detail: "Extending toward 90 days",
      tone: "warn",
    });
  } else {
    rows.push({
      id: "onboarding",
      title: "Onboarding backfill pending",
      detail: "First 30 days, then up to 90",
      tone: "neutral",
    });
  }

  if (deferred.length > 0) {
    rows.push({
      id: "deferred",
      title: `${deferred.length} deferred day${deferred.length === 1 ? "" : "s"}`,
      detail: `${deferred[0]}${deferred.length > 1 ? ` … ${deferred[deferred.length - 1]}` : ""}`,
      tone: "warn",
    });
  }

  if (args.running) {
    rows.push({
      id: "running",
      title: "Helper running",
      detail: args.lastMessage?.trim() || "Syncing…",
      tone: "neutral",
    });
  } else if (args.lastMessage?.trim()) {
    rows.push({
      id: "last",
      title: "Last helper message",
      detail: args.lastMessage.trim(),
      tone: "neutral",
    });
  }

  if (args.lastError?.trim()) {
    rows.push({
      id: "error",
      title: "Last error",
      detail: args.lastError.trim(),
      tone: "danger",
    });
  }

  return rows;
}
