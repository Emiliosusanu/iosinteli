import React, { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol, sfFromIonicon } from "@/src/components/ios/Native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { BidBudgetEditor, EntityStateSwitch, MutationTap, assertNotViewingAsOtherUser, blockIfCannotWriteAmazon } from "@/src/components/Mutations";
import { ParentLinks, targetingPerfStatus } from "@/src/components/EntityDetail";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { acosTone, layout, radii, spacing, toneColor, useTheme } from "@/src/lib/theme";
import { applyOptimisticEntityBid, applyOptimisticEntityState, invalidateEntityStateQueries, patchEntityInQueryData, revertOptimisticEntityBid, revertOptimisticEntityState, useInvalidateAds } from "@/src/lib/invalidateAds";
import { updateAdGroupManual, updateAdGroupState, updateKeywordManual, updateProductTargetManual } from "@/src/lib/mutations";
import { fetchAdGroupAutomationHistory, fetchAdGroupById, fetchKeywords, fetchProductTargets, fetchSearchTerms } from "@/src/lib/queries";
import { shouldShowActiveOrPausedWithData, statusLabel } from "@/src/lib/campaigns";
import { describeProductTarget, fallbackAsinCoverUrl, formatMatchTypeLabel, isExactMatchType, productTargetHeading, readTargetBid } from "@/src/lib/targeting";
import { resolveAdGroupAddMode } from "@/src/lib/adGroupTargets";
import { formatCurrency, formatInt, formatPercent, safeDivide } from "@/src/lib/format";
import { EmptyState, FilterChrome, SectionCard, ToneDot, MetricStrip, RetryState, ScreenSpinner, ListCard, DenseMetricLine } from "@/src/components/Primitives";
import { useLocalSearchParams, useRouter } from "expo-router";
import { fastAddSearchTermExact, searchTermLooksTargeted } from "@/src/lib/searchTermHarvest";
import { sortSearchTermsAcosThenSpend } from "@/src/lib/searchTermSort";

type TabKey = "targets" | "searchTerms" | "history";

function paramId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function AdGroupDetailScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidateAds = useInvalidateAds();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, defaultExactBid } = useApp();
  const { user, guestMode } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const writeGuard = { guestMode, viewAsOtherUser };
  const params = useLocalSearchParams<{
    id: string; name?: string; isAuto?: string; state?: string;
    spend?: string; orders?: string; acos?: string; ctr?: string; clicks?: string; impressions?: string;
  }>();
  const id = paramId(params.id);
  const nameParam = paramId(params.name);
  const isAuto = paramId(params.isAuto);
  const stateParam = paramId(params.state);
  const [tab, setTab] = useState<TabKey>("targets");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [keywordBid, setKeywordBid] = useState<{ id: string; title: string; value: number } | null>(null);
  const [targetBid, setTargetBid] = useState<{ id: string; title: string; value: number } | null>(null);
  const [addingExactId, setAddingExactId] = useState<string | null>(null);

  const adGroupsQ = useQuery({
    queryKey: ["ad-group-detail", id, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchAdGroupById(id, selectedProfileIds, { start: dateRange.start, end: dateRange.end }),
    enabled: !!id && selectedProfileIds.length > 0,
  });
  const group = adGroupsQ.data ?? null;
  const groupState = String(group?.state ?? stateParam ?? "");
  const displayName = group?.name || nameParam || "Ad Group";
  const auto = group?.is_auto ?? isAuto === "true";

  const keywordsQ = useQuery({
    queryKey: ["adgroup-keywords", adminFilterUserId ?? "self", id, dateRange.start, dateRange.end],
    queryFn: () => fetchKeywords(selectedProfileIds, { adGroupId: id, start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const targetsQ = useQuery({
    queryKey: ["adgroup-targets", adminFilterUserId ?? "self", id, dateRange.start, dateRange.end],
    queryFn: () => fetchProductTargets(selectedProfileIds, { adGroupId: id, start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const searchTermsQ = useQuery({
    queryKey: ["adgroup-search-terms", id, dateRange.start, dateRange.end],
    queryFn: () => fetchSearchTerms(selectedProfileIds, { adGroupId: id, start: dateRange.start, end: dateRange.end }),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const historyQ = useQuery({
    queryKey: ["adgroup-automation-history", id],
    queryFn: () => fetchAdGroupAutomationHistory(selectedProfileIds, id),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const addMode = resolveAdGroupAddMode({
    targetingType: group?.targeting_type,
    isAuto: auto,
    keywordCount: (keywordsQ.data ?? []).length,
    productTargetCount: (targetsQ.data ?? []).length,
    nameHint: displayName,
  });

  const searchNeedle = search.trim().toLowerCase();

  const keywords = useMemo(
    () =>
      (keywordsQ.data ?? [])
        .filter((kw) => shouldShowActiveOrPausedWithData(kw as any, kw.status))
        .filter((kw) => !searchNeedle || `${kw.keyword_text ?? ""} ${kw.match_type ?? ""}`.toLowerCase().includes(searchNeedle)),
    [keywordsQ.data, searchNeedle],
  );

  const targets = useMemo(
    () =>
      (targetsQ.data ?? [])
        .filter((pt) => shouldShowActiveOrPausedWithData(pt as any, pt.state))
        .filter((pt: any) => {
          if (!searchNeedle) return true;
          const described = describeProductTarget(pt.expression, pt.expression_type);
          return `${pt.title ?? ""} ${described.label} ${described.asin ?? ""}`.toLowerCase().includes(searchNeedle);
        }),
    [targetsQ.data, searchNeedle],
  );

  const searchTerms = useMemo(
    () => sortSearchTermsAcosThenSpend(
      (searchTermsQ.data ?? []).filter((term: any) =>
        !searchNeedle ||
        `${term.search_term ?? ""} ${term.campaign_name ?? ""} ${term.ad_group_name ?? ""} ${term.match_type ?? ""}`.toLowerCase().includes(searchNeedle),
      ),
    ),
    [searchNeedle, searchTermsQ.data],
  );

  const historyRows = useMemo(
    () =>
      (historyQ.data ?? []).filter((row: any) =>
        !searchNeedle ||
        `${row.entity_name ?? ""} ${row.entity_type ?? ""} ${row.action_type ?? ""} ${row.rule_name ?? ""} ${row.origin_label ?? ""} ${row.destination_label ?? ""}`.toLowerCase().includes(searchNeedle),
      ),
    [historyQ.data, searchNeedle],
  );

  const spendN = group != null ? Number(group.total_spend) || 0 : Number(params.spend ?? 0) || 0;
  const ordersN = group != null ? Number(group.total_orders) || 0 : Number(params.orders ?? 0) || 0;
  const salesN = group != null ? Number(group.total_sales) || 0 : 0;
  const clicksN = group != null ? Number(group.total_clicks) || 0 : Number(params.clicks ?? 0) || 0;
  const imprN = group != null ? Number(group.total_impressions) || 0 : Number(params.impressions ?? 0) || 0;
  const acosN = salesN > 0 ? (group != null ? Number(group.total_acos) || safeDivide(spendN, salesN) * 100 : Number(params.acos ?? 0) || 0) : 0;
  const ctrN = imprN > 0 ? (clicksN / imprN) * 100 : 0;
  const cvrN = clicksN > 0 ? (ordersN / clicksN) * 100 : 0;
  const roasN = spendN > 0 && salesN > 0 ? salesN / spendN : 0;
  const cpcN = clicksN > 0 ? spendN / clicksN : 0;
  const metricsFromGroup = group != null;
  const verdict = targetingPerfStatus({
    total_spend: spendN,
    total_orders: ordersN,
    // Route params omit sales. Orders > 0 still means the group produced sales — do not treat missing as $0.
    total_sales: metricsFromGroup ? salesN : ordersN > 0 ? 1 : 0,
    total_acos: metricsFromGroup ? acosN : Number(params.acos ?? 0) || 0,
  });
  const defaultBid = group?.default_bid != null && Number.isFinite(Number(group.default_bid))
    ? formatCurrency(Number(group.default_bid), primaryCurrency)
    : null;
  const addExact = async (term: any) => {
    if (addingExactId) return;
    setAddingExactId(term.id);
    try {
      await fastAddSearchTermExact({
        guestMode,
        viewAsOtherUser,
        id: term.id,
        term: term.search_term ?? "",
        bid: defaultExactBid,
        onSuccess: async () => {
          queryClient.setQueriesData({ queryKey: ["adgroup-search-terms"] }, (prev: any) => {
            if (!Array.isArray(prev)) return prev;
            return prev.map((row: any) =>
              String(row.id) === String(term.id)
                ? { ...row, status: "targeted", has_target: true, is_targeted: true }
                : row,
            );
          });
          await searchTermsQ.refetch();
        },
      });
    } finally {
      setAddingExactId(null);
    }
  };
  const renameAdGroup = () => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    Alert.prompt(
      "Rename ad group",
      "The new name is written to Amazon Ads.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) => {
            const name = String(value ?? "").trim();
            if (!name || name === displayName) return;
            void updateAdGroupManual(id, { name })
              .then(() => adGroupsQ.refetch())
              .catch(() => Alert.alert("Couldn't rename ad group", "Amazon Ads did not accept the change."));
          },
        },
      ],
      "plain-text",
      displayName,
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        adGroupsQ.refetch(),
        keywordsQ.refetch(),
        targetsQ.refetch(),
        searchTermsQ.refetch(),
        historyQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Ad Group" showDateRange>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to see this ad group." />
      </SubScreen>
    );
  }

  if (!id) {
    return (
      <SubScreen title="Ad Group" showDateRange>
        <EmptyState icon="layers-outline" title="Ad group not found" />
      </SubScreen>
    );
  }

  if (adGroupsQ.isLoading && !group && !nameParam) {
    return (
      <SubScreen title="Ad Group" showDateRange>
        <ScreenSpinner />
      </SubScreen>
    );
  }

  if (adGroupsQ.isError && !group && !nameParam) {
    return (
      <SubScreen title="Ad Group" showDateRange>
        <RetryState
          title="Couldn't load ad group"
          subtitle="Check your connection and try again."
          onRetry={() => void adGroupsQ.refetch()}
          retrying={adGroupsQ.isRefetching}
        />
      </SubScreen>
    );
  }

  if (!group && !nameParam && !adGroupsQ.isLoading) {
    return (
      <SubScreen title="Ad Group" showDateRange>
        <EmptyState icon="layers-outline" title="Ad group not found" subtitle="It may belong to another profile." />
      </SubScreen>
    );
  }

  const dash = (value: string, ready = true) => (!ready ? "—" : value);
  const salesReady = metricsFromGroup;

  return (
    <SubScreen title={displayName} showDateRange>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />}
      >
        <SectionCard>
          <View style={styles.headerRow}>
            <EntityStateSwitch
              testID={`ad-group-state-${id}`}
              enabled={groupState === "enabled"}
              noun="ad group"
              onChange={async (next) => {
                if (!id) return;
                assertNotViewingAsOtherUser(viewAsOtherUser);
                const previous = applyOptimisticEntityState(queryClient, "ad_group", id, next);
                try {
                  await updateAdGroupState(id, next ? "enabled" : "paused");
                  void invalidateEntityStateQueries(queryClient, "ad_group");
                } catch (error) {
                  revertOptimisticEntityState(queryClient, "ad_group", id, previous);
                  throw error;
                }
              }}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={[displayName, verdict.label, auto ? "Automatic" : "Manual", groupState === "enabled" ? "Enabled" : "Paused"].filter(Boolean).join(". ")}
              >
                <Text
                  style={[t.typography.headline, { color: t.colors.text_primary }]}
                  numberOfLines={2}
                >
                  {displayName}
                </Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Rename ad group" onPress={renameAdGroup} hitSlop={8}>
                  <SFSymbol name="pencil" size={14} color={t.colors.tone_primary} />
                </TouchableOpacity>
                <View style={styles.metaRow}>
                  <View style={[styles.statusDot, { backgroundColor: toneColor(verdict.tone, t.colors) }]} />
                  <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
                    {verdict.label}
                  </Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                    {auto ? "Automatic" : "Manual"}
                  </Text>
                </View>
              </View>
              {group?.campaign_id ? (
                <ParentLinks campaignId={group.campaign_id} campaignName={null} />
              ) : null}
            </View>
          </View>
          {defaultBid ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Default bid ${defaultBid}. Edit bid.`}
              onPress={() => {
                if (blockIfCannotWriteAmazon(writeGuard)) return;
                setBidOpen(true);
              }}
              style={[styles.bidRow, { borderTopColor: t.colors.separator }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Default bid</Text>
                <Text style={[t.typography.title2, { color: t.colors.text_primary, fontVariant: ["tabular-nums"], marginTop: 2 }]}>
                  {defaultBid}
                </Text>
              </View>
              <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Edit</Text>
            </TouchableOpacity>
          ) : null}

          <View style={[styles.metricsBlock, { borderTopColor: t.colors.separator }]}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: spacing.sm }]} accessibilityRole="header">
              Outcome
            </Text>
            <MetricStrip
              items={[
                {
                  label: "ACoS",
                  value: salesReady ? (salesN > 0 ? formatPercent(acosN) : "—") : dash(Number(params.acos ?? 0) > 0 ? formatPercent(Number(params.acos)) : "—"),
                  color: toneColor(acosTone(acosN || Number(params.acos ?? 0)), t.colors),
                },
                { label: "Spend", value: formatCurrency(spendN, primaryCurrency) },
                { label: "Orders", value: formatInt(ordersN) },
              ]}
            />
            <View style={[styles.metricsSplit, { backgroundColor: t.colors.separator }]} />
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: spacing.sm }]} accessibilityRole="header">
              Traffic
            </Text>
            <MetricStrip
              items={[
                { label: "Clicks", value: formatInt(clicksN) },
                { label: "Impr.", value: formatInt(imprN) },
                { label: "CTR", value: imprN > 0 ? formatPercent(ctrN, 2) : "—" },
                { label: "CVR", value: clicksN > 0 ? formatPercent(cvrN, 1) : "—" },
              ]}
            />
            <View style={[styles.metricsSplit, { backgroundColor: t.colors.separator }]} />
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: spacing.sm }]} accessibilityRole="header">
              Efficiency
            </Text>
            <MetricStrip
              items={[
                { label: "ROAS", value: salesReady && spendN > 0 ? `${roasN.toFixed(2)}x` : "—" },
                { label: "CPC", value: clicksN > 0 ? formatCurrency(cpcN, primaryCurrency) : "—" },
              ]}
            />
          </View>
        </SectionCard>

        <View style={styles.childChrome}>
          <FilterChrome flush>
            <IOSSearchBar
              testID="ad-group-search"
              placeholder="Find keywords, products, search terms"
              value={search}
              onChangeText={setSearch}
            />
            <IOSSegmentedControl
              testID="ad-group-tabs"
              value={tab}
              onChange={setTab}
              options={[
                { key: "targets", label: "Targets" },
                { key: "searchTerms", label: "Terms" },
                { key: "history", label: "History" },
              ]}
            />
          </FilterChrome>
        </View>

        {tab === "targets" && (
          <>
          {!auto ? (
            <SectionCard title="Add targeting">
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {addMode === "keywords" || addMode === "both" ? (
                  <TouchableOpacity
                    testID="adgroup-add-keywords"
                    accessibilityRole="button"
                    accessibilityLabel="Add keywords"
                    onPress={() =>
                      router.push(
                        `/adgroup/add-targets?id=${encodeURIComponent(id)}&campaignId=${encodeURIComponent(group?.campaign_id ?? "")}&mode=keywords&name=${encodeURIComponent(displayName)}`,
                      )
                    }
                    style={[styles.addTargetButton, { borderColor: t.colors.tone_primary, backgroundColor: `${t.colors.tone_primary}14`, flex: 1 }]}
                  >
                    <Text style={[t.typography.callout, { color: t.colors.tone_primary, fontWeight: "700" }]}>Keywords</Text>
                  </TouchableOpacity>
                ) : null}
                {addMode === "products" || addMode === "both" ? (
                  <TouchableOpacity
                    testID="adgroup-add-asins"
                    accessibilityRole="button"
                    accessibilityLabel="Add product targets"
                    onPress={() =>
                      router.push(
                        `/adgroup/add-targets?id=${encodeURIComponent(id)}&campaignId=${encodeURIComponent(group?.campaign_id ?? "")}&mode=products&name=${encodeURIComponent(displayName)}`,
                      )
                    }
                    style={[styles.addTargetButton, { borderColor: t.colors.tone_product, backgroundColor: `${t.colors.tone_product}14`, flex: 1 }]}
                  >
                    <Text style={[t.typography.callout, { color: t.colors.tone_product, fontWeight: "700" }]}>Products</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </SectionCard>
          ) : null}
          <TargetsPane
            auto={auto}
            searching={searchNeedle.length > 0}
            keywords={keywords}
            targets={targets}
            keywordsQ={keywordsQ}
            targetsQ={targetsQ}
            primaryCurrency={primaryCurrency}
            t={t}
            viewAsOtherUser={viewAsOtherUser}
            onOpenKeyword={(keywordId) => router.push(`/keyword/${keywordId}` as any)}
            onOpenTarget={(targetId) => router.push(`/target/${targetId}` as any)}
            onEditKeywordBid={(kw) => {
              const bid = readTargetBid({ bid_amount: kw.bid_amount, bid: kw.bid });
              setKeywordBid({
                id: kw.id,
                title: kw.keyword_text || "Keyword bid",
                value: bid ?? (Number(group?.default_bid) || 0.75),
              });
            }}
            onEditTargetBid={(pt) => {
              const bid = readTargetBid(pt);
              const heading = productTargetHeading(pt);
              setTargetBid({
                id: pt.id,
                title: heading || "Target bid",
                value: bid ?? (Number(group?.default_bid) || 0.75),
              });
            }}
          />
          </>
        )}

        {tab === "searchTerms" && (
          <SectionCard title={`Search Terms (${searchTerms.length})`}>
            {searchTermsQ.isError && (searchTermsQ.data ?? []).length === 0 ? (
              <RetryState
                title="Couldn't load search terms"
                subtitle="Keywords and targets above are still available."
                onRetry={() => void searchTermsQ.refetch()}
                retrying={searchTermsQ.isRefetching}
              />
            ) : searchTermsQ.isLoading && (searchTermsQ.data ?? []).length === 0 ? (
              <ScreenSpinner />
            ) : searchTerms.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title={searchNeedle ? "No matching search terms" : "No search terms in this range"}
                subtitle={searchNeedle ? "Try a different term." : "Nothing for the selected dates."}
              />
            ) : (
              searchTerms.map((term: any, idx) => (
                <SearchTermRow
                  key={term.id}
                  item={term}
                  last={idx === searchTerms.length - 1}
                  currency={primaryCurrency}
                  t={t}
                  alreadyExact={searchTermLooksTargeted(term)}
                  addingExact={addingExactId === term.id}
                  onAddExact={() => void addExact(term)}
                  onPress={() =>
                    router.push({
                      pathname: "/search-term/[id]",
                      params: { id: term.id, term: term.search_term ?? "", campaign: term.campaign_name ?? "", adGroup: term.ad_group_name ?? "" },
                    } as any)
                  }
                />
              ))
            )}
          </SectionCard>
        )}

        {tab === "history" && (
          <SectionCard title={`Automation History (${historyRows.length})`}>
            {historyQ.isError && (historyQ.data ?? []).length === 0 ? (
              <RetryState
                title="Couldn't load history"
                subtitle="The rest of this ad group is still available."
                onRetry={() => void historyQ.refetch()}
                retrying={historyQ.isRefetching}
              />
            ) : historyQ.isLoading && (historyQ.data ?? []).length === 0 ? (
              <ScreenSpinner />
            ) : historyRows.length === 0 ? (
              <EmptyState
                icon="time-outline"
                title={searchNeedle ? "No matching history" : "No automation changes inside this ad group"}
                subtitle={searchNeedle ? "Try a different search." : undefined}
              />
            ) : (
              historyRows.map((row: any, idx) => (
                <HistoryRow key={row.id} row={row} last={idx === historyRows.length - 1} currency={primaryCurrency} t={t} />
              ))
            )}
          </SectionCard>
        )}
      </ScrollView>
      <BidBudgetEditor
        visible={bidOpen}
        title="Default bid"
        value={group?.default_bid != null ? Number(group.default_bid) : 0.75}
        currency={primaryCurrency}
        kind="money"
        onClose={() => setBidOpen(false)}
        onSave={async (next) => {
          const previous = group?.default_bid == null ? null : Number(group.default_bid);
          queryClient.setQueriesData(
            { predicate: (query) => String(query.queryKey[0] ?? "").startsWith("ad-group") || String(query.queryKey[0] ?? "").startsWith("campaign") },
            (old) => patchEntityInQueryData(old, id, (row) => ({ ...row, default_bid: next })),
          );
          setBidOpen(false);
          try {
            await updateAdGroupManual(id, { defaultBid: next }, (targetsQ.data ?? []).filter((pt: any) => describeProductTarget(pt.expression, pt.expression_type, pt.resolved_expression).isAuto).map((pt: any) => pt.id));
            void invalidateAds(["ad-group-detail", "campaign-ad-groups", "campaign-keywords", "campaign-product-targets"]);
          } catch (error) {
            if (previous != null && Number.isFinite(previous)) {
              queryClient.setQueriesData(
                { predicate: (query) => String(query.queryKey[0] ?? "").startsWith("ad-group") || String(query.queryKey[0] ?? "").startsWith("campaign") },
                (old) => patchEntityInQueryData(old, id, (row) => ({ ...row, default_bid: previous })),
              );
            } else {
              void adGroupsQ.refetch();
            }
            throw error;
          }
        }}
      />
      <BidBudgetEditor
        visible={keywordBid != null}
        title={keywordBid?.title ?? "Keyword bid"}
        value={keywordBid?.value ?? 0.75}
        currency={primaryCurrency}
        kind="money"
        onClose={() => setKeywordBid(null)}
        onSave={async (next) => {
          if (!keywordBid) return;
          assertNotViewingAsOtherUser(viewAsOtherUser);
          const edit = keywordBid;
          const previous = applyOptimisticEntityBid(queryClient, "keyword", edit.id, next);
          setKeywordBid(null);
          try {
            await updateKeywordManual(edit.id, { bid: next });
            void invalidateAds(["ad-group-keywords", "campaign-keywords"]);
          } catch (error) {
            revertOptimisticEntityBid(queryClient, "keyword", edit.id, previous);
            throw error;
          }
        }}
      />
      <BidBudgetEditor
        visible={targetBid != null}
        title={targetBid?.title ?? "Target bid"}
        value={targetBid?.value ?? 0.75}
        currency={primaryCurrency}
        kind="money"
        onClose={() => setTargetBid(null)}
        onSave={async (next) => {
          if (!targetBid) return;
          assertNotViewingAsOtherUser(viewAsOtherUser);
          const edit = targetBid;
          const previous = applyOptimisticEntityBid(queryClient, "product_target", edit.id, next);
          setTargetBid(null);
          try {
            await updateProductTargetManual(edit.id, { bid: next });
            void invalidateAds(["ad-group-product-targets", "campaign-product-targets"]);
          } catch (error) {
            revertOptimisticEntityBid(queryClient, "product_target", edit.id, previous);
            throw error;
          }
        }}
      />
    </SubScreen>
  );
}

function TargetsPane({
  auto,
  searching,
  keywords,
  targets,
  keywordsQ,
  targetsQ,
  primaryCurrency,
  t,
  viewAsOtherUser,
  onOpenKeyword,
  onOpenTarget,
  onEditKeywordBid,
  onEditTargetBid,
}: {
  auto: boolean;
  searching: boolean;
  keywords: any[];
  targets: any[];
  keywordsQ: { isLoading: boolean; isError: boolean; isRefetching: boolean; data?: any[]; refetch: () => void };
  targetsQ: { isLoading: boolean; isError: boolean; isRefetching: boolean; data?: any[]; refetch: () => void };
  primaryCurrency: string;
  t: any;
  viewAsOtherUser: boolean;
  onOpenKeyword: (id: string) => void;
  onOpenTarget: (id: string) => void;
  onEditKeywordBid: (kw: any) => void;
  onEditTargetBid: (pt: any) => void;
}) {
  const showKeywords = keywordsQ.isLoading || keywordsQ.isError || keywords.length > 0 || searching;
  const showTargets = targetsQ.isLoading || targetsQ.isError || targets.length > 0 || searching;
  const bothEmpty = !keywordsQ.isLoading && !targetsQ.isLoading && !keywordsQ.isError && !targetsQ.isError && keywords.length === 0 && targets.length === 0;

  return (
    <>
      {showKeywords ? (
        <SectionCard title={`Keywords (${keywords.length})`}>
          {keywordsQ.isError && (keywordsQ.data ?? []).length === 0 ? (
            <RetryState
              title="Couldn't load keywords"
              subtitle="Other targeting on this ad group is still available."
              onRetry={() => void keywordsQ.refetch()}
              retrying={keywordsQ.isRefetching}
            />
          ) : keywordsQ.isLoading && (keywordsQ.data ?? []).length === 0 ? (
            <ScreenSpinner />
          ) : keywords.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title={searching ? "No matching keywords" : "No keywords"}
              subtitle={searching ? "Try a different name or match type." : "No keywords with data in this range."}
            />
          ) : (
            keywords.map((kw, idx) => (
              <KeywordRow
                key={kw.id}
                kw={kw}
                last={idx === keywords.length - 1}
                currency={primaryCurrency}
                t={t}
                viewAsOtherUser={viewAsOtherUser}
                onPress={() => onOpenKeyword(kw.id)}
                onEditBid={() => onEditKeywordBid(kw)}
              />
            ))
          )}
        </SectionCard>
      ) : null}

      {showTargets ? (
        <SectionCard title={auto ? `Auto Targeting (${targets.length})` : `Product Targets (${targets.length})`}>
          {targetsQ.isError && (targetsQ.data ?? []).length === 0 ? (
            <RetryState
              title={auto ? "Couldn't load auto targets" : "Couldn't load product targets"}
              subtitle="Other targeting on this ad group is still available."
              onRetry={() => void targetsQ.refetch()}
              retrying={targetsQ.isRefetching}
            />
          ) : targetsQ.isLoading && (targetsQ.data ?? []).length === 0 ? (
            <ScreenSpinner />
          ) : targets.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title={searching ? "No matching targets" : auto ? "No auto targets" : "No product targets"}
              subtitle={searching ? "Try a different name or ASIN." : "Nothing with data in this range."}
            />
          ) : (
            targets.map((pt: any, idx) => (
              <TargetRow
                key={pt.id}
                pt={pt}
                auto={auto}
                last={idx === targets.length - 1}
                primaryCurrency={primaryCurrency}
                t={t}
                viewAsOtherUser={viewAsOtherUser}
                onPress={() => onOpenTarget(pt.id)}
                onEditBid={() => onEditTargetBid(pt)}
              />
            ))
          )}
        </SectionCard>
      ) : null}

      {bothEmpty && !showKeywords && !showTargets ? (
        <SectionCard title="Targets">
          <EmptyState
            icon="search-outline"
            title={searching ? "No matching targets" : "No targets in this range"}
            subtitle={searching ? "Try a different search." : "No keywords or product targets with data for the selected dates."}
          />
        </SectionCard>
      ) : null}
    </>
  );
}

function adGroupMetricItems(item: any, currency: string, t: any) {
  return [
    { label: "Spend", value: formatCurrency(Number(item.total_spend) || 0, currency) },
    { label: "Impr", value: formatInt(Number(item.total_impressions) || 0) },
    { label: "Clicks", value: formatInt(Number(item.total_clicks) || 0) },
    { label: "Ord", value: formatInt(Number(item.total_orders) || 0) },
    {
      label: "ACoS",
      value: Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos) || safeDivide(Number(item.total_spend), Number(item.total_sales)) * 100) : "—",
      color: Number(item.total_sales) > 0 ? toneColor(acosTone(Number(item.total_acos) || 0), t.colors) : t.colors.text_secondary,
    },
  ];
}

function KeywordRow({
  kw,
  last: _last,
  currency,
  t,
  viewAsOtherUser,
  onPress,
  onEditBid,
}: {
  kw: any;
  last: boolean;
  currency: string;
  t: any;
  viewAsOtherUser: boolean;
  onPress: () => void;
  onEditBid: () => void;
}) {
  const queryClient = useQueryClient();
  const matchLabel = formatMatchTypeLabel(kw.match_type);
  const bid = readTargetBid({ bid_amount: kw.bid_amount, bid: kw.bid });
  return (
    <ListCard testID={`adgroup-keyword-row-${kw.id}`} compact>
      <View style={styles.leadRow}>
        <View style={styles.switchWell}>
          <EntityStateSwitch
            testID={`adgroup-keyword-state-${kw.id}`}
            enabled={kw.status === "enabled"}
            noun="keyword"
            onChange={async (next) => {
              assertNotViewingAsOtherUser(viewAsOtherUser);
              const previous = applyOptimisticEntityState(queryClient, "keyword", kw.id, next);
              try {
                await updateKeywordManual(kw.id, { status: next ? "enabled" : "paused" });
                void invalidateEntityStateQueries(queryClient, "keyword");
              } catch (error) {
                revertOptimisticEntityState(queryClient, "keyword", kw.id, previous);
                throw error;
              }
            }}
          />
        </View>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${kw.keyword_text || "Keyword"}, ${matchLabel}`}
          style={{ flex: 1, minWidth: 0 }}
        >
          <View style={styles.titleRow}>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", flex: 1 }]} numberOfLines={1}>
              {kw.keyword_text ?? "—"}
            </Text>
            <MutationTap
              testID={`adgroup-keyword-bid-${kw.id}`}
              label="Bid"
              compact
              value={bid != null ? formatCurrency(bid, currency) : "Set"}
              cooldownRow={kw}
              onPress={() => onEditBid()}
            />
          </View>
          {matchLabel ? (
            <View style={styles.metaRow}>
              <Text
                style={[
                  t.typography.caption2,
                  {
                    color: t.colors.text_secondary,
                    fontWeight: isExactMatchType(kw.match_type) ? "700" : "500",
                  },
                ]}
              >
                {matchLabel}
              </Text>
            </View>
          ) : null}
          <DenseMetricLine items={adGroupMetricItems(kw, currency, t)} />
        </TouchableOpacity>
      </View>
    </ListCard>
  );
}

function TargetRow({
  pt,
  auto,
  last: _last,
  primaryCurrency,
  t,
  viewAsOtherUser,
  onPress,
  onEditBid,
}: {
  pt: any;
  auto: boolean;
  last: boolean;
  primaryCurrency: string;
  t: any;
  viewAsOtherUser: boolean;
  onPress: () => void;
  onEditBid: () => void;
}) {
  const queryClient = useQueryClient();
  const target = describeProductTarget(pt.expression, pt.expression_type, pt.resolved_expression);
  const displayTitle = productTargetHeading(pt);
  const status = targetingPerfStatus(pt);
  const bid = readTargetBid(pt);
  const coverAsin = target.asin || pt.cover_asin || null;

  return (
    <ListCard testID={`adgroup-target-row-${pt.id}`} compact>
      <View style={styles.leadRow}>
        <View style={styles.switchWell}>
          <EntityStateSwitch
            testID={`adgroup-target-state-${pt.id}`}
            enabled={pt.state === "enabled"}
            noun="target"
            onChange={async (next) => {
              assertNotViewingAsOtherUser(viewAsOtherUser);
              const previous = applyOptimisticEntityState(queryClient, "product_target", pt.id, next);
              try {
                await updateProductTargetManual(pt.id, { state: next ? "enabled" : "paused" });
                void invalidateEntityStateQueries(queryClient, "product_target");
              } catch (error) {
                revertOptimisticEntityState(queryClient, "product_target", pt.id, previous);
                throw error;
              }
            }}
          />
        </View>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${displayTitle}, ${target.label}, ${status.label}`}
          style={{ flex: 1, minWidth: 0 }}
        >
          <View style={styles.cardHeader}>
            <BookCover
              uri={pt.image_url}
              fallbackUri={fallbackAsinCoverUrl(coverAsin)}
              asin={coverAsin}
              size="xs"
              placeholder={target.isAuto || auto ? "auto" : coverAsin ? "book" : "cube"}
              recyclingKey={coverAsin || pt.id}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.titleRow}>
                <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", flex: 1 }]} numberOfLines={1}>
                  {displayTitle}
                </Text>
                <MutationTap
                  testID={`adgroup-target-bid-${pt.id}`}
                  label="Bid"
                  compact
                  value={bid != null ? formatCurrency(bid, primaryCurrency) : "Set"}
                  cooldownRow={pt}
                  onPress={() => onEditBid()}
                />
              </View>
              <View style={styles.metaRow}>
                <Text
                  style={[
                    t.typography.caption2,
                    {
                      color: t.colors.text_secondary,
                      fontWeight:
                        !target.isAuto && !auto && isExactMatchType(target.label) ? "700" : "500",
                    },
                  ]}
                >
                  {target.isAuto || auto ? target.label : formatMatchTypeLabel(target.label) || target.label}
                </Text>
                {coverAsin && displayTitle !== coverAsin ? (
                  <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]} numberOfLines={1}>
                    {coverAsin}
                  </Text>
                ) : null}
              </View>
              <DenseMetricLine items={adGroupMetricItems(pt, primaryCurrency, t)} />
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </ListCard>
  );
}

function SearchTermRow({ item, last, currency, t, onPress, onAddExact, alreadyExact, addingExact }: { item: any; last: boolean; currency: string; t: any; onPress: () => void; onAddExact: () => void; alreadyExact: boolean; addingExact: boolean }) {
  const acos = safeDivide(Number(item.total_spend ?? 0), Number(item.total_sales ?? 0)) * 100;
  const converting = Number(item.total_orders) > 0;
  return (
    <View
      style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${item.search_term}, ${converting ? "converting" : "no orders"}, ACoS ${item.total_sales > 0 ? formatPercent(acos) : "none"}, spend ${formatCurrency(Number(item.total_spend), currency)}, ${formatInt(Number(item.total_orders))} orders`}
        accessibilityHint="Opens search term details"
        style={{ flex: 1, minWidth: 0 }}
      >
        <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>
          {item.search_term}
        </Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]} numberOfLines={2}>
          {[converting ? "Converting" : "No orders", `${formatCurrency(Number(item.total_spend), currency)} spend`, `${formatInt(Number(item.total_orders))} orders`].join(" · ")}
        </Text>
      </TouchableOpacity>
      <Text style={[t.typography.callout, { color: toneColor(acosTone(acos), t.colors), fontVariant: ["tabular-nums"], marginLeft: spacing.sm }]}>
        {item.total_sales > 0 ? formatPercent(acos) : "—"}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={alreadyExact ? "Already added as exact" : `Add ${item.search_term} as exact`}
        disabled={alreadyExact || addingExact}
        onPress={onAddExact}
        style={{ marginLeft: spacing.sm, paddingHorizontal: 9, paddingVertical: 7, borderRadius: radii.sm, backgroundColor: alreadyExact ? t.colors.background_tertiary : `${t.colors.tone_primary}18` }}
      >
        <Text style={[t.typography.caption1, { color: alreadyExact ? t.colors.text_tertiary : t.colors.tone_primary, fontWeight: "700" }]}>{alreadyExact ? "Added" : addingExact ? "…" : "Exact"}</Text>
      </TouchableOpacity>
      <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
    </View>
  );
}

function HistoryRow({ row, last, currency, t }: { row: any; last: boolean; currency: string; t: any }) {
  const snapshot = row.metric_snapshot ?? {};
  const oldValue = simpleValue(row.old_value, currency);
  const newValue = simpleValue(row.new_value, currency);
  const when = row.executed_at ?? row.processed_at;
  return (
    <View style={[styles.historyRow, { borderBottomColor: t.colors.separator, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={[styles.historyIcon, { backgroundColor: row.success === false ? t.colors.tone_danger + "1F" : t.colors.tone_primary + "1F" }]}>
          <SFSymbol name={row.success === false ? "exclamationmark.triangle.fill" : sfFromIonicon(actionIcon(row.action_type))} size={17} color={row.success === false ? t.colors.tone_danger : t.colors.tone_primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>
            {friendlyAction(row.action_type)}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]} numberOfLines={2}>
            {friendlyEntityType(row.entity_type)} · {row.entity_name || row.entity_id}
          </Text>
          {(row.origin_label || row.destination_label) && (
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 3 }]} numberOfLines={2}>
              {row.origin_label ?? "Origin"} -&gt; {row.destination_label ?? "Destination"}
            </Text>
          )}
          {(oldValue || newValue) && (
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 3 }]} numberOfLines={1}>
              {oldValue ?? "-"} -&gt; <Text style={{ color: t.colors.text_primary, fontWeight: "600" }}>{newValue ?? "-"}</Text>
            </Text>
          )}
          <View style={[styles.snapshot, { backgroundColor: t.colors.background_tertiary }]}>
            <QuickMetric label="Rule" value={row.rule_name ?? "Automation"} t={t} wide />
            <QuickMetric label="When" value={formatWhen(when)} t={t} />
            {snapshot.spend != null && <QuickMetric label="Spend" value={formatCurrency(Number(snapshot.spend), currency, { compact: true })} t={t} />}
            {snapshot.orders != null && <QuickMetric label="Orders" value={formatInt(Number(snapshot.orders))} t={t} />}
            {snapshot.acos != null && <QuickMetric label="ACoS" value={formatPercent(Number(snapshot.acos))} color={toneColor(acosTone(Number(snapshot.acos)), t.colors)} t={t} />}
          </View>
          {row.success === false && row.error ? (
            <Text style={[t.typography.caption1, { color: t.colors.tone_danger, marginTop: spacing.xs }]} numberOfLines={2}>
              {row.error}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function QuickMetric({ label, value, color, t, wide }: { label: string; value: string; color?: string; t: any; wide?: boolean }) {
  return (
    <View style={[styles.quickMetric, wide && { minWidth: 112 }]}>
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label.toUpperCase()}</Text>
      <Text style={[t.typography.caption1, { color: color ?? t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function actionIcon(actionType?: string | null): string {
  const action = String(actionType ?? "").toLowerCase();
  if (action.includes("negative") || action.includes("negat")) return "ban";
  if (action.includes("positive") || action.includes("keyword")) return "add-circle";
  if (action.includes("bid")) return "swap-horizontal";
  if (action.includes("pause")) return "pause-circle";
  return "options";
}

function friendlyAction(actionType?: string | null): string {
  const action = String(actionType ?? "").replace(/_/g, " ");
  if (!action.trim()) return "Updated entity";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function friendlyEntityType(type?: string | null): string {
  const value = String(type ?? "").toLowerCase();
  if (value.includes("search")) return "Search term";
  if (value.includes("keyword")) return "Keyword";
  if (value.includes("target") || value.includes("asin")) return "Product target";
  if (value.includes("campaign")) return "Campaign";
  return type ?? "Entity";
}

function simpleValue(value: any, currency: string): string | null {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 20 ? String(n) : formatCurrency(n, currency);
  if (typeof value === "string") return value;
  return null;
}

function formatWhen(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  content: { padding: layout.pagePad, paddingBottom: 80 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.tight,
    marginTop: spacing.xs,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  bidRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: layout.minTap,
    paddingTop: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metricsBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metricsSplit: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  childChrome: { gap: spacing.sm, marginBottom: spacing.md },
  addTargetButton: {
    flex: 1,
    minHeight: layout.minTap,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    minHeight: layout.minTap,
  },
  leadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchWell: { minWidth: 42, alignItems: "flex-start", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  historyRow: { paddingVertical: spacing.md },
  targetThumb: {
    width: 38,
    height: 50,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  targetThumbImage: { width: 38, height: 50 },
  quickMetric: {
    minWidth: 58,
  },
  historyIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  snapshot: {
    marginTop: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
});
