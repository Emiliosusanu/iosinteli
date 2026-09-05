import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import Animated, {
  FadeIn,
  FadeInDown,
  ZoomIn,
} from "react-native-reanimated";
import { SFSymbol } from "@/src/components/ios/Native";
import { passwordVisibilityLabel } from "@/src/lib/authContract";
import { dashboard, useReduceMotion, useTheme } from "@/src/lib/theme";
import { ScreenAmbient } from "@/src/components/ScreenAmbient";

const inteliadsIcon = require("../../../assets/images/icon.png");

const ICONS: Record<string, SFSymbolName> = {
  envelope: "envelope",
  lock: "lock",
  bag: "bag",
};

type AuthIcon = keyof typeof ICONS;

function useEntering<T>(value: T): T | undefined {
  const reduceMotion = useReduceMotion();
  return reduceMotion ? undefined : value;
}

export function AuthReveal({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const entering = useEntering(FadeInDown.delay(delay).duration(280));
  return <Animated.View entering={entering}>{children}</Animated.View>;
}

export function AuthScreen({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.colors.background_primary }]} edges={["top", "bottom"]}>
      <ScreenAmbient />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthBack({ onPress, testID }: { onPress: () => void; testID: string }) {
  const t = useTheme();
  const entering = useEntering(FadeIn.duration(280));
  return (
    <Animated.View entering={entering}>
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        hitSlop={12}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <SFSymbol name="chevron.left" size={18} color={t.colors.tone_primary} />
        <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Back</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function AuthMark() {
  const t = useTheme();
  const entering = useEntering(ZoomIn.duration(520).springify().damping(14));
  return (
    <Animated.View
      entering={entering}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.mark,
        {
          backgroundColor: t.colors.background_secondary,
          borderColor: t.colors.separator,
        },
      ]}
    >
      <Image source={inteliadsIcon} style={styles.markImage} contentFit="contain" cachePolicy="memory-disk" />
    </Animated.View>
  );
}

export function AuthTitle({
  title,
  subtitle,
  align = "left",
}: {
  title: string;
  subtitle?: string;
  align?: "left" | "center";
}) {
  const t = useTheme();
  const entering = useEntering(FadeInDown.delay(90).duration(280));
  return (
    <Animated.View
      entering={entering}
      style={[styles.titleBlock, align === "center" && styles.titleCenter]}
    >
      <Text
        accessibilityRole="header"
        style={[t.typography.largeTitle, { color: t.colors.text_primary, textAlign: align, lineHeight: undefined }]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginTop: 6, textAlign: align, lineHeight: undefined }]}>
          {subtitle}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function AuthFieldGroup({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={[styles.group, { backgroundColor: t.colors.background_secondary }]}>{children}</View>;
}

export function AuthField({
  symbol,
  last,
  trailing,
  inputRef,
  onFocus,
  onBlur,
  accessibilityLabel,
  ...input
}: TextInputProps & {
  symbol: AuthIcon;
  last?: boolean;
  trailing?: React.ReactNode;
  inputRef?: React.Ref<TextInput>;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const innerRef = React.useRef<TextInput>(null);
  const spoken = accessibilityLabel ?? (typeof input.placeholder === "string" ? input.placeholder : undefined);

  function setRefs(node: TextInput | null) {
    innerRef.current = node;
    if (!inputRef) return;
    if (typeof inputRef === "function") inputRef(node);
    else (inputRef as React.MutableRefObject<TextInput | null>).current = node;
  }

  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: t.colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          backgroundColor: focused ? t.colors.tone_primary + "0F" : "transparent",
        },
      ]}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SFSymbol
          name={ICONS[symbol]}
          size={18}
          color={focused ? t.colors.tone_primary : t.colors.text_secondary}
        />
      </View>
      <TextInput
        ref={setRefs}
        placeholderTextColor={t.colors.text_tertiary}
        style={[styles.input, { color: t.colors.text_primary }]}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        editable
        showSoftInputOnFocus
        accessibilityLabel={spoken}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          Haptics.selectionAsync();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
      {trailing}
    </View>
  );
}

export function AuthEye({ on, onPress }: { on: boolean; onPress: () => void }) {
  const t = useTheme();
  const label = passwordVisibilityLabel(on);
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.eye}
    >
      <SFSymbol name={on ? "eye.slash" : "eye"} size={18} color={t.colors.text_secondary} />
    </TouchableOpacity>
  );
}

export function AuthPrimary({
  label,
  onPress,
  testID,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useTheme();
  // Plain RN control — nested Reanimated transform wrappers ate presses on device.
  return (
    <TouchableOpacity
      testID={testID}
      onPress={() => {
        if (disabled || busy) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      disabled={disabled || busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={[styles.primary, { backgroundColor: t.colors.tone_primary, opacity: disabled || busy ? 0.5 : 1 }]}
    >
      <Text style={[t.typography.headline, { color: t.colors.text_inverse }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Amazon-branded primary CTA — matches web Continue with Amazon. */
export function AuthAmazon({
  label,
  onPress,
  testID,
  disabled,
  busy,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      onPress={() => {
        if (disabled || busy) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      disabled={disabled || busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={[styles.amazon, { opacity: disabled || busy ? 0.5 : 1 }]}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SFSymbol name="bag" size={18} color="#111111" />
      </View>
      <Text style={[t.typography.headline, { color: "#111111" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function AuthDivider({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.dividerLine, { backgroundColor: t.colors.separator }]} />
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary, paddingHorizontal: 10 }]}>{label}</Text>
      <View style={[styles.dividerLine, { backgroundColor: t.colors.separator }]} />
    </View>
  );
}

export function AuthSecondary({
  label,
  onPress,
  testID,
  disabled,
  symbol,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  symbol?: AuthIcon;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.secondary, { backgroundColor: t.colors.background_secondary, opacity: disabled ? 0.5 : 1 }]}
    >
      {symbol ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <SFSymbol name={ICONS[symbol]} size={18} color={t.colors.text_primary} />
        </View>
      ) : null}
      <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function AuthMessage({ kind, text }: { kind: "error" | "ok"; text: string }) {
  const t = useTheme();
  const color = kind === "error" ? t.colors.tone_danger : t.colors.tone_good;
  const entering = useEntering(FadeIn.duration(220));
  return (
    <Animated.View
      entering={entering}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.message, { backgroundColor: color + "14" }]}
    >
      <SFSymbol name={kind === "error" ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"} size={16} color={color} />
      <Text style={[t.typography.footnote, { color, flex: 1, lineHeight: undefined }]}>{text}</Text>
    </Animated.View>
  );
}

export function AuthLink({
  label,
  onPress,
  testID,
  align = "center",
}: {
  label: string;
  onPress: () => void;
  testID: string;
  align?: "center" | "end";
}) {
  const t = useTheme();
  const entering = useEntering(FadeIn.delay(120).duration(280));
  return (
    <Animated.View
      entering={entering}
      style={{ alignSelf: align === "end" ? "flex-end" : "center" }}
    >
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        hitSlop={8}
        style={styles.link}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function AuthSwitch({
  prompt,
  action,
  onPress,
  testID,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
  testID: string;
}) {
  const t = useTheme();
  const entering = useEntering(FadeIn.delay(260).duration(280));
  return (
    <Animated.View entering={entering} style={styles.switchRow}>
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{prompt} </Text>
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={action}
      >
        <Text style={[t.typography.footnote, { color: t.colors.tone_primary, fontWeight: "600" }]}>{action}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, flexGrow: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, marginLeft: -4 },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 20,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  markImage: { width: 40, height: 40, borderRadius: 10 },
  titleBlock: { marginBottom: 22 },
  titleCenter: { alignItems: "center" },
  group: { borderRadius: dashboard.cardRadius, borderCurve: "continuous", overflow: "hidden" },
  row: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 52,
    fontSize: 17,
    paddingVertical: 12,
    zIndex: 2,
  },
  eye: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", zIndex: 2 },
  primary: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  amazon: {
    marginTop: 4,
    minHeight: 48,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    backgroundColor: "#FF9900",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 22,
    marginBottom: 6,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  secondary: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  message: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: dashboard.chipRadius,
  },
  link: { minHeight: 44, justifyContent: "center" },
  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 18,
    minHeight: 44,
  },
});
