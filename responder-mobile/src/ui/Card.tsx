import React, { useMemo } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useAppTheme } from "../contexts/ThemePreferenceContext";

export function Card({ style, ...rest }: ViewProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: theme.color.card,
          borderWidth: 1,
          borderColor: theme.color.lightBorder,
          borderRadius: theme.radius.md,
          padding: theme.space.lg,
          ...theme.shadow.card,
        },
      }),
    [theme],
  );
  return <View style={[styles.card, style]} {...rest} />;
}
