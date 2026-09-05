import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { requireOptionalNativeModule } from "expo-modules-core";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { parseDateOnly, toDateString } from "@/src/lib/format";
import { dashboard, useTheme } from "@/src/lib/theme";

// @expo/ui calls requireNativeView at import time. Loading it before a native
// rebuild crashes the app. Only evaluate those modules when ExpoUI is linked.
function loadSwiftUi() {
  if (Platform.OS !== "ios") return null;
  try {
    const expoUi = requireOptionalNativeModule("ExpoUI");
    if (!expoUi) return null;
    const ui = require("@expo/ui/swift-ui") as typeof import("@expo/ui/swift-ui");
    const modifiers = require("@expo/ui/swift-ui/modifiers") as typeof import("@expo/ui/swift-ui/modifiers");
    return {
      Host: ui.Host,
      Picker: ui.Picker,
      DatePicker: ui.DateTimePicker,
      Button: ui.Button,
      ContentUnavailableView: ui.ContentUnavailableView,
      tint: modifiers.tint,
      disabled: modifiers.disabled,
      frame: modifiers.frame,
    };
  } catch {
    return null;
  }
}

const swiftUi = loadSwiftUi();
type SwiftUiKit = NonNullable<typeof swiftUi>;

function nativeSwift(): SwiftUiKit | null {
  return swiftUi;
}

const ION_TO_SF: Record<string, SFSymbol> = {
  "business-outline": "building.2",
  "megaphone-outline": "megaphone",
  "search-outline": "magnifyingglass",
  "search": "magnifyingglass",
  "locate-outline": "location",
  "cloud-offline-outline": "wifi.slash",
  "albums-outline": "square.stack",
  "cube-outline": "cube",
  "layers-outline": "square.stack.3d.up",
  "time-outline": "clock",
  "alert-circle-outline": "exclamationmark.triangle",
  "alert-circle": "exclamationmark.triangle.fill",
  "book-outline": "book",
  "sync-outline": "arrow.triangle.2.circlepath",
  "settings-outline": "gearshape",
  "checkmark-circle": "checkmark.circle.fill",
  "checkmark-circle-outline": "checkmark.circle",
  "close-circle": "xmark.circle.fill",
  "pulse-outline": "waveform.path.ecg",
  "cash-outline": "dollarsign.circle",
  "trending-up-outline": "chart.line.uptrend.xyaxis",
  "wallet-outline": "creditcard",
  "card-outline": "creditcard",
  "pie-chart-outline": "chart.pie",
  "hourglass-outline": "hourglass",
  "chevron-back": "chevron.left",
  "chevron-forward": "chevron.right",
  "chevron-down": "chevron.down",
  "arrow-up": "arrow.up",
  "arrow-down": "arrow.down",
  "arrow-forward": "arrow.right",
  "arrow-forward-circle-outline": "arrow.right.circle",
  "scan-circle-outline": "viewfinder",
  "shield-checkmark-outline": "checkmark.shield",
  "eye-off": "eye.slash",
  "eye-off-outline": "eye.slash",
  "eye-outline": "eye",
  "mail-outline": "envelope",
  "lock-closed-outline": "lock",
  "log-in-outline": "arrow.right.square",
  "log-out-outline": "rectangle.portrait.and.arrow.right",
  "play-circle-outline": "play.circle",
  "pause-circle-outline": "pause.circle",
  "logo-amazon": "storefront",
  "cart-outline": "cart",
  "speedometer-outline": "gauge.with.dots.needle.67percent",
  "contrast-outline": "circle.lefthalf.filled",
  "notifications-outline": "bell",
  "flash-outline": "bolt",
  "calendar-outline": "calendar",
  "apps-outline": "square.grid.2x2",
  "bag-check-outline": "bag",
  "key-outline": "key",
  "sparkles-outline": "slider.horizontal.3",
  "pricetags-outline": "tag",
  "refresh": "arrow.clockwise",
  "sync": "arrow.triangle.2.circlepath",
  "ellipse-outline": "circle",
  "checkmark": "checkmark",
  "warning": "exclamationmark.triangle.fill",
  "warning-outline": "exclamationmark.triangle",
  "sparkles": "slider.horizontal.3",
  "hand-left-outline": "hand.raised",
  "git-branch-outline": "arrow.triangle.branch",
  "add-circle-outline": "plus.circle",
  "ban-outline": "minus.circle",
  "ban": "minus.circle",
  "add-circle": "plus.circle.fill",
  "swap-horizontal": "arrow.left.arrow.right",
  "pause-circle": "pause.circle",
  "options": "slider.horizontal.3",
  "options-outline": "slider.horizontal.3",
  "remove": "minus",
  "add": "plus",
  "add-outline": "plus",
  "person-add-outline": "person.badge.plus",
  "checkmark-outline": "checkmark",
  "trash-outline": "trash",
  "create": "pencil",
  "create-outline": "pencil",
  "flash": "bolt",
  "construct": "wrench.and.screwdriver",
  "hardware-chip-outline": "slider.horizontal.3",
  "remove-circle": "minus.circle.fill",
  "close-circle-outline": "xmark.circle",
  "close": "xmark",
  "alert": "exclamationmark.triangle",
  "ellipse": "circle",
  "pricetag-outline": "tag",
  "arrow-undo-outline": "arrow.uturn.backward",
  "checkbox": "checkmark.square.fill",
  "square-outline": "square",
  "trending-up": "chart.line.uptrend.xyaxis",
  "trending-down": "chart.line.downtrend.xyaxis",
  "arrow-up-circle": "arrow.up.circle",
  "arrow-down-circle": "arrow.down.circle",
  "play-circle": "play.circle",
};

export function sfFromIonicon(name: string): SFSymbol {
  return ION_TO_SF[name] ?? "circle";
}

class SwiftSafe extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    if (this.state.failed || !nativeSwift()) return this.props.fallback;
    return this.props.children;
  }
}

export function SFSymbol({
  name,
  size = 22,
  color,
  weight = "regular",
  testID,
}: {
  name: SFSymbol;
  size?: number;
  color: string;
  weight?: "regular" | "medium" | "semibold" | "bold";
  testID?: string;
}) {
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <SymbolView
        testID={testID}
        name={name}
        size={size}
        tintColor={color}
        weight={weight}
        resizeMode="scaleAspectFit"
        fallback={<Ionicons name="ellipse" size={size} color={color} />}
      />
    </View>
  );
}

export function IOSSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testID,
  forceFallback = false,
}: {
  options: { key: T; label: string; testID?: string }[];
  value: T;
  onChange: (next: T) => void;
  testID?: string;
  /** Pressable segments — required when XCUITest / accessibility must tap option testIDs. */
  forceFallback?: boolean;
}) {
  const t = useTheme();
  const fallback = (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={testID === "home-horizon" ? "Reporting horizon" : testID === "home-period" ? "Calendar period" : undefined}
      style={[
        styles.segmented,
        {
          backgroundColor: t.colors.background_tertiary,
          borderColor: t.colors.border,
        },
      ]}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <TouchableOpacity
            key={option.key}
            testID={option.testID}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            activeOpacity={0.72}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            onPress={() => {
              if (option.key !== value) onChange(option.key);
            }}
            style={[
              styles.segment,
              active && {
                backgroundColor: t.colors.background_elevated,
                borderColor: t.colors.tone_primary + "55",
              },
            ]}
          >
            <Text
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[styles.segmentLabel, { color: active ? t.colors.text_primary : t.colors.text_secondary }]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (forceFallback) return fallback;

  const ui = nativeSwift();
  if (!ui) return fallback;

  return (
    <SwiftSafe fallback={fallback}>
      <View testID={testID} style={{ height: dashboard.controlHeight, overflow: "hidden" }}>
        <ui.Host matchContents colorScheme={t.scheme} style={{ height: dashboard.controlHeight, width: "100%" }}>
          <ui.Picker
            options={options.map((option) => option.label)}
            selectedIndex={Math.max(0, options.findIndex((option) => option.key === value))}
            variant="segmented"
            onOptionSelected={({ nativeEvent }) => {
              const next = options[nativeEvent.index]?.key;
              if (next && next !== value) onChange(next);
            }}
          />
        </ui.Host>
      </View>
    </SwiftSafe>
  );
}

export function IOSDateField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testID?: string;
}) {
  const t = useTheme();
  const selected = parseDateOnly(value);
  const fallback = (
    <TouchableOpacity
      testID={testID}
      onPress={() => {
        Alert.prompt(
          label,
          "YYYY-MM-DD",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Set",
              onPress: (text?: string) => {
                if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) onChange(text);
              },
            },
          ],
          "plain-text",
          value,
        );
      }}
      style={styles.dateFallback}
    >
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{label}</Text>
      <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>{value}</Text>
    </TouchableOpacity>
  );

  const ui = nativeSwift();
  if (!ui) return fallback;

  return (
    <SwiftSafe fallback={fallback}>
      <View testID={testID} style={{ height: 56, overflow: "hidden" }}>
        <ui.Host matchContents colorScheme={t.scheme} style={{ height: 56, width: "100%" }}>
          <ui.DatePicker
            title={label}
            initialDate={Number.isNaN(selected.getTime()) ? undefined : selected.toISOString()}
            displayedComponents="date"
            variant="compact"
            onDateSelected={(date: Date) => onChange(toDateString(date))}
          />
        </ui.Host>
      </View>
    </SwiftSafe>
  );
}

export function promptIOSNumber(opts: {
  title: string;
  message?: string;
  value: number;
  min?: number;
  max?: number;
  onSave: (next: number) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const current = Number.isFinite(opts.value) ? String(opts.value) : "";
  if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
    Alert.prompt(
      opts.title,
      opts.message,
      [
        { text: "Cancel", style: "cancel", onPress: opts.onCancel },
        {
          text: "Save",
          onPress: (text?: string) => {
            const next = Number(String(text ?? "").replace(",", "."));
            if (!Number.isFinite(next) || next < (opts.min ?? -Infinity) || next > (opts.max ?? Infinity)) {
              Alert.alert("Check the number", `Enter a value between ${opts.min ?? 0} and ${opts.max ?? 0}.`);
              return;
            }
            void opts.onSave(next);
          },
        },
      ],
      "plain-text",
      current,
      "decimal-pad",
    );
    return true;
  }
  return false;
}

export function IOSSettingsRow({
  label,
  subtitle,
  value,
  onPress,
  symbol,
  symbolColor,
  testID,
  last,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  symbol?: SFSymbol;
  symbolColor?: string;
  testID?: string;
  last?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const spoken = accessibilityLabel ?? [label, subtitle, value].filter(Boolean).join(". ");
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.55}
      accessible
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      style={[styles.settingsRow, { borderBottomColor: t.colors.separator, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}
    >
      {symbol ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.symbolWell, { backgroundColor: (symbolColor ?? t.colors.tone_primary) + "18" }]}
        >
          <SFSymbol name={symbol} size={18} color={symbolColor ?? t.colors.tone_primary} />
        </View>
      ) : null}
      <View style={styles.settingsCopy}>
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{label}</Text>
        {subtitle ? (
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[t.typography.body, { color: t.colors.text_secondary, marginRight: 6, maxWidth: "46%" }]}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <SFSymbol name="chevron.right" size={12} color={t.colors.text_tertiary} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function IOSGroupedSection({
  title,
  footer,
  children,
  inset = true,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  inset?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 20 }}>
      {title ? (
        <Text
          accessibilityRole="header"
          accessibilityLabel={title}
          style={[t.typography.footnote, styles.groupTitle, { color: t.colors.text_secondary, marginLeft: inset ? 32 : 16 }]}
        >
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={{ marginHorizontal: inset ? 16 : 0, ...t.shadow.card }}>
        <View
          style={[
            styles.group,
            {
              backgroundColor: t.colors.background_secondary,
              marginHorizontal: 0,
              borderColor: t.colors.glass_stroke,
            },
          ]}
        >
          {children}
        </View>
      </View>
      {footer ? (
        <Text
          style={[
            t.typography.footnote,
            styles.groupFooter,
            { color: t.colors.text_secondary, marginLeft: inset ? 32 : 16, lineHeight: undefined },
          ]}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function IOSSearchBar({
  value,
  onChangeText,
  placeholder,
  testID,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.search,
        {
          backgroundColor: t.colors.glass_background,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.glass_stroke,
        },
      ]}
    >
      <SFSymbol name="magnifyingglass" size={15} color={t.colors.text_tertiary} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.text_tertiary}
        style={[styles.searchInput, { color: t.colors.text_primary }]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

export function IOSButton({
  label,
  onPress,
  testID,
  role = "default",
  prominent = true,
  disabled: isDisabled,
  tintColor,
  systemImage,
  full,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  role?: "default" | "cancel" | "destructive";
  prominent?: boolean;
  disabled?: boolean;
  tintColor?: string;
  systemImage?: SFSymbol;
  full?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const color = tintColor ?? (role === "destructive" ? t.colors.tone_danger : t.colors.tone_primary);
  const fallback = (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled }}
      activeOpacity={0.85}
        style={[
        styles.buttonFallback,
        {
          backgroundColor: prominent ? color : t.colors.glass_background,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: prominent ? color : t.colors.glass_stroke,
          opacity: isDisabled ? 0.5 : 1,
          alignSelf: full ? "stretch" : "center",
        },
      ]}
    >
      <Text style={[t.typography.headline, { color: prominent ? t.colors.text_inverse : color }]}>{label}</Text>
    </TouchableOpacity>
  );

  // SwiftUI Host intercepts taps on sibling TextInputs (login, rules, bid bot).
  // Use the RN control so forms stay typeable.
  return fallback;
}

export function IOSUnavailable({
  title,
  description,
  systemImage = "tray",
}: {
  title: string;
  description?: string;
  systemImage?: SFSymbol;
}) {
  const t = useTheme();
  const fallback = (
    <View style={styles.unavailable}>
      <SFSymbol name={systemImage} size={36} color={t.colors.text_tertiary} />
      <Text style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 12, textAlign: "center" }]}>{title}</Text>
      {description ? (
        <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginTop: 6, textAlign: "center", maxWidth: 280 }]}>
          {description}
        </Text>
      ) : null}
    </View>
  );

  return fallback;
}

export function IOSSwitchRow({
  label,
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
        styles.settingsRow,
        {
          borderBottomColor: t.colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {symbol ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.symbolWell, { backgroundColor: (symbolColor ?? t.colors.tone_primary) + "18" }]}
        >
          <SFSymbol name={symbol} size={18} color={symbolColor ?? t.colors.tone_primary} />
        </View>
      ) : null}
      <Text style={[t.typography.body, { color: t.colors.text_primary, flex: 1 }]}>{label}</Text>
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

export function IOSFormRow({
  label,
  last,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.settingsRow, { borderBottomColor: t.colors.separator, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
      <Text style={[t.typography.body, { color: t.colors.text_primary, flex: 1 }]}>{label}</Text>
      <View style={{ minWidth: 96, maxWidth: 140 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
    gap: 2,
    minHeight: 44,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: dashboard.chipRadius - 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  dateFallback: {
    minHeight: 44,
    justifyContent: "center",
    gap: 2,
  },
  settingsRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingsCopy: {
    flex: 1,
    minWidth: 0,
  },
  symbolWell: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTitle: {
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  group: {
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginHorizontal: 16,
  },
  groupFooter: {
    marginTop: 6,
    marginRight: 16,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    height: dashboard.headerControl,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    paddingVertical: 0,
  },
  buttonFallback: {
    minHeight: 48,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  unavailable: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
});
