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

export default function SignupScreen() {
  const t = useTheme();
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSignUp() {
    setError(null);
    setInfo(null);
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const res = await signUp(email.trim(), password);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else if (res.needsConfirmation) {
      setInfo("Account created! Please check your email to confirm, then sign in.");
    } else {
      setInfo("Account created. Signing you in…");
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.colors.background_primary }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            testID="back-to-login"
            onPress={() => router.back()}
            style={{ alignSelf: "flex-start", padding: 4, marginBottom: 12 }}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={24} color={t.colors.tone_primary} />
          </TouchableOpacity>

          <Text style={[t.typography.largeTitle, { color: t.colors.text_primary }]}>Create account</Text>
          <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginTop: 4 }]}>
            Start managing your Amazon Ads with clarity
          </Text>

          <View style={[styles.card, { backgroundColor: t.colors.background_secondary, marginTop: 24 }]}>
            <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginBottom: 6 }]}>
              EMAIL
            </Text>
            <View style={[styles.input, { backgroundColor: t.colors.background_tertiary }]}>
              <Ionicons name="mail-outline" size={16} color={t.colors.text_secondary} />
              <TextInput
                testID="signup-email-input"
                style={[styles.inputText, { color: t.colors.text_primary }]}
                placeholder="you@example.com"
                placeholderTextColor={t.colors.text_tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: 14, marginBottom: 6 }]}>
              PASSWORD
            </Text>
            <View style={[styles.input, { backgroundColor: t.colors.background_tertiary }]}>
              <Ionicons name="lock-closed-outline" size={16} color={t.colors.text_secondary} />
              <TextInput
                testID="signup-password-input"
                style={[styles.inputText, { color: t.colors.text_primary }]}
                placeholder="At least 6 characters"
                placeholderTextColor={t.colors.text_tertiary}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: 14, marginBottom: 6 }]}>
              CONFIRM PASSWORD
            </Text>
            <View style={[styles.input, { backgroundColor: t.colors.background_tertiary }]}>
              <Ionicons name="lock-closed-outline" size={16} color={t.colors.text_secondary} />
              <TextInput
                testID="signup-confirm-input"
                style={[styles.inputText, { color: t.colors.text_primary }]}
                placeholder="Repeat your password"
                placeholderTextColor={t.colors.text_tertiary}
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
              />
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
                <Text
                  style={[t.typography.footnote, { color: t.colors.tone_danger, marginLeft: 6, flex: 1 }]}
                >
                  {error}
                </Text>
              </View>
            )}
            {info && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 14,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: t.colors.tone_good + "1A",
                }}
              >
                <Ionicons name="checkmark-circle" size={14} color={t.colors.tone_good} />
                <Text style={[t.typography.footnote, { color: t.colors.tone_good, marginLeft: 6, flex: 1 }]}>
                  {info}
                </Text>
              </View>
            )}

            <TouchableOpacity
              testID="signup-submit-btn"
              activeOpacity={0.8}
              disabled={loading}
              onPress={handleSignUp}
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
                {loading ? "Creating account..." : "Create account"}
              </Text>
            </TouchableOpacity>

            <View style={styles.footerRow}>
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                Already have an account?{" "}
              </Text>
              <TouchableOpacity testID="goto-login-btn" onPress={() => router.back()}>
                <Text style={[t.typography.footnote, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                  Sign in
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 20, flexGrow: 1 },
  card: { borderRadius: 22, padding: 22 },
  input: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  inputText: { flex: 1, fontSize: 16, paddingHorizontal: 8 },
  primaryBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: 18 },
});
