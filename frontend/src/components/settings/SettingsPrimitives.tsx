import React from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type AccessibilityRole,
} from "react-native";
import { Stack } from "expo-router";
import type { SFSymbol } from "expo-symbols";
import { SFSymbol as Symbol, IOSButton } from "@/src/components/ios/Native";
import { useTheme } from "@/src/lib/theme";

/** Native stack chrome for Settings routes only — grouped list background, no custom Back chip. */
export function SettingsScreen({
  title,
  children,
  largeTitle = false,
}: {
  title: string;
  children: React.ReactNode;
  largeTitle?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background_primary }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerLargeTitle: largeTitle,
          headerBackTitle: "Back",
          headerTintColor: t.colors.tone_primary,
          headerTitleStyle: { color: t.colors.text_primary, fontWeight: "600" },
          headerStyle: { backgroundColor: t.colors.background_primary },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.colors.background_primary },
        }}
      />
      {children}
    </View>
  );
}

export function SettingsSection({
  title,
  footer,
  children,
  testID,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View testID={testID} style={styles.section}>
      {title ? (
        <Text
          accessibilityRole="header"
          accessibilityLabel={title}
          style={[t.typography.footnote, styles.sectionTitle, { color: t.colors.text_secondary }]}
        >
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View
        style={[
          styles.group,
          {
            backgroundColor: t.colors.background_secondary,
          },
        ]}
      >
        {children}
      </View>
      {footer ? (
        <Text style={[t.typography.footnote, styles.sectionFooter, { color: t.colors.text_secondary }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** Calm SF Symbol well — muted fill so rainbow tiles don't compete with values. */
function SymbolBadge({ name, color }: { name: SFSymbol; color?: string }) {
  const t = useTheme();
  const destructive = color === t.colors.tone_danger;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.symbolWell,
        {
          backgroundColor: destructive
            ? t.colors.tone_danger
            : t.colors.background_tertiary,
        },
      ]}
    >
      <Symbol
        name={name}
        size={15}
        color={destructive ? "#FFFFFF" : color ?? t.colors.tone_primary}
        weight="semibold"
      />
    </View>
  );
}

type RowBase = {
  label: string;
  subtitle?: string;
  value?: string;
  symbol?: SFSymbol;
  symbolColor?: string;
  testID?: string;
  last?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  destructive?: boolean;
};

export function SettingsRow({
  label,
  subtitle,
  value,
  symbol,
  symbolColor,
  testID,
  last,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  destructive,
}: RowBase & { onPress?: () => void }) {
  const t = useTheme();
  const spoken = accessibilityLabel ?? [label, subtitle, value].filter(Boolean).join(". ");
  const labelColor = destructive ? t.colors.tone_danger : t.colors.text_primary;
  const role: AccessibilityRole = onPress ? "button" : "text";

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessible
      accessibilityRole={role}
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: t.colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed && onPress ? 0.55 : 1,
        },
      ]}
    >
      {symbol ? <SymbolBadge name={symbol} color={symbolColor} /> : null}
      <View style={styles.copy}>
        <Text style={[t.typography.body, { color: labelColor }]} numberOfLines={2}>
          {label}
        </Text>
        {subtitle ? (
          <Text
            style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={[
            t.typography.body,
            {
              color: t.colors.text_secondary,
              marginRight: onPress ? 4 : 0,
              flexShrink: 1,
              maxWidth: "48%",
              textAlign: "right",
            },
          ]}
        >
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Symbol name="chevron.right" size={12} color={t.colors.text_tertiary} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function SettingsNavigationRow(props: RowBase & { onPress: () => void }) {
  return <SettingsRow {...props} />;
}

export function SettingsToggleRow({
  label,
  subtitle,
  value,
  onChange,
  symbol,
  symbolColor,
  testID,
  last,
  disabled,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  symbol?: SFSymbol;
  symbolColor?: string;
  testID?: string;
  last?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const spoken = accessibilityLabel ?? `${label}, ${value ? "on" : "off"}`;
  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      onAccessibilityTap={() => {
        if (!disabled) onChange(!value);
      }}
      style={[
        styles.row,
        {
          borderBottomColor: t.colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {symbol ? <SymbolBadge name={symbol} color={symbolColor} /> : null}
      <View style={styles.copy}>
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{label}</Text>
        {subtitle ? (
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
        ios_backgroundColor={t.colors.background_tertiary}
      />
    </View>
  );
}

export function SettingsDestructiveRow({
  label,
  testID,
  last,
  onPress,
  accessibilityHint,
  busyLabel,
  busy,
}: {
  label: string;
  testID?: string;
  last?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  busyLabel?: string;
  busy?: boolean;
}) {
  return (
    <View style={styles.destructiveWrap}>
      <IOSButton
        testID={testID}
        label={busy && busyLabel ? busyLabel : label}
        role="destructive"
        prominent={false}
        disabled={busy}
        onPress={onPress}
        accessibilityHint={accessibilityHint}
        full
      />
      {last ? null : null}
    </View>
  );
}

export function SettingsNote({ children, testID }: { children: string; testID?: string }) {
  const t = useTheme();
  return (
    <Text
      testID={testID}
      style={[t.typography.footnote, { color: t.colors.text_secondary, marginHorizontal: 32, marginTop: 16 }]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 22,
  },
  sectionTitle: {
    letterSpacing: 0.6,
    marginBottom: 6,
    marginLeft: 32,
  },
  sectionFooter: {
    marginTop: 6,
    marginHorizontal: 32,
  },
  group: {
    marginHorizontal: 16,
    borderRadius: 10,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  symbolWell: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveWrap: {
    padding: 10,
  },
});
