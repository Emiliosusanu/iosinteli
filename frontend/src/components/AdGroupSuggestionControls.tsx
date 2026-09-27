import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme, radii, spacing } from "@/src/lib/theme";

export type SuggestionMatchChip = {
  key: string;
  label: string;
  count: number;
  allSelected: boolean;
  onPress: () => void;
};

export type SuggestionMatchBidRow = {
  key: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onApply: () => void;
};

/**
 * Select all + select-by-match-type + per-match-type bid apply for
 * New Ad Group / Add keywords|products suggestion pickers.
 */
export function AdGroupSuggestionControls({
  filteredCount,
  selectedFilteredCount,
  onToggleSelectAll,
  matchChips,
  matchBidRows,
  defaultBidPlaceholder,
}: {
  filteredCount: number;
  selectedFilteredCount: number;
  onToggleSelectAll: () => void;
  matchChips: SuggestionMatchChip[];
  matchBidRows: SuggestionMatchBidRow[];
  defaultBidPlaceholder: string;
}) {
  const t = useTheme();
  if (filteredCount <= 0) return null;
  const allSelected =
    selectedFilteredCount > 0 && selectedFilteredCount === filteredCount;

  return (
    <View style={styles.wrap} testID="adgroup-suggestion-controls">
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: allSelected }}
          onPress={onToggleSelectAll}
          style={({ pressed }) => [
            styles.chip,
            {
              borderColor: allSelected
                ? t.colors.tone_primary
                : t.colors.separator,
              backgroundColor: allSelected
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
                color: allSelected
                  ? t.colors.text_inverse
                  : t.colors.text_primary,
                fontWeight: "700",
              },
            ]}
          >
            {allSelected
              ? `Deselect all · ${filteredCount}`
              : `Select all · ${filteredCount}`}
          </Text>
        </Pressable>
        {selectedFilteredCount > 0 && !allSelected ? (
          <Text
            style={[
              t.typography.caption1,
              { color: t.colors.text_secondary, fontWeight: "600" },
            ]}
          >
            {selectedFilteredCount} selected
          </Text>
        ) : null}
      </View>

      {matchChips.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text
            style={[
              t.typography.caption1,
              { color: t.colors.text_secondary, fontWeight: "600" },
            ]}
          >
            Select by match type
          </Text>
          <View style={styles.row}>
            {matchChips.map((chip) => (
              <Pressable
                key={chip.key}
                accessibilityRole="button"
                accessibilityState={{ selected: chip.allSelected }}
                onPress={chip.onPress}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: chip.allSelected
                      ? t.colors.tone_primary
                      : t.colors.separator,
                    backgroundColor: chip.allSelected
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
                      color: chip.allSelected
                        ? t.colors.tone_primary
                        : t.colors.text_primary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {chip.label}
                  {chip.count ? ` · ${chip.count}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {matchBidRows.length ? (
        <View style={{ gap: 6 }}>
          <Text
            style={[
              t.typography.caption1,
              { color: t.colors.text_secondary, fontWeight: "600" },
            ]}
          >
            Fast bid by match type
          </Text>
          {matchBidRows.map((row) => (
            <View key={row.key} style={styles.bidRow}>
              <Text
                style={[
                  t.typography.caption1,
                  {
                    color: t.colors.text_secondary,
                    width: 72,
                    fontWeight: "600",
                    textTransform: "capitalize",
                  },
                ]}
              >
                {row.label}
              </Text>
              <TextInput
                value={row.value}
                onChangeText={row.onChange}
                keyboardType="decimal-pad"
                placeholder={defaultBidPlaceholder}
                placeholderTextColor={t.colors.text_tertiary}
                style={[
                  t.typography.caption1,
                  styles.bidInput,
                  {
                    color: t.colors.text_primary,
                    borderColor: t.colors.separator,
                    backgroundColor: t.colors.background_secondary,
                  },
                ]}
              />
              <Pressable
                onPress={row.onApply}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: t.colors.tone_primary,
                    backgroundColor: `${t.colors.tone_primary}14`,
                    opacity: pressed ? 0.88 : 1,
                    minHeight: 36,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    { color: t.colors.tone_primary, fontWeight: "700" },
                  ]}
                >
                  Set
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  bidRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  bidInput: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 88,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    fontVariant: ["tabular-nums"],
  },
});
