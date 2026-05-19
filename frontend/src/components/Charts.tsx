import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PieChart, LineChart, BarChart } from "react-native-gifted-charts";
import { useTheme, toneColor } from "../lib/theme";
import { formatCompact, formatInt, formatPercent, safeDivide } from "../lib/format";

// Budget Pace Ring -- displays % spent vs daily budget
interface BudgetRingProps {
  spent: number;
  budget: number;
  currency?: string;
}

export function BudgetRing({ spent, budget }: BudgetRingProps) {
  const t = useTheme();
  const pct = budget > 0 ? Math.min(spent / budget, 1) : 0;
  const pctDisplay = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const tone = pct >= 1 ? "danger" : pct >= 0.8 ? "warning" : "good";
  const color = toneColor(tone, t.colors);

  const data = [
    { value: pct * 100, color },
    { value: (1 - pct) * 100, color: t.colors.background_tertiary },
  ];

  return (
    <View style={{ alignItems: "center" }}>
      <PieChart
        donut
        radius={56}
        innerRadius={44}
        innerCircleColor={t.colors.background_secondary}
        data={data}
        centerLabelComponent={() => (
          <View style={{ alignItems: "center" }}>
            <Text style={[t.typography.title2, { color: t.colors.text_primary }]}>{pctDisplay}%</Text>
            <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>USED</Text>
          </View>
        )}
      />
    </View>
  );
}

// Conversion Funnel
interface FunnelProps {
  impressions: number;
  clicks: number;
  orders: number;
}

export function Funnel({ impressions, clicks, orders }: FunnelProps) {
  const t = useTheme();
  const ctr = safeDivide(clicks, impressions) * 100;
  const cvr = safeDivide(orders, clicks) * 100;

  const maxWidth = 1;
  const w1 = maxWidth;
  const w2 = impressions > 0 ? Math.max(clicks / impressions, 0.15) * maxWidth : 0.5 * maxWidth;
  const w3 = clicks > 0 ? Math.max(orders / clicks, 0.08) * maxWidth : 0.25 * maxWidth;

  const steps = [
    { label: "Impressions", value: impressions, w: w1, opacity: 1 },
    { label: "Clicks", value: clicks, w: w2, opacity: 0.7 },
    { label: "Orders", value: orders, w: w3, opacity: 0.45 },
  ];

  return (
    <View style={{ width: "100%" }}>
      {steps.map((s, i) => (
        <View
          key={s.label}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: i === steps.length - 1 ? 0 : 6,
          }}
        >
          <View
            style={{
              backgroundColor: t.colors.tone_primary,
              opacity: s.opacity,
              height: 32,
              width: `${s.w * 65}%`,
              borderRadius: 6,
              justifyContent: "center",
              paddingLeft: 10,
            }}
          >
            <Text style={[t.typography.caption1, { color: "#fff", fontWeight: "700" }]}>{s.label}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]}>
              {formatCompact(s.value)}
            </Text>
            {i === 1 && (
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>
                CTR {formatPercent(ctr)}
              </Text>
            )}
            {i === 2 && (
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>
                CVR {formatPercent(cvr)}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// Sparkline mini line chart
interface SparklineProps {
  data: { value: number }[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color, height = 50 }: SparklineProps) {
  const t = useTheme();
  if (!data.length) {
    return <View style={{ height }} />;
  }
  return (
    <LineChart
      data={data}
      hideAxesAndRules
      hideYAxisText
      hideRules
      hideDataPoints
      thickness={2}
      color={color ?? t.colors.tone_primary}
      areaChart
      startFillColor={color ?? t.colors.tone_primary}
      endFillColor={color ?? t.colors.tone_primary}
      startOpacity={0.3}
      endOpacity={0}
      curved
      adjustToWidth
      height={height}
      initialSpacing={0}
      endSpacing={0}
      xAxisColor="transparent"
      yAxisColor="transparent"
      disableScroll
    />
  );
}

// Multi-series chart: spend bars + sales line
interface PerformanceChartProps {
  spendData: { value: number; label?: string }[];
  salesData: { value: number; label?: string }[];
  width?: number;
}

export function PerformanceChart({ spendData, salesData, width = 320 }: PerformanceChartProps) {
  const t = useTheme();
  return (
    <BarChart
      data={spendData}
      lineData={salesData}
      showLine
      lineConfig={{
        color: t.colors.tone_good,
        thickness: 2,
        curved: true,
        hideDataPoints: false,
        dataPointsColor: t.colors.tone_good,
        dataPointsRadius: 3,
      }}
      barWidth={Math.max(8, width / Math.max(spendData.length, 1) - 8)}
      spacing={4}
      frontColor={t.colors.tone_primary}
      gradientColor={t.colors.tone_primary + "80"}
      noOfSections={4}
      yAxisColor="transparent"
      xAxisColor={t.colors.chart_grid}
      yAxisTextStyle={{ color: t.colors.text_tertiary, fontSize: 10 }}
      xAxisLabelTextStyle={{ color: t.colors.text_tertiary, fontSize: 9 }}
      rulesColor={t.colors.chart_grid}
      rulesType="solid"
      hideRules={false}
      height={140}
      width={width - 40}
      initialSpacing={4}
      disableScroll
      barBorderRadius={2}
      showGradient
    />
  );
}

// KDP Income vs Ad Spend chart (royalty-adjusted)
interface KdpIncomeChartProps {
  spendData: { value: number; label?: string }[];
  incomeData: { value: number; label?: string }[];
  width?: number;
}

export function KdpIncomeChart({ spendData, incomeData, width = 320 }: KdpIncomeChartProps) {
  const t = useTheme();
  // Combine into bars (spend, negative) + line (income)
  return (
    <BarChart
      data={spendData}
      lineData={incomeData}
      showLine
      lineConfig={{
        color: t.colors.tone_good,
        thickness: 2.5,
        curved: true,
        hideDataPoints: true,
        startFillColor: t.colors.tone_good,
        endFillColor: t.colors.tone_good,
        startOpacity: 0.2,
        endOpacity: 0.0,
        areaChart: true,
      }}
      barWidth={Math.max(8, width / Math.max(spendData.length, 1) - 6)}
      spacing={3}
      frontColor={t.colors.tone_danger}
      gradientColor={t.colors.tone_danger + "80"}
      noOfSections={4}
      yAxisColor="transparent"
      xAxisColor={t.colors.chart_grid}
      yAxisTextStyle={{ color: t.colors.text_tertiary, fontSize: 9 }}
      xAxisLabelTextStyle={{ color: t.colors.text_tertiary, fontSize: 9 }}
      rulesColor={t.colors.chart_grid}
      rulesType="solid"
      hideRules={false}
      height={140}
      width={width - 40}
      initialSpacing={3}
      disableScroll
      barBorderRadius={2}
      showGradient
    />
  );
}

// Mini metric chart - bars OR line for a single metric in a small card
interface MiniChartProps {
  data: { value: number; label?: string }[];
  variant: "bar" | "line";
  color?: string;
  height?: number;
  width?: number;
}

export function MiniChart({ data, variant, color, height = 60, width = 140 }: MiniChartProps) {
  const t = useTheme();
  const c = color ?? t.colors.tone_primary;
  if (!data.length) return <View style={{ height }} />;

  if (variant === "bar") {
    const max = Math.max(...data.map((d) => d.value), 1);
    return (
      <BarChart
        data={data}
        height={height}
        width={width}
        barWidth={Math.max(3, (width - 16) / data.length - 1)}
        spacing={1}
        frontColor={c}
        hideAxesAndRules
        hideYAxisText
        hideRules
        xAxisColor="transparent"
        yAxisColor="transparent"
        noOfSections={2}
        maxValue={max * 1.1}
        initialSpacing={2}
        disableScroll
        barBorderRadius={1.5}
      />
    );
  }

  return (
    <LineChart
      data={data}
      hideAxesAndRules
      hideYAxisText
      hideRules
      hideDataPoints
      thickness={2}
      color={c}
      areaChart
      startFillColor={c}
      endFillColor={c}
      startOpacity={0.3}
      endOpacity={0.0}
      curved
      adjustToWidth
      width={width}
      height={height}
      initialSpacing={0}
      endSpacing={0}
      xAxisColor="transparent"
      yAxisColor="transparent"
      disableScroll
    />
  );
}

// Hours heatmap: 7 days x 24 hours grid
interface HeatmapProps {
  data: number[][]; // [7][24]
  maxValue: number;
}

export function Heatmap({ data, maxValue }: HeatmapProps) {
  const t = useTheme();
  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <View>
      <View style={{ flexDirection: "row", marginLeft: 18 }}>
        {Array.from({ length: 24 }).map((_, h) => (
          <View key={h} style={{ flex: 1, alignItems: "center" }}>
            {h % 6 === 0 && (
              <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, fontSize: 9 }]}>
                {h}h
              </Text>
            )}
          </View>
        ))}
      </View>
      {data.map((row, d) => (
        <View key={d} style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
          <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, width: 14 }]}>
            {dayLabels[d]}
          </Text>
          {row.map((value, h) => {
            const intensity = maxValue > 0 ? Math.min(value / maxValue, 1) : 0;
            return (
              <View
                key={h}
                style={{
                  flex: 1,
                  height: 18,
                  marginLeft: 2,
                  borderRadius: 3,
                  backgroundColor:
                    value === 0
                      ? t.colors.background_tertiary
                      : t.colors.tone_primary,
                  opacity: value === 0 ? 0.3 : 0.2 + intensity * 0.8,
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

// Net Profit big metric line chart
interface NetProfitChartProps {
  data: { value: number; label?: string }[];
  width?: number;
}

export function NetProfitChart({ data, width = 320 }: NetProfitChartProps) {
  const t = useTheme();
  if (data.length === 0) return <View style={{ height: 100 }} />;

  const isPositive = (data[data.length - 1]?.value ?? 0) >= 0;
  const lineColor = isPositive ? t.colors.tone_good : t.colors.tone_danger;

  return (
    <LineChart
      data={data}
      hideAxesAndRules
      hideYAxisText
      hideRules
      hideDataPoints
      thickness={2.5}
      color={lineColor}
      areaChart
      startFillColor={lineColor}
      endFillColor={lineColor}
      startOpacity={0.25}
      endOpacity={0.01}
      curved
      adjustToWidth
      width={width - 20}
      height={80}
      initialSpacing={0}
      endSpacing={0}
      xAxisColor="transparent"
      yAxisColor="transparent"
      disableScroll
    />
  );
}

const _styles = StyleSheet.create({});
