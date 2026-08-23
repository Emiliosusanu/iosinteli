import React, { useRef, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  AuthEye,
  AuthField,
  AuthFieldGroup,
  AuthLink,
  AuthMark,
  AuthMessage,
  AuthPrimary,
  AuthReveal,
  AuthScreen,
  AuthSecondary,
  AuthSwitch,
  AuthTitle,
} from "@/src/components/auth/AuthChrome";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  AMAZON_LOGIN_BUSY,
  AMAZON_LOGIN_HINT,
  AMAZON_LOGIN_LABEL,
  GUEST_CTA,
  GUEST_HINT,
  LOGIN_SUBTITLE,
  LOGIN_TITLE,
  humanizeAuthError,
} from "@/src/lib/authContract";
import { fetchAmazonLoginUrl } from "@/src/lib/mutations";
import { useTheme } from "@/src/lib/theme";
import { storage } from "@/src/utils/storage";

export default function LoginScreen() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, enterGuestMode } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [amazonLoginHidden, setAmazonLoginHidden] = useState(false);
  const [amazonBusy, setAmazonBusy] = useState(false);

  React.useEffect(() => {
    let active = true;
    storage.getItem<boolean>("inteliads.onboarded", false).then((seen) => {
      if (active && !seen) router.replace("/auth/welcome");
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSignIn() {
    if (loading) return;
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    const res = await signIn(trimmedEmail, password);
    setLoading(false);
    if (res.error) setError(humanizeAuthError(res.error, "login"));
  }

  async function handleAmazonLogin() {
    if (amazonBusy || loading) return;
    setError(null);
    setAmazonBusy(true);
    try {
      const { url } = await fetchAmazonLoginUrl();
      if (!url) {
        setAmazonLoginHidden(true);
        return;
      }
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setAmazonLoginHidden(true);
    } finally {
      setAmazonBusy(false);
    }
  }

  return (
    <AuthScreen>
      <AuthMark />
      <AuthTitle title={LOGIN_TITLE} subtitle={LOGIN_SUBTITLE} align="center" />

      <AuthFieldGroup>
        <AuthField
          testID="login-email-input"
          symbol="envelope"
          placeholder="Email"
          keyboardType="email-address"
          autoComplete="username"
          textContentType="username"
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!loading}
        />
        <AuthField
          testID="login-password-input"
          symbol="lock"
          last
          placeholder="Password"
          autoComplete="password"
          textContentType="password"
          secureTextEntry={!showPwd}
          value={password}
          onChangeText={setPassword}
          returnKeyType="go"
          onSubmitEditing={() => void handleSignIn()}
          inputRef={passwordRef}
          editable={!loading}
          trailing={<AuthEye on={showPwd} onPress={() => setShowPwd((v) => !v)} />}
        />
      </AuthFieldGroup>

      <AuthLink
        testID="forgot-password-link"
        label="Forgot password?"
        align="end"
        onPress={() => router.push("/auth/forgot" as import("expo-router").Href)}
      />

      {error ? <AuthMessage kind="error" text={error} /> : null}

      <AuthPrimary
        testID="login-submit-btn"
        label={loading ? "Signing in…" : "Sign in"}
        onPress={() => void handleSignIn()}
        disabled={loading}
        busy={loading}
      />

      {amazonLoginHidden ? null : (
        <AuthSecondary
          testID="amazon-login-btn"
          symbol="bag"
          label={amazonBusy ? AMAZON_LOGIN_BUSY : AMAZON_LOGIN_LABEL}
          onPress={() => void handleAmazonLogin()}
          disabled={amazonBusy || loading}
          accessibilityHint={AMAZON_LOGIN_HINT}
        />
      )}

      <AuthSwitch
        prompt="No account?"
        action="Create one"
        testID="goto-signup-btn"
        onPress={() => router.push("/auth/signup")}
      />

      <View style={{ flex: 1, minHeight: 24 }} />

      <AuthReveal delay={300}>
        <TouchableOpacity
          testID="guest-mode-btn"
          onPress={enterGuestMode}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={GUEST_CTA}
          accessibilityHint={GUEST_HINT}
          style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}
        >
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, textAlign: "center" }]}>{GUEST_CTA}</Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, textAlign: "center", marginTop: 2, lineHeight: undefined }]}>
            {GUEST_HINT}
          </Text>
        </TouchableOpacity>
      </AuthReveal>
    </AuthScreen>
  );
}
