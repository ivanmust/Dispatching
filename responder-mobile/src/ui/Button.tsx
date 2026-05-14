import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "./theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  variant = "primary",
  loading,
  disabled,
  style,
  ...rest
}: PressableProps & {
  title: string;
  variant?: Variant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const variantStyles = useMemo(
    () =>
      ({
        primary: { backgroundColor: theme.color.primary, ...theme.shadow.button },
        secondary: { backgroundColor: theme.color.cardSolid, borderWidth: 1, borderColor: theme.color.border },
        danger: { backgroundColor: theme.color.danger },
        ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.color.border },
      }) satisfies Record<Variant, ViewStyle>,
    [theme],
  );
  const textVariantStyles = useMemo(
    () =>
      ({
        primary: { color: theme.color.white },
        secondary: { color: theme.color.text },
        danger: { color: theme.color.white },
        ghost: { color: theme.color.text },
      }) satisfies Record<Variant, { color: string }>,
    [theme],
  );

  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" || variant === "ghost" ? theme.color.text : theme.color.white} />
      ) : null}
      <Text style={[styles.text, textVariantStyles[variant]]}>{title}</Text>
    </Pressable>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    base: {
      minHeight: 56,
      paddingHorizontal: theme.space.xl,
      borderRadius: theme.radius.lg,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 10,
    },
    pressed: { transform: [{ scale: 0.985 }] },
    disabled: { opacity: 0.58 },
    text: { fontSize: 15, fontWeight: "800", letterSpacing: 0.25 },
  });
}
