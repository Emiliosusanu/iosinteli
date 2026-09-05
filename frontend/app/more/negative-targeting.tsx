import React, { memo, useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  type ListRenderItemInfo,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { dashboard, useTheme } from "@/src/lib/theme";
import { fetchNegativeKeywords, fetchNegativeProductTargets } from "@/src/lib/queries";
import { EmptyState, FilterChrome, RetryState, ScreenSpinner } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import {
  NEGATIVE_RESULT_LIMIT,
  type NegativeRowPresentation,
  type NegativeSegment,
  negativeCountLabel,
  negativeEmptyCopy,
  presentNegativeKeyword,
  presentNegativeProduct,
} from "@/src/lib/negativeTargeting";

const NegativeRow = memo(function NegativeRow({
  identity,
  typeLabel,
  scopeLabel,
  contextLabel,
  stateLabel,
  accessibilityLabel,
  testID,
  kind,
}: {
  identity: string;
  typeLabel: string;
  scopeLabel: string;
  contextLabel: string | null;
  stateLabel: string | null;
  accessibilityLabel: string;
  testID: string;
  kind: NegativeSegment;
}) {
  const t = useTheme();
  const symbolColor = kind === "keywords" ? t.colors.tone_primary : t.colors.tone_product;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, { backgroundColor: t.colors.background_secondary }]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.iconWell, { backgroundColor: symbolColor + "18" }]}
      >
        <SFSymbol name="minus.circle" size={17} color={symbolColor} />
      </View>
      <View style={styles.rowCopy}>
        <Text
          selectable
          style={[t.typography.headline, { color: t.colors.text_primary, lineHeight: undefined }]}
        >
          {identity}
        </Text>
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: 3, lineHeight: undefined },
          ]}
        >
          {[typeLabel, scopeLabel, stateLabel].filter(Boolean).join(" · ")}
        </Text>
        {contextLabel ? (
          <Text
            style={[
              t.typography.footnote,
              { color: t.colors.text_secondary, marginTop: 2, lineHeight: undefined },
            ]}
          >
            {contextLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

function Separator() {
  return <View style={styles.separator} />;
}

export default function NegativeTargetingScreen() {
  const t = useTheme();
  const { user, guestMode } = useAuth();
  const { selectedProfileIds, adminFilterUserId } = useApp();
  const [segment, setSegment] = useState<NegativeSegment>("keywords");
  const [search, setSearch] = useState("");
  const viewingCustomer = !!adminFilterUserId;
  const canRead =
    !!user?.id &&
    !guestMode &&
    !viewingCustomer &&
    selectedProfileIds.length > 0;

  const keywordsQ = useQuery({
    queryKey: [
      "negative-keywords",
      user?.id ?? "guest",
      adminFilterUserId ?? "self",
      selectedProfileIds,
    ],
    queryFn: () => fetchNegativeKeywords(selectedProfileIds),
    enabled: canRead && segment === "keywords",
    placeholderData: undefined,
  });

  const productsQ = useQuery({
    queryKey: [
      "negative-products",
      user?.id ?? "guest",
      adminFilterUserId ?? "self",
      selectedProfileIds,
    ],
    queryFn: () => fetchNegativeProductTargets(selectedProfileIds),
    enabled: canRead && segment === "products",
    placeholderData: undefined,
  });

  const activeQuery = segment === "keywords" ? keywordsQ : productsQ;
  const sourceRows = useMemo<NegativeRowPresentation[]>(() => {
    if (segment === "keywords") return (keywordsQ.data ?? []).map(presentNegativeKeyword);
    return (productsQ.data ?? []).map(presentNegativeProduct);
  }, [keywordsQ.data, productsQ.data, segment]);
  const searching = search.trim().length > 0;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sourceRows;
    return sourceRows.filter((row) => row.searchText.includes(needle));
  }, [search, sourceRows]);
  const countLabel = negativeCountLabel({
    segment,
    sourceCount: sourceRows.length,
    filteredCount: rows.length,
    searching,
  });
  const empty = negativeEmptyCopy(segment, searching);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<NegativeRowPresentation>) => (
      <NegativeRow
        identity={item.identity}
        typeLabel={item.typeLabel}
        scopeLabel={item.scopeLabel}
        contextLabel={item.contextLabel}
        stateLabel={item.stateLabel}
        accessibilityLabel={item.accessibilityLabel}
        testID={item.testID}
        kind={segment}
      />
    ),
    [segment],
  );
  const keyExtractor = useCallback((item: NegativeRowPresentation) => item.id, []);

  if (guestMode || !user?.id) {
    return (
      <SubScreen title="Negative targeting">
        <EmptyState
          icon="person-outline"
          title="Sign in to view negatives"
          subtitle="Preview demo does not include negative targeting."
        />
      </SubScreen>
    );
  }

  if (viewingCustomer) {
    return (
      <SubScreen title="Negative targeting">
        <EmptyState
          icon="eye-off-outline"
          title="Customer negatives unavailable"
          subtitle="This iPhone screen cannot load another customer's negatives. Switch back to your account from Campaigns, Targets, or Books."
        />
      </SubScreen>
    );
  }

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Negative targeting">
        <EmptyState
          icon="business-outline"
          title="No profiles in the current view"
          subtitle="Choose profiles in Amazon Accounts or from a screen with the profile selector."
        />
      </SubScreen>
    );
  }

  return (
    <SubScreen title="Negative targeting">
      <FilterChrome>
        <IOSSearchBar
          testID="negative-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search negatives"
        />
        <IOSSegmentedControl
          testID="negative-type-filter"
          value={segment}
          onChange={(value) => setSegment(value as NegativeSegment)}
          options={[
            { key: "keywords", label: "Keywords" },
            { key: "products", label: "Products" },
          ]}
        />
      </FilterChrome>
      {activeQuery.isLoading && sourceRows.length === 0 ? (
        <ScreenSpinner />
      ) : activeQuery.isError && sourceRows.length === 0 ? (
        <RetryState
          title={`Couldn't load negative ${segment === "keywords" ? "keywords" : "product targets"}`}
          subtitle="Check the connection and try again."
          onRetry={() => void activeQuery.refetch()}
          retrying={activeQuery.isRefetching}
        />
      ) : (
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl
              refreshing={activeQuery.isRefetching}
              onRefresh={() => void activeQuery.refetch()}
              tintColor={t.colors.tone_primary}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text
                accessibilityLabel={countLabel}
                style={[t.typography.footnote, { color: t.colors.text_secondary }]}
              >
                {countLabel}
              </Text>
              {activeQuery.isError ? (
                <Text
                  accessibilityRole="alert"
                  style={[t.typography.footnote, { color: t.colors.tone_danger, marginTop: 4 }]}
                >
                  {"Couldn't refresh. Pull to try again."}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="ban-outline"
              title={empty.title}
              subtitle={empty.subtitle}
            />
          }
          ListFooterComponent={
            sourceRows.length >= NEGATIVE_RESULT_LIMIT ? (
              <Text
                style={[
                  t.typography.footnote,
                  styles.limitNote,
                  { color: t.colors.text_secondary, lineHeight: undefined },
                ]}
              >
                Showing the latest {NEGATIVE_RESULT_LIMIT} for the profiles in the current view.
              </Text>
            ) : null
          }
        />
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
  },
  listHeader: {
    minHeight: 28,
    justifyContent: "center",
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    minHeight: 72,
  },
  iconWell: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  separator: {
    height: 6,
  },
  limitNote: {
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
