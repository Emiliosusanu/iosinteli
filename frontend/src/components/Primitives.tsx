import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  PixelRatio,
  useWindowDimensions,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { dashboard, useTheme, acosTone, toneColor, spacing, typography } from "../lib/theme";
import { formatDelta } from "../lib/format";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import { IOSButton, IOSUnavailable, SFSymbol, sfFromIonicon } from "./ios/Native";
import { PressableScale, VerifiedValue } from "./Motion";
import { InteliAdsIcon, type InteliAdsIconName } from "./InteliAdsIcon";
import { elevatedCardStyle, glassControlStyle } from "./ScreenAmbient";

type Tone = "good" | "warning" | "danger" | "primary" | "product" | "inactive";

const inteliadsIcon = require("../../assets/images/icon.png");

export function BrandIcon({ size = 28, radius = 8 }: { size?: number; radius?: number }) {
  return (
    <Image
      source={inteliadsIcon}
      style={{ width: size, height: size, borderRadius: radius }}
      contentFit="contain"
      cachePolicy="memory-disk"
    />
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  delta?: number;
  deltaTone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  onPress?: () => void;
  testID?: string;
  compact?: boolean;
}

export function KpiTile({
  label,
  value,
  delta,
  deltaTone,
  icon,
  iconColor,
  onPress,
  testID,
  compact,
}: KpiTileProps) {
  const t = useTheme();
  const showDelta = typeof delta === "number" && isFinite(delta);
  const tone = deltaTone ?? (delta && delta > 0 ? "good" : delta && delta < 0 ? "danger" : "inactive");
  const toneCol = toneColor(tone, t.colors);

  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      activeOpacity={0.7}
      onPress={onPress}
      testID={testID}
      style={[
        styles.tile,
        elevatedCardStyle(t),
        {
          padding: compact ? t.spacing.md : t.spacing.lg,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
          {label}
        </Text>
        {icon && (
          <SFSymbol name={sfFromIonicon(icon)} size={14} color={iconColor ?? t.colors.text_tertiary} />
        )}
      </View>
      <Text
        style={[
          compact ? t.typography.metric_compact : t.typography.metric,
          { color: t.colors.text_primary, marginTop: t.spacing.tight },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {showDelta && (
        <View style={[styles.deltaPill, { backgroundColor: toneCol + "20", marginTop: t.spacing.sm }]}>
          <SFSymbol
            name={delta! > 0 ? "arrow.up" : delta! < 0 ? "arrow.down" : "minus"}
            size={10}
            color={toneCol}
          />
          <Text style={[t.typography.caption1, { color: toneCol, marginLeft: 2 }]}>
            {formatDelta(Math.abs(delta!))}
          </Text>
        </View>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 88,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deltaPill: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
});

// Pill badge component
interface PillProps {
  label: string;
  tone?: Tone;
  size?: "sm" | "md";
}

export function Pill({ label, tone = "inactive", size = "sm" }: PillProps) {
  const t = useTheme();
  const col = toneColor(tone, t.colors);
  return (
    <View
      style={{
        backgroundColor: col + "1F",
        paddingHorizontal: size === "sm" ? t.spacing.sm : 10,
        paddingVertical: size === "sm" ? 3 : 5,
        borderRadius: t.radii.pill,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={[
          size === "sm" ? t.typography.caption1 : t.typography.footnote,
          { color: col, fontWeight: "600" },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

// Section Card wrapper
interface SectionCardProps {
  title?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
  noPadding?: boolean;
  testID?: string;
}

export function SectionCard({ title, action, children, noPadding, testID }: SectionCardProps) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      style={[
        elevatedCardStyle(t),
        {
          padding: noPadding ? 0 : dashboard.cardPadding,
          marginBottom: dashboard.sectionGap,
        },
      ]}
    >
      {title && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: noPadding ? t.spacing.lg : 0,
            paddingTop: noPadding ? t.spacing.lg : 0,
            marginBottom: t.spacing.md,
          }}
        >
          <Text style={[t.typography.headline, { color: t.colors.text_primary, flex: 1, marginRight: action ? 12 : 0 }]} numberOfLines={1}>
            {title}
          </Text>
          {action && (
            <TouchableOpacity onPress={action.onPress} hitSlop={10}>
              <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>
                {action.label}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

// Empty state — page-specific icon, one short title, optional one-line hint and action
export function EmptyState({
  icon = "albums-outline",
  productIcon,
  title,
  subtitle,
  tone = "primary",
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  productIcon?: InteliAdsIconName;
  title: string;
  subtitle?: string;
  tone?: Tone;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 20 }}>
      {productIcon ? (
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: dashboard.cardRadius,
              borderCurve: "continuous",
              backgroundColor: t.colors.glass_background,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: t.colors.glass_stroke,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 4,
            }}
          >
            <InteliAdsIcon name={productIcon} size={dashboard.iconEmpty} color={t.colors.text_tertiary} />
          </View>
          <Text style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 12, textAlign: "center" }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginTop: 6, textAlign: "center", maxWidth: 280 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : (
        <IOSUnavailable title={title} description={subtitle} systemImage={sfFromIonicon(icon)} />
      )}
      {action ? (
        <View style={{ marginTop: 12 }}>
          <PrimaryButton label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

export function RetryState({
  title = "Unable to load data",
  subtitle,
  onRetry,
  retrying,
}: {
  title?: string;
  subtitle?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <View style={{ alignItems: "center", padding: 24 }}>
      <IOSUnavailable title={title} description={subtitle} systemImage="wifi.slash" />
      <View style={{ marginTop: 12 }}>
        <PrimaryButton label={retrying ? "Retrying…" : "Retry"} onPress={onRetry} disabled={retrying} />
      </View>
    </View>
  );
}

// Skeleton block
export function Skeleton({ width, height, radius }: { width: number | string; height: number; radius?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: width as any,
        height,
        borderRadius: radius ?? t.radii.sm,
        backgroundColor: t.colors.background_tertiary,
        opacity: 0.6,
      }}
    />
  );
}

// ACOS tone dot for list rows
export function ToneDot({ value, target = 30 }: { value: number; target?: number }) {
  const t = useTheme();
  const tone = acosTone(value, target);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: toneColor(tone, t.colors),
      }}
    />
  );
}

export function FilterChrome({ children, flush }: { children: React.ReactNode; flush?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        marginHorizontal: flush ? 0 : dashboard.pageInset,
        marginTop: flush ? 0 : dashboard.chromeGap,
        marginBottom: flush ? 0 : dashboard.compactGap,
        padding: dashboard.headerShellInset,
        gap: dashboard.headerRowGap,
        borderRadius: dashboard.headerShellRadius,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.colors.glass_stroke,
        backgroundColor: t.colors.glass_background,
        ...t.shadow.card,
      }}
    >
      {children}
    </View>
  );
}

export function FilterSearchRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: dashboard.chromeGap }}>
      {children}
    </View>
  );
}

export function FilterIconButton({
  testID,
  active,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  symbol = "slider.horizontal.3",
}: {
  testID?: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  symbol?: SFSymbolName;
}) {
  const t = useTheme();
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={4}
      style={[
        glassControlStyle(t, !!active),
        {
          width: dashboard.headerControl,
          height: dashboard.headerControl,
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      <SFSymbol
        name={symbol}
        size={15}
        color={active ? t.colors.tone_primary : t.colors.text_secondary}
      />
      {active ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 5,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: t.colors.tone_primary,
          }}
        />
      ) : null}
    </PressableScale>
  );
}

export function ActiveFilterChip({
  testID,
  label,
  onPress,
  accessibilityLabel,
}: {
  testID?: string;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={[
        glassControlStyle(t, true),
        {
          minHeight: dashboard.controlHeight,
          paddingHorizontal: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
      ]}
    >
      <Text
        accessible={false}
        style={{
          fontSize: 12,
          fontWeight: "600",
          letterSpacing: -0.1,
          color: t.colors.tone_primary,
        }}
      >
        {label}
      </Text>
      <SFSymbol name="xmark" size={9} color={t.colors.tone_primary} />
    </PressableScale>
  );
}

export function ActiveFilterRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: dashboard.compactGap }}>
      {children}
    </View>
  );
}

export function ScreenSpinner() {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: t.spacing.xxl, alignItems: "center" }}>
      <ActivityIndicator color={t.colors.tone_primary} />
    </View>
  );
}

export function ListCard({
  children,
  testID,
  style,
  compact = false,
}: {
  children: React.ReactNode;
  testID?: string;
  style?: object;
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      style={[
        elevatedCardStyle(t),
        {
          padding: compact ? dashboard.denseCardPadding : dashboard.cardPadding,
          borderRadius: compact ? 14 : dashboard.cardRadius,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** One-line metrics for dense list rows (replaces full MetricStrip height). */
export function DenseMetricLine({
  items,
}: {
  items: { label: string; value: string; color?: string }[];
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
      {items.map((item, index) => (
        <View key={`${item.label}-${index}`} style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
          <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{item.label}</Text>
          <Text
            style={[
              t.typography.caption1,
              {
                color: item.color ?? t.colors.text_primary,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              },
            ]}
            numberOfLines={1}
          >
            {item.value}
          </Text>
          {index < items.length - 1 ? (
            <Text style={[t.typography.caption2, { color: t.colors.separator, marginLeft: 2 }]}>·</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

type IoniconName = keyof typeof Ionicons.glyphMap;

// ─── PageHeader: one strong title, optional one-line subtitle, page icon ───────
// Gives every screen a clear, scannable identity. The icon bubble + accent make
// each page feel distinct while staying part of the same app.
export function PageHeader({
  title,
  subtitle,
  icon,
  iconTone = "primary",
  accessory,
}: {
  title: string;
  subtitle?: string;
  icon?: IoniconName;
  iconTone?: Tone;
  accessory?: React.ReactNode;
}) {
  const t = useTheme();
  const col = toneColor(iconTone, t.colors);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: t.spacing.screen,
        paddingTop: t.spacing.sm,
        paddingBottom: t.spacing.md,
        gap: t.spacing.md,
      }}
    >
      {icon && (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: t.radii.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: col + "16",
          }}
        >
          <SFSymbol name={sfFromIonicon(icon)} size={24} color={col} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.title1, { color: t.colors.text_primary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {accessory}
    </View>
  );
}

// ─── SectionHeader: medium section label with optional right action ───────────
export function SectionHeader({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: IoniconName;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: t.spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm, flex: 1, minWidth: 0 }}>
        {icon && <SFSymbol name={sfFromIonicon(icon)} size={17} color={t.colors.text_secondary} />}
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, fontWeight: "400", letterSpacing: 0.4, textTransform: "uppercase" },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {action && (
        <TouchableOpacity onPress={action.onPress} hitSlop={10}>
          <Text style={[t.typography.callout, { color: t.colors.tone_primary, fontWeight: "600" }]}>
            {action.label}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── StatBadge: compact delta / trend pill. Returns null when flat. ───────────
export function StatBadge({
  delta,
  inverse = false,
  neutral = false,
  suffix,
}: {
  delta: number;
  inverse?: boolean;
  neutral?: boolean;
  suffix?: string;
}) {
  const t = useTheme();
  if (!isFinite(delta) || delta === 0) return null;
  const good = inverse ? delta < 0 : delta > 0;
  const col = neutral ? t.colors.text_tertiary : good ? t.colors.tone_good : t.colors.tone_danger;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: col + "1A",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        gap: 1,
      }}
    >
      <SFSymbol name={delta > 0 ? "arrow.up" : "arrow.down"} size={11} color={col} />
      <Text style={[t.typography.caption1, { color: col, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
        {Math.abs(delta).toFixed(1)}%{suffix ? ` ${suffix}` : ""}
      </Text>
    </View>
  );
}

// ─── MetricCard: one number told loudly. Label small, value big, optional ─────
// delta + caption + sparkline slot (passed as children).
export function MetricCard({
  label,
  value,
  valueColor,
  delta,
  deltaInverse,
  deltaNeutral,
  caption,
  captionColor,
  onPress,
  children,
  testID,
}: {
  label: string;
  value: string;
  valueColor?: string;
  delta?: number;
  deltaInverse?: boolean;
  deltaNeutral?: boolean;
  caption?: string;
  captionColor?: string;
  onPress?: () => void;
  children?: React.ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      activeOpacity={0.7}
      onPress={onPress}
      testID={testID}
        style={[
          elevatedCardStyle(t),
          {
            flex: 1,
            padding: t.spacing.lg,
          },
        ]}
    >
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[t.typography.metric, { color: valueColor ?? t.colors.text_primary, marginTop: 4 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {typeof delta === "number" && (
        <View style={{ marginTop: 6 }}>
          <StatBadge delta={delta} inverse={deltaInverse} neutral={deltaNeutral} />
        </View>
      )}
      {caption && (
        <Text style={[t.typography.caption1, { color: captionColor ?? t.colors.text_tertiary, marginTop: 4 }]} numberOfLines={2}>
          {caption}
        </Text>
      )}
      {children && <View style={{ marginTop: 8 }}>{children}</View>}
    </Wrapper>
  );
}

// ─── WarningCard: left-accent alert card with a short title and tappable items ─
export function WarningCard({
  tone = "danger",
  icon,
  title,
  subtitle,
  items,
  children,
}: {
  tone?: "danger" | "warning" | "good";
  icon?: IoniconName;
  title: string;
  subtitle?: string;
  items?: { icon: IoniconName; text: string; tone?: "danger" | "warning"; onPress?: () => void }[];
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const col = toneColor(tone, t.colors);
  const headIcon: IoniconName = icon ?? (tone === "good" ? "shield-checkmark-outline" : "warning-outline");
  return (
    <View
      style={{
        ...elevatedCardStyle(t),
        padding: t.spacing.lg,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SFSymbol name={sfFromIonicon(headIcon)} size={18} color={col} />
        <Text style={[t.typography.headline, { color: t.colors.text_primary, flex: 1 }]}>{title}</Text>
      </View>
      {subtitle && (
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4, marginLeft: 26 }]}>
          {subtitle}
        </Text>
      )}
      {items && items.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {items.map((item, i) => {
            const itemCol = item.tone === "warning" ? t.colors.tone_warning : t.colors.tone_danger;
            return (
              <TouchableOpacity
                key={i}
                activeOpacity={0.6}
                onPress={item.onPress}
                disabled={!item.onPress}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 10,
                  borderTopColor: t.colors.separator,
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                }}
              >
                <SFSymbol name={sfFromIonicon(item.icon)} size={16} color={itemCol} />
                <Text style={[t.typography.subhead, { color: t.colors.text_primary, flex: 1 }]}>{item.text}</Text>
                {item.onPress && <SFSymbol name="chevron.right" size={12} color={t.colors.text_tertiary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {children}
    </View>
  );
}

// ─── SyncStatusCard: connection state at a glance + last-updated + tap to open ─
export function SyncStatusCard({
  status,
  label,
  detail,
  onPress,
}: {
  status: "connected" | "syncing" | "warning" | "idle";
  label: string;
  detail?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const map = {
    connected: { col: t.colors.tone_good, icon: "checkmark-circle" as IoniconName },
    syncing: { col: t.colors.tone_primary, icon: "sync" as IoniconName },
    warning: { col: t.colors.tone_warning, icon: "alert-circle" as IoniconName },
    idle: { col: t.colors.tone_inactive, icon: "ellipse-outline" as IoniconName },
  }[status];
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      activeOpacity={0.7}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        ...elevatedCardStyle(t),
        padding: t.spacing.lg,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: t.radii.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: map.col + "16",
        }}
      >
        <SFSymbol name={sfFromIonicon(map.icon)} size={22} color={map.col} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>
          {label}
        </Text>
        {detail && (
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 1 }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {onPress && <SFSymbol name="chevron.right" size={12} color={t.colors.text_tertiary} />}
    </Wrapper>
  );
}

// ─── Buttons: one consistent, easy-to-tap primary + secondary ─────────────────
function estimateMetricWidth(value: string, fontScale: number) {
  return value.length * typography.headline.fontSize * 0.65 * Math.max(1, fontScale);
}

/** Same ladder on every screen: N if it fits, else 4→2→1 / 3→1 / 2→1. Widest value wins. */
function metricStripColumns(items: { value: string }[], width: number, fontScale: number) {
  const count = items.length;
  if (count <= 1 || width <= 0) return 1;
  const scale = Math.max(1, fontScale);
  const gap = dashboard.metricGap;
  const minCell = Math.max(56 * scale, ...items.map((item) => estimateMetricWidth(item.value, fontScale)));
  const fits = (cols: number) => (width - gap * (cols - 1)) / cols >= minCell;
  if (fits(count)) return count;
  if (count === 4 && fits(2)) return 2;
  return 1;
}

export function MetricStrip({
  items,
}: {
  items: { label: string; value: string; color?: string }[];
}) {
  const t = useTheme();
  const fontScale = PixelRatio.getFontScale();
  const { width: windowWidth } = useWindowDimensions();
  const [stripWidth, setStripWidth] = useState(0);
  useEffect(() => {
    setStripWidth(0);
  }, [fontScale, windowWidth]);
  const width = stripWidth || Math.max(0, windowWidth - dashboard.cardPadding * 2 - dashboard.pageInset * 2);
  const columns = metricStripColumns(items, width, fontScale);
  const wraps = columns < items.length;
  const gap = dashboard.metricGap;
  const cellWidth = wraps ? (width - gap * (columns - 1)) / columns : undefined;

  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && Math.abs(next - stripWidth) > 1) setStripWidth(next);
      }}
      style={{
        flexDirection: "row",
        flexWrap: wraps ? "wrap" : "nowrap",
        alignSelf: "stretch",
        width: "100%",
        minWidth: 0,
      }}
    >
      {items.map((item, index) => {
        const colIndex = index % columns;
        const rowIndex = Math.floor(index / columns);
        return (
          <View
            key={`${item.label}-${index}`}
            style={{
              flex: wraps ? undefined : 1,
              width: cellWidth,
              minWidth: 0,
              marginLeft: colIndex === 0 ? 0 : gap,
              marginTop: rowIndex === 0 ? 0 : gap,
            }}
          >
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]} numberOfLines={1}>
              {item.label}
            </Text>
            <VerifiedValue
              value={item.value}
              style={[
                t.typography.headline,
                {
                  color: item.color ?? t.colors.text_primary,
                  fontVariant: ["tabular-nums"],
                  marginTop: 2,
                  lineHeight: typography.headline.lineHeight,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
  tone = "primary",
  full,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: Tone;
  full?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const col = toneColor(tone, t.colors);
  return (
    <IOSButton
      testID={testID}
      label={loading ? "Please wait…" : label}
      onPress={onPress}
      disabled={disabled || loading}
      tintColor={col}
      full={full}
      systemImage={icon ? sfFromIonicon(icon) : undefined}
      accessibilityLabel={accessibilityLabel ?? (loading ? "Please wait" : label)}
      accessibilityHint={accessibilityHint}
    />
  );
}

export function SecondaryButton({
  label,
  icon,
  onPress,
  disabled,
  full,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
  disabled?: boolean;
  full?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  return (
    <IOSButton
      testID={testID}
      label={label}
      onPress={onPress}
      disabled={disabled}
      prominent={false}
      full={full}
      systemImage={icon ? sfFromIonicon(icon) : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
    />
  );
}
