import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { radii, useTheme } from "@/src/lib/theme";
import {
  formatKeywordSuggestionCountLabel,
  suggestionRelevanceNeedsUserConfirm,
  type KeywordSuggestionCountStats,
} from "@/src/lib/amazonCampaignSuggestions";

export type SuggestionAiFilterTargeting = "keywords" | "products" | "auto";

/**
 * Compact Amazon → AI filter status for Create / New Ad Group / Add targets.
 */
export function SuggestionAiFilterChrome({
  targeting,
  stats,
  onRetry,
  onAcceptUnfiltered,
  retrying,
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
  const countLabel = stats ? formatKeywordSuggestionCountLabel(stats) : null;
  const amazonEmpty =
    !!stats &&
    !stats.grokPending &&
    stats.amazonRowCount === 0 &&
    stats.amazonApiRowCount === 0;

  let statusTitle = "AI filter";
  let statusDetail: string | null = null;
  if (pending) {
    statusTitle = "Filtering…";
  } else if (amazonEmpty) {
    statusTitle = "No Amazon suggestions";
    statusDetail =
      targeting === "keywords"
        ? "Paste keywords below, or retry."
        : "Paste ASINs below, or retry.";
  } else if (stats?.relevanceOutcome === "failed_unfiltered") {
    statusTitle = "AI unavailable";
    statusDetail = "Showing Amazon unfiltered — confirm or retry.";
  } else if (stats?.relevanceOutcome === "restored_empty") {
    statusTitle = "AI empty · Amazon restored";
    statusDetail = "Confirm before adding all, or retry.";
  } else if (stats?.relevanceOutcome === "user_accepted_unfiltered") {
    statusTitle = "Amazon unfiltered";
  } else if (stats?.relevanceOutcome === "filtered" || stats?.grokFiltered) {
    statusTitle = "AI filtered";
  } else if (stats && !stats.grokPending) {
    statusTitle = "AI kept all";
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
            ? `${t.colors.tone_warning}12`
            : pending
              ? `${t.colors.tone_primary}10`
              : t.colors.background_secondary,
        },
      ]}
    >
      <View style={styles.statusRow}>
        {pending ? (
          <ActivityIndicator
            size="small"
            color={t.colors.tone_primary}
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
              flexShrink: 1,
            },
          ]}
          numberOfLines={1}
        >
          {statusTitle}
        </Text>
        {countLabel ? (
          <Text
            testID={`${testIDPrefix}-counts`}
            style={[
              t.typography.caption1,
              {
                color: t.colors.text_secondary,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                flexShrink: 1,
                textAlign: "right",
              },
            ]}
            numberOfLines={1}
          >
            {countLabel}
          </Text>
        ) : null}
      </View>
      {/* Keep testID for harnesses that still poll the old steps slot */}
      <Text testID={`${testIDPrefix}-steps`} style={styles.srOnly}>
        AI filter
      </Text>
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
                {retrying ? "Retrying…" : "Retry"}
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
                Use Amazon
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
    marginTop: 8,
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
    flexWrap: "wrap",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
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
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
});
