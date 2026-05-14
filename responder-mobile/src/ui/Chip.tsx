import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "./theme";

export function Chip({
  label,
  selected,
  ...rest
}: PressableProps & {
  label: string;
  selected?: boolean;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : null,
        pressed ? { opacity: 0.92, transform: [{ scale: 0.99 }] } : null,
      ]}
      {...rest}
    >
      <Text style={[styles.text, selected ? styles.textSelected : null]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    base: {
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.card,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: theme.radius.pill,
    },
    selected: { backgroundColor: theme.color.primarySoft, borderColor: theme.color.primarySoftStrong },
    text: { color: theme.color.textMuted, fontSize: 12, fontWeight: "800" },
    textSelected: { color: theme.color.text },
  });
}
