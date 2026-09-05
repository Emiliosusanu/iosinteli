import { fetchKdpAccounts, type KdpAccountSummary } from "../mutations.ts";
import { supabase } from "../supabase.ts";

/**
 * Resolve the KDP account the iPhone helper writes to.
 *
 * Safety rules (wrong-profile attribution):
 * 1. Prefer an account already linked to the selected Amazon Ads profiles.
 * 2. Prefer Nest/web account names (never invent a parallel "iPhone" row when
 *    the dashboard already has the account).
 * 3. Never auto-link a profile that already belongs to a different KDP account.
 * 4. Only create a local row as last resort, named from Nest when possible.
 */
export async function resolveHelperAccountId(opts: {
  userId: string;
  profileIds: string[];
}): Promise<{ accountId: string; name: string }> {
  const { userId, profileIds } = opts;
  const nestAccounts = await loadNestAccounts();

  if (profileIds.length > 0) {
    const linked = await findLinkedAccountIds(profileIds);
    if (linked[0]) {
      const id = linked[0];
      return { accountId: id, name: nestNameFor(nestAccounts, id) || (await localAccountName(id)) || "KDP" };
    }

    const { data: legacy } = await supabase
      .from("kdp_accounts")
      .select("id, name")
      .in("amazon_profile_id", profileIds)
      .limit(1);
    if (legacy?.[0]?.id) {
      const id = String(legacy[0].id);
      return {
        accountId: id,
        name: String(legacy[0].name || nestNameFor(nestAccounts, id) || "KDP"),
      };
    }
  }

  // Prefer a Nest/web account that already lists some of these profiles.
  const nestMatch = nestAccounts.find((a) =>
    (a.linked_amazon_profile_ids ?? []).some((pid) => profileIds.includes(pid)),
  );
  if (nestMatch?.id) {
    await linkAccountToProfilesSafe(nestMatch.id, profileIds);
    return { accountId: nestMatch.id, name: nestMatch.name || "KDP" };
  }

  // Owned Supabase rows (Chrome may have created them before Nest cache is warm).
  const { data: owned } = await supabase
    .from("kdp_accounts")
    .select("id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const ownedRows = owned ?? [];
  if (ownedRows[0]?.id) {
    const id = String(ownedRows[0].id);
    const name =
      nestNameFor(nestAccounts, id) ||
      String(ownedRows[0].name || "").trim() ||
      nestAccounts[0]?.name ||
      "KDP";
    if (name && name !== ownedRows[0].name) {
      await supabase.from("kdp_accounts").update({ name }).eq("id", id);
    }
    await linkAccountToProfilesSafe(id, profileIds);
    return { accountId: id, name };
  }

  // Last resort: create one row, preferring the Nest display name.
  const name =
    nestAccounts[0]?.name?.trim() ||
    (profileIds.length === 1 ? "KDP" : "KDP (iPhone)");
  if (nestAccounts[0]?.id) {
    // Nest knows an account we couldn't read via RLS — use that id if present in DB.
    const nestId = nestAccounts[0].id;
    const { data: exists } = await supabase.from("kdp_accounts").select("id").eq("id", nestId).maybeSingle();
    if (exists?.id) {
      await linkAccountToProfilesSafe(nestId, profileIds);
      return { accountId: nestId, name: nestAccounts[0].name || name };
    }
  }

  const { data: created, error } = await supabase
    .from("kdp_accounts")
    .insert({ user_id: userId, name })
    .select("id, name")
    .single();
  if (error || !created?.id) {
    throw new Error(error?.message || "Could not create a KDP account");
  }
  const id = String(created.id);
  await linkAccountToProfilesSafe(id, profileIds);
  return { accountId: id, name: String(created.name || name) };
}

/** True when this KDP account is linked to at least one of the selected Ads profiles. */
export async function accountLinkedToProfiles(
  accountId: string,
  profileIds: string[],
): Promise<boolean> {
  if (!accountId || !profileIds.length) return false;
  const { data } = await supabase
    .from("kdp_account_amazon_profiles")
    .select("amazon_profile_id, is_paused")
    .eq("kdp_account_id", accountId)
    .in("amazon_profile_id", profileIds);
  return (data ?? []).some((row: { is_paused?: boolean }) => row.is_paused !== true);
}

async function loadNestAccounts(): Promise<KdpAccountSummary[]> {
  try {
    return await fetchKdpAccounts();
  } catch {
    return [];
  }
}

function nestNameFor(accounts: KdpAccountSummary[], id: string): string | null {
  const hit = accounts.find((a) => a.id === id);
  const name = hit?.name?.trim();
  return name || null;
}

async function localAccountName(accountId: string): Promise<string | null> {
  const { data } = await supabase.from("kdp_accounts").select("name").eq("id", accountId).maybeSingle();
  const name = data?.name ? String(data.name).trim() : "";
  return name || null;
}

async function findLinkedAccountIds(profileIds: string[]): Promise<string[]> {
  const { data: links } = await supabase
    .from("kdp_account_amazon_profiles")
    .select("kdp_account_id, amazon_profile_id, is_paused")
    .in("amazon_profile_id", profileIds);
  const counts = new Map<string, number>();
  for (const row of links ?? []) {
    if ((row as { is_paused?: boolean }).is_paused === true) continue;
    const id = String((row as { kdp_account_id?: string }).kdp_account_id || "");
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * Link only profiles that are not already bound to a different KDP account.
 * Prevents attributing royalties to the wrong Ads profile.
 */
async function linkAccountToProfilesSafe(accountId: string, profileIds: string[]) {
  if (!profileIds.length) return;
  const { data: existing } = await supabase
    .from("kdp_account_amazon_profiles")
    .select("kdp_account_id, amazon_profile_id, is_paused")
    .in("amazon_profile_id", profileIds);

  const takenByOther = new Set<string>();
  for (const row of existing ?? []) {
    const pid = String((row as { amazon_profile_id?: string }).amazon_profile_id || "");
    const kid = String((row as { kdp_account_id?: string }).kdp_account_id || "");
    if (!pid || !kid) continue;
    if (kid !== accountId && (row as { is_paused?: boolean }).is_paused !== true) {
      takenByOther.add(pid);
    }
  }

  for (const profileId of profileIds) {
    if (takenByOther.has(profileId)) continue;
    try {
      await supabase.from("kdp_account_amazon_profiles").upsert(
        {
          kdp_account_id: accountId,
          amazon_profile_id: profileId,
          is_paused: false,
        },
        { onConflict: "kdp_account_id,amazon_profile_id" },
      );
    } catch {
      /* link table may use a different constraint; account write still proceeds */
    }
  }
}
