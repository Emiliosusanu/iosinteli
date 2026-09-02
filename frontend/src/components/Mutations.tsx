import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatCurrency } from "@/src/lib/format";
import { SIGN_IN_TO_MUTATE_MESSAGE, userMessageForNestError } from "@/src/lib/rulesApi";
import { dashboard, useTheme } from "@/src/lib/theme";
import { promptIOSNumber, SFSymbol } from "./ios/Native";
import { PrimaryButton, SecondaryButton } from "./Primitives";

export function alertMutationError(error: unknown, fallback = "Couldn't save that change.") {
  Alert.alert("Couldn't save", userMessageForNestError(error, fallback));
}

export function EntityStateSwitch({
  enabled,
  onChange,
  disabled,
  confirmPause = true,
  noun = "item",
  testID,
  compact = true,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void | Promise<void>;
  disabled?: boolean;
  confirmPause?: boolean;
  noun?: string;
  testID?: string;
  /** Smaller switch for dense list rows (default on). */
  compact?: boolean;
}) {
  const t = useTheme();
  const { guestMode } = useAuth();
  const [busy, setBusy] = useState(false);
  const locked = disabled || busy || guestMode;

  const apply = async (next: boolean) => {
    if (guestMode) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      await onChange(next);
    } catch (error) {
      alertMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={compact ? styles.switchCompact : undefined}>
      <Switch
        testID={testID}
        value={enabled}
        disabled={locked}
        accessibilityLabel={`${noun} is ${enabled ? "active" : "paused"}${busy ? ". Updating" : ""}`}
        accessibilityHint="Changing this writes Amazon Ads."
        accessibilityState={{ disabled: locked, checked: enabled, busy }}
        onValueChange={(next) => {
          if (!next && confirmPause) {
            Alert.alert(`Pause ${noun}?`, "This writes to Amazon Ads.", [
              { text: "Cancel", style: "cancel" },
              { text: "Pause", style: "destructive", onPress: () => void apply(false) },
            ]);
            return;
          }
          void apply(next);
        }}
        trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_good }}
        ios_backgroundColor={t.colors.background_tertiary}
      />
    </View>
  );
}

export function BidBudgetEditor({
  visible,
  title,
  value,
  currency,
  kind = "money",
  min = 0.02,
  max = 1_000_000,
  onClose,
  onSave,
  testID,
}: {
  visible: boolean;
  title: string;
  value: number;
  currency?: string | null;
  kind?: "money" | "percent";
  min?: number;
  max?: number;
  onClose: () => void;
  onSave: (next: number) => void | Promise<void>;
  testID?: string;
}) {
  const t = useTheme();
  const { guestMode } = useAuth();
  const [draft, setDraft] = useState(String(value || ""));
  const [saving, setSaving] = useState(false);
  const usedNativePrompt = React.useRef(false);

  React.useEffect(() => {
    if (visible) setDraft(String(Number.isFinite(value) ? value : ""));
  }, [visible, value]);

  React.useEffect(() => {
    if (!visible) {
      usedNativePrompt.current = false;
      return;
    }
    if (guestMode) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      onClose();
      return;
    }
    if (usedNativePrompt.current) return;
    usedNativePrompt.current = true;
    const opened = promptIOSNumber({
      title,
      message: kind === "percent" ? "0–900%. This writes to Amazon Ads." : `Current ${formatCurrency(value, currency)}. This writes to Amazon Ads.`,
      value,
      min,
      max,
      onCancel: () => {
        usedNativePrompt.current = false;
        onClose();
      },
      onSave: async (next) => {
        try {
          await onSave(next);
        } catch (error) {
          alertMutationError(error);
        } finally {
          usedNativePrompt.current = false;
          onClose();
        }
      },
    });
    if (!opened) usedNativePrompt.current = false;
    // Native UIAlertController owns the interaction; don't retrigger when parent callbacks change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = async () => {
    if (guestMode) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      return;
    }
    const next = Number(draft.replace(",", "."));
    if (!Number.isFinite(next) || next < min || next > max) {
      Alert.alert("Check the number", `Enter a value between ${min} and ${max}.`);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } catch (error) {
      alertMutationError(error);
    } finally {
      setSaving(false);
    }
  };

  if (Platform.OS === "ios") return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior="padding" style={styles.center}>
          <Pressable
            testID={testID}
            onPress={() => {}}
            style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}
          >
            <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{title}</Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4 }]}>
              {kind === "percent"
                ? "0–900%. This writes to Amazon Ads."
                : `Current ${formatCurrency(value, currency)}. This writes to Amazon Ads.`}
            </Text>
            <View style={[styles.inputRow, { borderColor: t.colors.border, backgroundColor: t.colors.background_primary }]}>
              <Text style={[t.typography.headline, { color: t.colors.text_secondary }]}>
                {kind === "percent" ? "%" : currency || ""}
              </Text>
              <TextInput
                testID={testID ? `${testID}-input` : undefined}
                value={draft}
                onChangeText={setDraft}
                keyboardType="decimal-pad"
                autoFocus
                style={[t.typography.title3, styles.input, { color: t.colors.text_primary }]}
                placeholder="0"
                placeholderTextColor={t.colors.text_tertiary}
              />
            </View>
            <View style={styles.actions}>
              <SecondaryButton label="Cancel" onPress={onClose} />
              <PrimaryButton label="Save" onPress={() => void submit()} loading={saving} />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

export function MutationTap({
  label,
  value,
  onPress,
  testID,
  compact = false,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID?: string;
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}. Edit ${label.toLowerCase()}.`}
      accessibilityHint="Opens the editor. Saving writes Amazon Ads."
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        compact ? styles.tapCompact : styles.tap,
        {
          backgroundColor: t.colors.glass_background ?? t.colors.background_secondary,
          borderColor: t.colors.glass_stroke ?? t.colors.separator,
        },
      ]}
    >
      {!compact ? (
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{label}</Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        {compact ? (
          <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label}</Text>
        ) : null}
        <Text
          style={[
            compact ? t.typography.caption1 : t.typography.body,
            { color: compact ? t.colors.text_primary : t.colors.text_secondary, fontVariant: ["tabular-nums"] },
          ]}
        >
          {value}
        </Text>
        <SFSymbol name="chevron.right" size={compact ? 10 : 12} color={t.colors.text_tertiary} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  switchCompact: {
    transform: [{ scaleX: 0.78 }, { scaleY: 0.78 }],
    marginLeft: -2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  center: { width: "100%" },
  sheet: {
    borderRadius: dashboard.cardRadius,
    padding: 18,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    minHeight: 52,
  },
  input: { flex: 1, paddingVertical: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 18 },
  tap: {
    minHeight: 44,
    borderRadius: dashboard.chipRadius,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: StyleSheet.hairlineWidth,
  },
  tapCompact: {
    minHeight: 28,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
});
