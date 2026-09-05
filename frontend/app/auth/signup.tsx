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
  AuthSwitch,
  AuthTitle,
} from "@/src/components/auth/AuthChrome";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  MIN_PASSWORD_LENGTH,
  SIGNUP_PASSWORD_RULE,
  SIGNUP_TITLE,
  humanizeAuthError,
  signupOutcomeCopy,
} from "@/src/lib/authContract";

export default function SignupScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function goToLogin() {
    router.replace("/auth/login");
  }

  async function handleSignUp() {
    if (loading) return;
    setError(null);
    setInfo(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(SIGNUP_PASSWORD_RULE);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const res = await signUp(trimmedEmail, password);
    setLoading(false);
    if (res.error) {
      setError(humanizeAuthError(res.error, "signup"));
    } else {
      setInfo(signupOutcomeCopy(res.needsConfirmation));
    }
  }

  return (
    <AuthScreen>
      <AuthBack testID="back-to-login" onPress={goToLogin} />
      <AuthTitle title={SIGNUP_TITLE} subtitle={SIGNUP_PASSWORD_RULE} />

      <AuthFieldGroup>
        <AuthField
          testID="signup-email-input"
          symbol="envelope"
          placeholder="Email"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!loading}
        />
        <AuthField
          testID="signup-password-input"
          symbol="lock"
          placeholder="Password"
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry={!showPwd}
          value={password}
          onChangeText={setPassword}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => confirmRef.current?.focus()}
          inputRef={passwordRef}
          editable={!loading}
          trailing={<AuthEye on={showPwd} onPress={() => setShowPwd((v) => !v)} />}
        />
        <AuthField
          testID="signup-confirm-input"
          symbol="lock"
          last
          placeholder="Confirm password"
          autoComplete="new-password"
          textContentType="newPassword"
          secureTextEntry={!showConfirm}
          value={confirm}
          onChangeText={setConfirm}
          returnKeyType="go"
          onSubmitEditing={() => void handleSignUp()}
          inputRef={confirmRef}
          editable={!loading}
          trailing={<AuthEye on={showConfirm} onPress={() => setShowConfirm((v) => !v)} />}
        />
      </AuthFieldGroup>

      {error ? <AuthMessage kind="error" text={error} /> : null}
      {info ? <AuthMessage kind="ok" text={info} /> : null}

      <AuthPrimary
        testID="signup-submit-btn"
        label={loading ? "Creating…" : "Create account"}
        onPress={() => void handleSignUp()}
        disabled={loading}
        busy={loading}
      />

      <AuthSwitch prompt="Already have an account?" action="Sign in" testID="goto-login-btn" onPress={goToLogin} />
    </AuthScreen>
  );
}
