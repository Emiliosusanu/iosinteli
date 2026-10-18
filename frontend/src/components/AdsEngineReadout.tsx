import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatCompact, formatInt, formatPercent } from "@/src/lib/format";
import { useTheme } from "@/src/lib/theme";

export function AdsEngineReadout({ label, impressions, clicks, orders, acos }: {
  label: string;
  impressions: number;
  clicks: number;
  orders: number;
  acos: number | null;
}) {
  const t = useTheme();
  const count = (value: number) => !Number.isFinite(value) ? "—" : Math.abs(value) < 1000 ? formatInt(value) : formatCompact(value);
  const metrics = [
    { label: "Impr", name: "Impressions", value: count(impressions), exact: formatInt(impressions), color: t.colors.tone_product },
    { label: "Clicks", name: "Clicks", value: count(clicks), exact: formatInt(clicks), color: t.colors.tone_primary },
    { label: "Orders", name: "Orders", value: count(orders), exact: formatInt(orders), color: t.colors.tone_good },
    { label: "ACoS", name: "ACoS", value: acos == null ? "—" : formatPercent(acos), exact: acos == null ? "unavailable" : formatPercent(acos), color: t.colors.tone_warning },
  ];
  return (
    <View style={styles.readout} testID="ads-engine-readout">
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label}</Text>
      <View style={styles.metrics}>
        {metrics.map(metric => (
          <View key={metric.name} style={styles.metric} accessible accessibilityLabel={`${metric.name}, ${metric.exact}`}>
            <Text style={[t.typography.caption2, { color: metric.color }]}>{metric.label}</Text>
            <Text style={[t.typography.callout, styles.value, { color: t.colors.text_primary }]}>{metric.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { gap: 4, marginBottom: 6 },
  metrics: { flexDirection: "row", flexWrap: "wrap", rowGap: 6 },
  metric: { width: "25%", minWidth: 64, paddingRight: 6 },
  value: { fontWeight: "600", fontVariant: ["tabular-nums"], flexShrink: 1 },
});
