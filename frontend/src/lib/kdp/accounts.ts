import { fetchKdpAccounts, type KdpAccountSummary } from "../mutations.ts";
import { supabase } from "../supabase.ts";

type OwnedAccount = { id: string; name: string };

/**
 * Resolve only this user's KDP import destination. Ads selection is not proof
 * that the signed-in Amazon catalog belongs to a particular Ads profile.
 * Profile links are created by the server's ASIN-proven auto-link after capture.
 */
export async function resolveHelperAccountId(opts: {
  userId: string;
  profileIds: string[];
}): Promise<{ accountId: string; name: string }> {
  const userId = String(opts.userId || "").trim();
  if (!userId) throw new Error("Sign in to InteliAds before setting up the KDP helper.");
  const profileIds = [...new Set(opts.profileIds.map((id) => String(id || "").trim()).filter(Boolean))];

  // A failed ownership read is unknown, never an empty catalog that authorizes
  // a duplicate account or another user's bridge destination.
  const ownedRows = await loadOwnedAccounts(userId);
  const ownedIds = new Set(ownedRows.map((row) => row.id));
  const nestAccounts = (await loadNestAccounts()).filter((row) => ownedIds.has(row.id));
  const nameFor = (id: string) => nestNameFor(nestAccounts, id)
    || ownedRows.find((row) => row.id === id)?.name || "KDP";
  const choose = (ids: string[]) => {
    if (ids.length > 1) throw chooseAccountError();
    return ids[0] ? { accountId: ids[0], name: nameFor(ids[0]) } : null;
  };

  if (profileIds.length) {
    const linked = choose(await findLinkedAccountIds(profileIds, ownedIds));
    if (linked) return linked;

    const { data: legacy, error } = await supabase.from("kdp_accounts")
      .select("id, name").eq("user_id", userId).in("amazon_profile_id", profileIds);
    if (error) throw error;
    const legacyMatch = choose([...new Set((legacy ?? []).map((row) => String(row.id || ""))
      .filter((id) => ownedIds.has(id)))]);
    if (legacyMatch) return legacyMatch;
  }

  const nestMatch = choose(nestAccounts.filter((row) =>
    (row.linked_amazon_profile_ids ?? []).some((id) => profileIds.includes(id)),
  ).map((row) => row.id));
  if (nestMatch) return nestMatch;
  const soleOwned = choose(ownedRows.map((row) => row.id));
  if (soleOwned) return soleOwned;

  // Destination creation is separate from Ads attribution; no bridge writes
  // occur until the server sees a captured catalog with unambiguous ASIN proof.
  const { data: created, error } = await supabase.from("kdp_accounts")
    .insert({ user_id: userId, name: "KDP" }).select("id, name").single();
  if (error || !created?.id) throw new Error(error?.message || "Could not create a KDP account");
  return { accountId: String(created.id), name: String(created.name || "KDP") };
}

/** True only for an active bridge to one of the requested Ads profiles. */
export async function accountLinkedToProfiles(accountId: string, profileIds: string[]): Promise<boolean> {
  if (!accountId || !profileIds.length) return false;
  const { data, error } = await supabase.from("kdp_account_amazon_profiles")
    .select("amazon_profile_id, is_paused").eq("kdp_account_id", accountId)
    .in("amazon_profile_id", profileIds);
  if (error) throw error;
  return (data ?? []).some((row: { is_paused?: boolean }) => row.is_paused !== true);
}

function chooseAccountError(): Error {
  return new Error("Choose the KDP import account in iPhone KDP helper before syncing.");
}

async function loadOwnedAccounts(userId: string): Promise<OwnedAccount[]> {
  const rows: OwnedAccount[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("kdp_accounts").select("id, name")
      .eq("user_id", userId).order("id", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = String(row.id || "").trim();
      if (id) rows.push({ id, name: String(row.name || "").trim() });
    }
    if ((data ?? []).length < 1000) return rows;
  }
}

async function loadNestAccounts(): Promise<KdpAccountSummary[]> {
  try { return await fetchKdpAccounts(); } catch { return []; }
}

function nestNameFor(accounts: KdpAccountSummary[], id: string): string | null {
  return accounts.find((account) => account.id === id)?.name?.trim() || null;
}

async function findLinkedAccountIds(profileIds: string[], ownedIds: Set<string>): Promise<string[]> {
  const { data, error } = await supabase.from("kdp_account_amazon_profiles")
    .select("kdp_account_id, amazon_profile_id, is_paused").in("amazon_profile_id", profileIds);
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = String(row.kdp_account_id || "").trim();
    if (row.is_paused !== true && ownedIds.has(id)) ids.add(id);
  }
  return [...ids];
}
