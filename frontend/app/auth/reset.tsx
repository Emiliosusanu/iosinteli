import React, { useRef, useState } from "react";
import { TextInput } from "react-native";
import { useRouter } from "expo-router";
import {
  AuthBack,
  AuthEye,
  AuthField,
  AuthFieldGroup,
  AuthMessage,
  AuthPrimary,
  AuthScreen,
  AuthTitle,
} from "@/src/components/auth/AuthChrome";
import { useAuth } from "@/src/contexts/AuthContext";
import { supabase } from "@/src/lib/supabase";
import {
  MIN_PASSWORD_LENGTH,
  RESET_TITLE,
  RESET_UPDATED_COPY,
  RESET_WEB_COPY,
  SIGNUP_PASSWORD_RULE,
  humanizeAuthError,
} from "@/src/lib/authContract";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const confirmRef = useRef<TextInput>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const canReset = !!session;

  async function handleUpdate() {
    if (loading || !canReset) return;
    setError(null);
    setInfo(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(SIGNUP_PASSWORD_RULE);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(humanizeAuthError(updateError.message, "reset"));
      return;
    }
    setInfo(RESET_UPDATED_COPY);
  }

  return (
    <AuthScreen>
      <AuthBack testID="reset-back" onPress={() => router.replace("/auth/login")} />
      <AuthTitle title={RESET_TITLE} subtitle={canReset ? SIGNUP_PASSWORD_RULE : RESET_WEB_COPY} />

      {canReset ? (
        <>
          <AuthFieldGroup>
            <AuthField
              testID="reset-password-input"
              symbol="lock"
              placeholder="New password"
              autoComplete="new-password"
              textContentType="newPassword"
              secureTextEntry={!showPwd}
              value={password}
              onChangeText={setPassword}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => confirmRef.current?.focus()}
              trailing={<AuthEye on={showPwd} onPress={() => setShowPwd((v) => !v)} />}
            />
            <AuthField
              testID="reset-confirm-input"
              symbol="lock"
              last
              placeholder="Repeat password"
              autoComplete="new-password"
              textContentType="newPassword"
              secureTextEntry={!showPwd}
              value={confirm}
              onChangeText={setConfirm}
              returnKeyType="go"
              onSubmitEditing={() => void handleUpdate()}
              inputRef={confirmRef}
            />
          </AuthFieldGroup>

          {error ? <AuthMessage kind="error" text={error} /> : null}
          {info ? <AuthMessage kind="ok" text={info} /> : null}

          <AuthPrimary
            testID="reset-submit-btn"
            label={loading ? "Saving…" : "Update password"}
            onPress={() => void handleUpdate()}
            disabled={loading}
            busy={loading}
          />
        </>
      ) : null}
    </AuthScreen>
  );
}
