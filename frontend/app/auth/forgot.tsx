import React, { useState } from "react";
import { useRouter } from "expo-router";
import {
  AuthBack,
  AuthField,
  AuthFieldGroup,
  AuthMessage,
  AuthPrimary,
  AuthScreen,
  AuthTitle,
} from "@/src/components/auth/AuthChrome";
import { useAuth } from "@/src/contexts/AuthContext";
import { FORGOT_SUBTITLE, FORGOT_SUCCESS, FORGOT_TITLE, humanizeAuthError } from "@/src/lib/authContract";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleReset() {
    if (loading) return;
    setError(null);
    setInfo(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    const res = await resetPassword(trimmedEmail);
    setLoading(false);
    if (res.error) {
      setError(humanizeAuthError(res.error, "forgot"));
      return;
    }
    setInfo(FORGOT_SUCCESS);
  }

  return (
    <AuthScreen>
      <AuthBack testID="forgot-back" onPress={() => router.replace("/auth/login")} />
      <AuthTitle title={FORGOT_TITLE} subtitle={FORGOT_SUBTITLE} />

      <AuthFieldGroup>
        <AuthField
          testID="forgot-email-input"
          symbol="envelope"
          last
          placeholder="Email"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          returnKeyType="go"
          onSubmitEditing={() => void handleReset()}
          editable={!loading}
        />
      </AuthFieldGroup>

      {error ? <AuthMessage kind="error" text={error} /> : null}
      {info ? <AuthMessage kind="ok" text={info} /> : null}

      <AuthPrimary
        testID="forgot-submit-btn"
        label={loading ? "Sending…" : "Email reset link"}
        onPress={() => void handleReset()}
        disabled={loading}
        busy={loading}
      />
    </AuthScreen>
  );
}
