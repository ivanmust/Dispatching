import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

type SocialAuthPalette = {
  socialBg: string;
  border: string;
  text: string;
};

export function SocialAuthButton(props: {
  icon: string;
  label: string;
  onPress: () => void;
  palette: SocialAuthPalette;
  accessibilityLabel: string;
}) {
  const { icon, label, onPress, palette, accessibilityLabel } = props;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.socialBtn,
        { backgroundColor: palette.socialBg, borderColor: palette.border },
        pressed ? styles.pressed : null,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.socialIcon}>{icon}</Text>
      <Text style={[styles.socialText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  socialBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  } as any,
  socialIcon: { fontSize: 16, fontWeight: "900" },
  socialText: { fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});

