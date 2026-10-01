import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { BookCover } from "@/src/components/BookCover";
import { EmptyState, RetryState, SecondaryButton } from "@/src/components/Primitives";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { countryFlagEmoji, profileDisplayName } from "@/src/lib/accountsUi";
import { fetchKdpAccountBooks } from "@/src/lib/kdp/linkPreview";
import { splitKdpAndAdsBooks } from "@/src/lib/kdpManager";
import {
  deleteKdpBook,
  fetchAmazonProfileBooks,
  fetchKdpAccounts,
  updateKdpAccountName,
  type KdpAccountSummary,
} from "@/src/lib/mutations";
import { useTheme } from "@/src/lib/theme";

export default function KdpManagerScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string | string[] }>();
  const queryClient = useQueryClient();
  const { profiles } = useApp();
  const [selectedAccount, setSelectedAccount] = useState<KdpAccountSummary | null>(null);
  const initialAccountHandled = useRef(false);

  const accountsQ = useQuery({
    queryKey: ["kdp-manager-accounts"],
    queryFn: fetchKdpAccounts,
    staleTime: 30_000,
  });
  const requestedAccountId = Array.isArray(params.accountId) ? params.accountId[0] : params.accountId;

  useEffect(() => {
    if (initialAccountHandled.current || !requestedAccountId || !accountsQ.data) return;
    initialAccountHandled.current = true;
    const account = accountsQ.data.find((row) => row.id === requestedAccountId);
    if (account) setSelectedAccount(account);
  }, [accountsQ.data, requestedAccountId]);
  const booksQ = useQuery({
    queryKey: ["kdp-manager-books", selectedAccount?.id],
    enabled: !!selectedAccount,
    staleTime: 30_000,
    queryFn: async () => {
      if (!selectedAccount) return { kdpBooks: [], advertisedOnly: [] };
      const linked = selectedAccount.linked_amazon_profile_ids ?? [];
      const [kdpBooks, adsGroups] = await Promise.all([
        fetchKdpAccountBooks(selectedAccount.id),
        Promise.all(linked.map(async (profileId) => ({
          profileId,
          books: await fetchAmazonProfileBooks(profileId),
        }))),
      ]);
      return splitKdpAndAdsBooks(kdpBooks, adsGroups);
    },
  });

  const overlapsQ = useQuery({
    queryKey: ["kdp-manager-overlaps", selectedAccount?.id, accountsQ.data?.map((row) => row.id).join(",")],
    enabled: !!selectedAccount && !!accountsQ.data?.length,
    staleTime: 30_000,
    queryFn: async () => {
      if (!selectedAccount || !accountsQ.data) return new Map<string, string[]>();
      const catalogs = await Promise.all(accountsQ.data.map(async (account) => ({
        account,
        books: await fetchKdpAccountBooks(account.id),
      })));
      const owners = new Map<string, string[]>();
      for (const { account, books } of catalogs) {
        for (const book of books) {
          const asin = String(book.asin || "").trim().toUpperCase();
          if (!asin) continue;
          owners.set(asin, [...(owners.get(asin) ?? []), account.name || "KDP account"]);
        }
      }
      return new Map([...owners].filter(([, names]) => names.length > 1));
    },
  });

  const linkedProfiles = useMemo(() => {
    const linked = new Set((selectedAccount?.linked_amazon_profile_ids ?? []).map(String));
    return profiles.filter((profile) => linked.has(String(profile.id)) || linked.has(String(profile.profile_id)));
  }, [profiles, selectedAccount]);

  const renameMutation = useMutation({
    mutationFn: ({ accountId, name }: { accountId: string; name: string }) => updateKdpAccountName(accountId, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kdp-manager-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["profile-picker-kdp-accounts"] });
    },
    onError: (error) => Alert.alert("Rename failed", error instanceof Error ? error.message : "Couldn't rename KDP account."),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ accountId, asin }: { accountId: string; asin: string }) => deleteKdpBook(accountId, asin),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kdp-manager-books"] }),
        queryClient.invalidateQueries({ queryKey: ["kdp-manager-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-picker-kdp-books"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-picker-kdp-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["kdp"] }),
      ]);
    },
    onError: (error) => Alert.alert("Delete failed", error instanceof Error ? error.message : "Couldn't delete the KDP book."),
  });

  function rename(account: KdpAccountSummary) {
    if (Platform.OS !== "ios") return;
    Alert.prompt("Rename KDP account", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (value?: string) => {
          const name = String(value || "").trim();
          if (name && name !== account.name) renameMutation.mutate({ accountId: account.id, name });
        },
      },
    ], "plain-text", account.name);
  }

  function confirmDelete(accountId: string, asin: string, title: string) {
    Alert.alert(
      "Delete KDP book data?",
      `${title}\n\nThis removes the currently imported data for ${asin}: KDP pricing, royalties, orders, and KENP history. A later full KDP sync can import the book again. Amazon Ads campaigns and products stay unchanged.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate({ accountId, asin }) },
      ],
    );
  }

  if (selectedAccount) {
    return (
      <SubScreen title={selectedAccount.name || "KDP books"}>
        <ScrollView contentContainerStyle={styles.content}>
          <SecondaryButton label="All KDP accounts" onPress={() => setSelectedAccount(null)} full />
          <View style={[styles.accountSummary, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.separator }]}>
            <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Linked marketplaces</Text>
            <View style={styles.chips}>
              {linkedProfiles.length ? linkedProfiles.map((profile) => (
                <View key={profile.id || profile.profile_id} style={[styles.chip, { backgroundColor: t.colors.tone_primary + "14" }]}>
                  <Text style={[t.typography.caption1, { color: t.colors.text_primary }]}>
                    {countryFlagEmoji(profile.country_code)} {profileDisplayName(profile)}
                  </Text>
                </View>
              )) : <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>No Ads marketplace linked</Text>}
            </View>
            <SecondaryButton label="Manage links" onPress={() => router.push("/more/accounts" as Href)} full />
          </View>

          {booksQ.isLoading ? <ActivityIndicator color={t.colors.tone_primary} style={{ marginTop: 32 }} /> :
            booksQ.isError ? <RetryState title="Couldn't load books" onRetry={() => void booksQ.refetch()} retrying={booksQ.isFetching} /> :
            (booksQ.data?.kdpBooks ?? []).length ? <>
              <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>KDP catalog</Text>
              {(booksQ.data?.kdpBooks ?? []).map((book) => {
              const adProfiles = book.adsProfileIds.map((id) => profiles.find((p) => p.id === id || p.profile_id === id)).filter(Boolean);
              const deleting = deleteMutation.isPending && deleteMutation.variables?.asin === book.asin;
              const overlappingAccounts = overlapsQ.data?.get(book.asin) ?? [];
              return (
                <View key={book.asin} testID={`kdp-manager-book-${book.asin}`} style={[styles.bookRow, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.separator }]}>
                  <Pressable
                    testID={`open-kdp-book-${book.asin}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${book.title || book.asin}`}
                    accessibilityHint="Opens book details"
                    onPress={() => router.push({
                      pathname: "/product/[asin]",
                      params: {
                        asin: book.asin,
                        title: book.title || "",
                        imageUrl: book.coverUrl || "",
                      },
                    })}
                    style={styles.bookOpen}
                  >
                    <BookCover uri={book.coverUrl} asin={book.asin} size="sm" recyclingKey={book.asin} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[t.typography.body, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={2}>{book.title || book.asin}</Text>
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>{book.asin}</Text>
                      <View style={[styles.chips, { marginTop: 6 }]}>
                        {book.inKdp ? <View style={[styles.chip, { backgroundColor: t.colors.tone_good + "18" }]}><Text style={[t.typography.caption2, { color: t.colors.tone_good }]}>KDP</Text></View> : null}
                        {overlappingAccounts.length > 1 ? <View style={[styles.chip, { backgroundColor: t.colors.tone_danger + "18" }]}><Text style={[t.typography.caption2, { color: t.colors.tone_danger }]}>Also stored in {overlappingAccounts.filter((name) => name !== selectedAccount.name).join(", ")}</Text></View> : null}
                        {adProfiles.map((profile) => profile ? (
                          <View key={profile.id || profile.profile_id} style={[styles.chip, { backgroundColor: t.colors.tone_primary + "14" }]}>
                            <Text style={[t.typography.caption2, { color: t.colors.text_primary }]}>{countryFlagEmoji(profile.country_code)} {profileDisplayName(profile)}</Text>
                          </View>
                        ) : null)}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={t.colors.text_tertiary} />
                  </Pressable>
                  {book.inKdp ? (
                    <TouchableOpacity
                      testID={`delete-kdp-book-${book.asin}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${book.title || book.asin} KDP data`}
                      disabled={deleteMutation.isPending}
                      onPress={() => confirmDelete(selectedAccount.id, book.asin, book.title || book.asin)}
                      style={styles.deleteButton}
                    >
                      {deleting ? <ActivityIndicator size="small" color={t.colors.tone_danger} /> : <Ionicons name="trash-outline" size={19} color={t.colors.tone_danger} />}
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
              })}
            </> : <EmptyState title="No KDP books" subtitle="The next completed KDP import will populate this account." />}

          {(booksQ.data?.advertisedOnly ?? []).length ? <View style={styles.section}>
            <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Advertised in linked marketplaces</Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>These products belong to linked Ads profiles and are not stored in this KDP catalog.</Text>
            {(booksQ.data?.advertisedOnly ?? []).map((book) => {
              const adProfiles = book.adsProfileIds.map((id) => profiles.find((p) => p.id === id || p.profile_id === id)).filter(Boolean);
              return <Pressable
                key={`ads-${book.asin}`}
                testID={`kdp-manager-advertised-book-${book.asin}`}
                onPress={() => router.push({ pathname: "/product/[asin]", params: { asin: book.asin, title: book.title || "", imageUrl: book.coverUrl || "" } })}
                style={[styles.bookRow, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.separator }]}
              >
                <BookCover uri={book.coverUrl} asin={book.asin} size="sm" recyclingKey={`ads-${book.asin}`} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.typography.body, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={2}>{book.title || book.asin}</Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>{book.asin}</Text>
                  <View style={[styles.chips, { marginTop: 6 }]}>{adProfiles.map((profile) => profile ? <View key={profile.id || profile.profile_id} style={[styles.chip, { backgroundColor: t.colors.tone_primary + "14" }]}><Text style={[t.typography.caption2, { color: t.colors.text_primary }]}>{countryFlagEmoji(profile.country_code)} {profileDisplayName(profile)}</Text></View> : null)}</View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.colors.text_tertiary} />
              </Pressable>;
            })}
          </View> : null}
        </ScrollView>
      </SubScreen>
    );
  }

  return (
    <SubScreen title="KDP Manager">
      <ScrollView contentContainerStyle={styles.content}>
        {accountsQ.isLoading ? <ActivityIndicator color={t.colors.tone_primary} style={{ marginTop: 32 }} /> :
          accountsQ.isError ? <RetryState title="Couldn't load KDP accounts" onRetry={() => void accountsQ.refetch()} retrying={accountsQ.isFetching} /> :
          (accountsQ.data ?? []).length ? (accountsQ.data ?? []).map((account) => {
            const linked = new Set((account.linked_amazon_profile_ids ?? []).map(String));
            const markets = profiles.filter((p) => linked.has(String(p.id)) || linked.has(String(p.profile_id)));
            return (
              <Pressable key={account.id} testID={`kdp-manager-account-${account.id}`} onPress={() => setSelectedAccount(account)} style={[styles.accountCard, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.separator }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>{account.name || "KDP account"}</Text>
                  <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 3 }]}>{account.book_count ?? 0} books · {markets.length} Ads marketplace{markets.length === 1 ? "" : "s"}</Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 5 }]} numberOfLines={2}>
                    {markets.length ? markets.map((p) => `${countryFlagEmoji(p.country_code)} ${profileDisplayName(p)}`).join("  ·  ") : "No linked Ads marketplace"}
                  </Text>
                </View>
                <TouchableOpacity testID={`rename-kdp-manager-${account.id}`} onPress={(event) => { event.stopPropagation(); rename(account); }} hitSlop={10} style={styles.editButton}>
                  <Ionicons name="pencil" size={18} color={t.colors.tone_primary} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={18} color={t.colors.text_tertiary} />
              </Pressable>
            );
          }) : <EmptyState title="No KDP accounts" subtitle="Import KDP once from the Chrome extension or iPhone helper." />}
      </ScrollView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  accountCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  accountSummary: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 16, gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  editButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  bookRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  bookOpen: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  deleteButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  section: { gap: 10, marginTop: 10 },
});
