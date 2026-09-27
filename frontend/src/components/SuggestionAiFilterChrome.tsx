import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { radii, spacing, useTheme } from "@/src/lib/theme";
import {
  formatKeywordSuggestionCountLabel,
  suggestionRelevanceNeedsUserConfirm,
  type KeywordSuggestionCountStats,
} from "@/src/lib/amazonCampaignSuggestions";

export type SuggestionAiFilterTargeting = "keywords" | "products" | "auto";

/**
 * Visible Step 2 chrome for Create Campaign / New Ad Group / Add targets.
 * Shows Amazon vs Kept, Ranking…, and honest failure / empty-restore actions.
 */
export function SuggestionAiFilterChrome({
  targeting,
  stats,
  onRetry,
  onAcceptUnfiltered,
  retrying,
  /** True while Amazon/AI request is in flight before keywordCounts exists. */
  loading,
  testIDPrefix = "suggestion-ai-filter",
}: {
  targeting: SuggestionAiFilterTargeting;
  stats?: KeywordSuggestionCountStats | null;
  onRetry?: () => void;
  onAcceptUnfiltered?: () => void;
  retrying?: boolean;
  loading?: boolean;
  testIDPrefix?: string;
}) {
  const t = useTheme();
  if (targeting === "auto") return null;

  const pending = Boolean(stats?.grokPending) || Boolean(loading && !stats);
  const needsConfirm = suggestionRelevanceNeedsUserConfirm(stats);
  const countLabel = stats
    ? formatKeywordSuggestionCountLabel(stats)
    : null;
  const stepsCopy =
    targeting === "keywords"
      ? "1) Amazon raw suggestions → 2) AI search-intent filter for this book."
      : "1) Amazon raw ASIN suggestions → 2) Title/theme relevance filter for this book.";

  let statusTitle = "Step 2 — AI search-intent filter";
  let statusDetail: string | null = null;
  const amazonEmpty =
    !!stats &&
    !stats.grokPending &&
    stats.amazonRowCount === 0 &&
    stats.amazonApiRowCount === 0;
  if (pending) {
    statusTitle = "Step 2 — AI filtering…";
    statusDetail =
      targeting === "keywords"
        ? "Keeping only high search-intent keywords for this book. Selection stays empty until this finishes."
        : "Applying title/theme relevance. Selection stays empty until this finishes.";
  } else if (amazonEmpty) {
    statusTitle = "Step 2 — No Amazon suggestions";
    statusDetail =
      targeting === "keywords"
        ? "Amazon returned no keyword suggestions for this ad group. Paste keywords below, or retry later."
        : "Amazon returned no product suggestions. Paste ASINs below, or retry later.";
  } else if (stats?.relevanceOutcome === "failed_unfiltered") {
    statusTitle = "Step 2 — AI filter failed";
    statusDetail =
      stats.relevanceError ||
      "Couldn't run the search-intent filter. Amazon suggestions are shown unfiltered — confirm before adding all.";
  } else if (stats?.relevanceOutcome === "restored_empty") {
    statusTitle = "Step 2 — AI returned empty";
    statusDetail =
      "The AI keep-list was empty, so the full Amazon list was restored. Confirm before adding all, or retry the filter.";
  } else if (stats?.relevanceOutcome === "user_accepted_unfiltered") {
    statusTitle = "Step 2 — Using Amazon unfiltered";
    statusDetail = "You chose to proceed with the raw Amazon suggestion set.";
  } else if (stats?.relevanceOutcome === "filtered" || stats?.grokFiltered) {
    statusTitle = "Step 2 — AI kept high-intent only";
    statusDetail = null;
  } else if (stats && !stats.grokPending) {
    statusTitle = "Step 2 — AI kept full Amazon set";
    statusDetail = null;
  }

  return (
    <View
      testID={`${testIDPrefix}-chrome`}
      style={[
        styles.wrap,
        {
          borderColor: needsConfirm
            ? t.colors.tone_warning
            : pending
              ? t.colors.tone_primary
              : t.colors.separator,
          backgroundColor: needsConfirm
            ? `${t.colors.tone_warning}14`
            : pending
              ? `${t.colors.tone_primary}12`
              : t.colors.background_secondary,
        },
      ]}
    >
      <Text
        testID={`${testIDPrefix}-steps`}
        style={[
          t.typography.caption1,
          { color: t.colors.text_secondary, fontWeight: "500" },
        ]}
      >
        {stepsCopy}
      </Text>
      <View style={styles.statusRow}>
        {pending ? (
          <ActivityIndicator
            size="small"
            color={t.colors.tone_primary}
            style={{ marginRight: 2 }}
          />
        ) : null}
        <Text
          testID={`${testIDPrefix}-status`}
          style={[
            t.typography.callout,
            {
              color: needsConfirm
                ? t.colors.tone_warning
                : t.colors.text_primary,
              fontWeight: "700",
              flex: 1,
            },
          ]}
        >
          {statusTitle}
        </Text>
      </View>
      {countLabel ? (
        <Text
          testID={`${testIDPrefix}-counts`}
          style={[
            t.typography.caption1,
            {
              color: t.colors.text_secondary,
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
            },
          ]}
        >
          {countLabel}
        </Text>
      ) : null}
      {statusDetail ? (
        <Text
          testID={`${testIDPrefix}-detail`}
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, fontWeight: "500" },
          ]}
        >
          {statusDetail}
        </Text>
      ) : null}
      {needsConfirm ? (
        <View style={styles.actions}>
          {onRetry ? (
            <Pressable
              testID={`${testIDPrefix}-retry`}
              accessibilityRole="button"
              accessibilityLabel="Retry AI filter"
              disabled={retrying}
              onPress={onRetry}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: t.colors.tone_primary,
                  backgroundColor: `${t.colors.tone_primary}14`,
                  opacity: pressed || retrying ? 0.75 : 1,
                },
              ]}
            >
              <Text
                style={[
                  t.typography.caption1,
                  { color: t.colors.tone_primary, fontWeight: "700" },
                ]}
              >
                {retrying ? "Retrying…" : "Retry AI filter"}
              </Text>
            </Pressable>
          ) : null}
          {onAcceptUnfiltered ? (
            <Pressable
              testID={`${testIDPrefix}-accept-unfiltered`}
              accessibilityRole="button"
              accessibilityLabel="Use Amazon suggestions unfiltered"
              onPress={onAcceptUnfiltered}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: t.colors.tone_warning,
                  backgroundColor: t.colors.background_primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={[
                  t.typography.caption1,
                  { color: t.colors.tone_warning, fontWeight: "700" },
                ]}
              >
                Use Amazon unfiltered
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: "center",
  },
});
