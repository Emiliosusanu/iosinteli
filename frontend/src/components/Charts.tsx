import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { ChartScrubCursor, VerifiedValue } from "./Motion";
import { playHaptic } from "../lib/hapticPolicy";
import { PieChart, LineChart, BarChart } from "react-native-gifted-charts";
import Svg, { Path, Circle, Rect, Line, Text as SvgText, Defs, LinearGradient, Stop, ClipPath, G } from "react-native-svg";
import { useTheme, toneColor } from "../lib/theme";
import { formatCompact, formatInt, formatPercent, safeDivide, formatCurrency } from "../lib/format";
import { dayBarStep, dayXLayout } from "../lib/chartLayout";

function innerChartWidth(width: number, padding = 40) {
  return Math.max(240, width - padding);
}

function thinLabels<T extends { label?: string }>(data: T[], width: number): T[] {
  if (data.length <= 8) return data;
  const maxLabels = Math.max(2, Math.floor(width / 88));
  const step = Math.max(1, Math.ceil((data.length - 1) / (maxLabels - 1)));

  return data.map((point, index) => ({
    ...point,
    label: index === 0 || index === data.length - 1 || index % step === 0 ? point.label : "",
  }));
}

type ChartPoint = { value: number; label?: string; date?: string; sales?: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function rangeFor(series: ChartPoint[][], includeZero = true) {
  const values = series.flat().map((point) => point.value).filter((value) => Number.isFinite(value));
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function pointsFor(data: ChartPoint[], width: number, height: number, min: number, max: number, inset = 10) {
  const plotWidth = Math.max(1, width - inset * 2);
  const plotHeight = Math.max(1, height - inset * 2);
  const layout = dayXLayout(data.length, plotWidth, inset);
  return data.map((point, index) => ({
    ...point,
    x: layout.xAt(index),
    y: inset + ((max - point.value) / (max - min)) * plotHeight,
  }));
}

function makeLinePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

// Smooth bezier curve (Catmull-Rom → cubic bezier) for a native Swift Charts feel
function makeSmoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return makeLinePath(pts);
  const t = 0.18; // tension — lower = smoother, higher = more angular
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function makeSmoothAreaPath(pts: Array<{ x: number; y: number }>, baselineY: number): string {
  if (!pts.length) return "";
  return `${makeSmoothPath(pts)} L ${pts[pts.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${pts[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function makeAreaPath(points: Array<{ x: number; y: number }>, baselineY: number) {
  if (!points.length) return "";
  return `${makeLinePath(points)} L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function buildChartDaySelection(
  index: number,
  data: ChartPoint[],
  royaltiesData?: ChartPoint[],
  spendData?: ChartPoint[],
): NonNullable<ChartDaySelection> {
  const point = data[index];
  return {
    index,
    label: point?.label,
    date: point?.date,
    net: point?.value ?? 0,
    royalties: royaltiesData?.[index]?.value ?? null,
    spend: spendData?.[index]?.value ?? 0,
    sales: point?.sales ?? 0,
  };
}

function useChartSelection(
  count: number,
  width: number,
  inset = 10,
  persistSelection = false,
  onIndexChange?: (index: number | null) => void,
  controlledIndex?: number | null,
) {
  const [uncontrolledIndex, setUncontrolledIndex] = React.useState<number | null>(null);
  const isControlled = controlledIndex !== undefined;
  const selectedIndex = isControlled ? controlledIndex : uncontrolledIndex;
  const onIndexChangeRef = React.useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;

  const emitIndex = React.useCallback((next: number | null) => {
    onIndexChangeRef.current?.(next);
  }, []);

  const setIndex = React.useCallback(
    (next: number | null) => {
      if (!isControlled) setUncontrolledIndex(next);
      emitIndex(next);
    },
    [emitIndex, isControlled],
  );

  React.useEffect(() => {
    setIndex(null);
  }, [count, setIndex]);

  const selectByX = React.useCallback(
    (x: number) => {
      if (count <= 0) {
        setIndex(null);
        return;
      }
      const plotWidth = Math.max(1, width - inset * 2);
      const next = dayXLayout(count, plotWidth, inset).indexAtX(x);
      if (!isControlled) {
        setUncontrolledIndex((prev) => {
          if (prev !== next) void playHaptic("select");
          return next;
        });
      } else if (selectedIndex !== next) {
        void playHaptic("select");
      }
      emitIndex(next);
    },
    [count, emitIndex, inset, isControlled, selectedIndex, setIndex, width],
  );

  const clearSelection = React.useCallback(() => {
    setIndex(null);
  }, [setIndex]);

  const gesture = React.useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-10, 10])
      .onStart((e) => runOnJS(selectByX)(e.x))
      .onUpdate((e) => runOnJS(selectByX)(e.x));
    if (!persistSelection) {
      pan.onEnd(() => runOnJS(clearSelection)());
    }
    return pan;
  }, [selectByX, clearSelection, persistSelection]);

  return { selectedIndex, gesture, clearSelection };
}

function xAxisLabels(data: ChartPoint[]) {
  if (!data.length) return [];
  const last = data.length - 1;
  const idxs = new Set<number>([0, last]);
  if (data.length >= 5) idxs.add(Math.round(last / 2));
  if (data.length >= 10) {
    idxs.add(Math.round(last / 4));
    idxs.add(Math.round((3 * last) / 4));
  }
  return [...idxs]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      label: data[index]?.label ?? "",
      key: `${index}-${data[index]?.date ?? data[index]?.label ?? index}`,
    }))
    .filter((row) => row.label);
}

function yAxisTicks(min: number, max: number): number[] {
  const ticks = [max];
  if (min < -1e-9 && max > 1e-9) ticks.push(0);
  if (Math.abs(min - max) > 1e-9) ticks.push(min);
  // Dedupe near-equals (flat ranges).
  const out: number[] = [];
  for (const tick of ticks) {
    if (out.every((v) => Math.abs(v - tick) > Math.max(1, Math.abs(max - min) * 0.02))) out.push(tick);
  }
  return out;
}

function valueToY(value: number, height: number, min: number, max: number, inset: number) {
  const plotHeight = Math.max(1, height - inset * 2);
  return inset + ((max - value) / Math.max(1e-9, max - min)) * plotHeight;
}

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

  // True funnel widths: each stage is a fraction of the stage above
  // (impressions → clicks → orders). Badges stay CTR / CVR math.
  const clickFill = impressions > 0 ? Math.min(1, clicks / impressions) : 0;
  const orderFill =
    impressions > 0 ? Math.min(1, orders / impressions) : clicks > 0 ? Math.min(1, orders / clicks) : 0;

  const steps = [
    {
      label: "Impressions",
      value: impressions,
      fill: impressions > 0 ? 1 : 0,
      color: t.colors.tone_primary,
      badge: "Reach",
      badgeTone: t.colors.text_secondary,
    },
    {
      label: "Clicks",
      value: clicks,
      fill: Math.max(clickFill, clicks > 0 ? 0.04 : 0),
      color: t.colors.tone_good,
      badge: `${formatPercent(ctr, 2)} CTR`,
      badgeTone: ctr >= 0.4 ? t.colors.tone_good : t.colors.tone_warning,
    },
    {
      label: "Orders",
      value: orders,
      fill: Math.max(orderFill, orders > 0 ? 0.04 : 0),
      color: t.colors.tone_warning,
      badge: `${formatPercent(cvr, 1)} CVR`,
      badgeTone: cvr >= 8 ? t.colors.tone_good : t.colors.tone_warning,
    },
  ];

  return (
    <View style={{ width: "100%", gap: 14 }}>
      {steps.map((s) => (
        <View key={s.label} style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", flex: 1 }]} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}>
              {formatCompact(s.value)}
            </Text>
            <View style={{ backgroundColor: s.badgeTone + "1F", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, minWidth: 72, alignItems: "center" }}>
              <Text style={[t.typography.caption2, { color: s.badgeTone, fontWeight: "600" }]}>{s.badge}</Text>
            </View>
          </View>
          <View style={{ height: 12, borderRadius: 6, backgroundColor: t.colors.background_tertiary, overflow: "hidden" }}>
            <View
              style={{
                backgroundColor: s.color,
                height: 12,
                width: `${Math.max(4, s.fill * 100)}%`,
                borderRadius: 6,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// Sparkline mini line chart
interface SparklineProps {
  data: ChartPoint[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color, height = 50 }: SparklineProps) {
  const t = useTheme();
  const svgWidth = 220;
  const { selectedIndex, gesture } = useChartSelection(data.length, svgWidth, 6);
  if (!data.length) {
    return <View style={{ height }} />;
  }
  const lineColor = color ?? t.colors.tone_primary;
  const { min, max } = rangeFor([data], true);
  const points = pointsFor(data, svgWidth, height, min, max, 6);
  const baselineY = clamp(pointsFor([{ value: 0 }], svgWidth, height, min, max, 6)[0]?.y ?? height - 6, 6, height - 6);
  const selected = points[selectedIndex] ?? points[points.length - 1];
  const tooltipLabel = selected
    ? selected.label
      ? `${selected.label}  ${formatCompact(selected.value)}`
      : formatCompact(selected.value)
    : "";

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width: "100%" }}>
        {/* Tooltip above chart — never clips */}
        <View style={{ height: 14, marginBottom: 2, paddingHorizontal: 2, alignItems: "flex-end" }}>
          <Text
            style={{ fontSize: 10, fontWeight: "600", color: t.colors.text_secondary, letterSpacing: 0 }}
            numberOfLines={1}
          >
            {tooltipLabel}
          </Text>
        </View>
        <View style={{ height, overflow: "hidden" }}>
          <Svg width="100%" height={height} viewBox={`0 0 ${svgWidth} ${height}`}>
            <Path d={makeAreaPath(points, baselineY)} fill={lineColor} opacity={0.13} />
            <Path d={makeLinePath(points)} stroke={lineColor} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {selected && (
              <>
                <Line x1={selected.x} y1={4} x2={selected.x} y2={height - 4} stroke={lineColor} strokeWidth={1} opacity={0.25} />
                <Circle cx={selected.x} cy={selected.y} r={3.5} fill={lineColor} />
              </>
            )}
          </Svg>
        </View>
      </View>
    </GestureDetector>
  );
}

// Performance chart: two normalized area series.
// seriesALabel / seriesBLabel let callers override the tooltip labels so the
// chart can be reused for any two metrics (Spend+Sales, Orders+ACoS, etc.)
interface PerformanceChartProps {
  spendData: ChartPoint[];
  salesData: ChartPoint[];
  width?: number;
  currency?: string;
  seriesALabel?: string; // default "spend"
  seriesBLabel?: string; // default "sales"
  formatA?: (v: number) => string;
  formatB?: (v: number) => string;
}

export function PerformanceChart({ spendData, salesData, width = 320, currency, seriesALabel = "spend", seriesBLabel = "sales", formatA, formatB }: PerformanceChartProps) {
  const t = useTheme();
  const chartWidth = innerChartWidth(width, 0);
  const chartHeight = 150;
  const inset = 14;
  const { selectedIndex, gesture } = useChartSelection(spendData.length, chartWidth, inset);
  if (!spendData.length) return <View style={{ height: 200 }} />;
  const baselineY = chartHeight - inset;

  // Independent y-scales so a small spend series isn't crushed by large sales spikes
  const spendMax = Math.max(...spendData.map((d) => d.value), 1);
  const salesMax = Math.max(...salesData.map((d) => d.value), 1);

  function scalePoints(data: ChartPoint[], seriesMax: number) {
    const plotW = Math.max(1, chartWidth - inset * 2);
    const plotH = Math.max(1, chartHeight - inset * 2);
    const layout = dayXLayout(data.length, plotW, inset);
    return data.map((pt, i) => ({
      ...pt,
      x: layout.xAt(i),
      y: inset + (1 - pt.value / seriesMax) * plotH,
    }));
  }

  const spendPoints = scalePoints(spendData, spendMax);
  const salesPoints = scalePoints(salesData, salesMax);

  const selectedLabel = spendData[selectedIndex]?.label ?? "—";
  const selectedA = spendData[selectedIndex]?.value ?? 0;
  const selectedB = salesData[selectedIndex]?.value ?? 0;
  const fmtA = formatA ?? ((v: number) => formatCurrency(v, currency, { compact: true }));
  const fmtB = formatB ?? ((v: number) => formatCurrency(v, currency, { compact: true }));

  return (
    <GestureDetector gesture={gesture}>
    <View style={{ width: chartWidth, overflow: "hidden" }}>
      <View style={chartStyles.tooltipRow}>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={1}>
          {fmtA(selectedA)} {seriesALabel} · {fmtB(selectedB)} {seriesBLabel}
        </Text>
      </View>
      <Svg width={chartWidth} height={chartHeight + 30}>
        {/* Subtle grid */}
        {[0.33, 0.66].map((pct) => (
          <Line key={pct} x1={inset} x2={chartWidth - inset} y1={inset + pct * (chartHeight - inset * 2)} y2={inset + pct * (chartHeight - inset * 2)} stroke={t.colors.chart_grid} strokeWidth={1} opacity={0.4} />
        ))}

        {/* Spend — blue area */}
        <Path d={makeSmoothAreaPath(spendPoints, baselineY)} fill={t.colors.tone_primary} opacity={0.12} />
        <Path d={makeSmoothPath(spendPoints)} stroke={t.colors.tone_primary} strokeWidth={2.5} fill="none" strokeLinecap="round" />

        {/* Sales — green area (drawn on top) */}
        <Path d={makeSmoothAreaPath(salesPoints, baselineY)} fill={t.colors.tone_good} opacity={0.12} />
        <Path d={makeSmoothPath(salesPoints)} stroke={t.colors.tone_good} strokeWidth={2.5} fill="none" strokeLinecap="round" />

        {/* Selection crosshair + dots */}
        {spendPoints[selectedIndex] && salesPoints[selectedIndex] && (
          <>
            <Line
              x1={spendPoints[selectedIndex].x} y1={inset}
              x2={spendPoints[selectedIndex].x} y2={chartHeight - inset}
              stroke={t.colors.text_tertiary} strokeWidth={1} opacity={0.3}
            />
            <Circle cx={spendPoints[selectedIndex].x} cy={spendPoints[selectedIndex].y} r={4.5} fill={t.colors.background_secondary} />
            <Circle cx={spendPoints[selectedIndex].x} cy={spendPoints[selectedIndex].y} r={3} fill={t.colors.tone_primary} />
            <Circle cx={salesPoints[selectedIndex].x} cy={salesPoints[selectedIndex].y} r={4.5} fill={t.colors.background_secondary} />
            <Circle cx={salesPoints[selectedIndex].x} cy={salesPoints[selectedIndex].y} r={3} fill={t.colors.tone_good} />
          </>
        )}

        {/* X-axis labels */}
        {xAxisLabels(spendData).map(({ index, label, key }) => (
          <SvgText key={key} x={spendPoints[index]?.x ?? inset} y={chartHeight + 20} textAnchor={index === 0 ? "start" : index === spendData.length - 1 ? "end" : "middle"} fontSize={11} fill={t.colors.text_tertiary}>
            {label}
          </SvgText>
        ))}
      </Svg>
    </View>
    </GestureDetector>
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
  const chartWidth = innerChartWidth(width);
  const spend = thinLabels(spendData, chartWidth);
  // Combine into bars (spend, negative) + line (income)
  return (
    <BarChart
      data={spend}
      lineData={incomeData}
      showLine
      lineConfig={{
        color: t.colors.tone_good,
        thickness: 2.5,
        curved: true,
        hideDataPoints: true,
      }}
      barWidth={Math.max(8, chartWidth / Math.max(spendData.length, 1) - 6)}
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
      width={chartWidth}
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

// Net Profit big metric line chart.
// Net is the hero line (split area at zero + thick stroke). Royalties and Ad Spend
// are thin reference lines on the same scale. Y ticks + date labels keep the
// series readable; scrub updates the labeled readout above the plot.
export type ChartDaySelection = {
  index: number;
  label?: string;
  date?: string;
  net: number;
  royalties: number | null;
  spend: number;
  sales: number;
} | null;

interface NetProfitChartProps {
  data: ChartPoint[];
  royaltiesData?: ChartPoint[];
  spendData?: ChartPoint[];
  width?: number;
  height?: number;
  currency?: string;
  periodLabel?: string;
  selectedIndex?: number | null;
  onDaySelect?: (selection: ChartDaySelection) => void;
}

export function NetProfitChart({
  data,
  royaltiesData,
  spendData,
  width = 320,
  height = 128,
  currency,
  periodLabel,
  selectedIndex: controlledIndex,
  onDaySelect,
}: NetProfitChartProps) {
  const t = useTheme();
  const leftGutter = 34;
  const rightPad = 6;
  const bottomPad = 22;
  const chartWidth = Math.max(200, width);
  const plotWidth = Math.max(160, chartWidth - leftGutter - rightPad);
  const inset = 8;
  const onDaySelectRef = React.useRef(onDaySelect);
  onDaySelectRef.current = onDaySelect;
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const royaltiesRef = React.useRef(royaltiesData);
  royaltiesRef.current = royaltiesData;
  const spendRef = React.useRef(spendData);
  spendRef.current = spendData;

  const notifyDaySelect = React.useCallback((index: number | null) => {
    const cb = onDaySelectRef.current;
    if (!cb) return;
    if (index == null) {
      cb(null);
      return;
    }
    cb(buildChartDaySelection(index, dataRef.current, royaltiesRef.current, spendRef.current));
  }, []);

  const { selectedIndex, gesture } = useChartSelection(
    data.length,
    plotWidth,
    inset,
    true,
    notifyDaySelect,
    controlledIndex,
  );

  const geometry = React.useMemo(() => {
    if (data.length === 0) return null;
    const isPositive = data.reduce((sum, d) => sum + (d.value ?? 0), 0) >= 0;
    const netColor = isPositive ? t.colors.tone_good : t.colors.tone_danger;
    const royColor = t.colors.tone_primary;
    const spendColor = t.colors.tone_warning;
    const series = [data, ...(royaltiesData?.length ? [royaltiesData] : []), ...(spendData?.length ? [spendData] : [])];
    const { min, max } = rangeFor(series, true);
    const points = pointsFor(data, plotWidth, height, min, max, inset);
    const royPoints = royaltiesData?.length ? pointsFor(royaltiesData, plotWidth, height, min, max, inset) : [];
    const spendPoints = spendData?.length ? pointsFor(spendData, plotWidth, height, min, max, inset) : [];
    const zeroY = clamp(valueToY(0, height, min, max, inset), inset, height - inset);
    const netPath = makeSmoothPath(points);
    const areaPath = makeSmoothAreaPath(points, zeroY);
    const ticks = yAxisTicks(min, max).map((value) => ({
      value,
      y: valueToY(value, height, min, max, inset),
      label: formatCurrency(value, currency, { compact: true }),
    }));
    const xLabels = xAxisLabels(data);
    return {
      isPositive,
      netColor,
      royColor,
      spendColor,
      min,
      max,
      points,
      royPoints,
      spendPoints,
      zeroY,
      netPath,
      areaPath,
      ticks,
      xLabels,
    };
  }, [currency, data, height, inset, plotWidth, royaltiesData, spendData, t.colors.tone_danger, t.colors.tone_good, t.colors.tone_primary, t.colors.tone_warning]);

  if (data.length === 0 || !geometry) return <View style={{ height: 100 }} />;

  const {
    netColor,
    royColor,
    spendColor,
    points,
    royPoints,
    spendPoints,
    zeroY,
    netPath,
    areaPath,
    ticks,
    xLabels,
  } = geometry;

  const selected = selectedIndex != null ? points[selectedIndex] : null;
  const selRoy = selectedIndex != null ? royaltiesData?.[selectedIndex]?.value : null;
  const selSpend = selectedIndex != null ? spendData?.[selectedIndex]?.value : null;
  const tooltipLabel = selected?.label ?? periodLabel ?? "Period";
  const tooltipNet = selected
    ? formatCurrency(selected.value ?? 0, currency, { compact: true })
    : "";
  const end = points[points.length - 1];
  const cursorX = (selected?.x ?? end?.x ?? inset) + leftGutter;
  const cursorY = selected?.y ?? end?.y ?? height / 2;
  const svgHeight = height + bottomPad;
  const aboveId = "netAboveZero";
  const belowId = "netBelowZero";
  const posGrad = "netPosFill";
  const negGrad = "netNegFill";

  return (
    <View style={{ width: chartWidth }} accessibilityLabel="Net royalties chart. Drag to inspect a day.">
      <View style={chartStyles.netHeader}>
        {selected ? (
          <>
            <VerifiedValue
              value={tooltipLabel}
              style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "600" }]}
            />
            <View style={chartStyles.netReadout}>
              <NetReadoutChip label="Net" value={tooltipNet} color={netColor} t={t} />
              {selRoy != null ? (
                <NetReadoutChip
                  label="Royalties"
                  value={formatCurrency(selRoy, currency, { compact: true })}
                  color={royColor}
                  t={t}
                />
              ) : null}
              {selSpend != null ? (
                <NetReadoutChip
                  label="Spend"
                  value={formatCurrency(selSpend, currency, { compact: true })}
                  color={spendColor}
                  t={t}
                />
              ) : null}
            </View>
          </>
        ) : (
          <View style={chartStyles.netLegend}>
            <LegendSwatch color={netColor} label="Net" solid t={t} />
            {royPoints.length > 0 ? <LegendSwatch color={royColor} label="Royalties" dashed t={t} /> : null}
            {spendPoints.length > 0 ? <LegendSwatch color={spendColor} label="Ad spend" dashed t={t} /> : null}
          </View>
        )}
      </View>

      <View style={{ width: chartWidth, height: svgHeight }}>
        <Svg width={chartWidth} height={svgHeight}>
          <Defs>
            <ClipPath id={aboveId}>
              <Rect x={0} y={0} width={plotWidth} height={Math.max(0, zeroY)} />
            </ClipPath>
            <ClipPath id={belowId}>
              <Rect x={0} y={zeroY} width={plotWidth} height={Math.max(0, height - zeroY)} />
            </ClipPath>
            <LinearGradient id={posGrad} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={t.colors.tone_good} stopOpacity="0.28" />
              <Stop offset="100%" stopColor={t.colors.tone_good} stopOpacity="0.03" />
            </LinearGradient>
            <LinearGradient id={negGrad} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={t.colors.tone_danger} stopOpacity="0.04" />
              <Stop offset="100%" stopColor={t.colors.tone_danger} stopOpacity="0.26" />
            </LinearGradient>
          </Defs>

          {ticks.map((tick) => (
            <React.Fragment key={`yt-${tick.value}`}>
              <Line
                x1={leftGutter}
                x2={leftGutter + plotWidth}
                y1={tick.y}
                y2={tick.y}
                stroke={t.colors.chart_grid}
                strokeWidth={tick.value === 0 ? 1 : 0.5}
                opacity={tick.value === 0 ? 0.9 : 0.5}
                strokeDasharray={tick.value === 0 ? undefined : "3 5"}
              />
              <SvgText
                x={leftGutter - 6}
                y={tick.y + 3.5}
                textAnchor="end"
                fontSize={10}
                fontWeight="500"
                fill={t.colors.text_tertiary}
              >
                {tick.label}
              </SvgText>
            </React.Fragment>
          ))}

          <G transform={`translate(${leftGutter}, 0)`}>
            {royPoints.length > 0 ? (
              <Path
                d={makeLinePath(royPoints)}
                stroke={royColor}
                strokeWidth={1.35}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="3.5 4"
                opacity={0.72}
              />
            ) : null}
            {spendPoints.length > 0 ? (
              <Path
                d={makeLinePath(spendPoints)}
                stroke={spendColor}
                strokeWidth={1.35}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="3.5 4"
                opacity={0.72}
              />
            ) : null}

            <G clipPath={`url(#${aboveId})`}>
              <Path d={areaPath} fill={`url(#${posGrad})`} />
            </G>
            <G clipPath={`url(#${belowId})`}>
              <Path d={areaPath} fill={`url(#${negGrad})`} />
            </G>

            <Path
              d={netPath}
              stroke={netColor}
              strokeWidth={2.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {end ? (
              <Circle
                cx={end.x}
                cy={end.y}
                r={selected ? 2.5 : 3.25}
                fill={netColor}
                opacity={selected ? 0.35 : 1}
              />
            ) : null}
          </G>

          {xLabels.map(({ index, label, key }) => {
            const x = leftGutter + (points[index]?.x ?? inset);
            const anchor = index === 0 ? "start" : index === data.length - 1 ? "end" : "middle";
            const active = selectedIndex === index;
            return (
              <SvgText
                key={key}
                x={x}
                y={height + 16}
                textAnchor={anchor}
                fontSize={10}
                fontWeight={active ? "700" : "500"}
                fill={active ? t.colors.text_secondary : t.colors.text_tertiary}
              >
                {label}
              </SvgText>
            );
          })}
        </Svg>

        <GestureDetector gesture={gesture}>
          <View
            style={{
              position: "absolute",
              left: leftGutter,
              top: 0,
              width: plotWidth,
              height,
            }}
            accessibilityRole="adjustable"
            accessibilityLabel="Scrub net royalties by day"
          />
        </GestureDetector>

        <ChartScrubCursor
          x={cursorX}
          y={cursorY}
          plotTop={inset}
          plotBottom={height - inset}
          color={netColor}
          visible={!!selected}
          stroke={t.colors.background_secondary}
        />
      </View>
    </View>
  );
}

function LegendSwatch({
  color,
  label,
  solid,
  dashed,
  t,
}: {
  color: string;
  label: string;
  solid?: boolean;
  dashed?: boolean;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={chartStyles.legendItem} accessibilityElementsHidden>
      {dashed ? (
        <View style={chartStyles.legendDashRow}>
          <View style={[chartStyles.legendDash, { backgroundColor: color }]} />
          <View style={[chartStyles.legendDash, { backgroundColor: color }]} />
          <View style={[chartStyles.legendDash, { backgroundColor: color }]} />
        </View>
      ) : (
        <View style={[chartStyles.legendMark, { backgroundColor: solid ? color : color }]} />
      )}
      <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>{label}</Text>
    </View>
  );
}

function NetReadoutChip({
  label,
  value,
  color,
  t,
}: {
  label: string;
  value: string;
  color: string;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={chartStyles.readoutChip}>
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label}</Text>
      <VerifiedValue
        value={value}
        color={color}
        style={[t.typography.caption1, { fontWeight: "700", fontVariant: ["tabular-nums"] }]}
      />
    </View>
  );
}

// ACOS semicircle gauge
interface AcosGaugeProps {
  acos: number;
  breakeven: number;
  size?: number;
}

export function AcosGauge({ acos, breakeven, size = 180 }: AcosGaugeProps) {
  const t = useTheme();
  const cx = size / 2;
  const cy = size / 2 + 4;
  const r = size / 2 - 20;
  const sw = 15;

  // Arc from startDeg → endDeg clockwise (sweep=1 in SVG y-down coords)
  // Standard math: 180°=left, 90°=top, 0°=right
  function arc(startDeg: number, endDeg: number) {
    const s = (startDeg * Math.PI) / 180;
    const e = (endDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s);
    const y1 = cy - r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy - r * Math.sin(e);
    const la = startDeg - endDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2}`;
  }

  const p = Math.min(1, Math.max(0, acos / 100));
  const dotDeg = 180 - p * 180;
  const dotRad = (dotDeg * Math.PI) / 180;
  const dotX = cx + r * Math.cos(dotRad);
  const dotY = cy - r * Math.sin(dotRad);

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={size} height={cy + sw / 2 + 4}>
        <Path d={arc(180, 120)} stroke={t.colors.tone_good} strokeWidth={sw} fill="none" strokeLinecap="butt" />
        <Path d={arc(120, 60)} stroke={t.colors.tone_warning} strokeWidth={sw} fill="none" strokeLinecap="butt" />
        <Path d={arc(60, 0)} stroke={t.colors.tone_danger} strokeWidth={sw} fill="none" strokeLinecap="butt" />
        <Circle cx={dotX} cy={dotY} r={11} fill={t.colors.text_primary} />
        <Circle cx={dotX} cy={dotY} r={5} fill={t.colors.background_secondary} />
      </Svg>
      <Text style={[t.typography.title2, { color: t.colors.text_primary, marginTop: 4, fontVariant: ["tabular-nums"] }]}>
        {formatPercent(acos)}
      </Text>
      <Text style={{ fontSize: 12, color: t.colors.text_secondary, marginTop: 2 }}>
        {"Break-even: "}
        <Text style={{ color: t.colors.tone_warning, fontWeight: "600" }}>{formatPercent(breakeven)}</Text>
      </Text>
    </View>
  );
}

// Ads Engine chart — impressions as purple bars + clicks / orders / ACoS lines.
// Each line is normalized to its own max (mobile-friendly; no crowded multi Y-axes).
interface AdsEngineChartProps {
  impressionsData: ChartPoint[];
  clicksData: ChartPoint[];
  ordersData: ChartPoint[];
  acosData: ChartPoint[];
  breakEvenAcos?: number;
  width?: number;
}

export function AdsEngineChart({
  impressionsData,
  clicksData,
  ordersData,
  acosData,
  breakEvenAcos = 0,
  width = 320,
}: AdsEngineChartProps) {
  const t = useTheme();
  const chartWidth = innerChartWidth(width, 0);
  const chartHeight = 168;
  const inset = 14;
  const { selectedIndex, gesture } = useChartSelection(impressionsData.length, chartWidth, inset);
  if (!impressionsData.length) return <View style={{ height: 200 }} />;

  const imprColor = t.colors.tone_product;
  const clickColor = t.colors.tone_primary;
  const orderColor = t.colors.tone_good;
  const acosColor = t.colors.tone_warning;
  const breakEvenColor = t.colors.tone_danger;

  const maxClicks = Math.max(...clicksData.map((d) => d.value), 1);
  const maxOrders = Math.max(...ordersData.map((d) => d.value), 1);
  const maxAcos = Math.max(...acosData.map((d) => d.value), breakEvenAcos || 0, 1);
  const maxImpr = Math.max(...impressionsData.map((d) => d.value), 1);

  function scalePoints(data: ChartPoint[], seriesMax: number) {
    const plotW = Math.max(1, chartWidth - inset * 2);
    const plotH = Math.max(1, chartHeight - inset * 2);
    const layout = dayXLayout(data.length, plotW, inset);
    return data.map((pt, i) => ({
      ...pt,
      x: layout.xAt(i),
      y: inset + (1 - pt.value / seriesMax) * plotH,
    }));
  }

  const clickPoints = scalePoints(clicksData, maxClicks);
  const orderPoints = scalePoints(ordersData, maxOrders);
  const acosPoints = scalePoints(acosData, maxAcos);
  const imprPoints = scalePoints(impressionsData, maxImpr);
  const selectedLabel = impressionsData[selectedIndex]?.label ?? "—";
  const selectedImpr = impressionsData[selectedIndex]?.value ?? 0;
  const selectedClicks = clicksData[selectedIndex]?.value ?? 0;
  const selectedOrders = ordersData[selectedIndex]?.value ?? 0;
  const selectedAcos = acosData[selectedIndex]?.value ?? 0;
  const baseY = chartHeight - inset;
  const plotW = Math.max(1, chartWidth - inset * 2);
  const barStep = dayBarStep(impressionsData.length, plotW);
  const barW = clamp(barStep * 0.55, 2, 14);
  const breakEvenY =
    breakEvenAcos > 0 ? inset + (1 - breakEvenAcos / maxAcos) * (chartHeight - inset * 2) : null;

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width: chartWidth, overflow: "hidden" }} accessibilityLabel="Ads Engine chart. Drag to inspect a day.">
        <View style={chartStyles.tooltipRow}>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{selectedLabel}</Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={1}>
            {formatCompact(selectedImpr)} impr · {formatInt(selectedClicks)} clicks · {formatInt(selectedOrders)} orders · {formatPercent(selectedAcos)}
          </Text>
        </View>
        <Svg width={chartWidth} height={chartHeight + 30}>
          <Line
            x1={inset}
            x2={chartWidth - inset}
            y1={inset + (chartHeight - inset * 2) * 0.5}
            y2={inset + (chartHeight - inset * 2) * 0.5}
            stroke={t.colors.chart_grid}
            strokeWidth={1}
            opacity={0.35}
            strokeDasharray="4 4"
          />

          {imprPoints.map((p, i) => (
            <Rect
              key={i}
              x={p.x - barW / 2}
              y={p.y}
              width={barW}
              height={Math.max(1, baseY - p.y)}
              rx={2}
              fill={imprColor}
              opacity={i === selectedIndex ? 0.55 : 0.28}
            />
          ))}

          {breakEvenY != null ? (
            <Line
              x1={inset}
              x2={chartWidth - inset}
              y1={breakEvenY}
              y2={breakEvenY}
              stroke={breakEvenColor}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              opacity={0.9}
            />
          ) : null}

          <Path d={makeSmoothPath(clickPoints)} stroke={clickColor} strokeWidth={2.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={makeSmoothPath(orderPoints)} stroke={orderColor} strokeWidth={2.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={makeSmoothPath(acosPoints)} stroke={acosColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />

          {clickPoints[selectedIndex] && orderPoints[selectedIndex] && (
            <>
              <Line
                x1={clickPoints[selectedIndex].x}
                y1={inset}
                x2={clickPoints[selectedIndex].x}
                y2={chartHeight - inset}
                stroke={t.colors.text_tertiary}
                strokeWidth={1}
                opacity={0.28}
              />
              <Circle cx={clickPoints[selectedIndex].x} cy={clickPoints[selectedIndex].y} r={5.5} fill={t.colors.background_secondary} />
              <Circle cx={clickPoints[selectedIndex].x} cy={clickPoints[selectedIndex].y} r={3.5} fill={clickColor} />
              <Circle cx={orderPoints[selectedIndex].x} cy={orderPoints[selectedIndex].y} r={5.5} fill={t.colors.background_secondary} />
              <Circle cx={orderPoints[selectedIndex].x} cy={orderPoints[selectedIndex].y} r={3.5} fill={orderColor} />
              <Circle cx={acosPoints[selectedIndex].x} cy={acosPoints[selectedIndex].y} r={5} fill={t.colors.background_secondary} />
              <Circle cx={acosPoints[selectedIndex].x} cy={acosPoints[selectedIndex].y} r={3} fill={acosColor} />
            </>
          )}

          {xAxisLabels(impressionsData).map(({ index, label, key }) => (
            <SvgText
              key={key}
              x={clickPoints[index]?.x ?? inset}
              y={chartHeight + 20}
              textAnchor={index === 0 ? "start" : index === impressionsData.length - 1 ? "end" : "middle"}
              fontSize={11}
              fill={t.colors.text_tertiary}
            >
              {label}
            </SvgText>
          ))}
        </Svg>
        <View style={chartStyles.netLegend}>
          <LegendSwatch color={imprColor} label="Impr" solid t={t} />
          <LegendSwatch color={clickColor} label="Clicks" solid t={t} />
          <LegendSwatch color={orderColor} label="Orders" solid t={t} />
          <LegendSwatch color={acosColor} label="ACoS" solid t={t} />
          {breakEvenAcos > 0 ? (
            <LegendSwatch color={breakEvenColor} label={`BE ${formatPercent(breakEvenAcos, 0)}`} dashed t={t} />
          ) : null}
        </View>
      </View>
    </GestureDetector>
  );
}

/** Format colors aligned with InteliAds web KDP Royalties widget. */
export const KDP_FORMAT_CHART_COLORS = {
  paperback: "#E67E22",
  ku: "#9B59B6",
  kindle: "#5AC8FA",
} as const;

export type KdpFormatStackDay = {
  date: string;
  label: string;
  paperback: number;
  ku: number;
  kindle: number;
  total: number;
};

interface KdpFormatRoyaltiesChartProps {
  days: KdpFormatStackDay[];
  width?: number;
  currency?: string;
}

export function KdpFormatRoyaltiesChart({ days, width = 320, currency }: KdpFormatRoyaltiesChartProps) {
  const t = useTheme();
  const chartWidth = innerChartWidth(width, 0);
  const chartHeight = 168;
  const inset = 14;
  const { selectedIndex, gesture } = useChartSelection(days.length, chartWidth, inset, true);
  if (!days.length) return <View style={{ height: 200 }} />;

  const maxTotal = Math.max(...days.map((d) => d.total), 1);
  const plotW = Math.max(1, chartWidth - inset * 2);
  const plotH = Math.max(1, chartHeight - inset * 2);
  const layout = dayXLayout(days.length, plotW, inset);
  const barStep = dayBarStep(days.length, plotW);
  const barW = clamp(barStep * 0.62, 3, 16);
  const baseY = chartHeight - inset;
  const i = selectedIndex ?? days.length - 1;
  const selected = days[i];
  const colors = KDP_FORMAT_CHART_COLORS;

  const points = days.map((day, index) => {
    const x = layout.xAt(index);
    const kindleH = (day.kindle / maxTotal) * plotH;
    const kuH = (day.ku / maxTotal) * plotH;
    const pbH = (day.paperback / maxTotal) * plotH;
    const kindleY = baseY - kindleH;
    const kuY = kindleY - kuH;
    const pbY = kuY - pbH;
    return { x, kindleY, kindleH, kuY, kuH, pbY, pbH };
  });

  const axisLabels = xAxisLabels(days.map((d) => ({ value: d.total, label: d.label })));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width: chartWidth, overflow: "hidden" }} accessibilityLabel="KDP royalties by format. Drag to inspect a day.">
        <View style={chartStyles.tooltipRow}>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{selected?.label ?? "—"}</Text>
          <Text style={[t.typography.caption1, { color: t.colors.tone_good, fontWeight: "700" }]} numberOfLines={1}>
            {formatCurrency(selected?.total ?? 0, currency, { compact: true })} total
          </Text>
        </View>
        {selected ? (
          <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: 4 }]} numberOfLines={1}>
            PB {formatCurrency(selected.paperback, currency, { compact: true })} · KU {formatCurrency(selected.ku, currency, { compact: true })} · Kindle{" "}
            {formatCurrency(selected.kindle, currency, { compact: true })}
          </Text>
        ) : null}
        <Svg width={chartWidth} height={chartHeight + 30}>
          {[0.25, 0.5, 0.75].map((frac) => {
            const y = inset + (1 - frac) * plotH;
            return (
              <Line
                key={frac}
                x1={inset}
                x2={chartWidth - inset}
                y1={y}
                y2={y}
                stroke={t.colors.chart_grid}
                strokeWidth={1}
                opacity={0.45}
                strokeDasharray="4 4"
              />
            );
          })}
          {points.map((p, idx) => (
            <G key={idx} opacity={idx === i ? 1 : 0.82}>
              {p.kindleH > 0.5 ? (
                <Rect x={p.x - barW / 2} y={p.kindleY} width={barW} height={Math.max(1, p.kindleH)} fill={colors.kindle} />
              ) : null}
              {p.kuH > 0.5 ? (
                <Rect x={p.x - barW / 2} y={p.kuY} width={barW} height={Math.max(1, p.kuH)} fill={colors.ku} />
              ) : null}
              {p.pbH > 0.5 ? (
                <Rect x={p.x - barW / 2} y={p.pbY} width={barW} height={Math.max(1, p.pbH)} rx={idx === i ? 2 : 1} fill={colors.paperback} />
              ) : null}
            </G>
          ))}
          {axisLabels.map(({ index, label, key }) => (
            <SvgText
              key={key}
              x={points[index]?.x ?? inset}
              y={chartHeight + 20}
              textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
              fontSize={11}
              fill={t.colors.text_tertiary}
            >
              {label}
            </SvgText>
          ))}
        </Svg>
      </View>
    </GestureDetector>
  );
}

// Campaign daily chart — impressions as background bars + spend / orders / ACoS lines.
// Each line is normalized to its own max so all are readable at once.
interface CampaignDailyChartProps {
  impressionsData: ChartPoint[];
  spendData: ChartPoint[];
  ordersData: ChartPoint[];
  acosData: ChartPoint[];
  width?: number;
  currency?: string;
}

export function CampaignDailyChart({ impressionsData, spendData, ordersData, acosData, width = 320, currency }: CampaignDailyChartProps) {
  const t = useTheme();
  const chartWidth = innerChartWidth(width, 0);
  const chartHeight = 175;
  const inset = 14;
  const { selectedIndex, gesture } = useChartSelection(impressionsData.length, chartWidth, inset);
  if (!impressionsData.length) return <View style={{ height: 210 }} />;
  const baseY = chartHeight - inset;

  const maxImpr   = Math.max(...impressionsData.map((d) => d.value), 1);
  const maxSpend  = Math.max(...spendData.map((d) => d.value), 1);
  const maxOrders = Math.max(...ordersData.map((d) => d.value), 1);
  const maxAcos   = Math.max(...acosData.map((d) => d.value), 1);

  function scale(data: ChartPoint[], seriesMax: number) {
    const plotW = Math.max(1, chartWidth - inset * 2);
    const plotH = Math.max(1, chartHeight - inset * 2);
    const layout = dayXLayout(data.length, plotW, inset);
    return data.map((pt, i) => ({
      ...pt,
      x: layout.xAt(i),
      y: inset + (1 - pt.value / seriesMax) * plotH,
    }));
  }

  const imprPts   = scale(impressionsData, maxImpr);
  const spendPts  = scale(spendData, maxSpend);
  const orderPts  = scale(ordersData, maxOrders);
  const acosPts   = scale(acosData, maxAcos);
  const i = selectedIndex;
  const plotW = Math.max(1, chartWidth - inset * 2);
  const barStep = dayBarStep(impressionsData.length, plotW);
  const barW = clamp(barStep * 0.55, 2, 14);

  const colSpend = t.colors.tone_warning;
  const colOrders = t.colors.tone_primary;
  const colAcos = t.colors.tone_good;

  return (
    <GestureDetector gesture={gesture}>
    <View style={{ width: chartWidth, overflow: "hidden" }}>
      <View style={chartStyles.tooltipRow}>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{impressionsData[i]?.label ?? "—"}</Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={1}>
          {formatCompact(impressionsData[i]?.value ?? 0)} impr · {formatCurrency(spendData[i]?.value ?? 0, currency, { compact: true })} · {formatInt(ordersData[i]?.value ?? 0)} ord · {formatPercent(acosData[i]?.value ?? 0)}
        </Text>
      </View>
      <Svg width={chartWidth} height={chartHeight + 30}>
        <Line x1={inset} x2={chartWidth - inset} y1={inset + (chartHeight - inset * 2) * 0.5} y2={inset + (chartHeight - inset * 2) * 0.5} stroke={t.colors.chart_grid} strokeWidth={1} opacity={0.3} />

        {/* Impressions — background bars */}
        {imprPts.map((p, idx) => (
          <Rect key={idx} x={p.x - barW / 2} y={p.y} width={barW} height={Math.max(1, baseY - p.y)} rx={2} fill={t.colors.chart_grid} opacity={idx === i ? 0.9 : 0.4} />
        ))}

        {/* Spend / Orders / ACoS lines */}
        <Path d={makeSmoothPath(spendPts)} stroke={colSpend} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Path d={makeSmoothPath(orderPts)} stroke={colOrders} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Path d={makeSmoothPath(acosPts)} stroke={colAcos} strokeWidth={2.5} fill="none" strokeLinecap="round" />

        {/* Selection crosshair + dots */}
        {imprPts[i] && (
          <>
            <Line x1={imprPts[i].x} y1={inset} x2={imprPts[i].x} y2={baseY} stroke={t.colors.text_tertiary} strokeWidth={1} opacity={0.3} />
            <Circle cx={spendPts[i].x} cy={spendPts[i].y} r={4} fill={colSpend} />
            <Circle cx={orderPts[i].x} cy={orderPts[i].y} r={4} fill={colOrders} />
            <Circle cx={acosPts[i].x} cy={acosPts[i].y} r={4} fill={colAcos} />
          </>
        )}

        {xAxisLabels(impressionsData).map(({ index, label, key }) => (
          <SvgText key={key} x={imprPts[index]?.x ?? inset} y={chartHeight + 20} textAnchor={index === 0 ? "start" : index === impressionsData.length - 1 ? "end" : "middle"} fontSize={11} fill={t.colors.text_tertiary}>
            {label}
          </SvgText>
        ))}
      </Svg>
    </View>
    </GestureDetector>
  );
}

// Business Trend chart: royalties (blue) + spend (red) + net (green) lines
interface BusinessTrendChartProps {
  royaltiesData: ChartPoint[];
  spendData: ChartPoint[];
  netData: ChartPoint[];
  organicOrdersData: ChartPoint[];
  width?: number;
  currency?: string;
}

// Business Trend — hero: net profit as thick green/red area (color by sign).
// Royalties and Spend as secondary thin lines showing context.
// All series normalized to a shared scale for clarity.
export function BusinessTrendChart({ royaltiesData, spendData, netData, organicOrdersData, width = 320, currency }: BusinessTrendChartProps) {
  const t = useTheme();
  const chartWidth = innerChartWidth(width, 0);
  const chartHeight = 170;
  const inset = 14;
  const { selectedIndex, gesture } = useChartSelection(royaltiesData.length, chartWidth, inset);
  if (!royaltiesData.length) return <View style={{ height: 200 }} />;
  const { min, max } = rangeFor([royaltiesData, spendData, netData], true);
  const royaltiesPoints = pointsFor(royaltiesData, chartWidth, chartHeight, min, max, inset);
  const spendPoints     = pointsFor(spendData,     chartWidth, chartHeight, min, max, inset);
  const netPoints       = pointsFor(netData,        chartWidth, chartHeight, min, max, inset);
  const maxOrganicOrders = Math.max(...organicOrdersData.map((point) => point.value), 1);
  const plotWidth = Math.max(1, chartWidth - inset * 2);
  const organicLayout = dayXLayout(organicOrdersData.length, plotWidth, inset);
  const organicBarStep = dayBarStep(organicOrdersData.length, plotWidth);
  const organicBarWidth = clamp(organicBarStep * 0.5, 2, 12);
  const organicBars = organicOrdersData.map((point, index) => {
    const x = organicLayout.xAt(index);
    const height = ((chartHeight - inset * 2) * point.value) / maxOrganicOrders;
    return { ...point, x, y: chartHeight - inset - height, height };
  });
  const zeroY = clamp(
    pointsFor([{ value: 0 }], chartWidth, chartHeight, min, max, inset)[0]?.y ?? chartHeight - inset,
    inset, chartHeight - inset,
  );
  const selectedLabel = royaltiesData[selectedIndex]?.label ?? "—";
  const selectedNet   = netData[selectedIndex]?.value ?? 0;
  const selectedRoy   = royaltiesData[selectedIndex]?.value ?? 0;
  const selectedSpend = spendData[selectedIndex]?.value ?? 0;
  const selectedOrganicOrders = organicOrdersData[selectedIndex]?.value ?? 0;
  const netIsPositive = selectedNet >= 0;

  // Split net curve into positive (above zero) and negative (below zero) segments
  // so we can color the fill green/red based on profit vs loss
  const posNetArea = makeSmoothAreaPath(netPoints, zeroY);
  const netLineColor = netIsPositive ? t.colors.tone_good : t.colors.tone_danger;

  return (
    <GestureDetector gesture={gesture}>
    <View style={{ width: chartWidth, overflow: "hidden" }}>
      <View style={chartStyles.tooltipRow}>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{selectedLabel}</Text>
        <Text style={[t.typography.caption1, { color: netIsPositive ? t.colors.tone_good : t.colors.tone_danger, fontWeight: "800" }]} numberOfLines={1}>
          {selectedNet >= 0 ? "+" : ""}{formatCurrency(selectedNet, currency, { compact: true })} net
          {"  "}
          <Text style={{ color: t.colors.tone_primary, fontWeight: "600" }}>
            {formatCurrency(selectedRoy, currency, { compact: true })} in
          </Text>
          {"  "}
          <Text style={{ color: t.colors.tone_warning, fontWeight: "600" }}>
            {formatCurrency(selectedSpend, currency, { compact: true })} ad
          </Text>
          {"  "}
          <Text style={{ color: t.colors.text_secondary, fontWeight: "600" }}>
            {formatInt(selectedOrganicOrders)} org
          </Text>
        </Text>
      </View>
      <Svg width={chartWidth} height={chartHeight + 30}>
        {/* Zero baseline */}
        <Line x1={inset} x2={chartWidth - inset} y1={zeroY} y2={zeroY} stroke={t.colors.chart_grid} strokeWidth={1} opacity={0.8} />
        {/* Subtle grid */}
        {[0.33, 0.66].map((pct) => (
          <Line key={pct} x1={inset} x2={chartWidth - inset} y1={inset + pct * (chartHeight - inset * 2)} y2={inset + pct * (chartHeight - inset * 2)} stroke={t.colors.chart_grid} strokeWidth={1} opacity={0.3} />
        ))}

        {organicBars.map((bar, index) => (
          <Rect
            key={`organic-${index}`}
            x={bar.x - organicBarWidth / 2}
            y={bar.y}
            width={organicBarWidth}
            height={Math.max(1, bar.height)}
            rx={2}
            fill={t.colors.text_tertiary}
            opacity={index === selectedIndex ? 0.38 : 0.18}
          />
        ))}

        {/* Royalties — thin blue dashed-style line (secondary context) */}
        <Path d={makeSmoothPath(royaltiesPoints)} stroke={t.colors.tone_primary} strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.5} />

        {/* Spend — thin orange line (secondary context) */}
        <Path d={makeSmoothPath(spendPoints)} stroke={t.colors.tone_warning} strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.5} />

        {/* Net profit — HERO: thick colored line + large area fill */}
        <Path d={posNetArea} fill={netLineColor} opacity={0.12} />
        <Path d={makeSmoothPath(netPoints)} stroke={netLineColor} strokeWidth={3} fill="none" strokeLinecap="round" />

        {/* Selection */}
        {netPoints[selectedIndex] && (
          <>
            <Line x1={netPoints[selectedIndex].x} y1={inset} x2={netPoints[selectedIndex].x} y2={chartHeight - inset} stroke={t.colors.text_tertiary} strokeWidth={1} opacity={0.3} />
            {/* Secondary dots */}
            <Circle cx={royaltiesPoints[selectedIndex].x} cy={royaltiesPoints[selectedIndex].y} r={3.5} fill={t.colors.tone_primary} opacity={0.7} />
            <Circle cx={spendPoints[selectedIndex].x}     cy={spendPoints[selectedIndex].y}     r={3.5} fill={t.colors.tone_warning} opacity={0.7} />
            {/* Hero dot — larger ring */}
            <Circle cx={netPoints[selectedIndex].x} cy={netPoints[selectedIndex].y} r={7} fill={netLineColor} opacity={0.18} />
            <Circle cx={netPoints[selectedIndex].x} cy={netPoints[selectedIndex].y} r={5} fill={t.colors.background_secondary} />
            <Circle cx={netPoints[selectedIndex].x} cy={netPoints[selectedIndex].y} r={3} fill={netLineColor} />
          </>
        )}

        {xAxisLabels(royaltiesData).map(({ index, label, key }) => (
          <SvgText key={key} x={royaltiesPoints[index]?.x ?? inset} y={chartHeight + 20} textAnchor={index === 0 ? "start" : index === royaltiesData.length - 1 ? "end" : "middle"} fontSize={11} fill={t.colors.text_tertiary}>
            {label}
          </SvgText>
        ))}
      </Svg>
    </View>
    </GestureDetector>
  );
}

// Budget used arc (SVG arc, 270° sweep)
// SVG convention: 0°=right, angles increase CLOCKWISE, 90°=bottom, 180°=left, 270°=top
// Arc from 135° (lower-left / ~7 o'clock) going clockwise 270° to 45° (lower-right / ~5 o'clock)
interface BudgetArcWidgetProps {
  spent: number;
  budget: number;
  currency?: string;
  size?: number;
}

export function BudgetArcWidget({ spent, budget, currency, size = 200 }: BudgetArcWidgetProps) {
  const t = useTheme();
  const pct = budget > 0 ? Math.min(1, spent / budget) : 0;
  const pctDisplay = budget > 0 ? Math.round(pct * 100) : 0;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const sw = 18;
  const SVG_START = 135;  // lower-left (~7 o'clock)
  const SVG_SWEEP = 270;  // full arc

  function pt(deg: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(fromDeg: number, toDeg: number) {
    const s = pt(fromDeg);
    const e = pt(toDeg);
    const span = toDeg - fromDeg;
    const la = span > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${la} 1 ${e.x} ${e.y}`;
  }

  const trackEndDeg = SVG_START + SVG_SWEEP;          // 405 = 45°
  const fillEndDeg = SVG_START + SVG_SWEEP * pct;

  const color = pct >= 1 ? t.colors.tone_danger : pct >= 0.8 ? t.colors.tone_warning : t.colors.tone_primary;

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ position: "relative", width: size, height: size }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Path d={arcPath(SVG_START, trackEndDeg)} stroke={t.colors.background_tertiary} strokeWidth={sw} fill="none" strokeLinecap="round" />
          {pct > 0 && (
            <Path d={arcPath(SVG_START, fillEndDeg)} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
          )}
        </Svg>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={[t.typography.title2, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>
            {formatCurrency(spent, currency, { compact: true })}
          </Text>
          <Text style={{ fontSize: 16, color, fontWeight: "600", marginTop: 2 }}>
            {pctDisplay}%
          </Text>
        </View>
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  tooltipRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
    overflow: "hidden",
  },
  netHeader: {
    minHeight: 28,
    marginBottom: 8,
    gap: 6,
  },
  netLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendMark: {
    width: 14,
    height: 3,
    borderRadius: 2,
  },
  legendDashRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    width: 14,
  },
  legendDash: {
    width: 3,
    height: 2,
    borderRadius: 1,
  },
  netReadout: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
  },
  readoutChip: {
    gap: 1,
    minWidth: 52,
  },
});
