import { isIosHelperEnabled } from "./kdp/source.ts";
import { getKdpRoyaltySource } from "./kdp/sourceStore.ts";
import { loadHelperAccountId, loadHelperSyncState } from "./kdp/persist.ts";
import { fetchKdpAccounts } from "./mutations.ts";
import { supabase } from "./supabase.ts";
import {
  combineKdpAccountFreshness,
  kdpAccountsLinkedToSelection,
  parseIngestMs,
  type KdpAccountFreshness,
} from "./kdpIngestFreshness.ts";

async function loadAccountSignals(accountIds: string[]): Promise<
  Map<string, { createdAtMs: number | null; dailyWriteAtMs: number | null }>
> {
  const map = new Map<string, { createdAtMs: number | null; dailyWriteAtMs: number | null }>();
  for (const id of accountIds) {
    map.set(id, { createdAtMs: null, dailyWriteAtMs: null });
  }
  if (!accountIds.length) return map;

  try {
    const { data: accounts } = await supabase
      .from("kdp_accounts")
      .select("id, created_at")
      .in("id", accountIds);
    for (const row of accounts ?? []) {
      const id = String((row as { id?: string }).id || "");
      if (!id || !map.has(id)) continue;
      map.set(id, {
        ...map.get(id)!,
        createdAtMs: parseIngestMs((row as { created_at?: string | null }).created_at),
      });
    }
  } catch {
    // Missing created_at must not invent a stall.
  }

  await Promise.all(
    accountIds.map(async (id) => {
      try {
        const { data } = await supabase
          .from("kdp_daily_data")
          .select("updated_at")
          .eq("account_id", id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const dailyWriteAtMs = parseIngestMs((data as { updated_at?: string | null } | null)?.updated_at);
        map.set(id, { ...map.get(id)!, dailyWriteAtMs });
      } catch {
        // Older schemas / RLS — Nest last_synced_at still applies.
      }
    }),
  );

  return map;
}

/** Linked KDP accounts for the selected Amazon profiles, Chrome or iPhone helper. */
export async function loadScopedKdpFreshness(
  profileIds: readonly string[],
  nowMs = Date.now(),
): Promise<KdpAccountFreshness[]> {
  if (!profileIds.length) return [];
  try {
    const accounts = await fetchKdpAccounts();
    const scoped = kdpAccountsLinkedToSelection(accounts, profileIds);
    if (!scoped.length) return [];

    const [source, helperAccountId, helperState, signals] = await Promise.all([
      getKdpRoyaltySource(),
      loadHelperAccountId(),
      loadHelperSyncState(),
      loadAccountSignals(scoped.map((account) => account.id)),
    ]);

    return scoped.map((account) => {
      const signal = signals.get(account.id);
      return combineKdpAccountFreshness({
        accountId: account.id,
        name: account.name,
        lastSyncedAt: account.last_synced_at,
        createdAtMs: signal?.createdAtMs ?? null,
        dailyWriteAtMs: signal?.dailyWriteAtMs ?? null,
        helperEnabled: isIosHelperEnabled(source),
        helperAccountId,
        helperLastRunAtMs: helperState.lastRunAtMs,
        nowMs,
      });
    });
  } catch {
    return [];
  }
}
