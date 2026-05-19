import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";

export default function LoginScreen() {
  const t = useTheme();
  const router = useRouter();
  const { signIn, enterGuestMode } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  async function handleSignIn() {
    setError(null);
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    const res = await signIn(email.trim(), password);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.colors.background_primary }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View
              style={[
                styles.logoBox,
                { backgroundColor: t.colors.tone_primary, shadowColor: t.colors.tone_primary },
              ]}
            >
              <Ionicons name="trending-up" size={28} color="#fff" />
            </View>
            <Text style={[t.typography.largeTitle, { color: t.colors.text_primary, marginTop: 20 }]}>
              inteliads
            </Text>
            <Text
              style={[
                t.typography.subhead,
                { color: t.colors.text_secondary, marginTop: 4, textAlign: "center" },
              ]}
            >
              Smart Clarity for Amazon Ads
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: t.colors.background_secondary }]}>
            <Text style={[t.typography.title2, { color: t.colors.text_primary, marginBottom: 4 }]}>
              Welcome back
            </Text>
            <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginBottom: 20 }]}>
              Sign in to your inteliads account
            </Text>

            <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginBottom: 6 }]}>
              EMAIL
            </Text>
            <View style={[styles.input, { backgroundColor: t.colors.background_tertiary }]}>
              <Ionicons name="mail-outline" size={16} color={t.colors.text_secondary} />
              <TextInput
                testID="login-email-input"
                style={[styles.inputText, { color: t.colors.text_primary }]}
                placeholder="you@example.com"
                placeholderTextColor={t.colors.text_tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                returnKeyType="next"
              />
            </View>

            <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: 14, marginBottom: 6 }]}>
              PASSWORD
            </Text>
            <View style={[styles.input, { backgroundColor: t.colors.background_tertiary }]}>
              <Ionicons name="lock-closed-outline" size={16} color={t.colors.text_secondary} />
              <TextInput
                testID="login-password-input"
                style={[styles.inputText, { color: t.colors.text_primary }]}
                placeholder="Your password"
                placeholderTextColor={t.colors.text_tertiary}
                secureTextEntry={!showPwd}
                value={password}
                onChangeText={setPassword}
                returnKeyType="go"
                onSubmitEditing={handleSignIn}
              />
              <TouchableOpacity onPress={() => setShowPwd((v) => !v)} hitSlop={10}>
                <Ionicons
                  name={showPwd ? "eye-off-outline" : "eye-outline"}
                  size={16}
                  color={t.colors.text_secondary}
                />
              </TouchableOpacity>
            </View>

            {error && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 14,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: t.colors.tone_danger + "1A",
                }}
              >
                <Ionicons name="alert-circle" size={14} color={t.colors.tone_danger} />
                <Text style={[t.typography.footnote, { color: t.colors.tone_danger, marginLeft: 6, flex: 1 }]}>
                  {error}
                </Text>
              </View>
            )}

            <TouchableOpacity
              testID="login-submit-btn"
              activeOpacity={0.8}
              disabled={loading}
              onPress={handleSignIn}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: t.colors.tone_primary,
                  opacity: loading ? 0.6 : 1,
                  marginTop: 22,
                },
              ]}
            >
              <Text style={[t.typography.headline, { color: "#fff" }]}>
                {loading ? "Signing in..." : "Sign in"}
              </Text>
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                Don&apos;t have an account?{" "}
              </Text>
              <TouchableOpacity testID="goto-signup-btn" onPress={() => router.push("/auth/signup")}>
                <Text style={[t.typography.footnote, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                  Sign up
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.divider, { backgroundColor: t.colors.separator }]} />

            <TouchableOpacity
              testID="guest-mode-btn"
              activeOpacity={0.7}
              onPress={enterGuestMode}
              style={[
                styles.guestBtn,
                { backgroundColor: t.colors.background_tertiary },
              ]}
            >
              <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}>
                Continue as guest · Explore demo
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 40, flexGrow: 1 },
  brand: { alignItems: "center", marginBottom: 28 },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  card: {
    borderRadius: 22,
    padding: 22,
  },
  input: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  inputText: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 8,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: 20,
    marginBottom: 16,
  },
  guestBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
