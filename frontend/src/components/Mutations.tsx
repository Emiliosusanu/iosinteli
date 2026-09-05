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
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatCurrency } from "@/src/lib/format";
import {
  cooldownAlertMessage,
  getEntityBidCooldown,
  type EntityBidCooldownFields,
  type EntityBidCooldownInfo,
} from "@/src/lib/bidCooldown";
import { SIGN_IN_TO_MUTATE_MESSAGE, userMessageForNestError } from "@/src/lib/rulesApi";
import {
  BID_CHANGE_CONFIRM_PCT,
  parseBidInput,
  requiresBidChangeConfirm,
  sanitizeBidForAmazon,
} from "@/src/lib/targetingFilters";
import { dashboard, useTheme } from "@/src/lib/theme";
import { promptIOSNumber, SFSymbol } from "./ios/Native";
import { PrimaryButton, SecondaryButton } from "./Primitives";

function confirmLargeBidChange(from: number, to: number): Promise<boolean> {
  if (!requiresBidChangeConfirm(from, to)) return Promise.resolve(true);
  const pct = Math.round((Math.abs(to - from) / from) * 100);
  return new Promise((resolve) => {
    Alert.alert(
      "Large bid change",
      `This moves the bid by about ${pct}% (over ${BID_CHANGE_CONFIRM_PCT}%). Write to Amazon Ads anyway?`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Write to Amazon", style: "destructive", onPress: () => resolve(true) },
      ],
    );
  });
}

/** Honest view-as write block — Nest rejects mutations for another user's entities. */
export const VIEW_AS_WRITE_ALERT_TITLE = "Can't write while viewing as customer";
export const VIEW_AS_WRITE_ALERT_BODY = "Exit View as to edit";

export class ViewAsWriteBlockedError extends Error {
  readonly code = "VIEW_AS_WRITE_BLOCKED" as const;
  constructor() {
    super(VIEW_AS_WRITE_ALERT_TITLE);
    this.name = "ViewAsWriteBlockedError";
  }
}

export function isViewAsWriteBlockedError(error: unknown): boolean {
  return (
    error instanceof ViewAsWriteBlockedError ||
    (typeof error === "object" &&
      error != null &&
      (error as { code?: string }).code === "VIEW_AS_WRITE_BLOCKED")
  );
}

export function alertViewAsWriteBlocked() {
  Alert.alert(VIEW_AS_WRITE_ALERT_TITLE, VIEW_AS_WRITE_ALERT_BODY);
}

export function isViewingAsOtherUser(
  adminFilterUserId: string | null | undefined,
  signedInUserId: string | null | undefined,
): boolean {
  return Boolean(adminFilterUserId && adminFilterUserId !== signedInUserId);
}

export type AmazonWriteGuardInput = {
  guestMode?: boolean;
  viewAsOtherUser: boolean;
};

/** Pure check — no alerts. */
export function canWriteAmazon(input: AmazonWriteGuardInput): boolean {
  return !input.guestMode && !input.viewAsOtherUser;
}

/** @returns true when the write must not proceed (alert already shown). */
export function blockIfViewingAs(viewAsOtherUser: boolean): boolean {
  if (!viewAsOtherUser) return false;
  alertViewAsWriteBlocked();
  return true;
}

/**
 * Guest + view-as gate for sync handlers (bid taps, bulk enqueue, strategy open).
 * @returns true when the write must not proceed (alert already shown).
 */
export function blockIfCannotWriteAmazon(input: AmazonWriteGuardInput): boolean {
  if (input.guestMode) {
    Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
    return true;
  }
  return blockIfViewingAs(input.viewAsOtherUser);
}

/**
 * For async handlers that already applied optimistic UI (e.g. EntityStateSwitch).
 * Alerts once, then throws so callers / EntityStateSwitch can roll back without a second alert.
 */
export function assertNotViewingAsOtherUser(viewAsOtherUser: boolean): void {
  if (!viewAsOtherUser) return;
  alertViewAsWriteBlocked();
  throw new ViewAsWriteBlockedError();
}

/**
 * Shared Amazon write honesty gate. Alerts guest or view-as, then throws so
 * callers / EntityStateSwitch can roll back without a second alert.
 */
export function assertCanWriteAmazon(input: AmazonWriteGuardInput): void {
  if (input.guestMode) {
    Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
    throw new Error(SIGN_IN_TO_MUTATE_MESSAGE);
  }
  assertNotViewingAsOtherUser(input.viewAsOtherUser);
}

/** Hook used by EntityStateSwitch / BidBudgetEditor so every consumer inherits the guard. */
export function useAmazonWriteAccess(): {
  guestMode: boolean;
  viewAsOtherUser: boolean;
  canWrite: boolean;
} {
  const { guestMode, user } = useAuth();
  const { adminFilterUserId } = useApp();
  const viewAsOtherUser = isViewingAsOtherUser(adminFilterUserId, user?.id);
  return {
    guestMode,
    viewAsOtherUser,
    canWrite: canWriteAmazon({ guestMode, viewAsOtherUser }),
  };
}

export function alertMutationError(error: unknown, fallback = "Couldn't save that change.") {
  if (isViewAsWriteBlockedError(error)) return;
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
  /** When false, locks writes (in addition to guest / view-as). */
  canWrite: canWriteProp,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void | Promise<void>;
  disabled?: boolean;
  confirmPause?: boolean;
  noun?: string;
  testID?: string;
  /** Smaller switch for dense list rows (default on). */
  compact?: boolean;
  canWrite?: boolean;
}) {
  const t = useTheme();
  const { guestMode, viewAsOtherUser, canWrite: sessionCanWrite } = useAmazonWriteAccess();
  const canWrite = (canWriteProp ?? true) && sessionCanWrite;
  const [busy, setBusy] = useState(false);
  // Hold the user's choice until the parent `enabled` prop catches up from
  // optimistic cache / refetch. Without this, a slow invalidateAds snaps the
  // Switch back and feels like "can't re-enable".
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? enabled;
  const locked = disabled || busy || !canWrite;

  React.useEffect(() => {
    if (optimistic == null) return;
    if (enabled === optimistic) setOptimistic(null);
  }, [enabled, optimistic]);

  const apply = async (next: boolean) => {
    if (!canWrite) {
      if (guestMode) {
        Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      } else if (viewAsOtherUser) {
        alertViewAsWriteBlocked();
      }
      return;
    }
    setOptimistic(next);
    setBusy(true);
    try {
      await onChange(next);
    } catch (error) {
      setOptimistic(null);
      alertMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={compact ? styles.switchCompact : undefined}>
      <Switch
        testID={testID}
        value={shown}
        disabled={locked}
        accessibilityLabel={`${noun} is ${shown ? "active" : "paused"}${busy ? ". Updating" : ""}`}
        accessibilityHint={
          viewAsOtherUser
            ? "Amazon writes are blocked while viewing as a customer."
            : "Changing this writes Amazon Ads."
        }
        accessibilityState={{ disabled: locked, checked: shown, busy }}
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
  min = 0.01,
  max = 1_000_000,
  onClose,
  onSave,
  testID,
  /** When false, skip the >30% relative confirm (bulk $/% delta editors). */
  confirmLargeChange = true,
  /** When false, locks writes (in addition to guest / view-as). */
  canWrite: canWriteProp,
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
  confirmLargeChange?: boolean;
  canWrite?: boolean;
}) {
  const t = useTheme();
  const { guestMode, viewAsOtherUser, canWrite: sessionCanWrite } = useAmazonWriteAccess();
  const canWrite = (canWriteProp ?? true) && sessionCanWrite;
  const [draft, setDraft] = useState(String(value || ""));
  const [saving, setSaving] = useState(false);
  const usedNativePrompt = React.useRef(false);

  const [forceSheet, setForceSheet] = useState(false);

  React.useEffect(() => {
    if (visible) setDraft(String(Number.isFinite(value) ? value : ""));
  }, [visible, value]);

  React.useEffect(() => {
    if (!visible) {
      usedNativePrompt.current = false;
      setForceSheet(false);
      return;
    }
    if (!canWrite) {
      if (guestMode) {
        Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      } else if (viewAsOtherUser) {
        alertViewAsWriteBlocked();
      }
      onClose();
      return;
    }
    if (usedNativePrompt.current) return;
    usedNativePrompt.current = true;
    const opened = promptIOSNumber({
      title,
      message:
        kind === "percent"
          ? `Enter ${min}–${max}%. Queues a write to Amazon Ads — not confirmed until Amazon accepts.`
          : `Shown value ${formatCurrency(value, currency)}. Minimum ${formatCurrency(min, currency)}. Queues a write to Amazon Ads — not confirmed until Amazon accepts.`,
      value,
      min,
      max,
      onCancel: () => {
        usedNativePrompt.current = false;
        onClose();
      },
      onSave: (next) => {
        // Close first so the seller can edit the next bid immediately.
        // Amazon writes continue via the caller's outbox / network path.
        usedNativePrompt.current = false;
        onClose();
        void (async () => {
          assertCanWriteAmazon({ guestMode, viewAsOtherUser });
          let resolved = next;
          if (kind === "money") {
            const sanitized = sanitizeBidForAmazon(String(next));
            if (sanitized == null || sanitized < min || sanitized > max) {
              Alert.alert("Check the number", `Enter a value between ${min} and ${max}.`);
              return;
            }
            resolved = sanitized;
            if (confirmLargeChange && !(await confirmLargeBidChange(value, resolved))) return;
          }
          await onSave(resolved);
        })().catch((error) => alertMutationError(error));
      },
    });
    if (!opened) {
      usedNativePrompt.current = false;
      setForceSheet(true);
    }
    // Native UIAlertController owns the interaction; don't retrigger when parent callbacks change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submit = async () => {
    if (!canWrite) {
      if (guestMode) {
        Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      } else if (viewAsOtherUser) {
        alertViewAsWriteBlocked();
      }
      return;
    }
    let next: number;
    if (kind === "money") {
      const sanitized = sanitizeBidForAmazon(draft);
      if (sanitized == null) {
        Alert.alert("Check the number", "Use digits only (optional decimal). No currency symbols or letters.");
        return;
      }
      next = sanitized;
    } else {
      const parsed = parseBidInput(draft);
      if (parsed == null) {
        Alert.alert("Check the number", "Use digits only (optional decimal).");
        return;
      }
      next = parsed;
    }
    if (!Number.isFinite(next) || next < min || next > max) {
      Alert.alert("Check the number", `Enter a value between ${min} and ${max}.`);
      return;
    }
    if (kind === "money" && confirmLargeChange && !(await confirmLargeBidChange(value, next))) return;
    setSaving(false);
    onClose();
    void Promise.resolve()
      .then(() => {
        assertCanWriteAmazon({ guestMode, viewAsOtherUser });
        return onSave(next);
      })
      .catch((error) => alertMutationError(error));
  };

  const showSheet = Platform.OS !== "ios" || forceSheet;
  if (!showSheet) return null;

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
                ? `Enter ${min}–${max}%. Queues a write to Amazon Ads — not confirmed until Amazon accepts.`
                : `Shown ${formatCurrency(value, currency)}. Minimum ${formatCurrency(min, currency)}. Queues a write to Amazon Ads — not confirmed until Amazon accepts.`}
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
  cooldown,
  cooldownRow,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID?: string;
  compact?: boolean;
  /** Precomputed cooldown (preferred). */
  cooldown?: EntityBidCooldownInfo | null;
  /** Or pass the entity row and we derive cooldown. */
  cooldownRow?: EntityBidCooldownFields | null;
}) {
  const t = useTheme();
  const info = cooldown ?? (cooldownRow ? getEntityBidCooldown(cooldownRow) : null);
  const locked = Boolean(info?.isInCooldown);
  const valueColor = locked ? t.colors.tone_warning : compact ? t.colors.text_primary : t.colors.text_secondary;

  const openEditor = () => {
    if (locked && info) {
      Alert.alert("Cooldown", cooldownAlertMessage(info), [
        { text: "Cancel", style: "cancel" },
        { text: "Edit anyway", style: "destructive", onPress },
      ]);
      return;
    }
    onPress();
  };

  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}${locked ? ". On cooldown" : ""}. Edit ${label.toLowerCase()}.`}
      accessibilityHint={
        locked
          ? "Shows cooldown details. You can still edit and reset the cooldown."
          : "Opens the editor. Saving writes Amazon Ads."
      }
      onPress={openEditor}
      activeOpacity={0.75}
      style={[
        compact ? styles.tapCompact : styles.tap,
        {
          backgroundColor: locked
            ? t.colors.tone_warning + "1A"
            : t.colors.glass_background ?? t.colors.background_secondary,
          borderColor: locked ? t.colors.tone_warning + "66" : t.colors.glass_stroke ?? t.colors.separator,
        },
      ]}
    >
      {!compact ? (
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{label}</Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
        {compact ? (
          <Text style={[t.typography.caption2, { color: locked ? t.colors.tone_warning : t.colors.text_tertiary }]}>
            {locked ? "Cooldown" : label}
          </Text>
        ) : null}
        <Text
          style={[
            compact ? t.typography.caption1 : t.typography.body,
            { color: valueColor, fontVariant: ["tabular-nums"], fontWeight: locked ? "700" : undefined },
          ]}
        >
          {value}
        </Text>
        <SFSymbol name="chevron.right" size={compact ? 10 : 12} color={locked ? t.colors.tone_warning : t.colors.text_tertiary} />
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
