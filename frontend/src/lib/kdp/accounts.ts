import { supabase } from "../supabase.ts";

/**
 * Resolve the KDP account the iPhone helper writes to.
 * Prefers an already-linked account for the selected Amazon profiles so
 * Books / Overview keep reading the same rows the Chrome helper uses.
 */
export async function resolveHelperAccountId(opts: {
  userId: string;
  profileIds: string[];
}): Promise<string> {
  const { userId, profileIds } = opts;

  if (profileIds.length > 0) {
    const { data: links } = await supabase
      .from("kdp_account_amazon_profiles")
      .select("kdp_account_id, is_paused")
      .in("amazon_profile_id", profileIds);
    const linked = (links ?? [])
      .filter((row: { is_paused?: boolean }) => row.is_paused !== true)
      .map((row: { kdp_account_id?: string }) => String(row.kdp_account_id || ""))
      .filter(Boolean);
    if (linked[0]) return linked[0];

    const { data: legacy } = await supabase
      .from("kdp_accounts")
      .select("id")
      .in("amazon_profile_id", profileIds)
      .limit(1);
    if (legacy?.[0]?.id) return String(legacy[0].id);
  }

  const { data: owned } = await supabase
    .from("kdp_accounts")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (owned?.[0]?.id) {
    const id = String(owned[0].id);
    await linkAccountToProfiles(id, profileIds);
    return id;
  }

  const { data: created, error } = await supabase
    .from("kdp_accounts")
    .insert({ user_id: userId, name: "iPhone" })
    .select("id")
    .single();
  if (error || !created?.id) {
    throw new Error(error?.message || "Could not create a KDP account");
  }
  const id = String(created.id);
  await linkAccountToProfiles(id, profileIds);
  return id;
}

async function linkAccountToProfiles(accountId: string, profileIds: string[]) {
  if (!profileIds.length) return;
  for (const profileId of profileIds) {
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
