import React, { useMemo } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "./theme";

export function TextField({
  label,
  error,
  containerStyle,
  ...rest
}: TextInputProps & { label?: string; error?: string | null; containerStyle?: any }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={theme.color.textSubtle}
        style={[styles.input, !!error && styles.inputError]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    wrap: { marginBottom: theme.space.md },
    label: { color: theme.color.textMuted, ...theme.text.sub, fontWeight: "800", marginBottom: 8, letterSpacing: 0.5 },
    input: {
      minHeight: 48,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.cardSolid,
      borderWidth: 1,
      borderColor: theme.color.border,
      paddingHorizontal: theme.space.md,
      color: theme.color.text,
      ...theme.text.body,
    },
    inputError: { borderColor: theme.color.danger },
    error: { marginTop: 8, color: theme.color.dangerTextSoft, ...theme.text.sub },
  });
}
