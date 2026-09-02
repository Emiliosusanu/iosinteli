import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { dashboard, useReduceMotion, useTheme } from "../lib/theme";
import { formatCurrency } from "../lib/format";
import { playHaptic } from "../lib/hapticPolicy";
import { publisherNetForPeriod } from "../lib/homePeriod";

export type SevenDayAdsPoint = {
  date: string;
  spend: number | null;
  orders: number | null;
  sales?: number | null;
  acos: number | null;
  state: string;
};

function spendKnown(point: SevenDayAdsPoint): number | null {
  if (point.state === "missing" || point.state === "no_sync") return null;
  return typeof point.spend === "number" && Number.isFinite(point.spend) ? point.spend : null;
}

function royaltyOn(map: ReadonlyMap<string, number> | undefined, date: string): number | null {
  if (!map || !map.has(date)) return null;
  const value = map.get(date);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function SevenDayAdsStrip({
  points,
  currency,
  kdpByDate,
  compact = false,
}: {
  points: SevenDayAdsPoint[];
  currency: string;
  kdpByDate?: ReadonlyMap<string, number>;
  /** Micro sparkline beside Spend — no labels / selection detail. */
  compact?: boolean;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const [selected, setSelected] = useState<number | null>(null);
  const known = points.map(spendKnown);
  const max = Math.max(1, ...known.filter((value): value is number => value != null && value > 0));
  const active = selected != null ? points[selected] : null;
  const activeSpend = active ? spendKnown(active) : null;
  const activeRoyalties = active ? royaltyOn(kdpByDate, active.date) : null;
  const activeNet = active ? publisherNetForPeriod(activeRoyalties, activeSpend) : null;
  const barMax = compact ? 36 : 56;
  const rowHeight = compact ? 44 : 72;

  return (
    <View
      testID="home-7d-ads-strip"
      accessibilityLabel="Amazon Ads spend, last seven reporting days"
      accessibilityElementsHidden={compact}
      importantForAccessibility={compact ? "no-hide-descendants" : "auto"}
    >
      {compact ? null : (
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: dashboard.compactGap }]}>
          Ads spend · 7 reporting days
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: compact ? 3 : 6, height: rowHeight }}>
        {points.map((point, index) => {
          const spend = known[index];
          const available = spend != null;
          const height = available ? Math.max(spend > 0 ? 4 : 2, Math.round((spend / max) * barMax)) : 2;
          const isOn = !compact && selected === index;
          return (
            <Pressable
              key={point.date}
              disabled={compact}
              onPress={() => {
                if (compact) return;
                void playHaptic("select", reduceMotion);
                setSelected(index === selected ? null : index);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${point.date}. ${
                available ? `${formatCurrency(spend, currency)} Ads spend` : "Ads spend unavailable"
              }`}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "flex-end",
                minHeight: compact ? undefined : 44,
              }}
            >
              <View
                style={{
                  width: compact ? "85%" : "70%",
                  maxWidth: compact ? 10 : 22,
                  height,
                  borderRadius: 2,
                  backgroundColor: available
                    ? isOn
                      ? t.colors.tone_primary
                      : t.colors.text_secondary
                    : "transparent",
                  borderWidth: available ? 0 : StyleSheet.hairlineWidth,
                  borderColor: t.colors.separator,
                }}
              />
              {compact ? null : (
                <Text
                  style={[t.typography.caption2, { color: isOn ? t.colors.text_primary : t.colors.text_tertiary, marginTop: 4 }]}
                  numberOfLines={1}
                >
                  {point.date.slice(8)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {!compact && active ? (
        <Text
          style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: dashboard.compactGap }]}
          accessibilityLabel={`${active.date}. KDP royalties, ${
            activeRoyalties == null ? "unavailable" : formatCurrency(activeRoyalties, currency)
          }. Amazon Ads spend, ${
            activeSpend == null ? "unavailable" : formatCurrency(activeSpend, currency)
          }. Net Royalties, ${activeNet == null ? "unavailable" : formatCurrency(activeNet, currency)}`}
        >
          {active.date} · KDP {activeRoyalties == null ? "—" : formatCurrency(activeRoyalties, currency, { compact: true })} · Spend{" "}
          {activeSpend == null ? "—" : formatCurrency(activeSpend, currency, { compact: true })} · Net{" "}
          {activeNet == null ? "—" : formatCurrency(activeNet, currency, { compact: true })}
        </Text>
      ) : null}
    </View>
  );
}
