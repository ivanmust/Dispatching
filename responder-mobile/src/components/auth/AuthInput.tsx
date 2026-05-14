import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppTheme } from "../../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../../ui/theme";

type AuthInputPalette = {
  text: string;
  muted: string;
  placeholder: string;
  inputBg: string;
  inputBorder: string;
  accent: string;
};

export function AuthInput(props: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  palette: AuthInputPalette;
  accessibilityLabel: string;
  keyboardType?: "default" | "email-address";
  textContentType?: "username" | "password";
  secureTextEntry?: boolean;
  showToggle?: boolean;
  onToggleSecure?: () => void;
  secureVisible?: boolean;
}) {
  const {
    label,
    value,
    placeholder,
    onChangeText,
    onBlur,
    error,
    palette,
    accessibilityLabel,
    keyboardType,
    textContentType,
    secureTextEntry,
    showToggle,
    onToggleSecure,
    secureVisible,
  } = props;
  const { theme } = useAppTheme();
  const styles = useMemo(() => createAuthStyles(theme), [theme]);
  const hasToggle = !!showToggle && typeof onToggleSecure === "function";
  const [focused, setFocused] = React.useState(false);
  const borderColor = error ? theme.color.danger : focused ? palette.accent : palette.inputBorder;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      {hasToggle ? (
        <View
          style={[
            styles.passwordRow,
            {
              backgroundColor: palette.inputBg,
              borderColor,
            },
          ]}
        >
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            placeholder={placeholder}
            placeholderTextColor={palette.placeholder}
            secureTextEntry={secureTextEntry}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={textContentType}
            style={[styles.passwordInput, { color: palette.text }]}
            accessibilityLabel={accessibilityLabel}
          />
          <Pressable
            onPress={onToggleSecure}
            style={({ pressed }) => [styles.passwordToggle, pressed ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityLabel={secureVisible ? "Hide password" : "Show password"}
          >
            <Text style={[styles.passwordToggleText, { color: palette.accent }]}>{secureVisible ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          placeholder={placeholder}
          placeholderTextColor={palette.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType}
          textContentType={textContentType}
          style={[styles.input, { backgroundColor: palette.inputBg, borderColor, color: palette.text }]}
          accessibilityLabel={accessibilityLabel}
        />
      )}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function createAuthStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { marginBottom: 10 },
    label: { ...theme.text.sub, marginBottom: 6, letterSpacing: 0.25, fontSize: 11, fontWeight: "800" },
    input: {
      minHeight: 48,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      paddingHorizontal: 14,
      ...theme.text.sub,
      fontSize: 13,
    },
    passwordRow: {
      minHeight: 48,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 12,
      paddingRight: theme.space.sm,
    },
    passwordInput: { flex: 1, ...theme.text.sub, fontSize: 13, paddingVertical: 0 },
    passwordToggle: { minWidth: 48, minHeight: 34, borderRadius: theme.radius.sm, alignItems: "center", justifyContent: "center" },
    passwordToggleText: { ...theme.text.sub, fontWeight: "800", fontSize: 12 },
    fieldError: { marginTop: 4, color: theme.color.dangerTextSoft, ...theme.text.sub, fontSize: 11 },
    pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  });
}
