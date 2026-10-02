import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import {
  EmptyState,
  PrimaryButton,
  RetryState,
  ScreenSpinner,
  SectionCard,
} from "@/src/components/Primitives";
import { AdGroupSuggestionControls } from "@/src/components/AdGroupSuggestionControls";
import { AmazonKeywordSuggestionRow } from "@/src/components/AmazonKeywordSuggestionRow";
import { AmazonProductSuggestionRow } from "@/src/components/AmazonProductSuggestionRow";
import { IOSSegmentedControl } from "@/src/components/ios/Native";
import { alertMutationError, blockIfCannotWriteAmazon } from "@/src/components/Mutations";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useProductSuggestionAsinMeta } from "@/src/hooks/useProductSuggestionAsinMeta";
import { countryCodeForProfile } from "@/src/lib/bookMarketplaces";
import { layout, radii, spacing, useTheme } from "@/src/lib/theme";
import {
  fetchAdGroupById,
  fetchCampaignAdvertisedAsin,
  fetchCampaignById,
  fetchKeywords,
  fetchProductTargets,
} from "@/src/lib/queries";
import {
  addAdGroupKeywords,
  addAdGroupProductTargets,
  fetchAdGroupSuggestions,
  fetchCampaignApi,
} from "@/src/lib/mutations";
import { parseCustomAsins } from "@/src/lib/campaignCreationStock";
import {
  clusterKeywordSuggestionsByPhrase,
  clusterProductSuggestionsByAsin,
  expandProductSuggestionsWithMatchTypes,
  formatKeywordSuggestionCountLabel,
  normalizeKeywordMatchType,
  normalizeProductMatchType,
  offerExpandedCompanionsForExactOnly,
  productMatchSelectLabel,
  recommendationBidMajorUnits,
  resolveSuggestionBid,
  selectedEligibleSuggestionIndexes,
  suggestionRelevanceNeedsUserConfirm,
  uniqueKeywordMatchTypes,
  uniqueProductMatchTypes,
  type BidMode,
} from "@/src/lib/amazonCampaignSuggestions";
import { SuggestionAiFilterChrome } from "@/src/components/SuggestionAiFilterChrome";
import {
  adGroupEditMode,
  keywordDedupeKey,
  parseCustomKeywords,
  prepareKeywordAdds,
  prepareProductTargetAdds,
  productTargetDedupeKey,
} from "@/src/lib/adGroupTargets";
import { useInvalidateAds } from "@/src/lib/invalidateAds";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function AddAdGroupTargetsScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidateAds = useInvalidateAds();
  const params = useLocalSearchParams<{
    id?: string;
    campaignId?: string;
    mode?: string;
    name?: string;
  }>();
  const adGroupId = param(params.id);
  const campaignIdParam = param(params.campaignId);
  const modeParam = param(params.mode);
  const nameParam = param(params.name);

  const {
    primaryCurrency,
    selectedProfileIds,
    profiles,
    adminFilterUserId,
    dateRange,
  } = useApp();
  const { user, guestMode } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const writeGuard = { guestMode, viewAsOtherUser };

  const adGroupsQ = useQuery({
    queryKey: ["ad-group-detail", adGroupId, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchAdGroupById(adGroupId, selectedProfileIds, {
        start: dateRange.start,
        end: dateRange.end,
      }),
    enabled: !!adGroupId && selectedProfileIds.length > 0,
  });
  const group = adGroupsQ.data ?? null;
  const campaignId = campaignIdParam || group?.campaign_id || "";

  const campaignQ = useQuery({
    queryKey: ["campaign-detail", campaignId],
    queryFn: () => fetchCampaignById(campaignId, selectedProfileIds, adminFilterUserId),
    enabled: !!campaignId && selectedProfileIds.length > 0,
  });
  const campaignApiQ = useQuery({
    queryKey: ["campaign-api", campaignId],
    queryFn: () => fetchCampaignApi(campaignId),
    enabled: !!campaignId,
  });
  const nestAsin = String(campaignApiQ.data?.primaryAsin ?? "").trim();
  const advertisedAsinQ = useQuery({
    queryKey: [
      "campaign-advertised-asin",
      campaignId,
      campaignQ.data?.amazon_profile_id ?? "",
      selectedProfileIds,
    ],
    queryFn: () => {
      const profileIds = [
        ...new Set(
          [campaignQ.data?.amazon_profile_id, ...selectedProfileIds]
            .map((id) => String(id || "").trim())
            .filter(Boolean),
        ),
      ];
      return fetchCampaignAdvertisedAsin(campaignId, profileIds);
    },
    enabled:
      !!campaignId &&
      selectedProfileIds.length > 0 &&
      !nestAsin &&
      !campaignApiQ.isLoading,
    staleTime: 60_000,
  });

  const inferredMode = adGroupEditMode(group?.targeting_type, group?.is_auto);
  const mode: "keywords" | "products" =
    modeParam === "products" || modeParam === "keywords"
      ? modeParam
      : inferredMode === "products"
        ? "products"
        : "keywords";

  const primaryAsin =
    (nestAsin || advertisedAsinQ.data || "").trim().toUpperCase() || null;
  const asinResolving =
    campaignApiQ.isLoading || advertisedAsinQ.isFetching || advertisedAsinQ.isLoading;
  const defaultBidAmount =
    group?.default_bid != null && Number(group.default_bid) >= 0.02
      ? Number(group.default_bid)
      : 0.75;

  const [useSuggestedBids, setUseSuggestedBids] = useState(true);
  const [customKeywordText, setCustomKeywordText] = useState("");
  const [customKeywordMatch, setCustomKeywordMatch] = useState<
    "broad" | "phrase" | "exact"
  >("exact");
  const [customAsinText, setCustomAsinText] = useState("");
  const [customProductMatch, setCustomProductMatch] = useState<"exact" | "expanded">(
    "exact",
  );
  const [selectedKeywords, setSelectedKeywords] = useState<Set<number>>(new Set());
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [keywordBidModes, setKeywordBidModes] = useState<Record<number, BidMode>>({});
  const [keywordCustomBids, setKeywordCustomBids] = useState<Record<number, string>>({});
  const [productBidModes, setProductBidModes] = useState<Record<number, BidMode>>({});
  const [productCustomBids, setProductCustomBids] = useState<Record<number, string>>({});
  const [matchTypeBidTexts, setMatchTypeBidTexts] = useState<
    Partial<Record<string, string>>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionMatch, setSuggestionMatch] = useState("all");
  const [visibleSuggestionCount, setVisibleSuggestionCount] = useState(50);

  const suggestionsProfileId = String(
    campaignQ.data?.amazon_profile_id ||
      group?.amazon_profile_id ||
      selectedProfileIds[0] ||
      "",
  ).trim();
  const suggestionsQueryKey = [
    "ad-group-suggestions",
    campaignId,
    mode,
    primaryAsin ?? "",
    suggestionsProfileId,
  ] as const;
  const suggestionsQ = useQuery({
    queryKey: suggestionsQueryKey,
    queryFn: () =>
      fetchAdGroupSuggestions({
        campaignId,
        targeting: mode,
        asin: primaryAsin || undefined,
        profileId: suggestionsProfileId || undefined,
        onAmazonReady: (partial) => {
          // Paint live Amazon phrase/row totals before Grok finishes.
          queryClient.setQueryData(suggestionsQueryKey, partial);
        },
      }),
    // Nest can resolve ASIN via product_ads / campaign_asin_links when client
    // primaryAsin is still empty. Paste keywords/ASINs still works without suggestions.
    enabled: !!campaignId && !guestMode && !asinResolving,
    // The fetcher already retries transient Amazon failures three times. Keep
    // one retry owner so throttling cannot multiply into nine endpoint calls.
    retry: false,
    staleTime: 60_000,
  });

  const showNoAdvertised =
    mode === "products" &&
    !primaryAsin &&
    !asinResolving &&
    !suggestionsQ.isLoading &&
    !suggestionsQ.isFetching &&
    !(suggestionsQ.data?.productTargets?.length);
  const asinResolveError =
    !primaryAsin && !asinResolving && (advertisedAsinQ.isError || campaignApiQ.isError);
  const suggestionsErrorNoAsin =
    mode === "products" &&
    !primaryAsin &&
    !asinResolving &&
    suggestionsQ.isError;

  const existingKeywordsQ = useQuery({
    queryKey: ["adgroup-keywords-existing", adGroupId],
    queryFn: () =>
      fetchKeywords(selectedProfileIds, {
        adGroupId,
        start: dateRange.start,
        end: dateRange.end,
      }),
    enabled: !!adGroupId && mode === "keywords" && selectedProfileIds.length > 0,
    staleTime: 30_000,
  });
  const existingProductsQ = useQuery({
    queryKey: ["adgroup-products-existing", adGroupId],
    queryFn: () =>
      fetchProductTargets(selectedProfileIds, {
        adGroupId,
        start: dateRange.start,
        end: dateRange.end,
      }),
    enabled: !!adGroupId && mode === "products" && selectedProfileIds.length > 0,
    staleTime: 30_000,
  });
  const existingKeywordKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of existingKeywordsQ.data ?? []) {
      keys.add(
        keywordDedupeKey(
          String(row.keyword_text ?? ""),
          normalizeKeywordMatchType(row.match_type ?? ""),
        ),
      );
    }
    return keys;
  }, [existingKeywordsQ.data]);
  const existingProductKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of existingProductsQ.data ?? []) {
      const asin = String((row as { asin?: string }).asin ?? "")
        .trim()
        .toUpperCase();
      const match = normalizeProductMatchType(
        (row as { match_type?: string; expression_type?: string }).match_type ??
          (row as { expression_type?: string }).expression_type ??
          "exact",
      );
      if (/^[A-Z0-9]{10}$/.test(asin)) keys.add(`${asin}::${match}`);
    }
    return keys;
  }, [existingProductsQ.data]);

  const keywordRows = useMemo(
    () => clusterKeywordSuggestionsByPhrase(suggestionsQ.data?.keywords ?? []),
    [suggestionsQ.data?.keywords],
  );
  const productRows = useMemo(
    () =>
      clusterProductSuggestionsByAsin(
        offerExpandedCompanionsForExactOnly(
          expandProductSuggestionsWithMatchTypes(
            (suggestionsQ.data?.productTargets ?? []).map((row) => ({
              ...row,
              matchType: row.matchType ?? "exact",
            })),
          ),
        ),
      ).filter((row) => /^[A-Z0-9]{10}$/.test(String(row.asin).toUpperCase())),
    [suggestionsQ.data?.productTargets],
  );
  const suggestionProfileIds = useMemo(() => {
    const ids = [
      campaignQ.data?.amazon_profile_id,
      group?.amazon_profile_id,
      ...selectedProfileIds,
    ]
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [campaignQ.data?.amazon_profile_id, group?.amazon_profile_id, selectedProfileIds]);
  const suggestionCountryCode = useMemo(() => {
    const fromSuggestions = String(
      suggestionsQ.data?.profile?.countryCode ?? "",
    )
      .trim()
      .toUpperCase();
    if (fromSuggestions) return fromSuggestions;
    return countryCodeForProfile(
      profiles,
      campaignQ.data?.amazon_profile_id ??
        group?.amazon_profile_id ??
        selectedProfileIds[0] ??
        null,
    );
  }, [
    suggestionsQ.data?.profile?.countryCode,
    profiles,
    campaignQ.data?.amazon_profile_id,
    group?.amazon_profile_id,
    selectedProfileIds,
  ]);
  const { metaByAsin: suggestionMetaByAsin, titlesLoading: suggestionTitlesLoading } =
    useProductSuggestionAsinMeta({
      productTargets: suggestionsQ.data?.productTargets ?? [],
      profileIds: suggestionProfileIds,
      countryCode: suggestionCountryCode,
      enabled: mode === "products" && !guestMode,
      visibleAsins: (suggestionsQ.data?.productTargets ?? [])
        .slice(0, visibleSuggestionCount)
        .map((row) => String(row.asin).toUpperCase()),
    });
  // Relevance: mutations already apply filterSuggestionsForBookRelevance
  // (default grok + keyword safety; onAmazonReady paints Amazon totals first).
  // Also hide identities already on this destination ad group.
  const availableKeywordRows = useMemo(
    () =>
      keywordRows
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) =>
            !existingKeywordKeys.has(
              keywordDedupeKey(String(row.keyword), String(row.matchType)),
            ),
        ),
    [keywordRows, existingKeywordKeys],
  );
  const availableProductRows = useMemo(
    () =>
      productRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => {
          const asin = String(row.asin ?? "")
            .trim()
            .toUpperCase();
          const match = normalizeProductMatchType(row.matchType ?? "exact");
          return !existingProductKeys.has(productTargetDedupeKey(asin, match));
        }),
    [productRows, existingProductKeys],
  );
  const filteredKeywordRows = useMemo(() => {
    const needle = suggestionQuery.trim().toLowerCase();
    return availableKeywordRows
      .filter(
        ({ row }) =>
          suggestionMatch === "all" ||
          normalizeKeywordMatchType(row.matchType) === suggestionMatch,
      )
      .filter(({ row }) => !needle || String(row.keyword).toLowerCase().includes(needle));
  }, [availableKeywordRows, suggestionMatch, suggestionQuery]);
  const filteredProductRows = useMemo(() => {
    const needle = suggestionQuery.trim().toLowerCase();
    return availableProductRows
      .filter(
        ({ row }) =>
          suggestionMatch === "all" ||
          normalizeProductMatchType(row.matchType) === suggestionMatch,
      )
      .filter(({ row }) => {
        if (!needle) return true;
        const meta = suggestionMetaByAsin[String(row.asin).toUpperCase()];
        const title = meta?.title ?? row.title ?? "";
        const subtitle = meta?.subtitle ?? row.subtitle ?? "";
        return `${row.asin} ${title} ${subtitle}`.toLowerCase().includes(needle);
      });
  }, [
    availableProductRows,
    suggestionMatch,
    suggestionQuery,
    suggestionMetaByAsin,
  ]);
  const filteredSuggestionRows = mode === "keywords" ? filteredKeywordRows : filteredProductRows;
  useEffect(() => {
    setSuggestionMatch("all");
    setSuggestionQuery("");
    setVisibleSuggestionCount(50);
  }, [mode]);
  useEffect(() => setVisibleSuggestionCount(50), [suggestionMatch, suggestionQuery]);
  const customKeywords = useMemo(
    () => parseCustomKeywords(customKeywordText),
    [customKeywordText],
  );
  const customAsins = useMemo(() => parseCustomAsins(customAsinText), [customAsinText]);

  const selectedKeywordIndexes = useMemo(
    () =>
      selectedEligibleSuggestionIndexes(
        selectedKeywords,
        availableKeywordRows.map(({ index }) => index),
      ),
    [selectedKeywords, availableKeywordRows],
  );
  const selectedProductIndexes = useMemo(
    () =>
      selectedEligibleSuggestionIndexes(
        selectedProducts,
        availableProductRows.map(({ index }) => index),
      ),
    [selectedProducts, availableProductRows],
  );
  const selectedCount = useMemo(() => {
    if (mode === "keywords") {
      const keys = new Set(
        selectedKeywordIndexes.map((index) => {
          const row = keywordRows[index];
          return keywordDedupeKey(row.keyword, row.matchType);
        }),
      );
      for (const keyword of customKeywords) {
        const key = keywordDedupeKey(keyword, customKeywordMatch);
        if (!existingKeywordKeys.has(key)) keys.add(key);
      }
      return keys.size;
    }
    const keys = new Set(
      selectedProductIndexes.map((index) => {
        const row = productRows[index];
        return productTargetDedupeKey(row.asin, row.matchType);
      }),
    );
    for (const asin of customAsins) {
      const key = productTargetDedupeKey(asin, customProductMatch);
      if (!existingProductKeys.has(key)) keys.add(key);
    }
    return keys.size;
  }, [
    mode,
    selectedKeywordIndexes,
    selectedProductIndexes,
    keywordRows,
    productRows,
    customKeywords,
    customAsins,
    customKeywordMatch,
    customProductMatch,
    existingKeywordKeys,
    existingProductKeys,
  ]);

  const applyMatchTypeCustomBid = (matchKey: string, text: string) => {
    const parsed = Number(String(text).replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0.02) return;
    const amountText = parsed.toFixed(2);
    if (mode === "keywords") {
      const indexes = availableKeywordRows
        .filter(({ row }) => String(row.matchType).toLowerCase() === matchKey)
        .map(({ index }) => index);
      setKeywordBidModes((old) => {
        const next = { ...old };
        for (const index of indexes) next[index] = "custom";
        return next;
      });
      setKeywordCustomBids((old) => {
        const next = { ...old };
        for (const index of indexes) next[index] = amountText;
        return next;
      });
      return;
    }
    const indexes = availableProductRows
      .filter(({ row }) => normalizeProductMatchType(row.matchType) === matchKey)
      .map(({ index }) => index);
    setProductBidModes((old) => {
      const next = { ...old };
      for (const index of indexes) next[index] = "custom";
      return next;
    });
    setProductCustomBids((old) => {
      const next = { ...old };
      for (const index of indexes) next[index] = amountText;
      return next;
    });
  };

  const keywordMatchKeys = useMemo(
    () => uniqueKeywordMatchTypes(availableKeywordRows.map(({ row }) => row)),
    [availableKeywordRows],
  );
  const productMatchKeys = useMemo(
    () => uniqueProductMatchTypes(availableProductRows.map(({ row }) => row)),
    [availableProductRows],
  );
  const selectedFilteredCount =
    mode === "keywords"
      ? filteredKeywordRows.filter(({ index }) => selectedKeywords.has(index)).length
      : filteredProductRows.filter(({ index }) => selectedProducts.has(index)).length;
  const keywordCountLabel = useMemo(() => {
    const stats = suggestionsQ.data?.keywordCounts;
    if (!stats || mode !== "keywords") return null;
    return formatKeywordSuggestionCountLabel(stats, {
      shownCount: filteredKeywordRows.length,
      selectedCount: selectedFilteredCount || undefined,
    });
  }, [
    suggestionsQ.data?.keywordCounts,
    mode,
    filteredKeywordRows.length,
    selectedFilteredCount,
  ]);
  const aiFilterPending = Boolean(suggestionsQ.data?.keywordCounts?.grokPending);
  const aiFilterNeedsConfirm = suggestionRelevanceNeedsUserConfirm(
    suggestionsQ.data?.keywordCounts,
  );
  const aiFilterBlocksSelect = aiFilterPending || aiFilterNeedsConfirm;
  const suggestionsBusy =
    suggestionsQ.isLoading || suggestionsQ.isFetching || asinResolving;
  // Keep Amazon rows + Filtering… chrome visible while Groq runs.
  const showSuggestionsSpinner =
    (suggestionsQ.isLoading || asinResolving) && !suggestionsQ.data;
  const filteredSelectionSeedRef = useRef<string | null>(null);

  const acceptAmazonUnfiltered = () => {
    const key = suggestionsQueryKey;
    const current = queryClient.getQueryData<typeof suggestionsQ.data>(key);
    if (!current?.keywordCounts) return;
    queryClient.setQueryData(key, {
      ...current,
      keywordCounts: {
        ...current.keywordCounts,
        relevanceOutcome: "user_accepted_unfiltered",
        relevanceError: undefined,
      },
    });
    setSelectedKeywords(new Set());
    setSelectedProducts(new Set());
  };

  // A new AI result resets stale numeric indexes. The seller explicitly
  // selects every keyword or product target that will be submitted.
  useEffect(() => {
    const seedKey = `${adGroupId}|${mode}|${suggestionsQ.data?.fetchedAt ?? ""}|${suggestionsQ.data?.keywordCounts?.relevanceOutcome ?? ""}`;
    if (aiFilterPending || aiFilterNeedsConfirm) {
      filteredSelectionSeedRef.current = null;
      setSelectedKeywords(new Set());
      setSelectedProducts(new Set());
      return;
    }
    if (!suggestionsQ.data || showSuggestionsSpinner) return;
    if (filteredSelectionSeedRef.current === seedKey) return;
    filteredSelectionSeedRef.current = seedKey;
    setSelectedKeywords(new Set());
    setSelectedProducts(new Set());
  }, [
    aiFilterPending,
    aiFilterNeedsConfirm,
    showSuggestionsSpinner,
    adGroupId,
    mode,
    suggestionsQ.data,
    suggestionsQ.data?.fetchedAt,
    suggestionsQ.data?.keywordCounts?.relevanceOutcome,
  ]);

  if (inferredMode === "auto") {
    return (
      <SubScreen title="Add targets">
        <EmptyState
          icon="sparkles-outline"
          title="Automatic ad group"
          subtitle="Amazon manages targeting for this ad group. Create a keyword or product ad group instead."
        />
      </SubScreen>
    );
  }

  const onSubmit = async () => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    if (
      !adGroupId ||
      selectedCount === 0 ||
      submitting ||
      aiFilterPending ||
      aiFilterNeedsConfirm
    )
      return;
    setSubmitting(true);
    try {
      if (mode === "keywords") {
        const raw = [
          ...selectedKeywordIndexes.map((index) => {
            const row = keywordRows[index];
            const custom = Number(
              String(keywordCustomBids[index] ?? "").replace(",", "."),
            );
            return {
              keyword: row.keyword,
              matchType: row.matchType,
              bid: resolveSuggestionBid({
                mode: keywordBidModes[index] ?? "default",
                customBid: Number.isFinite(custom) ? custom : null,
                suggestedBid: row.suggestedBid,
                defaultBid: defaultBidAmount,
                useSuggestedBids,
              }),
              source: "suggested" as const,
            };
          }),
          ...customKeywords.map((keyword) => ({
            keyword,
            matchType: customKeywordMatch,
            bid: defaultBidAmount,
            source: "custom" as const,
          })),
        ];
        const prepared = prepareKeywordAdds(raw, existingKeywordsQ.data ?? []);
        if (prepared.keywords.length === 0) {
          Alert.alert(
            "Nothing to add",
            prepared.skippedDuplicate
              ? "Those keywords already exist on this ad group with the same match type."
              : prepared.skippedBid
                ? "Bids must be at least $0.02."
                : "Add a keyword first.",
          );
          return;
        }
        const result = await addAdGroupKeywords(
          adGroupId,
          prepared.keywords.map((k) => ({
            keyword: k.keyword,
            matchType: (["broad", "phrase", "exact"].includes(
              String(k.matchType).toLowerCase(),
            )
              ? String(k.matchType).toLowerCase()
              : "exact") as "broad" | "phrase" | "exact",
            bid: k.bid,
            source: k.source === "custom" ? "custom" : "suggested",
          })),
        );
        void invalidateAds();
        void queryClient.invalidateQueries({ queryKey: ["adgroup-keywords"] });
        void queryClient.invalidateQueries({ queryKey: ["adgroup-keywords-existing"] });
        const skippedNote =
          prepared.skippedDuplicate > 0
            ? ` Skipped ${prepared.skippedDuplicate} duplicate(s).`
            : "";
        Alert.alert("Keywords added", `Added ${result.created} of ${prepared.keywords.length} selected keyword(s) on Amazon.${skippedNote}`, [
          { text: "Done", onPress: () => router.back() },
        ]);
      } else {
        const prepared = prepareProductTargetAdds(
          [
            ...selectedProductIndexes.map((index) => {
              const row = productRows[index];
              const custom = Number(
                String(productCustomBids[index] ?? "").replace(",", "."),
              );
              return {
                asin: String(row.asin).toUpperCase(),
                matchType: (row.matchType ?? "exact") as "exact" | "expanded",
                bid: resolveSuggestionBid({
                  mode: productBidModes[index] ?? "default",
                  customBid: Number.isFinite(custom) ? custom : null,
                  suggestedBid: row.suggestedBid,
                  defaultBid: defaultBidAmount,
                  useSuggestedBids,
                }),
                source: "suggested" as const,
              };
            }),
            ...customAsins.map((asin) => ({
              asin,
              matchType: customProductMatch,
              bid: defaultBidAmount,
              source: "custom" as const,
            })),
          ],
          existingProductsQ.data ?? [],
        );
        if (prepared.productTargets.length === 0) {
          Alert.alert(
            "Nothing to add",
            prepared.skippedDuplicate
              ? "Those product targets already exist on this ad group with the same match type."
              : prepared.skippedBid
                ? "Bids must be at least $0.02."
                : "Add a product target first.",
          );
          return;
        }
        const result = await addAdGroupProductTargets(
          adGroupId,
          prepared.productTargets,
        );
        void invalidateAds();
        void queryClient.invalidateQueries({ queryKey: ["adgroup-targets"] });
        Alert.alert(
          "Product targets added",
          `Added ${result.created} of ${prepared.productTargets.length} selected product target(s) on Amazon.`,
          [{ text: "Done", onPress: () => router.back() }],
        );
      }
    } catch (error) {
      alertMutationError(error, "Couldn't add targets");
    } finally {
      setSubmitting(false);
    }
  };

  if (!adGroupId) {
    return (
      <SubScreen title="Add targets">
        <EmptyState icon="layers-outline" title="Ad group not found" />
      </SubScreen>
    );
  }

  if (adGroupsQ.isLoading && !group) {
    return (
      <SubScreen title="Add targets">
        <ScreenSpinner />
      </SubScreen>
    );
  }

  return (
    <SubScreen title={mode === "keywords" ? "Add keywords" : "Add products"}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SectionCard title={group?.name || nameParam || "Ad group"}>
          {campaignQ.data?.name ? (
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
              {campaignQ.data.name}
            </Text>
          ) : null}
        </SectionCard>

        <SectionCard title={mode === "keywords" ? "Suggestions" : "Suggestions"}>
          <SuggestionAiFilterChrome
            testIDPrefix="adgroup-ai-filter"
            targeting={mode === "keywords" || mode === "products" ? mode : "auto"}
            stats={suggestionsQ.data?.keywordCounts}
            loading={showSuggestionsSpinner || aiFilterPending}
            retrying={suggestionsQ.isFetching && !aiFilterPending}
            onRetry={() => {
              void suggestionsQ.refetch();
            }}
            onAcceptUnfiltered={acceptAmazonUnfiltered}
          />
          {/* Counts live in SuggestionAiFilterChrome — keep harness id for AX. */}
          {mode === "keywords" && keywordCountLabel ? (
            <Text
              testID="adgroup-amazon-keyword-counts"
              style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
            >
              {keywordCountLabel}
            </Text>
          ) : null}
          {asinResolving && !primaryAsin && !suggestionsQ.data ? (
            <ScreenSpinner />
          ) : asinResolveError || suggestionsErrorNoAsin ? (
            <RetryState
              title="Couldn't resolve advertised product"
              onRetry={() => {
                void campaignApiQ.refetch();
                void advertisedAsinQ.refetch();
                void suggestionsQ.refetch();
              }}
              retrying={
                campaignApiQ.isRefetching ||
                advertisedAsinQ.isRefetching ||
                suggestionsQ.isRefetching
              }
            />
          ) : showNoAdvertised ? (
            <Text style={[t.typography.footnote, { color: t.colors.tone_warning }]}>
              No advertised product on this campaign — paste ASINs below.
            </Text>
          ) : (
            <>
              {mode === "keywords" && !primaryAsin && !asinResolving && !suggestionsQ.data ? (
                <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: spacing.sm }]}>
                  Paste keywords below.
                </Text>
              ) : null}
              <View style={styles.switchRow}>
                <Text style={[t.typography.callout, { color: t.colors.text_primary, flex: 1 }]}>
                  Suggested bids
                </Text>
                <Switch
                  value={useSuggestedBids}
                  onValueChange={(next) => {
                    setUseSuggestedBids(next);
                    if (next) {
                      setKeywordBidModes({});
                      setProductBidModes({});
                    }
                  }}
                  accessibilityLabel="Use Amazon suggested bids"
                />
              </View>
              <TextInput
                value={suggestionQuery}
                onChangeText={setSuggestionQuery}
                placeholder={mode === "keywords" ? "Filter keywords" : "Filter ASINs or titles"}
                placeholderTextColor={t.colors.text_tertiary}
                autoCapitalize="none"
                style={[styles.pasteInput, { minHeight: layout.minTap, textAlignVertical: "center", color: t.colors.text_primary, borderColor: t.colors.separator, backgroundColor: t.colors.background_tertiary, marginBottom: spacing.sm }]}
              />
              <IOSSegmentedControl
                testID="adgroup-suggestion-match-filter"
                value={suggestionMatch}
                onChange={setSuggestionMatch}
                options={(mode === "keywords"
                  ? ["all", "broad", "phrase", "exact"]
                  : ["all", "exact", "expanded"]
                ).map((key) => ({ key, label: key === "all" ? "All" : key[0].toUpperCase() + key.slice(1) }))}
              />
              {filteredSuggestionRows.length > 0 ? (
                <AdGroupSuggestionControls
                  filteredCount={filteredSuggestionRows.length}
                  selectedFilteredCount={selectedFilteredCount}
                  selectedTotalCount={
                    mode === "keywords"
                      ? selectedKeywordIndexes.length
                      : selectedProductIndexes.length
                  }
                  onClearSelection={() => {
                    setSelectedKeywords(new Set());
                    setSelectedProducts(new Set());
                  }}
                  onToggleSelectAll={() => {
                    if (aiFilterBlocksSelect) return;
                    if (mode === "keywords") {
                      const indexes = filteredKeywordRows.map(({ index }) => index);
                      const allOn =
                        indexes.length > 0 &&
                        indexes.every((index) => selectedKeywords.has(index));
                      setSelectedKeywords((prev) => {
                        const next = new Set(prev);
                        if (allOn) for (const index of indexes) next.delete(index);
                        else for (const index of indexes) next.add(index);
                        return next;
                      });
                      return;
                    }
                    const indexes = filteredProductRows.map(({ index }) => index);
                    const allOn =
                      indexes.length > 0 &&
                      indexes.every((index) => selectedProducts.has(index));
                    setSelectedProducts((prev) => {
                      const next = new Set(prev);
                      if (allOn) for (const index of indexes) next.delete(index);
                      else for (const index of indexes) next.add(index);
                      return next;
                    });
                  }}
                  matchChips={
                    mode === "keywords"
                      ? keywordMatchKeys.map((key) => {
                          const indexes = availableKeywordRows
                            .filter(
                              ({ row }) =>
                                String(row.matchType).toLowerCase() === key,
                            )
                            .map(({ index }) => index);
                          const allSelected =
                            indexes.length > 0 &&
                            indexes.every((index) => selectedKeywords.has(index)) &&
                            selectedKeywordIndexes.length === indexes.length;
                          return {
                            key,
                            label: key[0].toUpperCase() + key.slice(1),
                            count: indexes.length,
                            allSelected,
                            onPress: () => {
                              if (aiFilterBlocksSelect) return;
                              setSelectedKeywords(new Set(indexes));
                            },
                          };
                        })
                      : productMatchKeys.map((key) => {
                          const indexes = availableProductRows
                            .filter(
                              ({ row }) =>
                                normalizeProductMatchType(row.matchType) === key,
                            )
                            .map(({ index }) => index);
                          const allSelected =
                            indexes.length > 0 &&
                            indexes.every((index) => selectedProducts.has(index)) &&
                            selectedProductIndexes.length === indexes.length;
                          return {
                            key,
                            label: productMatchSelectLabel(key),
                            count: indexes.length,
                            allSelected,
                            onPress: () => {
                              if (aiFilterBlocksSelect) return;
                              setSelectedProducts(new Set(indexes));
                            },
                          };
                        })
                  }
                  matchBidRows={
                    mode === "keywords"
                      ? keywordMatchKeys.map((key) => ({
                          key,
                          label: key[0].toUpperCase() + key.slice(1),
                          value: matchTypeBidTexts[key] ?? "",
                          onChange: (text: string) =>
                            setMatchTypeBidTexts((old) => ({
                              ...old,
                              [key]: text,
                            })),
                          onApply: () =>
                            applyMatchTypeCustomBid(
                              key,
                              matchTypeBidTexts[key] ?? "",
                            ),
                        }))
                      : productMatchKeys.map((key) => ({
                          key,
                          label: productMatchSelectLabel(key),
                          value: matchTypeBidTexts[key] ?? "",
                          onChange: (text: string) =>
                            setMatchTypeBidTexts((old) => ({
                              ...old,
                              [key]: text,
                            })),
                          onApply: () =>
                            applyMatchTypeCustomBid(
                              key,
                              matchTypeBidTexts[key] ?? "",
                            ),
                        }))
                  }
                  defaultBidPlaceholder={defaultBidAmount.toFixed(2)}
                />
              ) : null}
              {showSuggestionsSpinner ? <ScreenSpinner /> : null}
              {suggestionsQ.isError ? (
                <RetryState
                  title="Couldn't load suggestions"
                  subtitle="You can still paste targets below."
                  onRetry={() => void suggestionsQ.refetch()}
                  retrying={suggestionsQ.isRefetching}
                />
              ) : null}
              {!suggestionsBusy &&
              !suggestionsQ.isError &&
              filteredSuggestionRows.length === 0 ? (
                <Text
                  style={[
                    t.typography.footnote,
                    { color: t.colors.text_secondary, marginBottom: spacing.sm },
                  ]}
                >
                  No Amazon suggestions right now — paste below.
                </Text>
              ) : null}
              {/* Suggestions filtered by Grok (title/subtitle/author/topic) in mutations; heuristic fallback. */}
              {mode === "keywords"
                ? filteredKeywordRows.slice(0, visibleSuggestionCount).map(({ row, index }) => {
                    const suggested = recommendationBidMajorUnits(row.suggestedBid);
                    return (
                      <AmazonKeywordSuggestionRow
                        key={`${row.keyword}-${row.matchType}-${index}`}
                        keyword={row.keyword}
                        matchType={row.matchType}
                        selected={selectedKeywords.has(index)}
                        suggestedBid={suggested}
                        defaultBid={defaultBidAmount}
                        currency={primaryCurrency}
                        bidMode={keywordBidModes[index] ?? "default"}
                        customBidText={
                          keywordCustomBids[index] ??
                          (suggested != null
                            ? suggested.toFixed(2)
                            : defaultBidAmount.toFixed(2))
                        }
                        useSuggestedBids={useSuggestedBids}
                        onToggle={() =>
                          setSelectedKeywords((prev) => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        onBidModeChange={(next) =>
                          setKeywordBidModes((old) => ({ ...old, [index]: next }))
                        }
                        onCustomBidChange={(text) =>
                          setKeywordCustomBids((old) => ({ ...old, [index]: text }))
                        }
                      />
                    );
                  })
                : filteredProductRows.slice(0, visibleSuggestionCount).map(({ row, index }) => {
                    const suggested = recommendationBidMajorUnits(row.suggestedBid);
                    const meta =
                      suggestionMetaByAsin[String(row.asin).toUpperCase()];
                    return (
                      <AmazonProductSuggestionRow
                        key={`${row.asin}-${row.matchType}-${index}`}
                        asin={row.asin}
                        title={meta?.title ?? row.title ?? null}
                        subtitle={meta?.subtitle ?? row.subtitle ?? null}
                        coverUrl={meta?.coverUrl ?? row.coverUrl ?? null}
                        themes={row.themes ?? []}
                        matchType={row.matchType}
                        selected={selectedProducts.has(index)}
                        suggestedBid={suggested}
                        defaultBid={defaultBidAmount}
                        currency={primaryCurrency}
                        bidMode={productBidModes[index] ?? "default"}
                        customBidText={
                          productCustomBids[index] ??
                          (suggested != null
                            ? suggested.toFixed(2)
                            : defaultBidAmount.toFixed(2))
                        }
                        useSuggestedBids={useSuggestedBids}
                        titleLoading={suggestionTitlesLoading}
                        onToggle={() =>
                          setSelectedProducts((prev) => {
                            const next = new Set(prev);
                            if (next.has(index)) next.delete(index);
                            else next.add(index);
                            return next;
                          })
                        }
                        onBidModeChange={(next) =>
                          setProductBidModes((old) => ({ ...old, [index]: next }))
                        }
                        onCustomBidChange={(text) =>
                          setProductCustomBids((old) => ({ ...old, [index]: text }))
                        }
                      />
                    );
                  })}
              {visibleSuggestionCount < filteredSuggestionRows.length ? (
                <PrimaryButton
                  label={`Show next ${Math.min(50, filteredSuggestionRows.length - visibleSuggestionCount)} · ${filteredSuggestionRows.length - visibleSuggestionCount} remaining`}
                  onPress={() => setVisibleSuggestionCount((count) => count + 50)}
                />
              ) : filteredSuggestionRows.length > 0 ? (
                <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: spacing.sm }]}>
                  {keywordCountLabel
                    ? `All kept suggestions loaded · ${keywordCountLabel}`
                    : `All ${filteredSuggestionRows.length} Amazon suggestions loaded.`}
                </Text>
              ) : null}
            </>
          )}

          {mode === "keywords" ? (
            <View style={styles.pasteBlock}>
              <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
                Or paste keywords
              </Text>
              <IOSSegmentedControl
                options={[
                  { key: "broad", label: "Broad" },
                  { key: "phrase", label: "Phrase" },
                  { key: "exact", label: "Exact" },
                ]}
                value={customKeywordMatch}
                onChange={setCustomKeywordMatch}
              />
              <TextInput
                testID="adgroup-add-custom-keywords"
                value={customKeywordText}
                onChangeText={setCustomKeywordText}
                multiline
                placeholder="keyword one&#10;keyword two"
                placeholderTextColor={t.colors.text_tertiary}
                style={[
                  styles.pasteInput,
                  {
                    color: t.colors.text_primary,
                    borderColor: t.colors.separator,
                    backgroundColor: t.colors.background_tertiary,
                  },
                ]}
              />
            </View>
          ) : (
            <View style={styles.pasteBlock}>
              <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
                Or paste ASINs
              </Text>
              <IOSSegmentedControl
                options={[
                  { key: "exact", label: "Exact" },
                  { key: "expanded", label: "Expanded" },
                ]}
                value={customProductMatch}
                onChange={setCustomProductMatch}
              />
              <TextInput
                testID="adgroup-add-custom-asins"
                value={customAsinText}
                onChangeText={setCustomAsinText}
                multiline
                autoCapitalize="characters"
                placeholder="B0XXXXXXXXX"
                placeholderTextColor={t.colors.text_tertiary}
                style={[
                  styles.pasteInput,
                  {
                    color: t.colors.text_primary,
                    borderColor: t.colors.separator,
                    backgroundColor: t.colors.background_tertiary,
                  },
                ]}
              />
            </View>
          )}
        </SectionCard>

        <PrimaryButton
          testID="adgroup-add-targets-submit"
          label={
            aiFilterPending
              ? "AI filtering…"
              : aiFilterNeedsConfirm
                ? "Confirm AI filter first"
                : submitting
                  ? "Adding…"
                  : mode === "keywords"
                    ? `Add ${selectedCount || ""} keyword${selectedCount === 1 ? "" : "s"}`.trim()
                    : `Add ${selectedCount || ""} product${selectedCount === 1 ? "" : "s"}`.trim()
          }
          full
          loading={submitting}
          disabled={
            selectedCount === 0 ||
            submitting ||
            aiFilterPending ||
            aiFilterNeedsConfirm
          }
          onPress={() => void onSubmit()}
        />
      </ScrollView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: layout.pagePad,
    paddingBottom: 48,
    gap: spacing.md,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  pasteBlock: { marginTop: spacing.md, gap: spacing.sm },
  pasteInput: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlignVertical: "top",
  },
});
