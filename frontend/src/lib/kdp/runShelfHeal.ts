/**
 * Orchestrate KDP shelf auto-heal: detect cross-account ASIN copies, persist
 * quarantine marks, optionally pause Ads joins on fully-poisoned shelves.
 * Never deletes kdp_* rows. Best-effort — callers must not block ingest on failure.
 */
import { supabase } from "../supabase.ts";
import { normalizeAsin, uniqueNormalizedAsins } from "./asinAttribution.ts";
import { loadHelperAccountId } from "./persist.ts";
import {
  buildQuarantineEntries,
  fullyQuarantinedAccountIds,
  type QuarantineEntry,
  type TitleAsinRow,
} from "./shelfHeal.ts";
import { saveKdpAsinQuarantine } from "./shelfHealStore.ts";

export type RunShelfHealResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  entryCount: number;
  pausedAccountIds: string[];
  saved: boolean;
};

export async function runShelfHeal(opts: {
  userId: string;
  /** Sticky / session account after resolveSessionAccount. */
  liveHelperAccountId?: string | null;
  /** Live WebView catalog ASINs (optional; strengthens live_helper rule). */
  liveHelperCatalogAsins?: readonly string[];
  /** When true, pause Ads joins for shelves whose entire catalog is quarantined. */
  pauseFullyQuarantinedJoins?: boolean;
}): Promise<RunShelfHealResult> {
  const userId = String(opts.userId || "").trim();
  if (!userId) {
    return { ok: false, skipped: true, reason: "no_user", entryCount: 0, pausedAccountIds: [], saved: false };
  }

  try {
    const accountIds = await loadOwnedAccountIds(userId);
    if (!accountIds.length) {
      const saved = await saveKdpAsinQuarantine(userId, []);
      return {
        ok: true,
        skipped: true,
        reason: "no_accounts",
        entryCount: 0,
        pausedAccountIds: [],
        saved: saved.saved,
      };
    }

    const titles = await loadAllTitleRows(accountIds);
    const liveHelperAccountId =
      String(opts.liveHelperAccountId || "").trim() ||
      (await loadHelperAccountId().catch(() => null)) ||
      null;

    const { adsOverlapByAsin, earliestAdsProofByAccountId, linkedProfileIdsByAccount } =
      await loadAdsProofMaps(accountIds);

    const entries = buildQuarantineEntries({
      titles,
      adsOverlapByAsin,
      earliestAdsProofByAccountId,
      liveHelperAccountId,
      liveHelperCatalogAsins: opts.liveHelperCatalogAsins,
    });

    const persist = await saveKdpAsinQuarantine(userId, entries);

    let pausedAccountIds: string[] = [];
    const shouldPause = opts.pauseFullyQuarantinedJoins !== false;
    if (shouldPause && entries.length) {
      const canonicalIds = [
        ...new Set(entries.map((e) => e.canonical_account_id).filter(Boolean)),
      ];
      const protect = [...new Set([...canonicalIds, ...(liveHelperAccountId ? [liveHelperAccountId] : [])])];
      const poisoned = fullyQuarantinedAccountIds({
        titles,
        entries,
        protectAccountIds: protect,
      });
      pausedAccountIds = await pauseAdsJoinsForAccounts(poisoned, linkedProfileIdsByAccount);
    }

    return {
      ok: true,
      entryCount: entries.length,
      pausedAccountIds,
      saved: persist.saved,
      skipped: persist.skipped && !pausedAccountIds.length,
      reason: persist.skipped ? "unchanged" : "updated",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || "heal_failed");
    // eslint-disable-next-line no-console
    console.warn("[inteliads] runShelfHeal skipped:", message);
    return {
      ok: false,
      skipped: true,
      reason: message,
      entryCount: 0,
      pausedAccountIds: [],
      saved: false,
    };
  }
}

/** Fire-and-forget wrapper — never throws. */
export function runShelfHealBestEffort(opts: {
  userId: string;
  liveHelperAccountId?: string | null;
  liveHelperCatalogAsins?: readonly string[];
  pauseFullyQuarantinedJoins?: boolean;
}): void {
  void runShelfHeal(opts).catch(() => undefined);
}

async function loadOwnedAccountIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("kdp_accounts").select("id").eq("user_id", userId);
  if (error) throw error;
  return [
    ...new Set(
      (data ?? [])
        .map((row) => String((row as { id?: string }).id || "").trim())
        .filter(Boolean),
    ),
  ];
}

async function loadAllTitleRows(accountIds: string[]): Promise<TitleAsinRow[]> {
  const out: TitleAsinRow[] = [];
  if (!accountIds.length) return out;
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("kdp_titles")
      .select("account_id, asin, updated_at")
      .in("account_id", accountIds)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const account_id = String((row as { account_id?: string }).account_id || "").trim();
      const asin = normalizeAsin((row as { asin?: string }).asin);
      if (!account_id || !asin) continue;
      const updated_at = (row as { updated_at?: string | null }).updated_at ?? null;
      out.push({ account_id, asin, updated_at });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadAdsProofMaps(accountIds: string[]): Promise<{
  adsOverlapByAsin: Record<string, string[]>;
  earliestAdsProofByAccountId: Record<string, string>;
  linkedProfileIdsByAccount: Map<string, string[]>;
}> {
  const adsOverlapByAsin: Record<string, string[]> = {};
  const earliestAdsProofByAccountId: Record<string, string> = {};
  const linkedProfileIdsByAccount = new Map<string, string[]>();

  if (!accountIds.length) {
    return { adsOverlapByAsin, earliestAdsProofByAccountId, linkedProfileIdsByAccount };
  }

  let links: {
    kdp_account_id?: string;
    amazon_profile_id?: string;
    is_paused?: boolean;
    created_at?: string | null;
  }[] = [];

  {
    const withCreated = await supabase
      .from("kdp_account_amazon_profiles")
      .select("kdp_account_id, amazon_profile_id, is_paused, created_at")
      .in("kdp_account_id", accountIds);
    if (!withCreated.error) {
      links = (withCreated.data ?? []) as typeof links;
    } else {
      const fallback = await supabase
        .from("kdp_account_amazon_profiles")
        .select("kdp_account_id, amazon_profile_id, is_paused")
        .in("kdp_account_id", accountIds);
      if (fallback.error) throw fallback.error;
      links = (fallback.data ?? []) as typeof links;
    }
  }

  const profileIds = new Set<string>();
  for (const row of links) {
    if (row.is_paused === true) continue;
    const kid = String(row.kdp_account_id || "").trim();
    const pid = String(row.amazon_profile_id || "").trim();
    if (!kid || !pid) continue;
    profileIds.add(pid);
    const list = linkedProfileIdsByAccount.get(kid) ?? [];
    if (!list.includes(pid)) list.push(pid);
    linkedProfileIdsByAccount.set(kid, list);
    const created = typeof row.created_at === "string" ? row.created_at.trim() : "";
    if (created) {
      const prev = earliestAdsProofByAccountId[kid];
      if (!prev || created < prev) earliestAdsProofByAccountId[kid] = created;
    }
  }

  const sponsoredByProfile = await fetchSponsoredAsins([...profileIds]);
  const holdersByAsin = new Map<string, Set<string>>();
  for (const [accountId, pids] of linkedProfileIdsByAccount) {
    const sponsored = uniqueNormalizedAsins(pids.flatMap((pid) => sponsoredByProfile[pid] ?? []));
    for (const asin of sponsored) {
      let set = holdersByAsin.get(asin);
      if (!set) {
        set = new Set();
        holdersByAsin.set(asin, set);
      }
      set.add(accountId);
    }
  }
  for (const [asin, set] of holdersByAsin) {
    adsOverlapByAsin[asin] = [...set].sort((a, b) => a.localeCompare(b));
  }

  return { adsOverlapByAsin, earliestAdsProofByAccountId, linkedProfileIdsByAccount };
}

async function fetchSponsoredAsins(profileIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const pid of profileIds) out[pid] = [];
  if (!profileIds.length) return out;
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("product_ads")
      .select("amazon_profile_id, asin")
      .in("amazon_profile_id", profileIds)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const pid = String((row as { amazon_profile_id?: string }).amazon_profile_id || "").trim();
      const asin = normalizeAsin((row as { asin?: string }).asin);
      if (!pid || !asin || !out[pid]) continue;
      if (!out[pid].includes(asin)) out[pid].push(asin);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function pauseAdsJoinsForAccounts(
  accountIds: string[],
  linkedProfileIdsByAccount: Map<string, string[]>,
): Promise<string[]> {
  const paused: string[] = [];
  for (const accountId of accountIds) {
    const pids = linkedProfileIdsByAccount.get(accountId) ?? [];
    if (!pids.length) continue;
    try {
      const { error } = await supabase
        .from("kdp_account_amazon_profiles")
        .update({ is_paused: true })
        .eq("kdp_account_id", accountId)
        .in("amazon_profile_id", pids);
      if (!error) paused.push(accountId);
    } catch {
      /* best-effort */
    }
  }
  return paused;
}

/** Test helper: expose entry builder path without IO. */
export function previewShelfHealEntries(opts: {
  titles: TitleAsinRow[];
  adsOverlapByAsin?: Record<string, readonly string[]>;
  earliestAdsProofByAccountId?: Record<string, string | null | undefined>;
  liveHelperAccountId?: string | null;
  liveHelperCatalogAsins?: readonly string[];
}): QuarantineEntry[] {
  return buildQuarantineEntries(opts);
}
