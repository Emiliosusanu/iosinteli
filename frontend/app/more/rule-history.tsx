import React, { memo, useCallback, useMemo, useRef } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, RetryState, ScreenSpinner } from "@/src/components/Primitives";
import { SFSymbol } from "@/src/components/ios/Native";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchRuleExecutions } from "@/src/lib/queries";
import {
  RULE_ACTIVITY_LIMIT,
  activityCapCopy,
  activityNavParams,
  activityRecentCopy,
  canReadRuleActivity,
  presentActivityRow,
  ruleActivityQueryKey,
  type ActivityRowPresentation,
} from "@/src/lib/ruleActivity";
import { toneColor, useTheme } from "@/src/lib/theme";

const ExecutionRow = memo(function ExecutionRow({
  executionId,
  ruleName,
  secondaryLine,
  whenLine,
  tone,
  accessibilityLabel,
  onOpen,
}: {
  executionId: string;
  ruleName: string;
  secondaryLine: string;
  whenLine: string;
  tone: ActivityRowPresentation["tone"];
  accessibilityLabel: string;
  onOpen: (executionId: string) => void;
}) {
  const t = useTheme();
  const statusColor = toneColor(tone, t.colors);
  return (
    <Pressable
      testID={`rule-activity-row-${executionId}`}
      onPress={() => onOpen(executionId)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens execution details"
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: t.colors.background_secondary, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={styles.rowCopy}>
        <Text
          style={[t.typography.headline, { color: t.colors.text_primary, lineHeight: undefined }]}
        >
          {ruleName}
        </Text>
        <Text
          style={[
            t.typography.footnote,
            { color: statusColor, marginTop: 3, fontWeight: "600", lineHeight: undefined },
          ]}
        >
          {secondaryLine}
        </Text>
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: 2, lineHeight: undefined },
          ]}
        >
          {whenLine}
        </Text>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SFSymbol name="chevron.right" size={14} color={t.colors.text_tertiary} />
      </View>
    </Pressable>
  );
});

function Separator() {
  return <View style={styles.separator} />;
}

export default function RuleHistoryScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, guestMode } = useAuth();
  const { selectedProfileIds, adminFilterUserId } = useApp();
  const viewingCustomer = !!adminFilterUserId;
  const canRead = canReadRuleActivity({
    userId: user?.id,
    guestMode,
    viewingCustomer,
    profileCount: selectedProfileIds.length,
  });

  const execsQ = useQuery({
    queryKey: ruleActivityQueryKey(user?.id, adminFilterUserId, selectedProfileIds),
    queryFn: () => fetchRuleExecutions({ userId: user!.id, profileIds: selectedProfileIds }),
    enabled: canRead,
    placeholderData: undefined,
  });

  const rows = useMemo(() => {
    return [...(execsQ.data ?? [])]
      .sort((left, right) => {
        const leftAt = left.executed_at ? new Date(left.executed_at).getTime() : 0;
        const rightAt = right.executed_at ? new Date(right.executed_at).getTime() : 0;
        return rightAt - leftAt;
      })
      .map(presentActivityRow);
  }, [execsQ.data]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const onOpen = useCallback(
    (executionId: string) => {
      const row = rowsRef.current.find((item) => item.executionId === executionId);
      if (!row) return;
      router.push({
        pathname: "/more/rule-detail/[id]",
        params: activityNavParams(row),
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ActivityRowPresentation>) => (
      <ExecutionRow
        executionId={item.executionId}
        ruleName={item.ruleName}
        secondaryLine={item.secondaryLine}
        whenLine={
          item.whenAbsolute
            ? `${item.whenAbsolute}${item.whenRelative ? ` · ${item.whenRelative}` : ""}`
            : "Run time unavailable"
        }
        tone={item.tone}
        accessibilityLabel={item.accessibilityLabel}
        onOpen={onOpen}
      />
    ),
    [onOpen],
  );
  const keyExtractor = useCallback((item: ActivityRowPresentation) => item.executionId, []);

  if (guestMode || !user?.id) {
    return (
      <SubScreen title="Rule activity">
        <EmptyState
          icon="person-outline"
          title="Sign in to view rule activity"
          subtitle="Preview demo does not include rule history."
        />
      </SubScreen>
    );
  }

  if (viewingCustomer) {
    return (
      <SubScreen title="Rule activity">
        <EmptyState
          icon="eye-off-outline"
          title="Customer rule activity unavailable"
          subtitle="This iPhone screen cannot load another customer's rule runs. Switch back to your account from Campaigns, Targets, or Books."
        />
      </SubScreen>
    );
  }

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Rule activity">
        <EmptyState
          icon="business-outline"
          title="No profiles in the current view"
          subtitle="Choose profiles in Amazon Accounts or from a screen with the profile selector."
        />
      </SubScreen>
    );
  }

  const rightAction = {
    icon: "refresh" as const,
    onPress: () => void execsQ.refetch(),
    testID: "rule-activity-refresh",
    accessibilityLabel: "Refresh recent activity",
    accessibilityHint: "Reloads recent rule runs. Does not run rules.",
  };

  return (
    <SubScreen title="Rule activity" rightAction={rightAction}>
      {execsQ.isLoading && !execsQ.data ? (
        <ScreenSpinner />
      ) : execsQ.isError && !execsQ.data ? (
        <RetryState
          title="Couldn't load rule activity"
          subtitle="Your rules were not changed."
          onRetry={() => void execsQ.refetch()}
          retrying={execsQ.isRefetching}
        />
      ) : (
        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl
              refreshing={execsQ.isRefetching}
              onRefresh={() => void execsQ.refetch()}
              tintColor={t.colors.tone_primary}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <Text
                style={[t.typography.footnote, { color: t.colors.text_secondary, lineHeight: undefined }]}
              >
                {activityRecentCopy()}
              </Text>
              {execsQ.isError ? (
                <Text
                  accessibilityRole="alert"
                  style={[t.typography.footnote, { color: t.colors.tone_danger, marginTop: 4, lineHeight: undefined }]}
                >
                  Couldn't refresh. Pull to try again.
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="time-outline"
              title="No rule activity yet"
              subtitle="Rules that have run for the selected profiles will show here."
            />
          }
          ListFooterComponent={
            rows.length >= RULE_ACTIVITY_LIMIT ? (
              <Text
                style={[
                  t.typography.footnote,
                  styles.limitNote,
                  { color: t.colors.text_secondary, lineHeight: undefined },
                ]}
              >
                {activityCapCopy()}
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
    paddingBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderCurve: "continuous",
    gap: 10,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  separator: {
    height: 8,
  },
  limitNote: {
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
