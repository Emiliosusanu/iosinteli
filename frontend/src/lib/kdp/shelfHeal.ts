/**
 * Pure KDP shelf auto-heal: detect cross-account duplicate ASINs, pick a
 * canonical owner, and build quarantine marks. Never deletes kdp_* rows.
 * Truth = ASIN only (never book title strings).
 */
import { normalizeAsin, uniqueNormalizedAsins } from "./asinAttribution.ts";

export const KDP_ASIN_QUARANTINE_FIELD = "kdp_asin_quarantine";

export type QuarantineRule = "ads_overlap" | "live_helper" | "first_ads_proof";
export type QuarantineReason = "cross_account_duplicate";

export type QuarantineEntry = {
  account_id: string;
  asin: string;
  canonical_account_id: string;
  reason: QuarantineReason;
  rule: QuarantineRule;
};

export type QuarantineDoc = {
  version: 1;
  updated_at: string;
  entries: QuarantineEntry[];
};

export type TitleAsinRow = {
  account_id: string;
  asin: string;
  updated_at?: string | null;
};

export function quarantinePairKey(accountId: string, asin: string): string {
  const aid = String(accountId || "").trim();
  const a = normalizeAsin(asin) || String(asin || "").trim().toUpperCase();
  return `${aid}::${a}`;
}

export function isQuarantined(
  accountId: string,
  asin: string,
  entries: readonly QuarantineEntry[],
): boolean {
  const key = quarantinePairKey(accountId, asin);
  return entries.some(
    (e) => quarantinePairKey(e.account_id, e.asin) === key,
  );
}

/** ASIN → distinct holder account ids (only ASINs with ≥2 holders). */
export function detectCrossAccountAsins(
  titles: readonly TitleAsinRow[],
): Map<string, string[]> {
  const holders = new Map<string, Set<string>>();
  for (const row of titles) {
    const asin = normalizeAsin(row.asin);
    const accountId = String(row.account_id || "").trim();
    if (!asin || !accountId) continue;
    let set = holders.get(asin);
    if (!set) {
      set = new Set();
      holders.set(asin, set);
    }
    set.add(accountId);
  }
  const out = new Map<string, string[]>();
  for (const [asin, set] of holders) {
    if (set.size < 2) continue;
    out.set(asin, [...set].sort((a, b) => a.localeCompare(b)));
  }
  return out;
}

function earliestIso(
  byAccount: Record<string, string | null | undefined> | undefined,
  accountIds: readonly string[],
): string | null {
  let best: string | null = null;
  let bestAccount: string | null = null;
  for (const id of accountIds) {
    const raw = byAccount?.[id];
    const iso = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (!iso) continue;
    if (!best || iso < best || (iso === best && id < (bestAccount || ""))) {
      best = iso;
      bestAccount = id;
    }
  }
  return bestAccount;
}

/**
 * Canonical owner priority (ASIN only):
 * 1) Unpaused Ads-sponsored overlap for that ASIN
 * 2) Live helper / sticky account whose catalog includes the ASIN
 * 3) Earliest Ads proof / earliest titles.updated_at tie-break
 */
export function pickCanonicalOwner(opts: {
  asin: string;
  holderAccountIds: readonly string[];
  /** Holders with an unpaused Ads join whose product_ads sponsor this ASIN. */
  adsOverlapAccountIds?: readonly string[];
  /** Earliest unpaused link created_at (ISO) per account among Ads-overlapping holders. */
  earliestAdsProofByAccountId?: Record<string, string | null | undefined>;
  /** Helper sticky / resolveSessionAccount winner when live catalog included this ASIN. */
  liveHelperAccountId?: string | null;
  /** kdp_titles.updated_at (ISO) per holder for this ASIN. */
  titleUpdatedAtByAccountId?: Record<string, string | null | undefined>;
}): { canonicalAccountId: string; rule: QuarantineRule } | null {
  const holders = [
    ...new Set(
      opts.holderAccountIds.map((id) => String(id || "").trim()).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  if (!holders.length) return null;

  const adsOverlap = [
    ...new Set(
      (opts.adsOverlapAccountIds ?? [])
        .map((id) => String(id || "").trim())
        .filter((id) => holders.includes(id)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  if (adsOverlap.length) {
    const byProof = earliestIso(opts.earliestAdsProofByAccountId, adsOverlap);
    if (byProof) return { canonicalAccountId: byProof, rule: "ads_overlap" };
    const byUpdated = earliestIso(opts.titleUpdatedAtByAccountId, adsOverlap);
    if (byUpdated) return { canonicalAccountId: byUpdated, rule: "ads_overlap" };
    return { canonicalAccountId: adsOverlap[0], rule: "ads_overlap" };
  }

  const live = String(opts.liveHelperAccountId || "").trim();
  if (live && holders.includes(live)) {
    return { canonicalAccountId: live, rule: "live_helper" };
  }

  const byProofAny = earliestIso(opts.earliestAdsProofByAccountId, holders);
  if (byProofAny) return { canonicalAccountId: byProofAny, rule: "first_ads_proof" };
  const byUpdated = earliestIso(opts.titleUpdatedAtByAccountId, holders);
  if (byUpdated) return { canonicalAccountId: byUpdated, rule: "first_ads_proof" };
  return { canonicalAccountId: holders[0], rule: "first_ads_proof" };
}

export function buildQuarantineEntries(opts: {
  titles: readonly TitleAsinRow[];
  adsOverlapByAsin?: Record<string, readonly string[]>;
  earliestAdsProofByAccountId?: Record<string, string | null | undefined>;
  liveHelperAccountId?: string | null;
  liveHelperCatalogAsins?: readonly string[];
  nowIso?: string;
}): QuarantineEntry[] {
  const duplicates = detectCrossAccountAsins(opts.titles);
  if (!duplicates.size) return [];

  const liveId = String(opts.liveHelperAccountId || "").trim() || null;
  const liveCatalog = new Set(uniqueNormalizedAsins(opts.liveHelperCatalogAsins ?? []));

  const updatedAtByAsinAccount = new Map<string, string>();
  for (const row of opts.titles) {
    const asin = normalizeAsin(row.asin);
    const accountId = String(row.account_id || "").trim();
    if (!asin || !accountId) continue;
    const iso = typeof row.updated_at === "string" ? row.updated_at.trim() : "";
    if (!iso) continue;
    const key = quarantinePairKey(accountId, asin);
    const prev = updatedAtByAsinAccount.get(key);
    if (!prev || iso < prev) updatedAtByAsinAccount.set(key, iso);
  }

  const entries: QuarantineEntry[] = [];
  for (const [asin, holders] of [...duplicates.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const titleUpdatedAtByAccountId: Record<string, string | undefined> = {};
    for (const accountId of holders) {
      const iso = updatedAtByAsinAccount.get(quarantinePairKey(accountId, asin));
      if (iso) titleUpdatedAtByAccountId[accountId] = iso;
    }

    const catalogProvided = (opts.liveHelperCatalogAsins?.length ?? 0) > 0;
    const liveHelperForAsin =
      liveId && holders.includes(liveId) && (!catalogProvided || liveCatalog.has(asin))
        ? liveId
        : null;

    const picked = pickCanonicalOwner({
      asin,
      holderAccountIds: holders,
      adsOverlapAccountIds: opts.adsOverlapByAsin?.[asin] ?? [],
      earliestAdsProofByAccountId: opts.earliestAdsProofByAccountId,
      liveHelperAccountId: liveHelperForAsin,
      titleUpdatedAtByAccountId,
    });
    if (!picked) continue;

    for (const accountId of holders) {
      if (accountId === picked.canonicalAccountId) continue;
      entries.push({
        account_id: accountId,
        asin,
        canonical_account_id: picked.canonicalAccountId,
        reason: "cross_account_duplicate",
        rule: picked.rule,
      });
    }
  }

  return entries.sort(
    (a, b) =>
      a.asin.localeCompare(b.asin) ||
      a.account_id.localeCompare(b.account_id) ||
      a.canonical_account_id.localeCompare(b.canonical_account_id),
  );
}

export function makeQuarantineDoc(
  entries: readonly QuarantineEntry[],
  nowIso = new Date().toISOString(),
): QuarantineDoc {
  return {
    version: 1,
    updated_at: nowIso,
    entries: [...entries],
  };
}

export function parseQuarantineDoc(raw: unknown): QuarantineDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const version = Number(obj.version);
  if (version !== 1) return null;
  const entriesRaw = Array.isArray(obj.entries) ? obj.entries : [];
  const entries: QuarantineEntry[] = [];
  for (const item of entriesRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const account_id = String(row.account_id || "").trim();
    const asin = normalizeAsin(row.asin);
    const canonical_account_id = String(row.canonical_account_id || "").trim();
    const reason = row.reason === "cross_account_duplicate" ? row.reason : null;
    const rule =
      row.rule === "ads_overlap" || row.rule === "live_helper" || row.rule === "first_ads_proof"
        ? row.rule
        : null;
    if (!account_id || !asin || !canonical_account_id || !reason || !rule) continue;
    entries.push({ account_id, asin, canonical_account_id, reason, rule });
  }
  const updated_at =
    typeof obj.updated_at === "string" && obj.updated_at.trim()
      ? obj.updated_at.trim()
      : new Date(0).toISOString();
  return { version: 1, updated_at, entries };
}

/** Stable comparison ignoring updated_at (for idempotent writes). */
export function quarantineEntriesEqual(
  a: readonly QuarantineEntry[],
  b: readonly QuarantineEntry[],
): boolean {
  if (a.length !== b.length) return false;
  const norm = (entries: readonly QuarantineEntry[]) =>
    [...entries]
      .map(
        (e) =>
          `${e.account_id}|${normalizeAsin(e.asin) || e.asin}|${e.canonical_account_id}|${e.reason}|${e.rule}`,
      )
      .sort((x, y) => x.localeCompare(y));
  const left = norm(a);
  const right = norm(b);
  return left.every((v, i) => v === right[i]);
}

export function filterRowsExcludingQuarantine<T extends { account_id?: unknown; asin?: unknown }>(
  rows: readonly T[],
  entries: readonly QuarantineEntry[],
): T[] {
  if (!entries.length) return [...rows];
  const blocked = new Set(
    entries.map((e) => quarantinePairKey(e.account_id, e.asin)),
  );
  return rows.filter((row) => {
    const accountId = String(row.account_id ?? "").trim();
    const asin = normalizeAsin(row.asin) || String(row.asin ?? "").trim().toUpperCase();
    if (!accountId || !asin) return true;
    return !blocked.has(quarantinePairKey(accountId, asin));
  });
}

/** Account ids whose every catalog ASIN is quarantined (no native titles left). */
export function fullyQuarantinedAccountIds(opts: {
  titles: readonly TitleAsinRow[];
  entries: readonly QuarantineEntry[];
  /** Never pause these (e.g. canonical / live helper). */
  protectAccountIds?: readonly string[];
}): string[] {
  const protect = new Set(
    (opts.protectAccountIds ?? []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  const byAccount = new Map<string, Set<string>>();
  for (const row of opts.titles) {
    const accountId = String(row.account_id || "").trim();
    const asin = normalizeAsin(row.asin);
    if (!accountId || !asin) continue;
    let set = byAccount.get(accountId);
    if (!set) {
      set = new Set();
      byAccount.set(accountId, set);
    }
    set.add(asin);
  }
  const out: string[] = [];
  for (const [accountId, asins] of byAccount) {
    if (protect.has(accountId) || !asins.size) continue;
    let allQuarantined = true;
    for (const asin of asins) {
      if (!isQuarantined(accountId, asin, opts.entries)) {
        allQuarantined = false;
        break;
      }
    }
    if (allQuarantined) out.push(accountId);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Aggregate book-daily rows into account-day shape for Overview merge. */
export function aggregateBookDailyToAccountDays(
  rows: readonly {
    account_id?: unknown;
    date?: unknown;
    asin?: unknown;
    royalties?: unknown;
    orders?: unknown;
  }[],
): { account_id: string; date: string; royalties: number; orders: number }[] {
  const map = new Map<string, { account_id: string; date: string; royalties: number; orders: number }>();
  for (const row of rows) {
    const account_id = String(row.account_id ?? "").trim();
    const date = typeof row.date === "string" ? row.date : "";
    if (!account_id || !date) continue;
    const key = `${account_id}:${date}`;
    const current = map.get(key) ?? { account_id, date, royalties: 0, orders: 0 };
    const roy = Number(row.royalties);
    const ord = Number(row.orders);
    current.royalties += Number.isFinite(roy) ? roy : 0;
    current.orders += Number.isFinite(ord) ? ord : 0;
    map.set(key, current);
  }
  return [...map.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.account_id.localeCompare(b.account_id),
  );
}

export function accountIdsHitByQuarantine(
  accountIds: readonly string[],
  entries: readonly QuarantineEntry[],
): string[] {
  const wanted = new Set(accountIds.map((id) => String(id || "").trim()).filter(Boolean));
  const hit = new Set<string>();
  for (const e of entries) {
    const id = String(e.account_id || "").trim();
    if (id && wanted.has(id)) hit.add(id);
  }
  return [...hit].sort((a, b) => a.localeCompare(b));
}
