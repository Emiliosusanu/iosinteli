import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
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
import { fetchCampaignAdvertisedAsin, fetchCampaignById } from "@/src/lib/queries";
import {
  createAdGroup,
  fetchAdGroupSuggestions,
  fetchCampaignApi,
  type AdGroupTargeting,
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
  suggestionRelevanceNeedsUserConfirm,
  uniqueKeywordMatchTypes,
  uniqueProductMatchTypes,
  AI_FAILED_SOFT_RECOVER_DELAYS_MS,
  AI_FAILED_SOFT_RECOVER_MAX,
  type BidMode,
} from "@/src/lib/amazonCampaignSuggestions";
import { SuggestionAiFilterChrome } from "@/src/components/SuggestionAiFilterChrome";
import {
  allowedAdGroupTargetings,
  parseCustomKeywords,
  type AdGroupCreateTargeting,
} from "@/src/lib/adGroupTargets";
import { useInvalidateAds } from "@/src/lib/invalidateAds";

function Choice({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? t.colors.tone_primary : t.colors.separator,
          backgroundColor: selected
            ? `${t.colors.tone_primary}14`
            : t.colors.background_tertiary,
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text
        style={[
          t.typography.callout,
          {
            color: selected ? t.colors.tone_primary : t.colors.text_primary,
            fontWeight: selected ? "600" : "500",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function CreateAdGroupScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidateAds = useInvalidateAds();
  const { campaignId: campaignIdParam, asin: asinParam, targeting: targetingParam } =
    useLocalSearchParams<{
      campaignId?: string;
      asin?: string;
      targeting?: string;
    }>();
  const campaignId = Array.isArray(campaignIdParam)
    ? campaignIdParam[0]
    : campaignIdParam ?? "";
  const asinOverride = Array.isArray(asinParam) ? asinParam[0] : asinParam;
  const targetingFromRoute = useMemo((): AdGroupCreateTargeting | null => {
    const raw = Array.isArray(targetingParam) ? targetingParam[0] : targetingParam;
    const v = String(raw || "").trim().toLowerCase();
    if (v === "keywords" || v === "products") return v;
    return null;
  }, [targetingParam]);

  const {
    primaryCurrency,
    selectedProfileIds,
    profiles,
    adminFilterUserId,
  } = useApp();
  const { user, guestMode } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const writeGuard = { guestMode, viewAsOtherUser };

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
      !asinOverride &&
      !nestAsin &&
      !campaignApiQ.isLoading,
    staleTime: 60_000,
  });

  const campaign = campaignQ.data;
  const campaignTargeting = String(
    campaign?.targeting_type ?? campaignApiQ.data?.targetingType ?? "",
  );
  const allowed = useMemo(
    () => allowedAdGroupTargetings(campaignTargeting),
    [campaignTargeting],
  );
  const primaryAsin =
    (String(asinOverride || "").trim() || nestAsin || advertisedAsinQ.data || "")
      .trim()
      .toUpperCase() || null;
  const asinResolving =
    campaignApiQ.isLoading || advertisedAsinQ.isFetching || advertisedAsinQ.isLoading;

  const [targeting, setTargeting] = useState<AdGroupCreateTargeting | null>(
    targetingFromRoute,
  );
  const effectiveTargeting: AdGroupCreateTargeting =
    targeting && allowed.includes(targeting) ? targeting : allowed[0] ?? "keywords";

  useEffect(() => {
    if (!targetingFromRoute) return;
    if (allowed.includes(targetingFromRoute)) {
      setTargeting(targetingFromRoute);
    }
  }, [targetingFromRoute, allowed]);

  const [name, setName] = useState("New ad group");
  const [defaultBidText, setDefaultBidText] = useState("0.75");
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

  const defaultBidAmount = (() => {
    const n = Number(String(defaultBidText).replace(",", "."));
    return Number.isFinite(n) && n >= 0.02 ? n : 0.75;
  })();

  const needsSuggestions =
    effectiveTargeting === "keywords" || effectiveTargeting === "products";

  const suggestionsProfileId = String(
    campaignQ.data?.amazon_profile_id || selectedProfileIds[0] || "",
  ).trim();
  const suggestionsQueryKey = [
    "ad-group-suggestions",
    campaignId,
    effectiveTargeting,
    primaryAsin ?? "",
    suggestionsProfileId,
  ] as const;
  const suggestionsQ = useQuery({
    queryKey: suggestionsQueryKey,
    queryFn: () =>
      fetchAdGroupSuggestions({
        campaignId,
        targeting: effectiveTargeting as "keywords" | "products",
        asin: primaryAsin || undefined,
        profileId: suggestionsProfileId || undefined,
        onAmazonReady: (partial) => {
          queryClient.setQueryData(suggestionsQueryKey, partial);
        },
      }),
    enabled: !!campaignId && !guestMode && !asinResolving && needsSuggestions,
    // fetchAdGroupSuggestions already owns a bounded three-attempt retry loop.
    // Avoid multiplying an Amazon throttle into as many as nine requests.
    retry: false,
    staleTime: 60_000,
  });

  const showNoAdvertised =
    effectiveTargeting === "products" &&
    !primaryAsin &&
    !asinResolving &&
    !suggestionsQ.isLoading &&
    !suggestionsQ.isFetching &&
    !(suggestionsQ.data?.productTargets?.length);
  const asinResolveError =
    !primaryAsin && !asinResolving && (advertisedAsinQ.isError || campaignApiQ.isError);
  const suggestionsErrorNoAsin =
    effectiveTargeting === "products" &&
    !primaryAsin &&
    !asinResolving &&
    suggestionsQ.isError;

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
      ),
    [suggestionsQ.data?.productTargets],
  );
  const suggestionProfileIds = useMemo(() => {
    const ids = [
      campaign?.amazon_profile_id,
      ...selectedProfileIds,
    ]
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [campaign?.amazon_profile_id, selectedProfileIds]);
  const suggestionCountryCode = useMemo(() => {
    const fromSuggestions = String(
      suggestionsQ.data?.profile?.countryCode ?? "",
    )
      .trim()
      .toUpperCase();
    if (fromSuggestions) return fromSuggestions;
    return countryCodeForProfile(
      profiles,
      campaign?.amazon_profile_id ?? selectedProfileIds[0] ?? null,
    );
  }, [
    suggestionsQ.data?.profile?.countryCode,
    profiles,
    campaign?.amazon_profile_id,
    selectedProfileIds,
  ]);
  const { metaByAsin: suggestionMetaByAsin, titlesLoading: suggestionTitlesLoading } =
    useProductSuggestionAsinMeta({
      productTargets: suggestionsQ.data?.productTargets ?? [],
      profileIds: suggestionProfileIds,
      countryCode: suggestionCountryCode,
      enabled: effectiveTargeting === "products" && !guestMode,
      visibleAsins: (suggestionsQ.data?.productTargets ?? [])
        .slice(0, visibleSuggestionCount)
        .map((row) => String(row.asin).toUpperCase()),
    });
  const filteredKeywordRows = useMemo(() => {
    const needle = suggestionQuery.trim().toLowerCase();
    return keywordRows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          suggestionMatch === "all" ||
          normalizeKeywordMatchType(row.matchType) === suggestionMatch,
      )
      .filter(({ row }) => !needle || String(row.keyword).toLowerCase().includes(needle));
  }, [keywordRows, suggestionMatch, suggestionQuery]);
  const filteredProductRows = useMemo(() => {
    const needle = suggestionQuery.trim().toLowerCase();
    return productRows
      .map((row, index) => ({ row, index }))
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
  }, [productRows, suggestionMatch, suggestionQuery, suggestionMetaByAsin]);
  const filteredSuggestionRows = effectiveTargeting === "keywords" ? filteredKeywordRows : filteredProductRows;
  useEffect(() => {
    setSuggestionMatch("all");
    setSuggestionQuery("");
    setVisibleSuggestionCount(50);
  }, [effectiveTargeting]);
  useEffect(() => setVisibleSuggestionCount(50), [suggestionMatch, suggestionQuery]);
  const customKeywords = useMemo(
    () => parseCustomKeywords(customKeywordText),
    [customKeywordText],
  );
  const customAsins = useMemo(() => parseCustomAsins(customAsinText), [customAsinText]);

  const selectedKeywordCount =
    selectedKeywords.size + (effectiveTargeting === "keywords" ? customKeywords.length : 0);
  const selectedProductCount =
    selectedProducts.size + (effectiveTargeting === "products" ? customAsins.length : 0);

  const canSubmit =
    !!campaignId &&
    name.trim().length > 0 &&
    (effectiveTargeting === "auto" ||
      (effectiveTargeting === "keywords" && selectedKeywordCount > 0) ||
      (effectiveTargeting === "products" && selectedProductCount > 0));

  const toggleKeyword = (index: number) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const toggleProduct = (index: number) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const applyMatchTypeCustomBid = (matchKey: string, text: string) => {
    const parsed = Number(String(text).replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0.02) return;
    const amountText = parsed.toFixed(2);
    if (effectiveTargeting === "keywords") {
      const indexes = keywordRows
        .map((row, index) => ({ row, index }))
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
    const indexes = productRows
      .map((row, index) => ({ row, index }))
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
    () => uniqueKeywordMatchTypes(keywordRows),
    [keywordRows],
  );
  const productMatchKeys = useMemo(
    () => uniqueProductMatchTypes(productRows),
    [productRows],
  );
  const selectedFilteredCount =
    effectiveTargeting === "keywords"
      ? filteredKeywordRows.filter(({ index }) => selectedKeywords.has(index)).length
      : filteredProductRows.filter(({ index }) => selectedProducts.has(index)).length;
  const keywordCountLabel = useMemo(() => {
    const stats = suggestionsQ.data?.keywordCounts;
    if (!stats || effectiveTargeting !== "keywords") return null;
    return formatKeywordSuggestionCountLabel(stats, {
      shownCount: filteredKeywordRows.length,
      selectedCount: selectedFilteredCount || undefined,
    });
  }, [
    suggestionsQ.data?.keywordCounts,
    effectiveTargeting,
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
  // Don't cover the list with a full-screen spinner while Groq runs — Amazon
  // rows + "Filtering…" chrome must stay visible (same as Create).
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
    if (effectiveTargeting === "keywords" && filteredKeywordRows.length) {
      setSelectedKeywords(
        new Set(filteredKeywordRows.map(({ index }) => index)),
      );
    } else if (effectiveTargeting === "products" && filteredProductRows.length) {
      setSelectedProducts(
        new Set(filteredProductRows.map(({ index }) => index)),
      );
    }
  };

  // Multi-shot UI soft-recover when AI latched failed_unfiltered (Nest/Groq TPM).
  // Do not gate on isFetching (that cancelled timers). Latch attempt inside the
  // timer; after AI_FAILED_SOFT_RECOVER_MAX still-fail → auto-accept Amazon.
  const aiFailedSoftRecoverAttemptRef = useRef(0);
  const aiFailedSoftRecoverScopeRef = useRef<string | null>(null);
  useEffect(() => {
    aiFailedSoftRecoverAttemptRef.current = 0;
    aiFailedSoftRecoverScopeRef.current = null;
  }, [campaignId, effectiveTargeting]);
  useEffect(() => {
    if (
      suggestionsQ.data?.keywordCounts?.relevanceOutcome !== "failed_unfiltered"
    ) {
      return;
    }
    const scope = `${campaignId}|${effectiveTargeting}`;
    if (aiFailedSoftRecoverScopeRef.current !== scope) {
      aiFailedSoftRecoverScopeRef.current = scope;
      aiFailedSoftRecoverAttemptRef.current = 0;
    }
    const attempt = aiFailedSoftRecoverAttemptRef.current;
    if (attempt >= AI_FAILED_SOFT_RECOVER_MAX) {
      acceptAmazonUnfiltered();
      return;
    }
    const delay =
      AI_FAILED_SOFT_RECOVER_DELAYS_MS[attempt] ??
      AI_FAILED_SOFT_RECOVER_DELAYS_MS[
        AI_FAILED_SOFT_RECOVER_DELAYS_MS.length - 1
      ]!;
    const timer = setTimeout(() => {
      const current = queryClient.getQueryData<typeof suggestionsQ.data>(
        suggestionsQueryKey,
      );
      if (current?.keywordCounts?.relevanceOutcome !== "failed_unfiltered") {
        return;
      }
      aiFailedSoftRecoverAttemptRef.current = attempt + 1;
      queryClient.setQueryData(suggestionsQueryKey, {
        ...current,
        keywordCounts: {
          ...current.keywordCounts,
          grokPending: true,
          relevanceOutcome: "pending",
        },
      });
      void suggestionsQ.refetch().then(() => {
        const after = queryClient.getQueryData<typeof suggestionsQ.data>(
          suggestionsQueryKey,
        );
        if (
          after?.keywordCounts?.relevanceOutcome === "failed_unfiltered" &&
          aiFailedSoftRecoverAttemptRef.current >= AI_FAILED_SOFT_RECOVER_MAX
        ) {
          acceptAmazonUnfiltered();
        }
      });
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- multi-shot soft recover
  }, [
    suggestionsQ.data?.keywordCounts?.relevanceOutcome,
    campaignId,
    effectiveTargeting,
  ]);

  // After Step 2 AI filter finishes, pre-select the kept set (not raw Amazon).
  // Skip auto-select when AI failed / empty-restored until user confirms.
  useEffect(() => {
    const seedKey = `${campaignId}|${effectiveTargeting}|${suggestionsQ.data?.fetchedAt ?? ""}|${suggestionsQ.data?.keywordCounts?.relevanceOutcome ?? ""}`;
    if (aiFilterPending || aiFilterNeedsConfirm) {
      filteredSelectionSeedRef.current = null;
      setSelectedKeywords(new Set());
      setSelectedProducts(new Set());
      return;
    }
    if (!suggestionsQ.data || showSuggestionsSpinner) return;
    if (filteredSelectionSeedRef.current === seedKey) return;
    filteredSelectionSeedRef.current = seedKey;
    if (effectiveTargeting === "keywords" && filteredKeywordRows.length) {
      setSelectedKeywords(
        new Set(filteredKeywordRows.map(({ index }) => index)),
      );
    } else if (effectiveTargeting === "products" && filteredProductRows.length) {
      setSelectedProducts(
        new Set(filteredProductRows.map(({ index }) => index)),
      );
    }
  }, [
    aiFilterPending,
    aiFilterNeedsConfirm,
    showSuggestionsSpinner,
    campaignId,
    effectiveTargeting,
    suggestionsQ.data?.fetchedAt,
    suggestionsQ.data?.keywordCounts?.relevanceOutcome,
    filteredKeywordRows,
    filteredProductRows,
  ]);

  const onSubmit = async () => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    if (!canSubmit || submitting || aiFilterPending || aiFilterNeedsConfirm) return;
    setSubmitting(true);
    try {
      const keywords =
        effectiveTargeting === "keywords"
          ? [
              ...[...selectedKeywords].map((index) => {
                const row = keywordRows[index];
                const mode = keywordBidModes[index] ?? "default";
                const custom = Number(
                  String(keywordCustomBids[index] ?? "").replace(",", "."),
                );
                return {
                  keyword: row.keyword,
                  matchType: row.matchType,
                  bid: resolveSuggestionBid({
                    mode,
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
            ]
          : undefined;
      const productTargets =
        effectiveTargeting === "products"
          ? [
              ...[...selectedProducts].map((index) => {
                const row = productRows[index];
                const mode = productBidModes[index] ?? "default";
                const custom = Number(
                  String(productCustomBids[index] ?? "").replace(",", "."),
                );
                return {
                  asin: String(row.asin).toUpperCase(),
                  matchType: (row.matchType ?? "exact") as "exact" | "expanded",
                  bid: resolveSuggestionBid({
                    mode,
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
            ]
          : undefined;

      const result = await createAdGroup({
        campaignId,
        name: name.trim(),
        defaultBid: defaultBidAmount,
        state: "enabled",
        targeting: effectiveTargeting as AdGroupTargeting,
        advertisedAsin: primaryAsin || undefined,
        keywords,
        productTargets,
      });

      void invalidateAds();
      void queryClient.invalidateQueries({ queryKey: ["ad-groups"] });
      Alert.alert(
        "Ad group created",
        effectiveTargeting === "auto"
          ? "Automatic ad group is live on Amazon."
          : effectiveTargeting === "keywords"
            ? `Added ${result.keywordCount ?? keywords?.length ?? 0} keyword(s).`
            : `Added ${result.productTargetCount ?? productTargets?.length ?? 0} product target(s).`,
        [
          {
            text: "View",
            onPress: () =>
              router.replace({
                pathname: "/more/ad-group/[id]",
                params: {
                  id: result.adGroup.id,
                  name: result.adGroup.name || name.trim(),
                },
              }),
          },
        ],
      );
    } catch (error) {
      alertMutationError(error, "Couldn't create ad group");
    } finally {
      setSubmitting(false);
    }
  };

  if (!campaignId) {
    return (
      <SubScreen title="New Ad Group">
        <EmptyState icon="layers-outline" title="Missing campaign" />
      </SubScreen>
    );
  }

  if (campaignQ.isLoading && !campaign) {
    return (
      <SubScreen title="New Ad Group">
        <ScreenSpinner />
      </SubScreen>
    );
  }

  if (campaignQ.isError && !campaign) {
    return (
      <SubScreen title="New Ad Group">
        <RetryState
          title="Couldn't load campaign"
          onRetry={() => void campaignQ.refetch()}
          retrying={campaignQ.isRefetching}
        />
      </SubScreen>
    );
  }

  return (
    <SubScreen title="New Ad Group">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SectionCard title={campaign?.name || "Campaign"}>
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
            {allowed.includes("auto")
              ? "This is an automatic campaign — new ad groups use Amazon auto targeting."
              : "Choose keyword or product targeting for this manual campaign."}
          </Text>
        </SectionCard>

        {allowed.length > 1 ? (
          <SectionCard title="Type">
            <View style={styles.choiceRow}>
              {allowed.includes("keywords") ? (
                <Choice
                  label="Keywords"
                  selected={effectiveTargeting === "keywords"}
                  onPress={() => setTargeting("keywords")}
                />
              ) : null}
              {allowed.includes("products") ? (
                <Choice
                  label="Products"
                  selected={effectiveTargeting === "products"}
                  onPress={() => setTargeting("products")}
                />
              ) : null}
              {allowed.includes("auto") ? (
                <Choice
                  label="Automatic"
                  selected={effectiveTargeting === "auto"}
                  onPress={() => setTargeting("auto")}
                />
              ) : null}
            </View>
          </SectionCard>
        ) : null}

        <SectionCard title="Basics">
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            Name
          </Text>
          <TextInput
            testID="adgroup-create-name"
            value={name}
            onChangeText={setName}
            placeholder="Ad group name"
            placeholderTextColor={t.colors.text_tertiary}
            style={[
              styles.input,
              {
                color: t.colors.text_primary,
                borderColor: t.colors.separator,
                backgroundColor: t.colors.background_tertiary,
              },
            ]}
          />
          <Text
            style={[
              t.typography.caption1,
              { color: t.colors.text_tertiary, marginTop: spacing.md },
            ]}
          >
            Default bid ({primaryCurrency || "USD"})
          </Text>
          <TextInput
            testID="adgroup-create-bid"
            value={defaultBidText}
            onChangeText={setDefaultBidText}
            keyboardType="decimal-pad"
            style={[
              styles.input,
              {
                color: t.colors.text_primary,
                borderColor: t.colors.separator,
                backgroundColor: t.colors.background_tertiary,
              },
            ]}
          />
        </SectionCard>

        {effectiveTargeting === "auto" ? (
          <SectionCard title="Automatic targeting">
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
              Amazon will generate close match, loose match, complements, and substitutes
              for the campaign’s advertised product.
            </Text>
          </SectionCard>
        ) : (
          <SectionCard
            title={
              effectiveTargeting === "keywords" ? "Keywords" : "Product targets"
            }
          >
            <SuggestionAiFilterChrome
              testIDPrefix="new-adgroup-ai-filter"
              targeting={
                effectiveTargeting === "keywords" ||
                effectiveTargeting === "products"
                  ? effectiveTargeting
                  : "auto"
              }
              stats={suggestionsQ.data?.keywordCounts}
              loading={showSuggestionsSpinner || aiFilterPending}
              retrying={suggestionsQ.isFetching && !aiFilterPending}
              onRetry={() => {
                void suggestionsQ.refetch();
              }}
              onAcceptUnfiltered={acceptAmazonUnfiltered}
            />
            {/* Counts live in SuggestionAiFilterChrome — keep harness id for AX. */}
            {effectiveTargeting === "keywords" && keywordCountLabel ? (
              <Text
                testID="new-adgroup-amazon-keyword-counts"
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
                subtitle="You can still paste targets below."
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
                No advertised ASIN on this campaign — paste targets below, or link a
                product ad first for Amazon suggestions.
              </Text>
            ) : null}

            {needsSuggestions &&
            !(asinResolving && !primaryAsin && !suggestionsQ.data) &&
            !(asinResolveError || suggestionsErrorNoAsin) &&
            !showNoAdvertised ? (
              <>
                {effectiveTargeting === "keywords" &&
                !primaryAsin &&
                !asinResolving &&
                !suggestionsQ.data ? (
                  <Text
                    style={[
                      t.typography.footnote,
                      { color: t.colors.text_secondary, marginBottom: spacing.sm },
                    ]}
                  >
                    Paste keywords below.
                  </Text>
                ) : null}
                <View style={styles.switchRow}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary, flex: 1 }]}>
                    Use Amazon suggested bids
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
                  placeholder={effectiveTargeting === "keywords" ? "Filter Amazon keywords" : "Filter Amazon ASINs or titles"}
                  placeholderTextColor={t.colors.text_tertiary}
                  autoCapitalize="none"
                  style={[styles.input, { color: t.colors.text_primary, borderColor: t.colors.separator, backgroundColor: t.colors.background_tertiary, marginBottom: spacing.sm }]}
                />
                <IOSSegmentedControl
                  testID="new-adgroup-suggestion-match-filter"
                  value={suggestionMatch}
                  onChange={setSuggestionMatch}
                  options={(effectiveTargeting === "keywords"
                    ? ["all", "broad", "phrase", "exact"]
                    : ["all", "exact", "expanded"]
                  ).map((key) => ({ key, label: key === "all" ? "All" : key[0].toUpperCase() + key.slice(1) }))}
                />
                {filteredSuggestionRows.length > 0 ? (
                  <AdGroupSuggestionControls
                    filteredCount={filteredSuggestionRows.length}
                    selectedFilteredCount={selectedFilteredCount}
                    onToggleSelectAll={() => {
                      if (aiFilterBlocksSelect) return;
                      if (effectiveTargeting === "keywords") {
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
                      effectiveTargeting === "keywords"
                        ? keywordMatchKeys.map((key) => {
                            const indexes = keywordRows
                              .map((row, index) => ({ row, index }))
                              .filter(
                                ({ row }) =>
                                  String(row.matchType).toLowerCase() === key,
                              )
                              .map(({ index }) => index);
                            const allSelected =
                              indexes.length > 0 &&
                              indexes.every((index) => selectedKeywords.has(index)) &&
                              selectedKeywords.size === indexes.length;
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
                            const indexes = productRows
                              .map((row, index) => ({ row, index }))
                              .filter(
                                ({ row }) =>
                                  normalizeProductMatchType(row.matchType) === key,
                              )
                              .map(({ index }) => index);
                            const allSelected =
                              indexes.length > 0 &&
                              indexes.every((index) => selectedProducts.has(index)) &&
                              selectedProducts.size === indexes.length;
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
                      effectiveTargeting === "keywords"
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
                {effectiveTargeting === "keywords"
                  ? filteredKeywordRows.slice(0, visibleSuggestionCount).map(({ row, index }) => {
                      const suggested = recommendationBidMajorUnits(row.suggestedBid);
                      const mode = keywordBidModes[index] ?? "default";
                      return (
                        <AmazonKeywordSuggestionRow
                          key={`${row.keyword}-${row.matchType}-${index}`}
                          keyword={row.keyword}
                          matchType={row.matchType}
                          selected={selectedKeywords.has(index)}
                          suggestedBid={suggested}
                          defaultBid={defaultBidAmount}
                          currency={primaryCurrency}
                          bidMode={mode}
                          customBidText={
                            keywordCustomBids[index] ??
                            (suggested != null
                              ? suggested.toFixed(2)
                              : defaultBidAmount.toFixed(2))
                          }
                          useSuggestedBids={useSuggestedBids}
                          onToggle={() => toggleKeyword(index)}
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
                      const mode = productBidModes[index] ?? "default";
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
                          bidMode={mode}
                          customBidText={
                            productCustomBids[index] ??
                            (suggested != null
                              ? suggested.toFixed(2)
                              : defaultBidAmount.toFixed(2))
                          }
                          useSuggestedBids={useSuggestedBids}
                          titleLoading={suggestionTitlesLoading}
                          onToggle={() => toggleProduct(index)}
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
            ) : null}

            {effectiveTargeting === "keywords" ? (
              <View style={styles.pasteBlock}>
                <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
                  Or paste keywords (one per line)
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
                  testID="adgroup-create-custom-keywords"
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
                {customKeywords.length ? (
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                    {customKeywords.length} custom keyword
                    {customKeywords.length === 1 ? "" : "s"}
                  </Text>
                ) : null}
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
                  testID="adgroup-create-custom-asins"
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
                {customAsins.length ? (
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                    {customAsins.length} custom ASIN
                    {customAsins.length === 1 ? "" : "s"}
                  </Text>
                ) : null}
              </View>
            )}
          </SectionCard>
        )}

        <PrimaryButton
          testID="adgroup-create-submit"
          label={
            aiFilterPending
              ? "AI filtering…"
              : aiFilterNeedsConfirm
                ? "Confirm AI filter first"
                : submitting
                  ? "Creating…"
                  : "Create ad group"
          }
          full
          loading={submitting}
          disabled={
            !canSubmit || submitting || aiFilterPending || aiFilterNeedsConfirm
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
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: "continuous",
  },
  input: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
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
