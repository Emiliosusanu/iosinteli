import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AmazonKeywordSuggestionRow } from "@/src/components/AmazonKeywordSuggestionRow";
import { AmazonProductSuggestionRow } from "@/src/components/AmazonProductSuggestionRow";
import { BookCover } from "@/src/components/BookCover";
import {
  CreateReveal,
  CreateScalePressable,
  CreateStickyReveal,
} from "@/src/components/CreateMotion";
import {
  alertMutationError,
  blockIfCannotWriteAmazon,
} from "@/src/components/Mutations";
import {
  EmptyState,
  ListCard,
  Pill,
  PrimaryButton,
  RetryState,
  ScreenSpinner,
  SecondaryButton,
} from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl } from "@/src/components/ios/Native";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { playHaptic } from "@/src/lib/hapticPolicy";
import {
  countryFlagEmoji,
  profileDisplayName,
  profileEnabled,
} from "@/src/lib/accountsUi";
import {
  clusterKeywordSuggestionsByPhrase,
  fetchAsinDisplayMeta,
  fetchAmazonRetailTitles,
  isAsinAsTitle,
  mergeAsinDisplayMeta,
  normalizeProductMatchType,
  normalizeSuggestionStockStatus,
  productMatchSelectLabel,
  reasonSelectLabel,
  recommendationBidMajorUnits,
  resolveSuggestionBid,
  rowMatchesReasonKey,
  sortProductSuggestionsByTitleSimilarity,
  uniqueKeywordMatchTypes,
  uniqueKeywordPhraseCount,
  formatKeywordSuggestionCountLabel,
  suggestionRelevanceNeedsUserConfirm,
  uniqueProductMatchTypes,
  uniqueReasonKeys,
  type AsinDisplayMeta,
  type BidMode,
  type KeywordMatchType,
  type ProductMatchType,
  type SuggestionReasonKey,
} from "@/src/lib/amazonCampaignSuggestions";
import { SuggestionAiFilterChrome } from "@/src/components/SuggestionAiFilterChrome";
import {
  priorityAsinsForTitleEnrichment,
  RETAIL_FIRST_WAVE,
  RETAIL_TAIL_CHUNK,
  RETAIL_TAIL_CONCURRENCY,
  RETAIL_TAIL_MAX,
  RETAIL_TAIL_RETRIES,
  RETAIL_TAIL_TIMEOUT_MS,
} from "@/src/hooks/useProductSuggestionAsinMeta";
import {
  advertisedAsinForCreateFormat,
  createFlowFormatOptions,
  defaultCreateFormatAsin,
  formatsFromWorkKey,
  type BookFormatOption,
} from "@/src/lib/bookCampaignFormats";
import {
  adsStockSoftListed,
  amazonAdsStockConfirmed,
  CAMPAIGN_CREATION_BOOKS_QUERY_KEY,
  CAMPAIGN_CREATION_SELECTED_BOOK_KEY,
  createPaperbackSearchEmptyMessage,
  ineligibleOutOfStockPaperbacks,
  isKindleAsinOnPrintWork,
  isPaperbackCreateCandidate,
  isPaperbackFormatCandidate,
  kindleAsinsFromCatalog,
  printAsinForDigitalFromCatalog,
  printAsinFromWorkKey,
  isRetryableCreationStatus,
  liveStockStatusFromMarketplaces,
  marketplaceFallbackHint,
  marketplaceIsCreateChoice,
  marketplacesFromBookProfiles,
  matchLocalProfileForCreationMarketplace,
  paperbackEditionStockCaption,
  parseCustomAsins,
  searchCreatePaperbacks,
  workFamilyKey,
  type LiveAsinStock,
} from "@/src/lib/campaignCreationStock";
import { formatCurrency } from "@/src/lib/format";
import {
  keywordDedupeKey,
  prepareKeywordAdds,
  prepareProductTargetAdds,
  productTargetDedupeKey,
} from "@/src/lib/adGroupTargets";
import {
  createCampaign,
  fetchCampaignCreationBooks,
  fetchCampaignCreationMarketplaces,
  previewCampaignCreation,
  resolveCreationProfileId,
  type CampaignCreationBook,
  type CampaignCreationMarketplace,
  type CampaignCreationPreview,
  type CampaignCreationTargeting,
} from "@/src/lib/mutations";
import { fetchActiveCampaignsForBookProfile, fetchTargetingBookOptions } from "@/src/lib/queries";
import { sortedProfileIds } from "@/src/lib/periodQuery";
import { CAMPAIGN_CREATION_BOOKS_TIMEOUT_MS, CAMPAIGN_CREATION_MARKETPLACES_TIMEOUT_MS, isHomeQueryTimeout, withQueryTimeout } from "@/src/lib/queryTimeout";
import { targetingBookHasCampaigns } from "@/src/lib/targetingBookFilter";
import { appQueryClient } from "@/src/lib/queryClient";
import { NestApiError, userMessageForNestError } from "@/src/lib/rulesApi";
import { useReduceMotion, useTheme } from "@/src/lib/theme";

type StatusTone = "good" | "warning" | "danger" | "inactive";

function stockCaptionTone(caption: string): StatusTone {
  if (caption.startsWith("In stock")) return "good";
  if (
    caption === "Out of stock" ||
    caption.startsWith("No profile") ||
    caption.startsWith("Check failed") ||
    caption.startsWith("Catalog only")
  ) {
    return "danger";
  }
  if (
    caption.startsWith("Checking") ||
    caption.startsWith("Linked") ||
    caption.startsWith("Stock not") ||
    caption.startsWith("Availability")
  ) {
    return "warning";
  }
  return "inactive";
}

function StepHeader({
  step,
  title,
  hint,
}: {
  step: number;
  title: string;
  hint?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text
        style={[
          t.typography.caption2,
          {
            color: t.colors.text_tertiary,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          },
        ]}
      >
        {step}
      </Text>
      <Text
        style={[
          t.typography.headline,
          { color: t.colors.text_primary, fontWeight: "600", letterSpacing: -0.2 },
        ]}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_tertiary, lineHeight: 18 },
          ]}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

type Strategy = "LEGACY_FOR_SALES" | "AUTO_FOR_SALES" | "MANUAL";
const SUGGESTION_PAGE_SIZE = 50;
const BOOK_PAGE_SIZE = 60;

function requestId() {
  return `ios-campaign-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function amount(value: string, min: number, max: number) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function catalogErrorSubtitle(error: unknown) {
  if (isHomeQueryTimeout(error)) {
    return "Book catalog is taking longer than usual. Try again.";
  }
  if (error instanceof NestApiError) {
    if (error.status === 429)
      return "Amazon is busy. Wait a moment, then retry.";
    if (error.status === 401) return "Session expired. Sign in again.";
    if (error.status === 403)
      return "This marketplace isn’t linked to your account.";
    if (error.status === 404) return "Try again in a moment.";
    if (error.status >= 500) return "Service temporarily unavailable.";
  }
  return "Check your connection and retry.";
}

function emptyBooksCopy(
  counts?: Awaited<
    ReturnType<typeof fetchCampaignCreationBooks>
  >["verification"],
) {
  if (!counts)
    return {
      title: "No paperbacks",
      subtitle: "No paperback books are ready to advertise yet.",
    };
  if (counts.kdpAccountCount === 0) {
    return {
      title: "Connect KDP first",
      subtitle: "Link a KDP account, then return here.",
    };
  }
  if (counts.kdpTitleCount === 0) {
    return {
      title: "Catalog still syncing",
      subtitle: "Keep KDP Helper open until titles finish importing.",
    };
  }
  if (counts.kdpPaperbackCount === 0)
    return {
      title: "No paperbacks yet",
      subtitle: "Refresh the KDP catalog, then retry.",
    };
  return {
    title: "No paperbacks yet",
    subtitle: "Refresh the KDP catalog, then retry.",
  };
}

/** Soft shell while Amazon/AI loads — keeps Create paused + Filtering chrome honest. */
function pendingKeywordCountsShell(): NonNullable<
  CampaignCreationPreview["keywordCounts"]
> {
  return {
    amazonApiRowCount: 0,
    amazonApiPhraseCount: 0,
    amazonRowCount: 0,
    amazonPhraseCount: 0,
    keptRowCount: 0,
    keptPhraseCount: 0,
    grokFiltered: false,
    grokPending: true,
    relevanceOutcome: "pending",
  };
}

function parseCustomKeywords(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      const key = keyword.toLocaleLowerCase();
      if (!keyword || keyword.length > 80 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 1000);
}

function Choice({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <CreateScalePressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      hapticSelect
      onPress={onPress}
      style={[
        styles.choice,
        {
          borderColor: selected ? t.colors.tone_primary : t.colors.separator,
          backgroundColor: selected
            ? `${t.colors.tone_primary}18`
            : t.colors.background_secondary,
          opacity: disabled ? 0.45 : 1,
          shadowColor: selected ? t.colors.tone_primary : "transparent",
          shadowOpacity: selected ? 0.2 : 0,
          shadowRadius: selected ? 8 : 0,
          shadowOffset: { width: 0, height: 2 },
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          t.typography.footnote,
          {
            color: selected ? t.colors.tone_primary : t.colors.text_primary,
            fontWeight: "600",
            flexShrink: 1,
          },
        ]}
      >
        {label}
      </Text>
    </CreateScalePressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
  suffix,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  suffix?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 125 }}>
      <Text
        style={[
          t.typography.caption1,
          { color: t.colors.text_secondary, marginBottom: 5 },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputShell,
          {
            backgroundColor: t.colors.background_tertiary,
            borderColor: t.colors.separator,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.colors.text_tertiary}
          keyboardType={numeric ? "decimal-pad" : "default"}
          autoCorrect={!numeric}
          style={[
            t.typography.body,
            styles.input,
            { color: t.colors.text_primary },
          ]}
        />
        {suffix ? (
          <Text
            style={[t.typography.footnote, { color: t.colors.text_secondary }]}
          >
            {suffix}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function CreateCampaignScreen() {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const routeParams = useLocalSearchParams<{
    asin?: string | string[];
    profileId?: string | string[];
    targeting?: string | string[];
    workKey?: string | string[];
  }>();
  const prefAsin = String(
    Array.isArray(routeParams.asin) ? routeParams.asin[0] : routeParams.asin ?? "",
  )
    .trim()
    .toUpperCase();
  const prefProfileId = String(
    Array.isArray(routeParams.profileId)
      ? routeParams.profileId[0]
      : routeParams.profileId ?? "",
  ).trim();
  const prefWorkKey = String(
    Array.isArray(routeParams.workKey)
      ? routeParams.workKey[0]
      : routeParams.workKey ?? "",
  ).trim();
  const prefTargetingRaw = String(
    Array.isArray(routeParams.targeting)
      ? routeParams.targeting[0]
      : routeParams.targeting ?? "",
  )
    .trim()
    .toLowerCase();
  const prefTargeting: CampaignCreationTargeting | null =
    prefTargetingRaw === "auto" ||
    prefTargetingRaw === "keywords" ||
    prefTargetingRaw === "products"
      ? prefTargetingRaw
      : null;
  const { profiles, adminFilterUserId } = useApp();
  const { guestMode, user } = useAuth();
  const viewAsOtherUser = Boolean(
    adminFilterUserId && adminFilterUserId !== user?.id,
  );
  const availableProfiles = useMemo(() => {
    // Create campaign must see every enabled Ads profile the seller owns —
    // selected Overview filters must not hide the only profile that carries
    // this paperback.
    return profiles.filter(profileEnabled);
  }, [profiles]);
  const [profileId, setProfileId] = useState(prefProfileId);
  const [adsProfileId, setAdsProfileId] = useState(prefProfileId);
  const [book, setBook] = useState<CampaignCreationBook | null>(null);
  /** After pick, collapse the long list; Change expands the full picker again. */
  const [bookPickerExpanded, setBookPickerExpanded] = useState(!prefAsin);
  const [bookSearch, setBookSearch] = useState(prefAsin);
  const [visibleBookCount, setVisibleBookCount] = useState(BOOK_PAGE_SIZE);
  const [targeting, setTargeting] = useState<CampaignCreationTargeting>(
    // Keywords by default so Step 2 AI filter is visible (Automatic skips suggestions).
    prefTargeting ?? "keywords",
  );
  const prefillFormats = useMemo(
    () => createFlowFormatOptions(formatsFromWorkKey(prefWorkKey)),
    [prefWorkKey],
  );
  /** Exclusive chip selection — must track taps; do not force value to PRINT. */
  const [selectedFormatAsin, setSelectedFormatAsin] = useState<string | null>(
    () => defaultCreateFormatAsin(createFlowFormatOptions(formatsFromWorkKey(prefWorkKey))),
  );
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [preview, setPreview] = useState<CampaignCreationPreview | null>(null);
  // Stable entity identities prevent an AI/meta re-rank from moving a checkmark
  // onto a different keyword or ASIN before Create is pressed.
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(
    new Set(),
  );
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set(),
  );
  const [visibleSuggestionCount, setVisibleSuggestionCount] =
    useState(SUGGESTION_PAGE_SIZE);
  const [customKeywordText, setCustomKeywordText] = useState("");
  const [customAsinText, setCustomAsinText] = useState("");
  const [customKeywordMatch, setCustomKeywordMatch] = useState<
    "broad" | "phrase" | "exact"
  >("broad");
  const [liveStockByAsin, setLiveStockByAsin] = useState<
    Record<string, LiveAsinStock>
  >({});
  const [name, setName] = useState("");
  const [adGroupName, setAdGroupName] = useState("Main ad group");
  const [budget, setBudget] = useState("");
  const [defaultBid, setDefaultBid] = useState("");
  /** On — Amazon suggested bids (cents→major already repaired). Toggle off for default only. */
  const [useSuggestedBids, setUseSuggestedBids] = useState(true);
  const [productBidModes, setProductBidModes] = useState<
    Record<number, BidMode>
  >({});
  const [productCustomBids, setProductCustomBids] = useState<
    Record<number, string>
  >({});
  const [globalProductBidMode, setGlobalProductBidMode] =
    useState<BidMode>("default");
  const [keywordBidModes, setKeywordBidModes] = useState<
    Record<number, BidMode>
  >({});
  const [keywordCustomBids, setKeywordCustomBids] = useState<
    Record<number, string>
  >({});
  const [globalKeywordBidMode, setGlobalKeywordBidMode] =
    useState<BidMode>("default");
  const [bulkCustomBidText, setBulkCustomBidText] = useState("");
  const [matchTypeBidTexts, setMatchTypeBidTexts] = useState<
    Partial<Record<KeywordMatchType | ProductMatchType, string>>
  >({});
  const [suggestionMetaByAsin, setSuggestionMetaByAsin] = useState<
    Record<string, AsinDisplayMeta>
  >({});
  const [suggestionTitlesLoading, setSuggestionTitlesLoading] = useState(false);
  const suggestionMetaGenRef = useRef(0);
  const suggestionRetailAttemptedRef = useRef<Set<string>>(new Set());
  const suggestionMetaByAsinRef = useRef(suggestionMetaByAsin);
  suggestionMetaByAsinRef.current = suggestionMetaByAsin;
  const prefTargetingPrefetchRef = useRef(false);
  /** One-shot recover when soft shell is left after a discarded paint. */
  const softShellRecoverRef = useRef(false);
  /** Bumps on each preview request / marketplace reset so late callbacks cannot overwrite. */
  const previewRequestGenRef = useRef(0);
  const targetingRef = useRef(targeting);
  targetingRef.current = targeting;
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("LEGACY_FOR_SALES");
  const [topPlacement, setTopPlacement] = useState("0");
  const [productPlacement, setProductPlacement] = useState("0");
  const [restPlacement, setRestPlacement] = useState("0");
  const [enableAfterCreate, setEnableAfterCreate] = useState(false);

  const booksQ = useQuery({
    queryKey: CAMPAIGN_CREATION_BOOKS_QUERY_KEY,
    queryFn: ({ signal }) =>
      withQueryTimeout(fetchCampaignCreationBooks(), CAMPAIGN_CREATION_BOOKS_TIMEOUT_MS, signal),
    // One soft retry on timeout — kill/relaunch stress often races Nest cold start.
    retry: (count, error) => count < 1 && isHomeQueryTimeout(error),
    retryDelay: 1_500,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  const createActivityProfileIds = useMemo(
    () => sortedProfileIds(availableProfiles.map((p) => p.profile_id || p.id)),
    [availableProfiles],
  );
  const createBookActivityQ = useQuery({
    queryKey: [
      "campaign-creation-book-activity",
      createActivityProfileIds.join(","),
      adminFilterUserId ?? "",
    ],
    queryFn: () =>
      fetchTargetingBookOptions(createActivityProfileIds, {
        filterUserId: adminFilterUserId,
        purpose: "create",
      }),
    enabled: createActivityProfileIds.length > 0 && !guestMode,
    staleTime: 60_000,
  });
  const createActivityByAsin = useMemo(() => {
    const map = new Map<string, { hasKdpData: boolean; hasCampaign: boolean }>();
    for (const row of createBookActivityQ.data ?? []) {
      const stamp = {
        hasKdpData: !!row.hasKdpData,
        hasCampaign: targetingBookHasCampaigns(row),
      };
      const ids = [
        String(row.asin ?? "").trim().toUpperCase(),
        ...(row.formatAsins ?? []).map((id) => String(id).trim().toUpperCase()),
      ].filter(Boolean);
      for (const id of ids) {
        const prev = map.get(id);
        map.set(id, {
          hasKdpData: !!(prev?.hasKdpData || stamp.hasKdpData),
          hasCampaign: !!(prev?.hasCampaign || stamp.hasCampaign),
        });
      }
    }
    return map;
  }, [createBookActivityQ.data]);
  const creationBooksWithActivity = useMemo(() => {
    const books = booksQ.data?.books ?? [];
    if (!createActivityByAsin.size) return books;
    return books.map((book) => {
      const asin = String(book.asin ?? "")
        .trim()
        .toUpperCase();
      const stamp = createActivityByAsin.get(asin);
      if (!stamp) return book;
      return {
        ...book,
        hasKdpData: stamp.hasKdpData,
        hasCampaign: stamp.hasCampaign,
      };
    });
  }, [booksQ.data?.books, createActivityByAsin]);

  const marketplacesQ = useQuery({
    queryKey: ["campaign-creation-marketplaces", book?.asin],
    queryFn: ({ signal }) =>
      withQueryTimeout(
        fetchCampaignCreationMarketplaces(book!.asin),
        CAMPAIGN_CREATION_MARKETPLACES_TIMEOUT_MS,
        signal,
      ),
    enabled: Boolean(book),
    retry: (count, error) =>
      count < 3 &&
      error instanceof NestApiError &&
      isRetryableCreationStatus(error.status),
    retryDelay: (count) => Math.min(8000, 1500 * 2 ** count),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const existingCampaignsQ = useQuery({
    queryKey: [
      "campaign-creation-existing",
      adsProfileId || profileId,
      book?.asin ?? "",
    ],
    queryFn: () =>
      fetchActiveCampaignsForBookProfile({
        profileId: adsProfileId || profileId,
        asin: book!.asin,
      }),
    enabled: Boolean(book?.asin && (adsProfileId || profileId)),
    staleTime: 30_000,
  });

  useFocusEffect(
    useCallback(() => {
      void booksQ.refetch();
      if (book?.asin) void marketplacesQ.refetch();
    }, [book?.asin, booksQ.refetch, marketplacesQ.refetch]),
  );

  const previewM = useMutation({
    mutationFn: async (nextTargeting?: CampaignCreationTargeting) => {
      const gen = ++previewRequestGenRef.current;
      const requestTargeting = nextTargeting ?? targetingRef.current;
      try {
        const result = await previewCampaignCreation({
          profileId: adsProfileId || profileId,
          advertisedAsin: book!.asin,
          targeting: requestTargeting,
          onAmazonReady: (partial) => {
            // Step 1: paint Amazon totals immediately. Do NOT select-all raw rows —
            // Step 2 (AI filter) must finish before we pre-select the kept set.
            if (gen !== previewRequestGenRef.current) {
              console.log(
                `[inteliads:create-preview] paint discarded gen=${gen} current=${previewRequestGenRef.current} phase=onAmazonReady`,
              );
              return;
            }
            if (targetingRef.current !== requestTargeting) {
              console.log(
                `[inteliads:create-preview] paint discarded targeting=${requestTargeting}→${targetingRef.current} phase=onAmazonReady`,
              );
              return;
            }
            setPreview(partial);
            setVisibleSuggestionCount(SUGGESTION_PAGE_SIZE);
            setSelectedKeywords(new Set());
            setSelectedProducts(new Set());
          },
        });
        return { result, gen, requestTargeting };
      } catch (error) {
        // Stale errors must not wipe a newer successful paint (soft shell / Kept).
        if (error && typeof error === "object") {
          (error as { previewGen?: number; requestTargeting?: string }).previewGen =
            gen;
          (
            error as { previewGen?: number; requestTargeting?: string }
          ).requestTargeting = requestTargeting;
        }
        throw error;
      }
    },
    onMutate: () => {
      setSuggestionsError(null);
    },
    onSuccess: (payload) => {
      const { result, gen, requestTargeting } = payload;
      if (gen !== previewRequestGenRef.current) {
        console.log(
          `[inteliads:create-preview] paint discarded gen=${gen} current=${previewRequestGenRef.current} phase=onSuccess kept=${result.keywords?.length ?? 0}/${result.productTargets?.length ?? 0}`,
        );
        return;
      }
      if (targetingRef.current !== requestTargeting) {
        console.log(
          `[inteliads:create-preview] paint discarded targeting=${requestTargeting}→${targetingRef.current} phase=onSuccess`,
        );
        return;
      }
      console.log(
        `[inteliads:create-preview] paint applied keywords=${result.keywords?.length ?? 0} products=${result.productTargets?.length ?? 0} outcome=${result.keywordCounts?.relevanceOutcome ?? "n/a"}`,
      );
      setSuggestionsError(null);
      // Advance generation so in-flight enrich from a prior preview is ignored.
      // Late meta for THIS gen still applies when gen matches (progressive).
      const metaGen = ++suggestionMetaGenRef.current;
      suggestionRetailAttemptedRef.current = new Set();
      setPreview(result);
      setVisibleSuggestionCount(SUGGESTION_PAGE_SIZE);
      // Suggestions are recommendations, not user intent. A completed AI
      // filter must never silently choose rows on the seller's behalf.
      setSelectedKeywords(new Set());
      setSelectedProducts(new Set());
      setProductBidModes({});
      setProductCustomBids({});
      setGlobalProductBidMode("default");
      setKeywordBidModes({});
      setKeywordCustomBids({});
      setGlobalKeywordBidMode("default");
      setBulkCustomBidText("");
      setMatchTypeBidTexts({});
      const asins = [
        ...new Set(result.productTargets.map((row) => String(row.asin).toUpperCase())),
      ];
      const nestSeed = new Map<string, AsinDisplayMeta>();
      for (const row of result.productTargets) {
        const asin = String(row.asin).toUpperCase();
        const prev = nestSeed.get(asin);
        nestSeed.set(asin, {
          title:
            (prev?.title && !isAsinAsTitle(prev.title, asin)
              ? prev.title
              : null) ||
            (row.title && !isAsinAsTitle(row.title, asin) ? row.title : null),
          subtitle: prev?.subtitle ?? row.subtitle ?? null,
          coverUrl: prev?.coverUrl ?? row.coverUrl ?? null,
          stockStatus: normalizeSuggestionStockStatus(
            prev?.stockStatus ?? row.stockStatus,
          ),
          publishedAt: prev?.publishedAt ?? row.publishedAt ?? null,
        });
      }
      const seeded: Record<string, AsinDisplayMeta> = {};
      for (const [asin, value] of nestSeed) seeded[asin] = value;
      // Seed immediately — never flash empty meta before Nest titles apply.
      setSuggestionMetaByAsin(seeded);
      setSuggestionTitlesLoading(
        asins.some((asin) => !seeded[asin]?.title),
      );

      if (!asins.length) {
        setSuggestionTitlesLoading(false);
        return;
      }

      const profileKey = adsProfileId || profileId;
      const applyMetaPatch = (partial: Map<string, AsinDisplayMeta> | Record<string, AsinDisplayMeta>) => {
        if (metaGen !== suggestionMetaGenRef.current) return false;
        const entries =
          partial instanceof Map ? [...partial.entries()] : Object.entries(partial);
        if (!entries.length) return true;
        setSuggestionMetaByAsin((prev) => {
          const next = { ...prev };
          for (const [asin, meta] of entries) {
            const key = String(asin).toUpperCase();
            next[key] = mergeAsinDisplayMeta(prev[key], meta);
          }
          return next;
        });
        return true;
      };

      void (async () => {
        try {
          // Fast path: Nest/catalog/KDP/Open Library — paint titles ASAP.
          const meta = await fetchAsinDisplayMeta({
            asins,
            profileIds: profileKey ? [profileKey] : [],
            nestMetaByAsin: nestSeed,
            skipRetail: true,
          });
          if (!applyMetaPatch(meta)) return;

          // Clear Loading after catalog — do not wait on retail scrapes (often
          // blocked offline). Unresolved rows fall through to Title unavailable.
          const visibleSeed = asins.slice(0, SUGGESTION_PAGE_SIZE);
          const prioritized = priorityAsinsForTitleEnrichment(asins, visibleSeed);
          const needTitles = prioritized.filter((asin) => !meta.get(asin)?.title);
          if (metaGen === suggestionMetaGenRef.current) {
            setSuggestionTitlesLoading(false);
          }
          if (!needTitles.length) return;

          // Background retail only — capped; prefer visible window first.
          // Never re-arm suggestionTitlesLoading. Load-more triggers another wave.
          const retailCap = RETAIL_FIRST_WAVE + RETAIL_TAIL_MAX;
          const chunkSize = RETAIL_TAIL_CHUNK;
          const capped = needTitles.slice(0, retailCap);
          for (const asin of capped) {
            suggestionRetailAttemptedRef.current.add(asin);
          }
          for (let i = 0; i < capped.length; i += chunkSize) {
            if (metaGen !== suggestionMetaGenRef.current) return;
            const chunk = capped.slice(i, i + chunkSize);
            const retail = await fetchAmazonRetailTitles(chunk, {
              concurrency: RETAIL_TAIL_CONCURRENCY,
              retries: RETAIL_TAIL_RETRIES,
              timeoutMs: RETAIL_TAIL_TIMEOUT_MS,
              countryCode:
                result.profile?.countryCode ??
                selectedMarketplace?.countryCode ??
                null,
            });
            if (!retail.size) continue;
            const patch = new Map<string, AsinDisplayMeta>();
            for (const [asin, title] of retail) {
              const cur = meta.get(asin) ?? nestSeed.get(asin) ?? {
                title: null,
                subtitle: null,
                coverUrl: null,
                stockStatus: "unknown" as const,
              };
              patch.set(asin, { ...cur, title });
              meta.set(asin, { ...cur, title });
            }
            if (!applyMetaPatch(patch)) return;
          }
        } catch {
          // Soft-fail: covers still work via CDN; paste ASINs still available.
        } finally {
          if (metaGen === suggestionMetaGenRef.current) {
            setSuggestionTitlesLoading(false);
          }
        }
      })();

    },
    onError: (error, nextTargeting) => {
      const errMeta =
        error && typeof error === "object"
          ? (error as { previewGen?: number; requestTargeting?: string })
          : {};
      // Stale failure from a superseded gen must not clobber Kept / in-flight paint.
      if (
        typeof errMeta.previewGen === "number" &&
        errMeta.previewGen !== previewRequestGenRef.current
      ) {
        console.log(
          `[inteliads:create-preview] onError discarded gen=${errMeta.previewGen} current=${previewRequestGenRef.current}`,
        );
        return;
      }
      setSelectedKeywords(new Set());
      setSelectedProducts(new Set());
      setSuggestionTitlesLoading(false);
      const activeTargeting =
        (errMeta.requestTargeting as CampaignCreationTargeting | undefined) ??
        nextTargeting ??
        targetingRef.current;
      // Soft-fail: keep an empty preview shell so sellers can still paste
      // custom keywords / ASINs when Amazon rate-limits recommendations.
      // Ignore stale errors from a superseded targeting switch.
      if (
        targetingRef.current === activeTargeting &&
        book &&
        (activeTargeting === "keywords" || activeTargeting === "products")
      ) {
        // Soft shell stays; Refresh retries. Do not clear prefetch or we loop onError.
        setPreview({
          source: "amazon_ads",
          fetchedAt: new Date().toISOString(),
          recommendationsAvailable: false,
          profile: {
            id: adsProfileId || profileId,
            profileId: adsProfileId || profileId,
            countryCode: selectedMarketplace?.countryCode ?? null,
            currencyCode: selectedMarketplace?.currencyCode ?? null,
            marketplaceId: selectedMarketplace?.marketplaceId ?? null,
          },
          book: {
            asin: book.asin,
            title: book.title,
            subtitle: null,
            author: null,
            topic: null,
            coverUrl: book.coverUrl,
          },
          duplicateAuto: null,
          amazonKeywordApi: { rowCount: 0, phraseCount: 0 },
          keywords: [],
          productTargets: [],
          keywordCounts: pendingKeywordCountsShell(),
        });
      } else if (targetingRef.current === activeTargeting) {
        setPreview(null);
      }
      const message = userMessageForNestError(
        error,
        "Amazon couldn't load suggestions. Nothing was substituted or created.",
      );
      setSuggestionsError(message);
      const status = error instanceof NestApiError ? error.status : 0;
      const rateLimited =
        /rate limiting|temporarily unavailable|retry in a moment/i.test(message);
      // 429 / 5xx / Amazon soft rate-limit copy: inline Retry (paste still works).
      // Alert only for hard non-retryable failures.
      if (status === 429 || status >= 500 || status === 0 || rateLimited) {
        return;
      }
      // Soft-fallback / linked CA·US rows mean Nest bulk already tied this
      // paperback to the profile (often with active campaigns). Do NOT append
      // the "pick an in-stock paperback" scare — that contradicts the picker
      // and mislabels Amazon eligibility flakes as OOS (NE CA 1807973751).
      const advertisableHint =
        /advertisable|not confirm this ASIN|unpublished|suppressed|ineligible/i.test(
          message,
        );
      const softLinked =
        usingFallbackMarketplaces ||
        Boolean(selectedMarketplace && adsStockSoftListed(selectedMarketplace)) ||
        (existingCampaignsQ.data?.length ?? 0) > 0;
      const alertBody = advertisableHint
        ? softLinked
          ? `${message}\n\nThis marketplace is linked and may already advertise this book. Retry Refresh — Amazon's eligibility check can flake even when the paperback is in stock.`
          : `${message}\n\nPick an in-stock, currently published paperback for this marketplace. Unpublished or suppressed ASINs cannot load Amazon suggestions.`
        : message;
      Alert.alert("Couldn't load suggestions", alertBody);
    },
  });

  const createM = useMutation({
    mutationFn: async () => {
      const dailyBudget = amount(budget, 1, 1_000_000)!;
      const bid = amount(defaultBid, 0.02, 1000)!;
      const customAsins = parseCustomAsins(customAsinText);
      return createCampaign({
        profileId: adsProfileId || profileId,
        advertisedAsin: book!.asin,
        targeting,
        name: name.trim(),
        adGroupName: adGroupName.trim(),
        dailyBudget,
        defaultBid: bid,
        biddingStrategy: strategy,
        placements: {
          topOfSearch: amount(topPlacement, 0, 900)!,
          productPages: amount(productPlacement, 0, 900)!,
          restOfSearch: amount(restPlacement, 0, 900)!,
        },
        enableAfterCreate,
        requestId: requestId(),
        keywords:
          targeting === "keywords"
            ? prepareKeywordAdds([
                ...selectedKeywordIndexes.map((index) => {
                  const row = keywordSuggestionRows[index];
                  const mode = keywordBidModes[index] ?? globalKeywordBidMode;
                  const customRaw = Number(
                    String(keywordCustomBids[index] ?? "").replace(",", "."),
                  );
                  return {
                    keyword: row.keyword,
                    matchType: row.matchType,
                    bid: resolveSuggestionBid({
                      mode,
                      customBid: Number.isFinite(customRaw) ? customRaw : null,
                      suggestedBid: recommendationBidMajorUnits(row.suggestedBid),
                      defaultBid: bid,
                      useSuggestedBids,
                    }),
                    source: "suggested" as const,
                  };
                }),
                ...parseCustomKeywords(customKeywordText).map((keyword) => ({
                  keyword,
                  matchType: customKeywordMatch,
                  bid,
                  source: "custom" as const,
                })),
              ]).keywords
            : undefined,
        productTargets:
          targeting === "products"
            ? prepareProductTargetAdds([
                ...selectedProductIndexes.map((index) => {
                  const row = preview!.productTargets[index];
                  const mode = productBidModes[index] ?? globalProductBidMode;
                  const customRaw = Number(
                    String(productCustomBids[index] ?? "").replace(",", "."),
                  );
                  return {
                    asin: row.asin,
                    matchType: normalizeProductMatchType(row.matchType),
                    bid: resolveSuggestionBid({
                      mode,
                      customBid: Number.isFinite(customRaw) ? customRaw : null,
                      suggestedBid: recommendationBidMajorUnits(row.suggestedBid),
                      defaultBid: bid,
                      useSuggestedBids,
                    }),
                    source: "suggested" as const,
                  };
                }),
                ...customAsins.map((asin) => ({
                  asin,
                  matchType: "exact" as const,
                  bid,
                  source: "custom" as const,
                })),
              ]).productTargets
            : undefined,
      });
    },
    onSuccess: (result) => {
      void playHaptic("success", reduceMotion);
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["product-campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-product-targets"] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-adgroups"] });
      void queryClient.invalidateQueries({ queryKey: ["campaign-products"] });
      Alert.alert(
        result.state === "enabled"
          ? "Campaign active"
          : "Campaign created paused",
        "Amazon confirmed the campaign, ad group, advertised product, and targeting.",
        [
          {
            text: "Open campaign",
            onPress: () => router.replace(`/campaign/${result.campaignId}`),
          },
        ],
      );
    },
    onError: (error) => {
      void playHaptic("error", reduceMotion);
      alertMutationError(
        error,
        "Amazon didn't confirm the complete setup. Nothing is presented as active.",
      );
    },
  });

  function resetAfterMarketplace(next: CampaignCreationMarketplace) {
    suggestionMetaGenRef.current += 1;
    previewRequestGenRef.current += 1;
    prefTargetingPrefetchRef.current = false;
    setProfileId(next.id);
    setAdsProfileId(resolveCreationProfileId(next));
    setPreview(null);
    setSuggestionsError(null);
    setSuggestionMetaByAsin({});
    setSuggestionTitlesLoading(false);
    // Drop selected-book stock so the prior marketplace's availability cannot stick.
    if (book?.asin) {
      const asin = String(book.asin).toUpperCase();
      setLiveStockByAsin((prev) => {
        if (!(asin in prev)) return prev;
        const nextMap = { ...prev };
        delete nextMap[asin];
        return nextMap;
      });
    }
    setSelectedKeywords(new Set());
    setSelectedProducts(new Set());
    setVisibleSuggestionCount(SUGGESTION_PAGE_SIZE);
  }

  function selectBook(next: CampaignCreationBook) {
    // Sponsored Products advertise PRINT — never leave the Kindle parent ASIN
    // selected when the work encodes a paperback sibling (including Nest rows
    // that mis-tag Kindle as format=paperback with a bare workKey).
    const catalog = booksQ.data?.books ?? [];
    const kindleAsins = kindleAsinsFromCatalog(catalog);
    let resolved = next;
    if (isKindleAsinOnPrintWork(next, kindleAsins)) {
      const printAsin =
        printAsinFromWorkKey(next.workKey) ??
        printAsinForDigitalFromCatalog(next.asin, catalog);
      const sibling =
        (printAsin
          ? catalog.find(
              (row) => String(row.asin).toUpperCase() === printAsin,
            )
          : undefined) ??
        catalog.find(
          (row) =>
            workFamilyKey(row) === workFamilyKey(next) &&
            !isKindleAsinOnPrintWork(row, kindleAsins) &&
            isPaperbackCreateCandidate(
              row,
              liveStockByAsin[String(row.asin).toUpperCase()] ?? null,
              kindleAsins,
            ),
        );
      if (!sibling) {
        Alert.alert(
          "Paperback needed",
          "Kindle edition — pick its paperback.",
        );
        return;
      }
      resolved = sibling;
      setBookSearch(sibling.asin);
    }
    const live = liveStockByAsin[String(resolved.asin).toUpperCase()];
    // QA / Books→Create deep-link: allow format-ok preferred ASIN even when
    // Nest activity stamps have not yet merged onto the catalog row (ISBN NE).
    const deepLinkAllow =
      Boolean(prefAsin) &&
      String(resolved.asin).toUpperCase() === prefAsin &&
      isPaperbackFormatCandidate(resolved, kindleAsins) &&
      live?.status !== "out_of_stock";
    if (
      !deepLinkAllow &&
      !isPaperbackCreateCandidate(resolved, live ?? null, kindleAsins)
    ) {
      Alert.alert(
        live?.status === "out_of_stock"
          ? "Out of stock"
          : "Not available for ads",
        live?.status === "out_of_stock"
          ? `${resolved.asin} is out of stock. Pick another paperback.`
          : live?.status === "pending"
            ? "Still checking this paperback. Try again in a moment."
            : "This paperback is not available for ads right now.",
      );
      return;
    }
    suggestionMetaGenRef.current += 1;
    prefTargetingPrefetchRef.current = false;
    setBook(resolved);
    setBookPickerExpanded(false);
    void playHaptic("select");
    appQueryClient.setQueryData(
      [CAMPAIGN_CREATION_SELECTED_BOOK_KEY, String(resolved.asin).toUpperCase()],
      {
        asin: String(resolved.asin).toUpperCase(),
        title: resolved.title || null,
        coverUrl: resolved.coverUrl ?? null,
        workKey: resolved.workKey ?? null,
        sku: resolved.sku ?? null,
        publishedAt: resolved.publishedAt ?? null,
      },
    );
    // Clear prior marketplace, but keep QA / Books→Create deep-link profile so
    // Targeting does not stick on "Choose a book and marketplace first" when the
    // search-tap path calls selectBook after prefill already ran.
    if (prefProfileId) {
      setProfileId(prefProfileId);
      setAdsProfileId(prefProfileId);
    } else {
      setProfileId("");
      setAdsProfileId("");
    }
    previewRequestGenRef.current += 1;
    setPreview(null);
    setSuggestionMetaByAsin({});
    setSuggestionTitlesLoading(false);
    // Fresh book — do not keep prior ASINs' in/out-of-stock captions.
    setLiveStockByAsin({});
    setSelectedKeywords(new Set());
    setSelectedProducts(new Set());
    setVisibleSuggestionCount(SUGGESTION_PAGE_SIZE);
    setCustomKeywordText("");
    setCustomAsinText("");
    setName(
      `${resolved.title.slice(0, 82)} - ${targeting === "auto" ? "Auto" : targeting === "keywords" ? "Keywords" : "Products"}`,
    );
  }

  // Prefill from Books → Create campaign (asin / workKey / profileId / targeting).
  useEffect(() => {
    if (prefillApplied || !booksQ.data?.books?.length) return;
    if (!prefAsin && !prefWorkKey) {
      setPrefillApplied(true);
      return;
    }
    const catalog = booksQ.data.books;
    const chipDefault =
      defaultCreateFormatAsin(prefillFormats) ||
      defaultCreateFormatAsin(formatsFromWorkKey(prefWorkKey));
    if (chipDefault && !selectedFormatAsin) {
      setSelectedFormatAsin(chipDefault);
    }
    const selectedFmt: BookFormatOption | undefined = prefillFormats.find(
      (f) => f.asin === (selectedFormatAsin || chipDefault),
    );
    const wantAsin =
      advertisedAsinForCreateFormat(
        selectedFmt ?? prefillFormats.find((f) => f.asin === chipDefault),
        prefillFormats,
        prefWorkKey,
      ) ||
      prefAsin ||
      chipDefault;
    const byAsin = wantAsin
      ? catalog.find((row) => String(row.asin).toUpperCase() === wantAsin)
      : undefined;
    const family = prefWorkKey
      ? workFamilyKey({ asin: prefAsin || wantAsin || "", workKey: prefWorkKey })
      : "";
    const byFamily = family
      ? catalog.find((row) => workFamilyKey(row) === family)
      : undefined;
    const match = byAsin || byFamily;
    const kindleAsins = kindleAsinsFromCatalog(catalog);
    const liveForMatch = match
      ? liveStockByAsin[String(match.asin).toUpperCase()] ?? null
      : null;
    // Deep-link / QA: prefer format-ok row even when Nest stock stamps lag —
    // otherwise search shows the paperback ("In stock") while book stays null
    // and Targeting sticks on "Choose a book and marketplace first" (NE ISBN).
    const deepLinkPick =
      Boolean(prefAsin) &&
      match &&
      String(match.asin).toUpperCase() === prefAsin &&
      isPaperbackFormatCandidate(match, kindleAsins) &&
      liveForMatch?.status !== "out_of_stock";
    const stockPick =
      match &&
      isPaperbackCreateCandidate(match, liveForMatch, kindleAsins);
    if (match && (deepLinkPick || stockPick)) {
      selectBook(match);
      if (prefProfileId) {
        setProfileId(prefProfileId);
        // Prefer Ads profile id for suggestions; local id alone left Targeting gated.
        const hit = availableProfiles.find(
          (p) => p.id === prefProfileId || p.profile_id === prefProfileId,
        );
        setAdsProfileId(hit?.profile_id || hit?.id || prefProfileId);
      }
    } else if (wantAsin) {
      setBookSearch(wantAsin);
    }
    setPrefillApplied(true);
    // Intentionally once after catalog load — avoid re-select loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booksQ.data, prefAsin, prefWorkKey, prefillFormats, prefillApplied]);

  useEffect(() => {
    if (!prefProfileId || !book) return;
    if (profileId === prefProfileId || adsProfileId === prefProfileId) return;
    const hit = availableProfiles.find(
      (p) => p.id === prefProfileId || p.profile_id === prefProfileId,
    );
    if (hit) {
      setProfileId(hit.id);
      setAdsProfileId(hit.profile_id || hit.id);
    } else if (!adsProfileId) {
      // Deep-link Ads profile id before local profile rows hydrate.
      setAdsProfileId(prefProfileId);
      setProfileId(prefProfileId);
    }
  }, [prefProfileId, book, availableProfiles, profileId, adsProfileId]);

  const validSettings = Boolean(
    name.trim().length >= 3 &&
    adGroupName.trim() &&
    amount(budget, 1, 1_000_000) != null &&
    amount(defaultBid, 0.02, 1000) != null &&
    amount(topPlacement, 0, 900) != null &&
    amount(productPlacement, 0, 900) != null &&
    amount(restPlacement, 0, 900) != null,
  );
  const customKeywords = useMemo(
    () => parseCustomKeywords(customKeywordText),
    [customKeywordText],
  );
  const customAsins = useMemo(
    () => parseCustomAsins(customAsinText),
    [customAsinText],
  );
  const duplicateBlocked =
    targeting === "auto" && Boolean(preview?.duplicateAuto);
  const returnedMarketplaces =
    book &&
    marketplacesQ.data?.asin &&
    marketplacesQ.data.asin === book.asin
      ? marketplacesQ.data.marketplaces
      : [];
  const liveFinished =
    Boolean(book) &&
    !marketplacesQ.isPending &&
    !marketplacesQ.isFetching &&
    marketplacesQ.data?.asin === book?.asin;
  const liveInStockCount =
    returnedMarketplaces.filter(amazonAdsStockConfirmed).length;
  const liveCreateChoiceCount =
    returnedMarketplaces.filter(marketplaceIsCreateChoice).length;
  // Soft-fallback while loading, on Nest/Amazon errors, Nest in_stock, or
  // existing-product-ad evidence (tolerate flaky empty rechecks — Iceland).
  // When live returned soft listed profiles, prefer those over "incomplete"
  // book.marketplaceIds fallback (B0FW468FBB Croatia).
  const allowSoftFallback = Boolean(
    book &&
      liveInStockCount === 0 &&
      liveCreateChoiceCount === 0 &&
      (!liveFinished ||
        marketplacesQ.isError ||
        (marketplacesQ.data?.failedCount ?? 0) > 0 ||
        amazonAdsStockConfirmed(book) ||
        adsStockSoftListed(book)),
  );
  // Live /marketplaces for THIS asin is preferred (may under/over-list vs
  // book.marketplaceIds). Soft-fallback uses book.marketplaceIds only — never
  // every enabled profile. Never enrich from another ASIN's response.
  const displayMarketplaces = marketplacesFromBookProfiles(
    availableProfiles,
    book,
    returnedMarketplaces,
    { allowSoftFallback },
  );
  const usingFallbackMarketplaces =
    Boolean(book) &&
    liveFinished &&
    liveInStockCount === 0 &&
    displayMarketplaces.length > 0;
  // Live soft hits (existing_product_ad) still set usingFallbackMarketplaces so
  // the book pill stays honest ("not reconfirmed"), but that is not a failed
  // availability check — do not block or scare Products suggestions
  // (B0FW468FBB Croatia / US Emilian Susanu).
  const availabilityCheckUnconfirmed =
    allowSoftFallback ||
    marketplacesQ.isError ||
    (marketplacesQ.data?.failedCount ?? 0) > 0;
  const selectedLiveStatus = book
    ? liveStockByAsin[String(book.asin).toUpperCase()]?.status
    : undefined;
  // Soft-fallback rows mean Nest bulk already said in_stock / we tolerate a
  // flaky empty live recheck (Iceland B0HB5MB9L9) — do not block Create just
  // because liveStockStatusFromMarketplaces mapped that miss to out_of_stock.
  const bookLiveIneligible =
    Boolean(book) &&
    displayMarketplaces.length === 0 &&
    selectedLiveStatus === "out_of_stock" &&
    !adsStockSoftListed(book!) &&
    !amazonAdsStockConfirmed(book!);
  const selectedMarketplace = displayMarketplaces.find(
    (marketplace) =>
      marketplace.id === profileId ||
      marketplace.profileId === profileId ||
      marketplace.profileId === adsProfileId,
  );
  const confirmedMarketplaceKey = displayMarketplaces
    .map((marketplace) => marketplace.profileId)
    .join("|");
  // Drop a previously selected profile the moment the book no longer lists it
  // (e.g. Aruba/US Emilian Susanu must not stick after picking Puerto Rico).
  // Wait until live marketplace rows settle — clearing mid-fetch wiped
  // deep-link CA/US profileId and left Targeting stuck on
  // "Choose a book and marketplace first" while chips still looked selected.
  // Never wipe a deep-link / route profile for the deep-linked ASIN (live can
  // return empty / soft while Nest still accepts preview on that profile).
  useEffect(() => {
    if (!book) return;
    if (!profileId && !adsProfileId) return;
    if (selectedMarketplace) return;
    if (!liveFinished) return;
    const deepLinkHold =
      Boolean(prefProfileId) &&
      Boolean(prefAsin) &&
      String(book.asin).toUpperCase() === prefAsin &&
      (profileId === prefProfileId ||
        adsProfileId === prefProfileId ||
        availableProfiles.some(
          (p) =>
            (p.id === prefProfileId || p.profile_id === prefProfileId) &&
            (profileId === p.id ||
              adsProfileId === p.profile_id ||
              adsProfileId === p.id),
        ));
    if (deepLinkHold) return;
    if (displayMarketplaces.length === 0 && returnedMarketplaces.length === 0) {
      return;
    }
    const listed =
      displayMarketplaces.some(
        (marketplace) =>
          marketplace.id === prefProfileId ||
          marketplace.profileId === prefProfileId ||
          marketplace.id === profileId ||
          marketplace.profileId === profileId ||
          marketplace.profileId === adsProfileId,
      ) ||
      returnedMarketplaces.some((marketplace) => {
        const adsId = String(marketplace.profileId || marketplace.id || "");
        return (
          adsId === prefProfileId ||
          adsId === profileId ||
          adsId === adsProfileId
        );
      });
    if (listed) return;
    suggestionMetaGenRef.current += 1;
    previewRequestGenRef.current += 1;
    prefTargetingPrefetchRef.current = false;
    setProfileId("");
    setAdsProfileId("");
    setPreview(null);
    setSuggestionMetaByAsin({});
    setSuggestionTitlesLoading(false);
    setSelectedKeywords(new Set());
    setSelectedProducts(new Set());
  }, [
    book?.asin,
    confirmedMarketplaceKey,
    profileId,
    adsProfileId,
    prefProfileId,
    prefAsin,
    availableProfiles,
    selectedMarketplace,
    liveFinished,
    displayMarketplaces,
    returnedMarketplaces,
  ]);
  // canCreate depends on selectedTargetCount (below, after suggestion ranking).
  const canCreateBase = Boolean(
    preview &&
    selectedMarketplace &&
    adsProfileId &&
    book &&
    !bookLiveIneligible &&
    validSettings &&
    !duplicateBlocked &&
    !createM.isPending,
  );

  // QA / deep-link: bind prefProfileId so chips + Targeting unlock even when
  // selectBook cleared ids, live chips lag, or /marketplaces returns empty.
  useEffect(() => {
    if (!book || !prefProfileId) return;
    if (bookLiveIneligible) return;
    if (selectedMarketplace) return;
    if (profileId === prefProfileId || adsProfileId === prefProfileId) return;
    const fromDisplay = displayMarketplaces.find(
      (marketplace) =>
        marketplace.id === prefProfileId ||
        marketplace.profileId === prefProfileId ||
        resolveCreationProfileId(marketplace) === prefProfileId,
    );
    if (fromDisplay) {
      resetAfterMarketplace(fromDisplay);
      return;
    }
    if (liveFinished) {
      const fromLive = returnedMarketplaces.find((marketplace) => {
        const adsId = String(marketplace.profileId || marketplace.id || "");
        return adsId === prefProfileId && marketplaceIsCreateChoice(marketplace);
      });
      if (fromLive) {
        resetAfterMarketplace({
          id: String(fromLive.id || fromLive.profileId || prefProfileId),
          profileId: String(fromLive.profileId || fromLive.id || prefProfileId),
          countryCode: fromLive.countryCode,
          currencyCode: fromLive.currencyCode,
          marketplaceId: fromLive.marketplaceId,
          availabilityEvidence: fromLive.availabilityEvidence,
          stockStatus: fromLive.stockStatus,
          sku: fromLive.sku,
          verificationSource: fromLive.verificationSource,
        });
        return;
      }
    }
    // Local Ads profile row is enough to unlock Targeting + Nest preview while
    // live /marketplaces is empty or still in flight (CA NE ISBN deep-link).
    const fromLocal = availableProfiles.find(
      (p) => p.id === prefProfileId || p.profile_id === prefProfileId,
    );
    if (!fromLocal) {
      if (!adsProfileId && !profileId) {
        setAdsProfileId(prefProfileId);
        setProfileId(prefProfileId);
      }
      return;
    }
    resetAfterMarketplace({
      id: fromLocal.id,
      profileId: fromLocal.profile_id || fromLocal.id,
      countryCode: fromLocal.country_code,
      currencyCode: fromLocal.currency_code,
      marketplaceId: fromLocal.marketplace_id,
      availabilityEvidence: "existing_product_ad",
      stockStatus: null,
    });
  }, [
    book?.asin,
    prefProfileId,
    liveFinished,
    bookLiveIneligible,
    selectedMarketplace,
    confirmedMarketplaceKey,
    returnedMarketplaces,
    displayMarketplaces,
    availableProfiles,
    profileId,
    adsProfileId,
  ]);

  useEffect(() => {
    if (!book) return;
    // Deep-link / QA profile wins — do not steal CA/US onto a sole soft chip.
    if (prefProfileId) return;
    if (displayMarketplaces.length !== 1) return;
    if (bookLiveIneligible) return;
    const only = displayMarketplaces[0];
    if (
      profileId === only.id &&
      adsProfileId === resolveCreationProfileId(only)
    ) {
      return;
    }
    resetAfterMarketplace(only);
  }, [
    book?.asin,
    confirmedMarketplaceKey,
    profileId,
    adsProfileId,
    bookLiveIneligible,
    prefProfileId,
  ]);

  // Auto-fetch Amazon suggestions (+ AI filter) when book + marketplace are ready.
  // Segment onChange does not fire for the initial Keywords default.
  // Soft shell alone (pending + empty rows) must not block a one-shot retry after a
  // discarded paint left Filtering chrome with no Amazon rows forever.
  useEffect(() => {
    softShellRecoverRef.current = false;
  }, [targeting, book?.asin, adsProfileId]);
  useEffect(() => {
    if (targeting === "auto") return;
    if (!book || !adsProfileId || bookLiveIneligible) return;
    if (previewM.isPending) return;
    const shellStuck =
      preview != null &&
      preview.keywordCounts?.grokPending === true &&
      !preview.recommendationsAvailable &&
      (preview.keywords?.length ?? 0) === 0 &&
      (preview.productTargets?.length ?? 0) === 0;
    if (preview && !shellStuck) return;
    if (shellStuck) {
      if (softShellRecoverRef.current) return;
      softShellRecoverRef.current = true;
    } else if (prefTargetingPrefetchRef.current) {
      return;
    }
    prefTargetingPrefetchRef.current = true;
    if (!preview) {
      setPreview({
        source: "amazon_ads",
        fetchedAt: new Date().toISOString(),
        recommendationsAvailable: false,
        profile: {
          id: adsProfileId || profileId,
          profileId: adsProfileId || profileId,
          countryCode: selectedMarketplace?.countryCode ?? null,
          currencyCode: selectedMarketplace?.currencyCode ?? null,
          marketplaceId: selectedMarketplace?.marketplaceId ?? null,
        },
        book: {
          asin: book.asin,
          title: book.title,
          subtitle: null,
          author: null,
          topic: null,
          coverUrl: book.coverUrl,
        },
        duplicateAuto: null,
        amazonKeywordApi: { rowCount: 0, phraseCount: 0 },
        keywords: [],
        productTargets: [],
        keywordCounts: pendingKeywordCountsShell(),
      });
    }
    previewM.mutate(targeting);
  }, [
    targeting,
    book?.asin,
    adsProfileId,
    bookLiveIneligible,
    preview,
    previewM.isPending,
  ]);

  // Sync selected-book live marketplaces into the batch stock map.
  useEffect(() => {
    if (!book || !liveFinished || !marketplacesQ.data) return;
    const asin = String(book.asin).toUpperCase();
    const status = liveStockStatusFromMarketplaces({
      marketplaces: returnedMarketplaces,
      checkedCount: marketplacesQ.data.checkedCount,
      failedCount: marketplacesQ.data.failedCount,
      requestFailed: marketplacesQ.isError,
      nestBuyable:
        amazonAdsStockConfirmed(book) || adsStockSoftListed(book),
    });
    setLiveStockByAsin((prev) =>
      prev[asin]?.status === status ? prev : { ...prev, [asin]: { status } },
    );
  }, [
    book?.asin,
    liveFinished,
    liveInStockCount,
    marketplacesQ.data?.checkedCount,
    marketplacesQ.data?.failedCount,
    marketplacesQ.isError,
  ]);

  // Live stock for the selected ASIN only (marketplacesQ). No batch
  // /marketplaces sweep — that spammed availability counts and falsely marked
  // buyable existing-product-ad paperbacks out of stock (Iceland B0HB5MB9L9).

  const currency =
    preview?.profile.currencyCode || selectedMarketplace?.currencyCode || "";
  const matchingBooks = useMemo(
    () => {
      const rows = searchCreatePaperbacks(
        creationBooksWithActivity,
        bookSearch,
        liveStockByAsin,
      );
      const chipAsin =
        selectedFormatAsin &&
        prefillFormats.some((f) => f.asin === selectedFormatAsin)
          ? selectedFormatAsin
          : defaultCreateFormatAsin(prefillFormats);
      const chip = prefillFormats.find((f) => f.asin === chipAsin);
      if (!chip || chip.kind === "paperback") return rows;
      // Kindle / Hardcover: keep works that encode this format ASIN so the
      // chip filters the catalog (ads ASIN still remaps to PRINT via selectBook).
      return rows.filter((book) => {
        const wk = String(book.workKey ?? "").toUpperCase();
        if (chip.kind === "kindle") {
          return wk.includes(`DIGITAL=${chip.asin}`);
        }
        if (chip.kind === "hardcover") {
          return (
            wk.includes(`HARDCOVER=${chip.asin}`) ||
            String(book.asin).toUpperCase() === chip.asin
          );
        }
        return true;
      });
    },
    [
      bookSearch,
      creationBooksWithActivity,
      liveStockByAsin,
      selectedFormatAsin,
      prefillFormats,
    ],
  );
  const searchEmptyMessage = useMemo(
    () =>
      createPaperbackSearchEmptyMessage({
        search: bookSearch,
        books: creationBooksWithActivity,
      }),
    [bookSearch, creationBooksWithActivity],
  );
  const ineligibleBooks = useMemo(
    () => ineligibleOutOfStockPaperbacks(creationBooksWithActivity, liveStockByAsin),
    [creationBooksWithActivity, liveStockByAsin],
  );
  const groupedBooks = useMemo(() => {
    const groups = new Map<string, CampaignCreationBook[]>();
    for (const item of matchingBooks.slice(0, visibleBookCount)) {
      // A shared title is not evidence that two ASINs are editions of one
      // KDP book. Only the KDP work identity may group them.
      const key = item.workKey || item.asin;
      const rows = groups.get(key) ?? [];
      rows.push(item);
      groups.set(key, rows);
    }
    return [...groups.values()];
  }, [matchingBooks, visibleBookCount]);
  const emptyBooks = booksQ.data
    ? emptyBooksCopy(booksQ.data.verification)
    : null;
  const keywordSuggestionRows = useMemo(
    () => clusterKeywordSuggestionsByPhrase(preview?.keywords ?? []),
    [preview?.keywords],
  );
  const suggestionRows =
    targeting === "keywords"
      ? keywordSuggestionRows
      : (preview?.productTargets ?? []);
  const titleByAsin = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const [asin, meta] of Object.entries(suggestionMetaByAsin)) {
      map.set(asin, meta.title);
    }
    return map;
  }, [suggestionMetaByAsin]);
  const rankedProductSuggestions = useMemo(() => {
    if (targeting !== "products" || !preview?.productTargets.length) return [];
    const withMeta = preview.productTargets.map((row) => {
      const asin = String(row.asin).toUpperCase();
      const meta = suggestionMetaByAsin[asin];
      return {
        ...row,
        title: meta?.title ?? row.title ?? null,
        subtitle: meta?.subtitle ?? row.subtitle ?? null,
        coverUrl: meta?.coverUrl ?? row.coverUrl ?? null,
        stockStatus:
          meta?.stockStatus ??
          normalizeSuggestionStockStatus(row.stockStatus),
        publishedAt: meta?.publishedAt ?? row.publishedAt ?? null,
      };
    });
    // Sort on the full Nest list so originalIndex stays aligned with
    // selectedProducts / create payload indices.
    return sortProductSuggestionsByTitleSimilarity(
      withMeta,
      book?.title ?? preview.book?.title ?? "",
      titleByAsin,
    ).filter((row) => /^[A-Z0-9]{10}$/.test(String(row.asin).toUpperCase()));
  }, [
    targeting,
    preview?.productTargets,
    preview?.book?.title,
    book?.title,
    titleByAsin,
    suggestionMetaByAsin,
  ]);
  const productSuggestionCount =
    targeting === "products"
      ? rankedProductSuggestions.length
      : suggestionRows.length;
  const selectedKeywordIndexes = useMemo(
    () =>
      keywordSuggestionRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) =>
          selectedKeywords.has(keywordDedupeKey(row.keyword, row.matchType)),
        )
        .map(({ index }) => index),
    [selectedKeywords, keywordSuggestionRows],
  );
  const selectedProductIndexes = useMemo(
    () =>
      (preview?.productTargets ?? [])
        .map((row, index) => ({ row, index }))
        .filter(({ row }) =>
          selectedProducts.has(productTargetDedupeKey(row.asin, row.matchType)),
        )
        .map(({ index }) => index),
    [selectedProducts, preview?.productTargets],
  );
  const selectedKeywordIdentityCount = useMemo(() => {
    const keys = new Set(
      selectedKeywordIndexes.map((index) => {
        const row = keywordSuggestionRows[index];
        return keywordDedupeKey(row.keyword, row.matchType);
      }),
    );
    for (const keyword of customKeywords) {
      keys.add(keywordDedupeKey(keyword, customKeywordMatch));
    }
    return keys.size;
  }, [
    selectedKeywordIndexes,
    keywordSuggestionRows,
    customKeywords,
    customKeywordMatch,
  ]);
  const selectedProductIdentityCount = useMemo(() => {
    const keys = new Set(
      selectedProductIndexes.map((index) => {
        const row = preview?.productTargets[index];
        return productTargetDedupeKey(row?.asin ?? "", row?.matchType);
      }),
    );
    for (const asin of customAsins) {
      keys.add(productTargetDedupeKey(asin, "exact"));
    }
    return keys.size;
  }, [selectedProductIndexes, preview?.productTargets, customAsins]);
  const selectedProductVisibleCount = selectedProductIndexes.length;
  const selectedTargetCount =
    targeting === "keywords"
      ? selectedKeywordIdentityCount
      : targeting === "products"
        ? selectedProductIdentityCount
        : 0;
  const hasTargets = targeting === "auto" || selectedTargetCount > 0;
  const aiFilterPending = Boolean(preview?.keywordCounts?.grokPending);
  const aiFilterNeedsConfirm = suggestionRelevanceNeedsUserConfirm(
    preview?.keywordCounts,
  );
  const aiFilterBlocksSelect = aiFilterPending || aiFilterNeedsConfirm;
  const canCreate = Boolean(
    canCreateBase &&
      hasTargets &&
      !aiFilterPending &&
      !aiFilterNeedsConfirm &&
      !previewM.isPending,
  );
  const acceptAmazonUnfiltered = useCallback(() => {
    setPreview((prev) => {
      if (!prev?.keywordCounts) return prev;
      return {
        ...prev,
        keywordCounts: {
          ...prev.keywordCounts,
          relevanceOutcome: "user_accepted_unfiltered",
          relevanceError: undefined,
        },
      };
    });
    if (targeting === "keywords") {
      setSelectedKeywords(new Set());
    } else if (targeting === "products") {
      setSelectedProducts(new Set());
    }
  }, [targeting]);

  const productReasonKeys = useMemo(
    () => uniqueReasonKeys(rankedProductSuggestions),
    [rankedProductSuggestions],
  );
  const keywordMatchKeys = useMemo(
    () => uniqueKeywordMatchTypes(keywordSuggestionRows),
    [keywordSuggestionRows],
  );
  const productMatchKeys = useMemo(
    () => uniqueProductMatchTypes(rankedProductSuggestions),
    [rankedProductSuggestions],
  );
  const defaultBidAmount = amount(defaultBid, 0.02, 1000) ?? 0.75;
  const visibleSuggestionRows =
    targeting === "products"
      ? rankedProductSuggestions.slice(0, visibleSuggestionCount)
      : suggestionRows.slice(0, visibleSuggestionCount);

  // Load more on Products: retail titles for newly visible ranked ASINs that
  // the initial capped wave never reached. Never re-arm Loading.
  useEffect(() => {
    if (targeting !== "products") return;
    if (visibleSuggestionCount <= SUGGESTION_PAGE_SIZE) return;
    const visibleAsins = rankedProductSuggestions
      .slice(0, visibleSuggestionCount)
      .map((row) => String(row.asin).toUpperCase())
      .filter((asin) => /^[A-Z0-9]{10}$/.test(asin));
    const prevMeta = suggestionMetaByAsinRef.current;
    const missing = visibleAsins.filter((asin) => {
      const title = prevMeta[asin]?.title;
      if (title && !isAsinAsTitle(title, asin)) return false;
      return !suggestionRetailAttemptedRef.current.has(asin);
    });
    if (!missing.length) return;

    const gen = suggestionMetaGenRef.current;
    for (const asin of missing) {
      suggestionRetailAttemptedRef.current.add(asin);
    }
    const countryCode =
      preview?.profile?.countryCode ??
      selectedMarketplace?.countryCode ??
      null;

    void (async () => {
      for (let i = 0; i < missing.length; i += RETAIL_TAIL_CHUNK) {
        if (gen !== suggestionMetaGenRef.current) return;
        const chunk = missing.slice(i, i + RETAIL_TAIL_CHUNK);
        const retail = await fetchAmazonRetailTitles(chunk, {
          concurrency: RETAIL_TAIL_CONCURRENCY,
          retries: RETAIL_TAIL_RETRIES,
          timeoutMs: RETAIL_TAIL_TIMEOUT_MS,
          countryCode,
        });
        if (gen !== suggestionMetaGenRef.current || !retail.size) continue;
        setSuggestionMetaByAsin((prev) => {
          const next = { ...prev };
          for (const [asin, title] of retail) {
            const key = String(asin).toUpperCase();
            next[key] = mergeAsinDisplayMeta(prev[key], {
              title,
              subtitle: prev[key]?.subtitle ?? null,
              coverUrl: prev[key]?.coverUrl ?? null,
              stockStatus: prev[key]?.stockStatus ?? "unknown",
            });
          }
          return next;
        });
      }
    })();
  }, [
    targeting,
    visibleSuggestionCount,
    rankedProductSuggestions,
    preview?.profile?.countryCode,
    selectedMarketplace?.countryCode,
  ]);

  function toggleSuggestion(index: number, kind: "keywords" | "products") {
    // Block selecting raw Amazon rows while Step 2 is pending or needs confirm.
    if (aiFilterBlocksSelect) return;
    const key =
      kind === "keywords"
        ? (() => {
            const row = keywordSuggestionRows[index];
            return row ? keywordDedupeKey(row.keyword, row.matchType) : null;
          })()
        : (() => {
            const row = preview?.productTargets[index];
            return row ? productTargetDedupeKey(row.asin, row.matchType) : null;
          })();
    if (!key) return;
    const setter = kind === "keywords" ? setSelectedKeywords : setSelectedProducts;
    setter((old) => {
      const next = new Set(old);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      return next;
    });
  }

  /** Exclusive: select all of this match type, deselect other types. */
  function selectKeywordsByMatchType(match: KeywordMatchType) {
    if (aiFilterBlocksSelect) return;
    const next = new Set<string>();
    keywordSuggestionRows.forEach((row) => {
      if (row.matchType === match) {
        next.add(keywordDedupeKey(row.keyword, row.matchType));
      }
    });
    setSelectedKeywords(next);
  }

  function toggleSelectAllSuggestions() {
    // Block select-all of raw Amazon rows while Step 2 AI filter is running
    // or while failure/empty-restore still needs an explicit confirm.
    if (aiFilterBlocksSelect) return;
    if (targeting === "keywords") {
      const keys = keywordSuggestionRows.map((row) =>
        keywordDedupeKey(row.keyword, row.matchType),
      );
      const allOn =
        keys.length > 0 && keys.every((key) => selectedKeywords.has(key));
      setSelectedKeywords(allOn ? new Set() : new Set(keys));
      return;
    }
    if (targeting === "products") {
      const keys = rankedProductSuggestions.map((row) =>
        productTargetDedupeKey(row.asin, row.matchType),
      );
      const allOn =
        keys.length > 0 && keys.every((key) => selectedProducts.has(key));
      setSelectedProducts(allOn ? new Set() : new Set(keys));
    }
  }

  function selectProductsByMatchType(match: ProductMatchType) {
    const next = new Set<string>();
    for (const row of rankedProductSuggestions) {
      if (normalizeProductMatchType(row.matchType) === match) {
        next.add(productTargetDedupeKey(row.asin, row.matchType));
      }
    }
    setSelectedProducts(next);
  }

  function selectProductsByReason(key: SuggestionReasonKey) {
    setSelectedProducts((old) => {
      const next = new Set(old);
      for (const row of rankedProductSuggestions) {
        if (rowMatchesReasonKey(row.themes, key)) {
          next.add(productTargetDedupeKey(row.asin, row.matchType));
        }
      }
      return next;
    });
  }

  function clearProductsByReason(key: SuggestionReasonKey) {
    setSelectedProducts((old) => {
      const next = new Set(old);
      for (const row of rankedProductSuggestions) {
        if (rowMatchesReasonKey(row.themes, key)) {
          next.delete(productTargetDedupeKey(row.asin, row.matchType));
        }
      }
      return next;
    });
  }

  function applyBulkCustomBid(text: string) {
    const parsed = Number(String(text).replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0.02) return;
    const amountText = parsed.toFixed(2);
    if (targeting === "keywords") {
      setGlobalKeywordBidMode("custom");
      setKeywordBidModes((old) => {
        const next = { ...old };
        for (const index of selectedKeywordIndexes) next[index] = "custom";
        return next;
      });
      setKeywordCustomBids((old) => {
        const next = { ...old };
        for (const index of selectedKeywordIndexes) next[index] = amountText;
        return next;
      });
    } else {
      setGlobalProductBidMode("custom");
      setProductBidModes((old) => {
        const next = { ...old };
        for (const index of selectedProductIndexes) next[index] = "custom";
        return next;
      });
      setProductCustomBids((old) => {
        const next = { ...old };
        for (const index of selectedProductIndexes) next[index] = amountText;
        return next;
      });
    }
  }

  function applyMatchTypeCustomBid(
    match: KeywordMatchType | ProductMatchType,
    text: string,
  ) {
    const parsed = Number(String(text).replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0.02) return;
    const amountText = parsed.toFixed(2);
    if (targeting === "keywords") {
      const indexes: number[] = [];
      keywordSuggestionRows.forEach((row, index) => {
        if (row.matchType === match) indexes.push(index);
      });
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
    } else {
      const indexes = rankedProductSuggestions
        .filter((row) => normalizeProductMatchType(row.matchType) === match)
        .map((row) => row.originalIndex);
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
    }
  }

  const stickyReserve = 88 + Math.max(insets.bottom, 10);
  // Active campaigns used to sit above Targeting and pushed "Your keywords" /
  // Amazon suggestions off the first viewport (Refresh-only + Create paused).
  // Keep suggestions in-flow under Targeting; Active lists below Budget.
  const bookCollapsed = Boolean(book) && !bookPickerExpanded;
  const showSuggestionStickyChrome = false;
  const keywordPhraseCount = useMemo(
    () => uniqueKeywordPhraseCount(keywordSuggestionRows),
    [keywordSuggestionRows],
  );
  const suggestionsCountLabel = useMemo(() => {
    if (targeting === "products") {
      if (preview?.keywordCounts) {
        return formatKeywordSuggestionCountLabel(preview.keywordCounts, {
          shownCount: productSuggestionCount,
          selectedCount: selectedTargetCount || undefined,
        });
      }
      return `${productSuggestionCount} · ${selectedTargetCount} selected`;
    }
    if (preview?.keywordCounts) {
      return formatKeywordSuggestionCountLabel(preview.keywordCounts, {
        shownCount: keywordSuggestionRows.length,
        selectedCount: selectedTargetCount || undefined,
      });
    }
    if (!keywordSuggestionRows.length) return `${selectedTargetCount} selected`;
    // Fallback when keywordCounts missing (stale preview): still show phrases.
    return keywordPhraseCount < keywordSuggestionRows.length
      ? `${keywordPhraseCount} phrases · ${keywordSuggestionRows.length} · ${selectedTargetCount} selected`
      : `${keywordSuggestionRows.length} · ${selectedTargetCount} selected`;
  }, [
    targeting,
    productSuggestionCount,
    selectedTargetCount,
    keywordSuggestionRows.length,
    keywordPhraseCount,
    preview?.keywordCounts,
  ]);
  const existingCampaigns = existingCampaignsQ.data ?? [];

  const collapsedBookRow = book ? (
    <View
      testID="campaign-create-book-collapsed"
      style={[styles.bookTitleRow, { marginTop: 10 }]}
    >
      <BookCover uri={book.coverUrl} asin={book.asin} size="sm" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={2}
          style={[
            t.typography.headline,
            {
              color: t.colors.text_primary,
              fontWeight: "600",
              letterSpacing: -0.2,
            },
          ]}
        >
          {book.title}
        </Text>
        <Text
          selectable
          style={[
            t.typography.footnote,
            {
              color: t.colors.text_secondary,
              fontVariant: ["tabular-nums"],
            },
          ]}
        >
          {book.asin}
        </Text>
      </View>
      <Pressable
        testID="campaign-create-book-change"
        accessibilityRole="button"
        accessibilityLabel="Change book"
        onPress={() => {
          setBookPickerExpanded(true);
          setVisibleBookCount(BOOK_PAGE_SIZE);
        }}
        style={({ pressed }) => [
          styles.changeChip,
          {
            borderColor: t.colors.separator,
            backgroundColor: t.colors.background_secondary,
            opacity: pressed ? 0.86 : 1,
          },
        ]}
      >
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.tone_primary, fontWeight: "600" },
          ]}
        >
          Change
        </Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <SubScreen title="Create campaign" chromeVisible>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={12}
      >
      <View style={{ flex: 1 }}>
        {/* Compact sticky kept in tree for tests / future absolute overlay, but
            gated off so suggestions stay in a full-height ScrollView. */}
        {showSuggestionStickyChrome ? (
          <CreateStickyReveal>
          <View
            testID="campaign-create-sticky-chrome"
            style={[
              styles.stickyChrome,
              {
                paddingHorizontal: t.layout.pagePad,
                paddingBottom: 10,
                borderBottomColor: t.colors.separator,
                backgroundColor: t.colors.background_primary,
              },
            ]}
          >
            {/* Compact sticky: leave vertical room for Amazon suggestions. */}
            <View
              style={[
                styles.stickyCompactCard,
                {
                  backgroundColor: t.colors.background_secondary,
                  borderColor: t.colors.separator,
                },
              ]}
            >
              <View style={styles.stickyBookRow}>
                <BookCover uri={book!.coverUrl} asin={book!.asin} size="xs" />
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={[
                      t.typography.callout,
                      {
                        color: t.colors.text_primary,
                        fontWeight: "700",
                        letterSpacing: -0.2,
                      },
                    ]}
                  >
                    {book!.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      t.typography.caption2,
                      {
                        color: t.colors.text_tertiary,
                        fontVariant: ["tabular-nums"],
                      },
                    ]}
                  >
                    {book!.asin}
                    {selectedMarketplace?.countryCode
                      ? ` · ${String(selectedMarketplace.countryCode).toUpperCase()}`
                      : ""}
                    {selectedMarketplace?.currencyCode
                      ? ` · ${selectedMarketplace.currencyCode}`
                      : ""}
                  </Text>
                </View>
                <Pressable
                  testID="campaign-create-book-change"
                  accessibilityRole="button"
                  accessibilityLabel="Change book"
                  onPress={() => {
                    setBookPickerExpanded(true);
                    setVisibleBookCount(BOOK_PAGE_SIZE);
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.changeChip,
                    {
                      borderColor: t.colors.separator,
                      backgroundColor: t.colors.background_tertiary,
                      opacity: pressed ? 0.86 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.typography.caption1,
                      { color: t.colors.tone_primary, fontWeight: "600" },
                    ]}
                  >
                    Change
                  </Text>
                </Pressable>
              </View>
              <IOSSegmentedControl
                testID="campaign-create-targeting"
                forceFallback
                options={[
                  { key: "keywords", label: "Keywords" },
                  { key: "products", label: "Products" },
                  { key: "auto", label: "Auto" },
                ]}
                value={targeting}
                onChange={(type) => {
                  setTargeting(type);
                  setVisibleSuggestionCount(SUGGESTION_PAGE_SIZE);
                  setName(
                    `${book!.title.slice(0, 82)} - ${type === "auto" ? "Auto" : type === "keywords" ? "Keywords" : "Products"}`,
                  );
                  if (type === "keywords" || type === "products") {
                    // Invalidate any in-flight products/keywords preview paint.
                    previewRequestGenRef.current += 1;
                    prefTargetingPrefetchRef.current = false;
                    setPreview({
                      source: "amazon_ads",
                      fetchedAt: new Date().toISOString(),
                      recommendationsAvailable: false,
                      profile: {
                        id: adsProfileId || profileId,
                        profileId: adsProfileId || profileId,
                        countryCode: selectedMarketplace?.countryCode ?? null,
                        currencyCode:
                          selectedMarketplace?.currencyCode ?? null,
                        marketplaceId:
                          selectedMarketplace?.marketplaceId ?? null,
                      },
                      book: {
                        asin: book!.asin,
                        title: book!.title,
                        subtitle: null,
                        author: null,
                        topic: null,
                        coverUrl: book!.coverUrl,
                      },
                      duplicateAuto: null,
                      amazonKeywordApi: { rowCount: 0, phraseCount: 0 },
                      keywords: [],
                      productTargets: [],
                      keywordCounts: pendingKeywordCountsShell(),
                    });
                    if (adsProfileId) {
                      prefTargetingPrefetchRef.current = true;
                      previewM.mutate(type);
                    }
                  } else {
                    previewRequestGenRef.current += 1;
                    prefTargetingPrefetchRef.current = false;
                    setPreview(null);
                  }
                }}
              />
              <View style={styles.stickyActionRow}>
                {displayMarketplaces.length > 1 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.stickyMarketRow}
                  >
                    {displayMarketplaces.map(
                      (marketplace: CampaignCreationMarketplace) => {
                        const local = matchLocalProfileForCreationMarketplace(
                          availableProfiles,
                          marketplace,
                        );
                        const selected =
                          profileId === marketplace.id ||
                          adsProfileId === marketplace.profileId;
                        const label = local
                          ? `${countryFlagEmoji(local.country_code)} ${String(local.country_code || "").toUpperCase() || "Ads"}`
                          : `${countryFlagEmoji(marketplace.countryCode)} ${String(marketplace.countryCode || "").toUpperCase() || "Ads"}`;
                        return (
                          <CreateScalePressable
                            key={`${marketplace.profileId}-${marketplace.id}`}
                            hapticSelect
                            onPress={() => resetAfterMarketplace(marketplace)}
                            style={[
                              styles.stickyMarketChip,
                              {
                                borderColor: selected
                                  ? t.colors.tone_primary
                                  : t.colors.separator,
                                backgroundColor: selected
                                  ? `${t.colors.tone_primary}18`
                                  : t.colors.background_tertiary,
                                shadowColor: selected
                                  ? t.colors.tone_primary
                                  : "transparent",
                                shadowOpacity: selected ? 0.22 : 0,
                                shadowRadius: selected ? 6 : 0,
                                shadowOffset: { width: 0, height: 2 },
                              },
                            ]}
                          >
                            <Text
                              style={[
                                t.typography.caption1,
                                {
                                  color: selected
                                    ? t.colors.tone_primary
                                    : t.colors.text_primary,
                                  fontWeight: selected ? "700" : "500",
                                },
                              ]}
                            >
                              {label}
                            </Text>
                          </CreateScalePressable>
                        );
                      },
                    )}
                  </ScrollView>
                ) : null}
                <Pressable
                  testID="campaign-create-refresh-suggestions"
                  accessibilityRole="button"
                  accessibilityLabel="Refresh suggestions"
                  disabled={previewM.isPending || !adsProfileId}
                  onPress={() => previewM.mutate(undefined)}
                  style={({ pressed }) => [
                    styles.stickyRefresh,
                    {
                      borderColor: t.colors.tone_primary,
                      backgroundColor: `${t.colors.tone_primary}12`,
                      opacity:
                        previewM.isPending || !adsProfileId
                          ? 0.45
                          : pressed
                            ? 0.88
                            : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.typography.caption1,
                      { color: t.colors.tone_primary, fontWeight: "700" },
                    ]}
                  >
                    {previewM.isPending ? "Loading…" : "Refresh"}
                  </Text>
                </Pressable>
              </View>
            </View>
            {targeting !== "auto" ? (
              <Text
                style={[
                  t.typography.caption1,
                  {
                    color: t.colors.text_secondary,
                    fontWeight: "600",
                    marginTop: 2,
                  },
                ]}
              >
                Amazon suggestions
                {preview?.recommendationsAvailable
                  ? ` · ${suggestionsCountLabel}`
                  : ""}
              </Text>
            ) : null}
          </View>
          </CreateStickyReveal>
        ) : null}
        <ScrollView
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          contentContainerStyle={{
            paddingHorizontal: t.layout.pagePad,
            // Sticky chrome is an in-flow sibling above this ScrollView — do not
            // add stickyChromeHeight here (that double-padded and looked like a gap bug).
            paddingTop: 8,
            paddingBottom: preview ? 28 + stickyReserve : 48,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
        {showSuggestionStickyChrome ? null : (
        <ListCard compact>
          <StepHeader step={1} title="Book" />
          {bookCollapsed ? (
            collapsedBookRow
          ) : (
          <>
          {prefillFormats.length > 0 ? (
            <View style={{ gap: 6, marginTop: 12 }}>
              <IOSSegmentedControl
                // Native Host clips 3–4 labels; Pressable fallback keeps taps exclusive.
                forceFallback={prefillFormats.length > 2}
                testID="campaign-create-format"
                options={prefillFormats.map((fmt) => ({
                  key: fmt.asin,
                  label: fmt.label,
                  testID: `campaign-create-format-${fmt.kind}`,
                }))}
                value={
                  (selectedFormatAsin &&
                  prefillFormats.some((f) => f.asin === selectedFormatAsin)
                    ? selectedFormatAsin
                    : null) ??
                  defaultCreateFormatAsin(prefillFormats) ??
                  prefillFormats[0]?.asin
                }
                onChange={(asin) => {
                  const fmt = prefillFormats.find((f) => f.asin === asin);
                  setSelectedFormatAsin(asin);
                  // Search by chip ASIN (Kindle stays Kindle) — not silent PRINT
                  // remap, which made the segmented control feel like a no-op.
                  setBookSearch(asin);
                  setVisibleBookCount(BOOK_PAGE_SIZE);
                  const advertised =
                    advertisedAsinForCreateFormat(
                      fmt,
                      prefillFormats,
                      prefWorkKey,
                    ) ?? asin;
                  const match = (booksQ.data?.books ?? []).find(
                    (row) =>
                      String(row.asin).toUpperCase() ===
                      String(advertised).toUpperCase(),
                  );
                  if (match) {
                    selectBook(match);
                  } else if (
                    fmt?.kind === "hardcover" &&
                    !prefillFormats.some((f) => f.kind === "paperback")
                  ) {
                    Alert.alert(
                      "Paperback needed",
                      "Hardcover isn't available for Sponsored Products create. Use a paperback edition.",
                    );
                  }
                }}
              />
              {(() => {
                const chipAsin =
                  selectedFormatAsin ??
                  defaultCreateFormatAsin(prefillFormats) ??
                  "";
                const chip = prefillFormats.find((f) => f.asin === chipAsin);
                const advertised =
                  advertisedAsinForCreateFormat(
                    chip,
                    prefillFormats,
                    prefWorkKey,
                  ) ?? "";
                if (
                  chip &&
                  chip.kind !== "paperback" &&
                  advertised &&
                  advertised !== chip.asin
                ) {
                  return (
                    <Text
                      style={[
                        t.typography.caption1,
                        { color: t.colors.text_tertiary },
                      ]}
                    >
                      Ads use paperback {advertised}
                    </Text>
                  );
                }
                return null;
              })()}
            </View>
          ) : null}
          {booksQ.isPending ? (
            <ScreenSpinner />
          ) : booksQ.isError ? (
            <RetryState
              title="Couldn't load books"
              subtitle={catalogErrorSubtitle(booksQ.error)}
              onRetry={() => void booksQ.refetch()}
              retrying={booksQ.isFetching}
            />
          ) : booksQ.data?.books.length ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <IOSSearchBar
                value={bookSearch}
                onChangeText={(value) => {
                  setBookSearch(value);
                  setVisibleBookCount(BOOK_PAGE_SIZE);
                }}
                placeholder="Title or ASIN"
                testID="campaign-create-book-search"
              />
              {!bookSearch.trim() && (matchingBooks.length || ineligibleBooks.length) ? (
                <Text
                  style={[
                    t.typography.caption1,
                    { color: t.colors.text_tertiary },
                  ]}
                >
                  {matchingBooks.length} available
                  {ineligibleBooks.length
                    ? ` · ${ineligibleBooks.length} unavailable`
                    : ""}
                </Text>
              ) : null}
              {groupedBooks.map((editions) => {
                const groupSelected = editions.some(
                  (item) => item.asin === book?.asin,
                );
                return (
                <View
                  key={editions[0].workKey || editions[0].asin}
                  style={[
                    styles.bookGroup,
                    {
                      backgroundColor: groupSelected
                        ? `${t.colors.tone_primary}12`
                        : t.colors.background_tertiary,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: groupSelected
                        ? `${t.colors.tone_primary}55`
                        : t.colors.separator,
                    },
                  ]}
                >
                  <View style={styles.bookTitleRow}>
                    <BookCover
                      uri={editions[0].coverUrl}
                      asin={editions[0].asin}
                      size="sm"
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        numberOfLines={3}
                        style={[
                          t.typography.headline,
                          {
                            color: t.colors.text_primary,
                            fontWeight: "600",
                            letterSpacing: -0.2,
                            flexShrink: 1,
                          },
                        ]}
                      >
                        {editions[0].title}
                      </Text>
                      {editions.length > 1 ? (
                        <Text
                          style={[
                            t.typography.caption1,
                            { color: t.colors.text_secondary },
                          ]}
                        >
                          {editions.length} editions
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ gap: 4 }}>
                    {editions.map((item) => {
                      const selected = book?.asin === item.asin;
                      const caption = paperbackEditionStockCaption({
                        book: item,
                        selected,
                        liveInStockCount: selected
                          ? returnedMarketplaces.filter(
                              amazonAdsStockConfirmed,
                            ).length
                          : liveStockByAsin[String(item.asin).toUpperCase()]
                                ?.status === "in_stock"
                            ? 1
                            : 0,
                        livePending:
                          (selected &&
                            (marketplacesQ.isPending ||
                              marketplacesQ.isFetching)) ||
                          liveStockByAsin[String(item.asin).toUpperCase()]
                            ?.status === "pending",
                        displayProfileCount: selected
                          ? displayMarketplaces.length
                          : 0,
                        usingFallback: selected && usingFallbackMarketplaces,
                        liveStatus:
                          liveStockByAsin[String(item.asin).toUpperCase()]
                            ?.status,
                      });
                      return (
                        <Pressable
                          key={item.asin}
                          onPress={() => selectBook(item)}
                          style={({ pressed }) => [
                            styles.editionRow,
                            {
                              backgroundColor: selected
                                ? `${t.colors.tone_primary}18`
                                : t.colors.background_secondary,
                              opacity: pressed ? 0.88 : 1,
                              transform: [{ scale: pressed ? 0.96 : 1 }],
                            },
                          ]}
                        >
                          <View style={styles.editionMain}>
                            <Text
                              selectable
                              style={[
                                t.typography.footnote,
                                {
                                  color: selected
                                    ? t.colors.tone_primary
                                    : t.colors.text_primary,
                                  fontWeight: "600",
                                  fontVariant: ["tabular-nums"],
                                },
                              ]}
                            >
                              Paperback · {item.asin}
                            </Text>
                            <Pill
                              label={caption || "Stock not confirmed"}
                              tone={stockCaptionTone(
                                caption || "Stock not confirmed",
                              )}
                              size="sm"
                            />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                );
              })}
              {matchingBooks.length === 0 ? (
                <Text
                  style={[
                    t.typography.footnote,
                    { color: t.colors.text_secondary, paddingVertical: 6 },
                  ]}
                >
                  {searchEmptyMessage}
                </Text>
              ) : null}
              {matchingBooks.length > visibleBookCount ? (
                <SecondaryButton
                  label={`Show ${Math.min(BOOK_PAGE_SIZE, matchingBooks.length - visibleBookCount)} more`}
                  full
                  onPress={() =>
                    setVisibleBookCount((count) =>
                      Math.min(matchingBooks.length, count + BOOK_PAGE_SIZE),
                    )
                  }
                />
              ) : null}
            </View>
          ) : (
            <EmptyState
              icon="book-outline"
              title={emptyBooks?.title ?? "No paperbacks"}
              subtitle={
                emptyBooks?.subtitle ?? "No paperback books are ready yet."
              }
            />
          )}
          </>
          )}
        </ListCard>
        )}

        {showSuggestionStickyChrome ? null : book ? (
          <CreateReveal delay={40}>
          <ListCard compact>
            <StepHeader step={2} title="Marketplace" />
            {marketplacesQ.isPending && !displayMarketplaces.length ? (
              <ScreenSpinner />
            ) : displayMarketplaces.length ? (
              <>
                <View style={[styles.wrap, { marginTop: 10 }]}>
                  {displayMarketplaces.map(
                    (marketplace: CampaignCreationMarketplace) => {
                      const local = matchLocalProfileForCreationMarketplace(
                        availableProfiles,
                        marketplace,
                      );
                      const label = local
                        ? `${countryFlagEmoji(local.country_code)} ${String(local.country_code || "").toUpperCase() || "Ads"} · ${profileDisplayName({
                            nickname: (local as { nickname?: string | null }).nickname ?? null,
                            account_name:
                              (local as { account_name?: string | null }).account_name ?? null,
                          })} · ${marketplace.currencyCode || local.currency_code || "—"}`
                        : `${countryFlagEmoji(marketplace.countryCode)} ${String(marketplace.countryCode || "").toUpperCase() || "Ads"} · ${marketplace.currencyCode || "—"}`;
                      return (
                        <Choice
                          key={`${marketplace.profileId}-${marketplace.id}`}
                          label={label}
                          selected={
                            profileId === marketplace.id ||
                            adsProfileId === marketplace.profileId
                          }
                          onPress={() => resetAfterMarketplace(marketplace)}
                        />
                      );
                    },
                  )}
                </View>
                {availabilityCheckUnconfirmed ? (
                  <Text
                    style={[
                      t.typography.caption1,
                      { color: t.colors.tone_warning, marginTop: 8 },
                    ]}
                  >
                    {marketplaceFallbackHint({
                      failedCount: marketplacesQ.data?.failedCount,
                      requestFailed: marketplacesQ.isError,
                      profileCount: displayMarketplaces.length,
                    })}
                  </Text>
                ) : null}
                {availabilityCheckUnconfirmed ? (
                  <View style={{ marginTop: 8 }}>
                    <SecondaryButton
                      label="Retry availability check"
                      full
                      onPress={() => void marketplacesQ.refetch()}
                    />
                  </View>
                ) : null}
              </>
            ) : bookLiveIneligible ? (
              <View style={{ gap: 10, marginTop: 8 }}>
                <EmptyState
                  icon="storefront-outline"
                  title="Out of stock"
                  subtitle="Not available for ads. Pick another paperback."
                />
                <SecondaryButton
                  label="Recheck availability"
                  full
                  onPress={() => void marketplacesQ.refetch()}
                />
              </View>
            ) : (
              <View style={{ gap: 10, marginTop: 8 }}>
                <EmptyState
                  icon="storefront-outline"
                  title={
                    !(book.marketplaceIds ?? []).length
                      ? "No profile"
                      : "Profile not on this account"
                  }
                  subtitle={
                    !(book.marketplaceIds ?? []).length
                      ? "Refresh KDP sync, then retry."
                      : "Enable the linked Ads profile in Accounts, then retry."
                  }
                />
                <SecondaryButton
                  label="Recheck availability"
                  full
                  onPress={() => void marketplacesQ.refetch()}
                />
              </View>
            )}
          </ListCard>
          </CreateReveal>
        ) : null}

        {showSuggestionStickyChrome ? null : (
        <CreateReveal delay={130}>
        <ListCard compact>
          <StepHeader
            step={3}
            title="Targeting"
          />
          {!book ||
          !(adsProfileId || profileId || (prefProfileId && book)) ? (
            <Text
              style={[
                t.typography.footnote,
                { color: t.colors.text_tertiary, marginTop: 8 },
              ]}
            >
              Select a book and marketplace.
            </Text>
          ) : (
            <>
              <View style={{ marginTop: 10 }}>
                <IOSSegmentedControl
                  testID="campaign-create-targeting"
                  // Pressable fallback: native Host historically clipped these
                  // three labels; height fix remains in Native.tsx as belt.
                  forceFallback
                  options={[
                    { key: "keywords", label: "Keywords" },
                    { key: "products", label: "Products" },
                    { key: "auto", label: "Automatic" },
                  ]}
                  value={targeting}
                  onChange={(type) => {
                    void playHaptic("select", reduceMotion);
                    setTargeting(type);
                    setVisibleSuggestionCount(SUGGESTION_PAGE_SIZE);
                    setName(
                      `${book.title.slice(0, 82)} - ${type === "auto" ? "Auto" : type === "keywords" ? "Keywords" : "Products"}`,
                    );
                    // Seed an empty preview shell so paste ASINs/keywords works
                    // while Amazon recommendations load (avoids stuck wait).
                    if (type === "keywords" || type === "products") {
                      // Invalidate any in-flight products/keywords preview paint.
                      previewRequestGenRef.current += 1;
                      prefTargetingPrefetchRef.current = false;
                      setPreview({
                        source: "amazon_ads",
                        fetchedAt: new Date().toISOString(),
                        recommendationsAvailable: false,
                        profile: {
                          id: adsProfileId || profileId,
                          profileId: adsProfileId || profileId,
                          countryCode: selectedMarketplace?.countryCode ?? null,
                          currencyCode:
                            selectedMarketplace?.currencyCode ?? null,
                          marketplaceId:
                            selectedMarketplace?.marketplaceId ?? null,
                        },
                        book: {
                          asin: book.asin,
                          title: book.title,
                          subtitle: null,
                          author: null,
                          topic: null,
                          coverUrl: book.coverUrl,
                        },
                        duplicateAuto: null,
                        amazonKeywordApi: { rowCount: 0, phraseCount: 0 },
                        keywords: [],
                        productTargets: [],
                        keywordCounts: pendingKeywordCountsShell(),
                      });
                      if (adsProfileId) {
                        prefTargetingPrefetchRef.current = true;
                        previewM.mutate(type);
                      }
                    } else {
                      previewRequestGenRef.current += 1;
                      prefTargetingPrefetchRef.current = false;
                      setPreview(null);
                    }
                  }}
                />
              </View>
              <View style={{ marginTop: 12 }}>
                <PrimaryButton
                  testID="campaign-create-refresh-suggestions"
                  label={
                    previewM.isPending
                      ? "Loading…"
                      : preview
                        ? "Refresh"
                        : "Load suggestions"
                  }
                  icon="shield-checkmark-outline"
                  full
                  // Keep label visible — PrimaryButton's loading prop
                  // replaces it with a stuck-feeling "Please wait…".
                  loading={false}
                  disabled={previewM.isPending || !adsProfileId}
                  onPress={() => {
                    void playHaptic("select", reduceMotion);
                    previewM.mutate(undefined);
                  }}
                />
              </View>
              {/* Kept chrome under Refresh so Amazon · N · Kept stays above-fold
                  (Your keywords / ASINs paste used to push it under Create paused). */}
              {preview && targeting !== "auto" ? (
                <SuggestionAiFilterChrome
                  testIDPrefix="campaign-create-ai-filter"
                  targeting={targeting}
                  stats={preview.keywordCounts}
                  loading={
                    previewM.isPending ||
                    (!preview.recommendationsAvailable && !suggestionsError)
                  }
                  retrying={previewM.isPending}
                  onRetry={() => {
                    setSuggestionsError(null);
                    previewM.mutate(undefined);
                  }}
                  onAcceptUnfiltered={acceptAmazonUnfiltered}
                />
              ) : null}
            </>
          )}
        </ListCard>
        </CreateReveal>
        )}

        {preview ? (
          <>
            {duplicateBlocked ? (
              <CreateReveal delay={40}>
              <ListCard
                compact
                style={{ borderColor: t.colors.tone_warning, borderWidth: 1 }}
              >
                <Text
                  style={[
                    t.typography.headline,
                    { color: t.colors.tone_warning },
                  ]}
                >
                  Automatic campaign already active
                </Text>
                <View style={{ marginTop: 10 }}>
                  <SecondaryButton
                    label="Open existing"
                    full
                    onPress={() =>
                      router.push(`/campaign/${preview.duplicateAuto!.id}`)
                    }
                  />
                </View>
              </ListCard>
              </CreateReveal>
            ) : null}

            {targeting !== "auto" ? (
              <>
              {/* Amazon suggestions list first so Kept chips are reachable without
                  scrolling past a tall paste card under the sticky Create bar. */}
              <CreateReveal delay={80}>
              <ListCard compact style={{ overflow: "visible" }}>
                <Text
                  style={[
                    t.typography.headline,
                    { color: t.colors.text_primary },
                  ]}
                >
                  Amazon suggestions
                </Text>
                {suggestionsError && !preview.recommendationsAvailable && !previewM.isPending ? (
                  <RetryState
                    title="Couldn't load suggestions"
                    subtitle={suggestionsError}
                    onRetry={() => {
                      setSuggestionsError(null);
                      previewM.mutate(undefined);
                    }}
                    retrying={previewM.isPending}
                  />
                ) : null}
                <View style={{ gap: 8, marginTop: 10 }}>
                  {targeting === "keywords" && keywordSuggestionRows.length ? (
                    <View style={styles.wrap}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          selected:
                            selectedKeywordIndexes.length > 0 &&
                            selectedKeywordIndexes.length ===
                              keywordSuggestionRows.length,
                        }}
                        onPress={toggleSelectAllSuggestions}
                        style={({ pressed }) => [
                          styles.choice,
                          {
                            borderColor:
                              selectedKeywordIndexes.length > 0 &&
                              selectedKeywordIndexes.length ===
                                keywordSuggestionRows.length
                                ? t.colors.tone_primary
                                : t.colors.separator,
                            backgroundColor:
                              selectedKeywordIndexes.length > 0 &&
                              selectedKeywordIndexes.length ===
                                keywordSuggestionRows.length
                                ? t.colors.tone_primary
                                : t.colors.background_secondary,
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            t.typography.caption1,
                            {
                              color:
                                selectedKeywordIndexes.length > 0 &&
                                selectedKeywordIndexes.length ===
                                  keywordSuggestionRows.length
                                  ? t.colors.text_inverse
                                  : t.colors.text_primary,
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {selectedKeywordIndexes.length > 0 &&
                          selectedKeywordIndexes.length ===
                            keywordSuggestionRows.length
                            ? `Deselect all · ${keywordSuggestionRows.length}`
                            : `Select all · ${keywordSuggestionRows.length}`}
                        </Text>
                      </Pressable>
                      {selectedKeywordIndexes.length > 0 &&
                      selectedKeywordIndexes.length <
                        keywordSuggestionRows.length ? (
                        <Text
                          style={[
                            t.typography.caption1,
                            { color: t.colors.text_secondary, fontWeight: "600" },
                          ]}
                        >
                          {selectedKeywordIndexes.length} selected
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {targeting === "keywords" && keywordMatchKeys.length ? (
                    <View style={{ gap: 6 }}>
                      <Text
                        style={[
                          t.typography.caption1,
                          { color: t.colors.text_secondary },
                        ]}
                      >
                        Select by match type
                      </Text>
                      <View style={styles.wrap}>
                        {keywordMatchKeys.map((key) => {
                          const keys = keywordSuggestionRows
                            .filter((row) => row.matchType === key)
                            .map((row) =>
                              keywordDedupeKey(row.keyword, row.matchType),
                            );
                          const allOn =
                            keys.length > 0 &&
                            keys.every((identity) => selectedKeywords.has(identity)) &&
                            selectedKeywordIndexes.length === keys.length;
                          return (
                            <Pressable
                              key={key}
                              onPress={() => selectKeywordsByMatchType(key)}
                              style={({ pressed }) => [
                                styles.choice,
                                {
                                  borderColor: allOn
                                    ? t.colors.tone_primary
                                    : t.colors.separator,
                                  backgroundColor: allOn
                                    ? `${t.colors.tone_primary}16`
                                    : t.colors.background_secondary,
                                  opacity: pressed ? 0.88 : 1,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  t.typography.caption1,
                                  {
                                    color: allOn
                                      ? t.colors.tone_primary
                                      : t.colors.text_primary,
                                    fontWeight: "600",
                                    textTransform: "capitalize",
                                  },
                                ]}
                              >
                                {key}
                                {keys.length ? ` · ${keys.length}` : ""}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.wrap}>
                        <Pressable
                          onPress={() => {
                            setGlobalKeywordBidMode("default");
                            setKeywordBidModes({});
                          }}
                          style={[
                            styles.choice,
                            {
                              borderColor:
                                globalKeywordBidMode === "default"
                                  ? t.colors.tone_primary
                                  : t.colors.separator,
                              backgroundColor:
                                globalKeywordBidMode === "default"
                                  ? `${t.colors.tone_primary}16`
                                  : t.colors.background_secondary,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              t.typography.caption1,
                              { color: t.colors.text_primary, fontWeight: "600" },
                            ]}
                          >
                            All default bid ·{" "}
                            {formatCurrency(defaultBidAmount, currency)}
                          </Text>
                        </Pressable>
                      </View>
                      <View style={styles.bulkBidRow}>
                        <Text
                          style={[
                            t.typography.caption1,
                            { color: t.colors.text_secondary, flex: 1 },
                          ]}
                        >
                          All same custom bid
                        </Text>
                        <TextInput
                          value={bulkCustomBidText}
                          onChangeText={setBulkCustomBidText}
                          keyboardType="decimal-pad"
                          placeholder={defaultBidAmount.toFixed(2)}
                          placeholderTextColor={t.colors.text_tertiary}
                          style={[
                            t.typography.caption1,
                            styles.bulkBidInput,
                            {
                              color: t.colors.text_primary,
                              borderColor: t.colors.separator,
                              backgroundColor: t.colors.background_secondary,
                            },
                          ]}
                        />
                        <Pressable
                          onPress={() => applyBulkCustomBid(bulkCustomBidText)}
                          style={[
                            styles.choice,
                            {
                              borderColor: t.colors.tone_primary,
                              backgroundColor: `${t.colors.tone_primary}16`,
                              minHeight: 36,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              t.typography.caption1,
                              { color: t.colors.tone_primary, fontWeight: "600" },
                            ]}
                          >
                            Apply
                          </Text>
                        </Pressable>
                      </View>
                      {keywordMatchKeys.map((key) => (
                        <View key={`bid-${key}`} style={styles.bulkBidRow}>
                          <Text
                            style={[
                              t.typography.caption1,
                              {
                                color: t.colors.text_secondary,
                                textTransform: "capitalize",
                                width: 64,
                              },
                            ]}
                          >
                            {key}
                          </Text>
                          <TextInput
                            value={matchTypeBidTexts[key] ?? ""}
                            onChangeText={(text) =>
                              setMatchTypeBidTexts((old) => ({
                                ...old,
                                [key]: text,
                              }))
                            }
                            keyboardType="decimal-pad"
                            placeholder={defaultBidAmount.toFixed(2)}
                            placeholderTextColor={t.colors.text_tertiary}
                            style={[
                              t.typography.caption1,
                              styles.bulkBidInput,
                              {
                                color: t.colors.text_primary,
                                borderColor: t.colors.separator,
                                backgroundColor: t.colors.background_secondary,
                              },
                            ]}
                          />
                          <Pressable
                            onPress={() =>
                              applyMatchTypeCustomBid(
                                key,
                                matchTypeBidTexts[key] ?? "",
                              )
                            }
                            style={[
                              styles.choice,
                              {
                                borderColor: t.colors.separator,
                                backgroundColor: t.colors.background_secondary,
                                minHeight: 36,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                t.typography.caption1,
                                {
                                  color: t.colors.text_primary,
                                  fontWeight: "600",
                                },
                              ]}
                            >
                              Set
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {targeting === "products" && rankedProductSuggestions.length ? (
                    <View style={styles.wrap}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          selected:
                            selectedProductVisibleCount > 0 &&
                            selectedProductVisibleCount ===
                              rankedProductSuggestions.length,
                        }}
                        onPress={toggleSelectAllSuggestions}
                        style={({ pressed }) => [
                          styles.choice,
                          {
                            borderColor:
                              selectedProductVisibleCount > 0 &&
                              selectedProductVisibleCount ===
                                rankedProductSuggestions.length
                                ? t.colors.tone_primary
                                : t.colors.separator,
                            backgroundColor:
                              selectedProductVisibleCount > 0 &&
                              selectedProductVisibleCount ===
                                rankedProductSuggestions.length
                                ? t.colors.tone_primary
                                : t.colors.background_secondary,
                            opacity: pressed ? 0.88 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            t.typography.caption1,
                            {
                              color:
                                selectedProductVisibleCount > 0 &&
                                selectedProductVisibleCount ===
                                  rankedProductSuggestions.length
                                  ? t.colors.text_inverse
                                  : t.colors.text_primary,
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {selectedProductVisibleCount > 0 &&
                          selectedProductVisibleCount ===
                            rankedProductSuggestions.length
                            ? `Deselect all · ${rankedProductSuggestions.length}`
                            : `Select all · ${rankedProductSuggestions.length}`}
                        </Text>
                      </Pressable>
                      {selectedProductVisibleCount > 0 &&
                      selectedProductVisibleCount <
                        rankedProductSuggestions.length ? (
                        <Text
                          style={[
                            t.typography.caption1,
                            { color: t.colors.text_secondary, fontWeight: "600" },
                          ]}
                        >
                          {selectedProductVisibleCount} selected
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  {targeting === "products" && productMatchKeys.length ? (
                    <View style={{ gap: 6 }}>
                      <Text
                        style={[
                          t.typography.caption1,
                          { color: t.colors.text_secondary },
                        ]}
                      >
                        Select by match type
                      </Text>
                      <View style={styles.wrap}>
                        {productMatchKeys.map((key) => {
                          const keys = rankedProductSuggestions
                            .filter(
                              (row) =>
                                normalizeProductMatchType(row.matchType) === key,
                            )
                            .map((row) =>
                              productTargetDedupeKey(row.asin, row.matchType),
                            );
                          const allOn =
                            keys.length > 0 &&
                            keys.every((identity) => selectedProducts.has(identity)) &&
                            selectedProductVisibleCount === keys.length;
                          return (
                            <Pressable
                              key={key}
                              onPress={() => selectProductsByMatchType(key)}
                              style={({ pressed }) => [
                                styles.choice,
                                {
                                  borderColor: allOn
                                    ? t.colors.tone_primary
                                    : t.colors.separator,
                                  backgroundColor: allOn
                                    ? `${t.colors.tone_primary}16`
                                    : t.colors.background_secondary,
                                  opacity: pressed ? 0.88 : 1,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  t.typography.caption1,
                                  {
                                    color: allOn
                                      ? t.colors.tone_primary
                                      : t.colors.text_primary,
                                    fontWeight: "600",
                                  },
                                ]}
                              >
                                {productMatchSelectLabel(key)}
                                {keys.length ? ` · ${keys.length}` : ""}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                  {targeting === "products" && productReasonKeys.length ? (
                    <View style={{ gap: 6 }}>
                      <Text
                        style={[
                          t.typography.caption1,
                          { color: t.colors.text_secondary },
                        ]}
                      >
                        Select by type
                      </Text>
                      <View style={styles.wrap}>
                        {productReasonKeys.map((key) => {
                          const keys = rankedProductSuggestions
                            .filter((row) => rowMatchesReasonKey(row.themes, key))
                            .map((row) =>
                              productTargetDedupeKey(row.asin, row.matchType),
                            );
                          const allOn =
                            keys.length > 0 &&
                            keys.every((identity) => selectedProducts.has(identity));
                          return (
                            <Pressable
                              key={key}
                              onPress={() =>
                                allOn
                                  ? clearProductsByReason(key)
                                  : selectProductsByReason(key)
                              }
                              style={({ pressed }) => [
                                styles.choice,
                                {
                                  borderColor: allOn
                                    ? t.colors.tone_primary
                                    : t.colors.separator,
                                  backgroundColor: allOn
                                    ? `${t.colors.tone_primary}16`
                                    : t.colors.background_secondary,
                                  opacity: pressed ? 0.88 : 1,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  t.typography.caption1,
                                  {
                                    color: allOn
                                      ? t.colors.tone_primary
                                      : t.colors.text_primary,
                                    fontWeight: "600",
                                  },
                                ]}
                              >
                                {reasonSelectLabel(key)}
                                {keys.length ? ` · ${keys.length}` : ""}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                  {targeting === "products" && productMatchKeys.length ? (
                    <View style={{ gap: 6 }}>
                      <View style={styles.wrap}>
                        <Pressable
                          onPress={() => {
                            setGlobalProductBidMode("default");
                            setProductBidModes({});
                          }}
                          style={[
                            styles.choice,
                            {
                              borderColor:
                                globalProductBidMode === "default"
                                  ? t.colors.tone_primary
                                  : t.colors.separator,
                              backgroundColor:
                                globalProductBidMode === "default"
                                  ? `${t.colors.tone_primary}16`
                                  : t.colors.background_secondary,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              t.typography.caption1,
                              {
                                color: t.colors.text_primary,
                                fontWeight: "600",
                              },
                            ]}
                          >
                            All default bid ·{" "}
                            {formatCurrency(defaultBidAmount, currency)}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setGlobalProductBidMode("custom")}
                          style={[
                            styles.choice,
                            {
                              borderColor:
                                globalProductBidMode === "custom"
                                  ? t.colors.tone_primary
                                  : t.colors.separator,
                              backgroundColor:
                                globalProductBidMode === "custom"
                                  ? `${t.colors.tone_primary}16`
                                  : t.colors.background_secondary,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              t.typography.caption1,
                              {
                                color: t.colors.text_primary,
                                fontWeight: "600",
                              },
                            ]}
                          >
                            Prefer custom bids
                          </Text>
                        </Pressable>
                      </View>
                      <View style={styles.bulkBidRow}>
                        <Text
                          style={[
                            t.typography.caption1,
                            { color: t.colors.text_secondary, flex: 1 },
                          ]}
                        >
                          All same custom bid
                        </Text>
                        <TextInput
                          value={bulkCustomBidText}
                          onChangeText={setBulkCustomBidText}
                          keyboardType="decimal-pad"
                          placeholder={defaultBidAmount.toFixed(2)}
                          placeholderTextColor={t.colors.text_tertiary}
                          style={[
                            t.typography.caption1,
                            styles.bulkBidInput,
                            {
                              color: t.colors.text_primary,
                              borderColor: t.colors.separator,
                              backgroundColor: t.colors.background_secondary,
                            },
                          ]}
                        />
                        <Pressable
                          onPress={() => applyBulkCustomBid(bulkCustomBidText)}
                          style={[
                            styles.choice,
                            {
                              borderColor: t.colors.tone_primary,
                              backgroundColor: `${t.colors.tone_primary}16`,
                              minHeight: 36,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              t.typography.caption1,
                              { color: t.colors.tone_primary, fontWeight: "600" },
                            ]}
                          >
                            Apply
                          </Text>
                        </Pressable>
                      </View>
                      {productMatchKeys.map((key) => (
                        <View key={`pbid-${key}`} style={styles.bulkBidRow}>
                          <Text
                            style={[
                              t.typography.caption1,
                              { color: t.colors.text_secondary, width: 72 },
                            ]}
                          >
                            {productMatchSelectLabel(key)}
                          </Text>
                          <TextInput
                            value={matchTypeBidTexts[key] ?? ""}
                            onChangeText={(text) =>
                              setMatchTypeBidTexts((old) => ({
                                ...old,
                                [key]: text,
                              }))
                            }
                            keyboardType="decimal-pad"
                            placeholder={defaultBidAmount.toFixed(2)}
                            placeholderTextColor={t.colors.text_tertiary}
                            style={[
                              t.typography.caption1,
                              styles.bulkBidInput,
                              {
                                color: t.colors.text_primary,
                                borderColor: t.colors.separator,
                                backgroundColor: t.colors.background_secondary,
                              },
                            ]}
                          />
                          <Pressable
                            onPress={() =>
                              applyMatchTypeCustomBid(
                                key,
                                matchTypeBidTexts[key] ?? "",
                              )
                            }
                            style={[
                              styles.choice,
                              {
                                borderColor: t.colors.separator,
                                backgroundColor: t.colors.background_secondary,
                                minHeight: 36,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                t.typography.caption1,
                                {
                                  color: t.colors.text_primary,
                                  fontWeight: "600",
                                },
                              ]}
                            >
                              Set
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {targeting === "keywords"
                    ? (visibleSuggestionRows as typeof keywordSuggestionRows).map(
                        (row, index) => {
                          const mode =
                            keywordBidModes[index] ?? globalKeywordBidMode;
                          const suggested = recommendationBidMajorUnits(
                            row.suggestedBid,
                          );
                          return (
                            <AmazonKeywordSuggestionRow
                              key={`${row.keyword}-${row.matchType}-${index}`}
                              keyword={row.keyword}
                              matchType={row.matchType}
                              selected={selectedKeywords.has(
                                keywordDedupeKey(row.keyword, row.matchType),
                              )}
                              suggestedBid={suggested}
                              defaultBid={defaultBidAmount}
                              currency={currency}
                              bidMode={mode}
                              customBidText={
                                keywordCustomBids[index] ??
                                (suggested != null
                                  ? suggested.toFixed(2)
                                  : defaultBidAmount.toFixed(2))
                              }
                              useSuggestedBids={useSuggestedBids}
                              onToggle={() => toggleSuggestion(index, "keywords")}
                              onBidModeChange={(next) =>
                                setKeywordBidModes((old) => ({
                                  ...old,
                                  [index]: next,
                                }))
                              }
                              onCustomBidChange={(text) =>
                                setKeywordCustomBids((old) => ({
                                  ...old,
                                  [index]: text,
                                }))
                              }
                            />
                          );
                        },
                      )
                    : (
                        visibleSuggestionRows as typeof rankedProductSuggestions
                      ).map((row) => {
                        const index = row.originalIndex;
                        const meta =
                          suggestionMetaByAsin[String(row.asin).toUpperCase()];
                        const mode =
                          productBidModes[index] ?? globalProductBidMode;
                        const suggested = recommendationBidMajorUnits(
                          row.suggestedBid,
                        );
                        return (
                          <AmazonProductSuggestionRow
                            key={`${row.asin}-${index}`}
                            asin={row.asin}
                            title={meta?.title ?? row.title ?? null}
                            subtitle={meta?.subtitle ?? row.subtitle ?? null}
                            coverUrl={meta?.coverUrl ?? row.coverUrl ?? null}
                            themes={row.themes ?? []}
                            matchType={row.matchType}
                            selected={selectedProducts.has(
                              productTargetDedupeKey(row.asin, row.matchType),
                            )}
                            suggestedBid={suggested}
                            defaultBid={defaultBidAmount}
                            currency={currency}
                            bidMode={mode}
                            customBidText={
                              productCustomBids[index] ??
                              (suggested != null
                                ? suggested.toFixed(2)
                                : defaultBidAmount.toFixed(2))
                            }
                            useSuggestedBids={useSuggestedBids}
                            titleLoading={suggestionTitlesLoading}
                            onToggle={() => toggleSuggestion(index, "products")}
                            onBidModeChange={(next) =>
                              setProductBidModes((old) => ({
                                ...old,
                                [index]: next,
                              }))
                            }
                            onCustomBidChange={(text) =>
                              setProductCustomBids((old) => ({
                                ...old,
                                [index]: text,
                              }))
                            }
                          />
                        );
                      })}
                  {preview.recommendationsAvailable &&
                  !(targeting === "keywords"
                    ? preview.keywords.length
                    : preview.productTargets.length) ? (
                    <Text
                      style={[
                        t.typography.footnote,
                        { color: t.colors.text_secondary },
                      ]}
                    >
                      {targeting === "products" ? "None from Amazon." : "None."}
                    </Text>
                  ) : null}
                  {visibleSuggestionCount < productSuggestionCount ? (
                    <SecondaryButton
                      label={`Show ${Math.min(SUGGESTION_PAGE_SIZE, productSuggestionCount - visibleSuggestionCount)} more`}
                      full
                      onPress={() =>
                        setVisibleSuggestionCount((count) =>
                          Math.min(
                            productSuggestionCount,
                            count + SUGGESTION_PAGE_SIZE,
                          ),
                        )
                      }
                    />
                  ) : null}
                </View>
              </ListCard>
              </CreateReveal>

              {/* Paste in its own card — nesting under Amazon ListCard
                  historically half-clipped Broad/Phrase/Exact (Host + overflow). */}
              <CreateReveal delay={100}>
                {targeting === "keywords" ? (
                  <ListCard
                    compact
                    testID="campaign-create-your-keywords"
                    style={{ overflow: "visible" }}
                  >
                    <Text
                      style={[
                        t.typography.callout,
                        { color: t.colors.text_primary, fontWeight: "600" },
                      ]}
                    >
                      Your keywords
                    </Text>
                    <View style={styles.matchTypeRow}>
                      <IOSSegmentedControl
                        forceFallback
                        options={[
                          { key: "broad", label: "Broad" },
                          { key: "phrase", label: "Phrase" },
                          { key: "exact", label: "Exact" },
                        ]}
                        value={customKeywordMatch}
                        onChange={setCustomKeywordMatch}
                      />
                    </View>
                    <TextInput
                      value={customKeywordText}
                      onChangeText={setCustomKeywordText}
                      placeholder="Paste keywords, one per line"
                      placeholderTextColor={t.colors.text_tertiary}
                      multiline
                      autoCorrect={false}
                      style={[
                        t.typography.body,
                        styles.keywordInput,
                        {
                          color: t.colors.text_primary,
                          backgroundColor: t.colors.background_tertiary,
                          borderColor: t.colors.separator,
                        },
                      ]}
                    />
                    {customKeywords.length ? (
                      <Text
                        style={[
                          t.typography.caption1,
                          { color: t.colors.text_secondary, marginTop: 6 },
                        ]}
                      >
                        {customKeywords.length} custom keyword
                        {customKeywords.length === 1 ? "" : "s"}
                      </Text>
                    ) : null}
                  </ListCard>
                ) : (
                  <ListCard
                    compact
                    testID="campaign-create-your-asins"
                    style={{ overflow: "visible" }}
                  >
                    <Text
                      style={[
                        t.typography.callout,
                        { color: t.colors.text_primary, fontWeight: "600" },
                      ]}
                    >
                      Your product ASINs
                    </Text>
                    <TextInput
                      value={customAsinText}
                      onChangeText={setCustomAsinText}
                      placeholder="B0… one per line"
                      placeholderTextColor={t.colors.text_tertiary}
                      multiline
                      autoCorrect={false}
                      autoCapitalize="characters"
                      style={[
                        t.typography.body,
                        styles.keywordInput,
                        {
                          color: t.colors.text_primary,
                          backgroundColor: t.colors.background_tertiary,
                          borderColor: t.colors.separator,
                        },
                      ]}
                    />
                    {customAsins.length ? (
                      <Text
                        style={[
                          t.typography.caption1,
                          { color: t.colors.text_secondary, marginTop: 6 },
                        ]}
                      >
                        {customAsins.length} custom ASIN
                        {customAsins.length === 1 ? "" : "s"}
                      </Text>
                    ) : null}
                  </ListCard>
                )}
              </CreateReveal>
              </>
            ) : null}

            <CreateReveal delay={120}>
            <ListCard compact>
              <StepHeader step={4} title="Budget" />
              <View style={[styles.fields, { marginTop: 10 }]}>
                <Field
                  label="Campaign name"
                  value={name}
                  onChangeText={setName}
                />
                <Field
                  label="Ad group name"
                  value={adGroupName}
                  onChangeText={setAdGroupName}
                />
                <Field
                  label="Daily budget"
                  value={budget}
                  onChangeText={setBudget}
                  numeric
                  suffix={currency}
                />
                <Field
                  label="Default bid"
                  value={defaultBid}
                  onChangeText={setDefaultBid}
                  numeric
                  suffix={currency}
                />
              </View>
              {targeting !== "auto" ? (
                <View
                  style={[
                    styles.enableRow,
                    { borderTopColor: t.colors.separator },
                  ]}
                >
                  <Text
                    style={[
                      t.typography.callout,
                      { color: t.colors.text_primary, fontWeight: "600", flex: 1, paddingRight: 4 },
                    ]}
                  >
                    Use Amazon suggested bids
                  </Text>
                  <Switch
                    value={useSuggestedBids}
                    onValueChange={setUseSuggestedBids}
                    trackColor={{ true: t.colors.tone_good }}
                    accessibilityLabel="Use Amazon suggested bids"
                  />
                </View>
              ) : null}
            </ListCard>

            <ListCard compact style={{ overflow: "visible" }}>
              <StepHeader step={5} title="Bidding" />
              <View style={{ marginTop: 10, minHeight: 44 }}>
                <IOSSegmentedControl
                  forceFallback
                  options={[
                    { key: "LEGACY_FOR_SALES", label: "Down only" },
                    { key: "AUTO_FOR_SALES", label: "Up & down" },
                    { key: "MANUAL", label: "Fixed" },
                  ]}
                  value={strategy}
                  onChange={setStrategy}
                />
              </View>
              <View style={[styles.fields, { marginTop: 10 }]}>
                <Field
                  label="Top of search"
                  value={topPlacement}
                  onChangeText={setTopPlacement}
                  numeric
                  suffix="%"
                />
                <Field
                  label="Product pages"
                  value={productPlacement}
                  onChangeText={setProductPlacement}
                  numeric
                  suffix="%"
                />
                <Field
                  label="Rest of search"
                  value={restPlacement}
                  onChangeText={setRestPlacement}
                  numeric
                  suffix="%"
                />
              </View>
              <View
                style={[
                  styles.enableRow,
                  { borderTopColor: t.colors.separator },
                ]}
              >
                <View style={{ flex: 1, paddingRight: 4 }}>
                  <Text
                    style={[
                      t.typography.callout,
                      { color: t.colors.text_primary, fontWeight: "600" },
                    ]}
                  >
                    Activate when ready
                  </Text>
                  <Text
                    style={[
                      t.typography.caption1,
                      { color: t.colors.text_secondary, marginTop: 2 },
                    ]}
                  >
                    Starts paused.
                  </Text>
                </View>
                <Switch
                  value={enableAfterCreate}
                  onValueChange={setEnableAfterCreate}
                  trackColor={{ true: t.colors.tone_good }}
                />
              </View>
            </ListCard>
            </CreateReveal>
          </>
        ) : null}

        {book && (adsProfileId || profileId) ? (
          <CreateReveal delay={90}>
          <ListCard compact testID="campaign-create-existing-campaigns">
            <Text
              style={[
                t.typography.headline,
                { color: t.colors.text_primary },
              ]}
            >
              Active on this marketplace
            </Text>
            {existingCampaignsQ.isPending ? (
              <ScreenSpinner />
            ) : existingCampaignsQ.isError ? (
              <RetryState
                title="Couldn't load campaigns"
                onRetry={() => void existingCampaignsQ.refetch()}
                retrying={existingCampaignsQ.isFetching}
              />
            ) : existingCampaigns.length ? (
              <View style={{ gap: 8, marginTop: 10 }}>
                {existingCampaigns.map((row) => (
                  <CreateScalePressable
                    key={row.id}
                    testID={`campaign-create-existing-${row.id}`}
                    onPress={() => router.push(`/campaign/${row.id}`)}
                    style={[
                      styles.existingCampaignRow,
                      {
                        backgroundColor: t.colors.background_tertiary,
                        borderColor: t.colors.separator,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        numberOfLines={2}
                        style={[
                          t.typography.callout,
                          {
                            color: t.colors.text_primary,
                            fontWeight: "600",
                          },
                        ]}
                      >
                        {row.name}
                      </Text>
                      <Text
                        style={[
                          t.typography.caption1,
                          { color: t.colors.text_secondary },
                        ]}
                      >
                        {row.label}
                      </Text>
                    </View>
                    <Pill label="Active" tone="good" size="sm" />
                  </CreateScalePressable>
                ))}
              </View>
            ) : (
              <Text
                style={[
                  t.typography.footnote,
                  { color: t.colors.text_tertiary, marginTop: 8 },
                ]}
              >
                None yet.
              </Text>
            )}
          </ListCard>
          </CreateReveal>
        ) : null}
        </ScrollView>

        {preview ? (
          <View
            style={[
              styles.stickyBar,
              {
                paddingBottom: Math.max(insets.bottom, 10),
                borderTopColor: t.colors.separator,
                backgroundColor: t.colors.background_primary,
              },
            ]}
          >
            <PrimaryButton
              testID="campaign-create-submit"
              label={
                aiFilterPending
                  ? "AI filtering…"
                  : aiFilterNeedsConfirm
                    ? "Confirm AI filter first"
                    : enableAfterCreate
                      ? "Create & activate"
                      : "Create paused"
              }
              icon="add-circle-outline"
              full
              loading={createM.isPending}
              disabled={!canCreate}
              onPress={() => {
                if (blockIfCannotWriteAmazon({ guestMode, viewAsOtherUser }))
                  return;
                Alert.alert(
                  enableAfterCreate ? "Create & activate?" : "Create paused?",
                  `${name}\n${formatCurrency(Number(budget) || 0, currency || "USD")}/day · ${strategy === "AUTO_FOR_SALES" ? "Up & down" : strategy === "MANUAL" ? "Fixed" : "Down only"}`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: enableAfterCreate
                        ? "Create & activate"
                        : "Create paused",
                      onPress: () => createM.mutate(),
                    },
                  ],
                );
              }}
            />
          </View>
        ) : null}
      </View>
      </KeyboardAvoidingView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  help: { marginTop: 4, lineHeight: 18 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stickyChrome: {
    gap: 8,
    paddingTop: 6,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  stickyCompactCard: {
    gap: 8,
    padding: 10,
    borderRadius: 14,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  stickyBookRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stickyActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stickyMarketRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 4,
  },
  stickyMarketChip: {
    minHeight: 30,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: 9,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  stickyRefresh: {
    minHeight: 30,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 9,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  changeChip: {
    minHeight: 34,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 10,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  existingCampaignRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  choice: {
    minHeight: 40,
    maxWidth: "100%",
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 13,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  bookGroup: {
    gap: 8,
    padding: 10,
    borderRadius: 14,
    borderCurve: "continuous",
  },
  bookTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  editionRow: {
    minHeight: 44,
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
    borderCurve: "continuous",
  },
  editionMain: {
    gap: 6,
  },
  targetRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: "continuous",
  },
  bulkBidRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  bulkBidInput: {
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    fontVariant: ["tabular-nums"],
  },
  customKeywords: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** Paste card match-type row — full 44pt, never clipped by Host/ListCard. */
  matchTypeRow: {
    marginTop: 10,
    marginBottom: 4,
    minHeight: 44,
    height: 44,
    justifyContent: "center",
    overflow: "visible",
    zIndex: 1,
  },
  keywordInput: {
    minHeight: 88,
    marginTop: 8,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  inputShell: {
    minHeight: 44,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  input: { flex: 1, minWidth: 70, paddingVertical: 9 },
  enableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stickyBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
