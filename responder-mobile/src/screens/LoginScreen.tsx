import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import { Screen } from "../ui/Screen";
import { Button } from "../ui/Button";
import { AuthInput } from "../components/auth/AuthInput";
import type { ThemeTokens } from "../ui/theme";

export function LoginScreen() {
  const { login, loading } = useAuthMobile();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useAppTheme();
  const styles = useMemo(() => createLoginStyles(theme), [theme]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterTranslateY = useRef(new Animated.Value(14)).current;

  const palette = useMemo(
    () =>
      isDark
        ? {
            bg: theme.color.screenMuted,
            card: theme.color.surface,
            border: theme.color.borderStrong,
            text: theme.color.text,
            muted: theme.color.textMuted,
            subtle: theme.color.textSubtle,
            inputBg: theme.color.cardSolid,
            inputBorder: theme.color.border,
            placeholder: theme.color.textSubtle,
            accent: theme.color.primary2,
            accentSoft: theme.color.primarySoft,
            cta: theme.color.primary,
          }
        : {
            bg: "#e5e7eb",
            card: "#ffffff",
            border: "#d1d5db",
            text: "#0f172a",
            muted: "#64748b",
            subtle: "#64748b",
            inputBg: "#f1f5f9",
            inputBorder: "#cbd5e1",
            placeholder: "#94a3b8",
            accent: "#1d4f9e",
            accentSoft: "rgba(29,79,158,0.12)",
            cta: "#1d4f9e",
          },
    [isDark, theme],
  );

  const usernameTrimmed = username.trim();
  const usernameLooksLikeEmail = usernameTrimmed.includes("@");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const usernameError =
    usernameTouched && !usernameTrimmed
      ? "Email or username is required."
      : usernameTouched && usernameLooksLikeEmail && !emailRegex.test(usernameTrimmed)
        ? "Enter a valid email address."
        : null;
  const passwordError = passwordTouched && !password ? "Password is required." : null;
  const isFormValid = !!usernameTrimmed && !!password && !usernameError;
  const isBusy = submitting || loading;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(enterTranslateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [enterOpacity, enterTranslateY]);

  const onSubmit = async () => {
    setError(null);
    setUsernameTouched(true);
    setPasswordTouched(true);
    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setSubmitting(true);
    try {
      const ok = await login(usernameTrimmed, password);
      if (!ok) {
        Alert.alert("Login failed", "Invalid credentials or not a responder account.");
        return;
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen style={[styles.container, { backgroundColor: palette.bg }]} padded={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kb}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: theme.space.xl + Math.max(insets.bottom, 14) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.card,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                shadowOpacity: isDark ? 0.22 : 0.08,
                opacity: enterOpacity,
                transform: [{ translateY: enterTranslateY }],
              },
            ]}
          >
            <View style={styles.hero}>
              <View style={[styles.brandIcon, { backgroundColor: palette.accent }]}>
                <Text style={styles.brandIconText}>🛡</Text>
              </View>
              <Text style={[styles.title, { color: palette.text }]}>Responder</Text>
              <Text style={[styles.subtitle, { color: palette.muted }]}>Sign in to your responder account</Text>
            </View>

            <View style={styles.formArea}>
              <AuthInput
                label="Email"
                value={username}
                onChangeText={(v) => {
                  setUsername(v);
                  if (error) setError(null);
                }}
                onBlur={() => setUsernameTouched(true)}
                placeholder="you@example.com"
                keyboardType="email-address"
                textContentType="username"
                error={usernameError}
                palette={palette}
                accessibilityLabel="Email or username"
              />

              <AuthInput
                label="Password"
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (error) setError(null);
                }}
                onBlur={() => setPasswordTouched(true)}
                placeholder="••••••••"
                textContentType="password"
                secureTextEntry={!passwordVisible}
                showToggle
                onToggleSecure={() => setPasswordVisible((prev) => !prev)}
                secureVisible={passwordVisible}
                error={passwordError}
                palette={palette}
                accessibilityLabel="Password"
              />
            </View>

            {!!error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title={isBusy ? "Signing in..." : "Sign in"}
              onPress={onSubmit}
              disabled={!isFormValid || isBusy}
              loading={isBusy}
              style={[styles.signInBtn, { backgroundColor: palette.cta }]}
            />
          </Animated.View>
          <Text style={[styles.footer, { color: palette.subtle }]}>Responder sign-in only.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function createLoginStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1 },
    kb: { flex: 1 },
    scroll: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 18,
      paddingVertical: theme.space.xl,
    },
    card: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 26,
      paddingVertical: 28,
      ...theme.shadow.card,
      maxWidth: 460,
      width: "100%",
      alignSelf: "center",
    },
    hero: { marginBottom: 18, alignItems: "center" },
    brandIcon: {
      width: 52,
      height: 52,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    brandIconText: { color: theme.color.white, fontSize: 22 },
    title: { textAlign: "center", fontSize: 34, fontWeight: "800" },
    subtitle: { marginTop: 6, fontSize: 14, fontWeight: "500", textAlign: "center", lineHeight: 18, maxWidth: 250 },
    formArea: { marginBottom: 8 },
    error: { color: theme.color.dangerTextSoft, marginBottom: 10, textAlign: "center", ...theme.text.sub, fontSize: 11 },
    signInBtn: { marginTop: 8, borderRadius: theme.radius.lg, minHeight: 52 },
    footer: { marginTop: 16, textAlign: "center", ...theme.text.sub, fontSize: 11 },
  });
}
