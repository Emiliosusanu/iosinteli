/**
 * KDP ingest stall — pipeline freshness, not "Amazon has no new royalty day."
 *
 * Chrome and the iPhone helper both write the same tables. Nest
 * `last_synced_at` is the latest successful write (sync run or royalty row).
 * Helper `lastRunAtMs` is the on-device corroboration when this phone is
 * the writer. Report-date holes are not a stall.
 */

export const KDP_INGEST_STALE_AFTER_MS = 60 * 60 * 1000;

export type KdpAccountFreshness = {
  accountId: string;
  name: string;
  lastIngestAtMs: number | null;
  stale: boolean;
};

export function parseIngestMs(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function latestIngestMs(sources: Array<number | null | undefined>): number | null {
  let latest: number | null = null;
  for (const src of sources) {
    if (src == null || !Number.isFinite(src) || src <= 0) continue;
    if (latest == null || src > latest) latest = src;
  }
  return latest;
}

export function kdpAccountsLinkedToSelection<T extends { linked_amazon_profile_ids?: readonly string[] | null }>(
  accounts: readonly T[],
  profileIds: readonly string[],
): T[] {
  const wanted = new Set(profileIds.map((id) => String(id || "").trim()).filter(Boolean));
  if (!wanted.size) return [];
  return accounts.filter((account) =>
    (account.linked_amazon_profile_ids ?? []).some((id) => wanted.has(String(id || "").trim())),
  );
}

export function isKdpIngestStale(input: {
  lastIngestAtMs: number | null;
  knownSinceMs?: number | null;
  nowMs: number;
  staleAfterMs?: number;
}): boolean {
  const limit = input.staleAfterMs ?? KDP_INGEST_STALE_AFTER_MS;
  if (!(limit > 0) || !Number.isFinite(input.nowMs)) return false;
  if (input.lastIngestAtMs != null) {
    return Number.isFinite(input.lastIngestAtMs) && input.nowMs - input.lastIngestAtMs > limit;
  }
  if (input.knownSinceMs != null) {
    return Number.isFinite(input.knownSinceMs) && input.nowMs - input.knownSinceMs > limit;
  }
  return false;
}

export function combineKdpAccountFreshness(input: {
  accountId: string;
  name: string;
  lastSyncedAt?: string | null;
  createdAtMs?: number | null;
  dailyWriteAtMs?: number | null;
  helperEnabled?: boolean;
  helperAccountId?: string | null;
  helperLastRunAtMs?: number | null;
  nowMs: number;
  staleAfterMs?: number;
}): KdpAccountFreshness {
  const nestMs = parseIngestMs(input.lastSyncedAt);
  const dailyMs = parseIngestMs(input.dailyWriteAtMs);
  const helperMatches =
    !!input.helperEnabled &&
    !!input.helperAccountId &&
    input.helperAccountId === input.accountId;
  const helperMs = helperMatches ? parseIngestMs(input.helperLastRunAtMs) : null;
  const lastIngestAtMs = latestIngestMs([nestMs, dailyMs, helperMs]);
  return {
    accountId: input.accountId,
    name: String(input.name || "").trim() || "KDP",
    lastIngestAtMs,
    stale: isKdpIngestStale({
      lastIngestAtMs,
      knownSinceMs: input.createdAtMs ?? null,
      nowMs: input.nowMs,
      staleAfterMs: input.staleAfterMs,
    }),
  };
}

export function formatIngestAge(lastIngestAtMs: number | null, nowMs: number): string {
  if (lastIngestAtMs == null) return "Never";
  const ago = nowMs - lastIngestAtMs;
  if (!Number.isFinite(ago) || ago < 60_000) return "Just now";
  if (ago < 3_600_000) return `${Math.max(1, Math.round(ago / 60_000))}m ago`;
  if (ago < 36 * 3_600_000) return `${Math.max(1, Math.round(ago / 3_600_000))}h ago`;
  return `${Math.max(1, Math.round(ago / 86_400_000))}d ago`;
}

export function kdpIngestStatusLabel(row: Pick<KdpAccountFreshness, "stale" | "lastIngestAtMs">, nowMs: number): string {
  if (row.lastIngestAtMs == null) return row.stale ? "No KDP data yet" : "Waiting for first ingest";
  if (!row.stale) return "Receiving data";
  return `No ingest for ${formatIngestAge(row.lastIngestAtMs, nowMs).replace(" ago", "")}`;
}

export function kdpStallAlertCopy(accountName: string): { title: string; body: string } {
  const name = String(accountName || "").trim() || "A KDP account";
  return {
    title: "KDP data stalled",
    body: `${name} has not received royalty data in over an hour. Check the Chrome extension or iPhone helper.`,
  };
}
