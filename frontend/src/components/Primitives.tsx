import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, acosTone, toneColor } from "../lib/theme";
import { formatDelta } from "../lib/format";

type Tone = "good" | "warning" | "danger" | "primary" | "product" | "inactive";

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
        {
          backgroundColor: t.colors.background_secondary,
          borderRadius: t.radii.lg,
          padding: compact ? t.spacing.md : t.spacing.lg,
        },
        t.shadow.card,
      ]}
    >
      <View style={styles.header}>
        <Text style={[t.typography.caption2, { color: t.colors.text_secondary, letterSpacing: 0.6 }]}>
          {label.toUpperCase()}
        </Text>
        {icon && (
          <Ionicons name={icon} size={14} color={iconColor ?? t.colors.text_tertiary} />
        )}
      </View>
      <Text
        style={[
          compact ? t.typography.title3 : t.typography.title2,
          { color: t.colors.text_primary, marginTop: 6 },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {showDelta && (
        <View style={[styles.deltaPill, { backgroundColor: toneCol + "20", marginTop: 8 }]}>
          <Ionicons
            name={delta! > 0 ? "arrow-up" : delta! < 0 ? "arrow-down" : "remove"}
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
        paddingHorizontal: size === "sm" ? 6 : 10,
        paddingVertical: size === "sm" ? 2 : 4,
        borderRadius: 6,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          color: col,
          fontSize: size === "sm" ? 10 : 12,
          fontWeight: "700",
          letterSpacing: 0.3,
        }}
      >
        {label.toUpperCase()}
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
      style={{
        backgroundColor: t.colors.background_secondary,
        borderRadius: t.radii.lg,
        padding: noPadding ? 0 : t.spacing.lg,
        marginBottom: t.spacing.lg,
        ...t.shadow.card,
      }}
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
          <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>{title}</Text>
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

// Empty state
export function EmptyState({
  icon = "albums-outline",
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", padding: t.spacing.xl }}>
      <Ionicons name={icon} size={36} color={t.colors.text_tertiary} />
      <Text
        style={[
          t.typography.headline,
          { color: t.colors.text_primary, marginTop: 12, textAlign: "center" },
        ]}
      >
        {title}
      </Text>
      {subtitle && (
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: 4, textAlign: "center" },
          ]}
        >
          {subtitle}
        </Text>
      )}
    </View>
  );
}

// Skeleton block
export function Skeleton({ width, height, radius = 8 }: { width: number | string; height: number; radius?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: width as any,
        height,
        borderRadius: radius,
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
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: toneColor(tone, t.colors),
      }}
    />
  );
}
