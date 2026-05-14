import React, { useMemo } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  /**
   * Socket connection state. Accepted for backwards compatibility but no longer
   * rendered in the UI.
   */
  connected?: boolean;
  available?: boolean;
  onToggleAvailable?: (value: boolean) => void;
  rightActionLabel?: string;
  onRightActionPress?: () => void;
};

export function AppHeader({
  title,
  subtitle,
  available,
  onToggleAvailable,
  rightActionLabel,
  onRightActionPress,
}: AppHeaderProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const compact = width < 430;
  const hasRight =
    (typeof available === "boolean" && !!onToggleAvailable) || (!!rightActionLabel && !!onRightActionPress);

  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.left}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {hasRight ? (
        <View style={[styles.right, compact && styles.rightCompact]}>
          {typeof available === "boolean" && onToggleAvailable ? (
            <View style={styles.availability}>
              <Text style={styles.availabilityText}>{available ? "Available" : "Busy"}</Text>
              <Switch
                value={available}
                onValueChange={onToggleAvailable}
                trackColor={{ false: theme.color.borderStrong, true: theme.color.primarySoftStrong }}
                thumbColor={available ? theme.color.primary2 : theme.color.text}
              />
            </View>
          ) : null}
          {rightActionLabel && onRightActionPress ? (
            <TouchableOpacity onPress={onRightActionPress} style={styles.actionBtn} activeOpacity={0.85}>
              <Text style={styles.actionText}>{rightActionLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    header: {
      paddingTop: 6,
      paddingBottom: 14,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.color.screenMuted,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.lightBorderStrong,
      gap: 10,
    },
    headerCompact: { flexDirection: "column", alignItems: "flex-start", gap: 10 } as any,
    left: { flexShrink: 1, alignSelf: "stretch" },
    title: { fontSize: 22, fontWeight: "900", color: theme.color.text, letterSpacing: -0.35 },
    subtitle: { fontSize: 11, color: theme.color.textMuted, marginTop: 3, fontWeight: "700", letterSpacing: 0.15 },
    right: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 16, flexWrap: "wrap" } as any,
    rightCompact: { alignSelf: "stretch", justifyContent: "space-between" },
    availability: { flexDirection: "row", alignItems: "center", gap: 6 } as any,
    availabilityText: { fontSize: 11, color: theme.color.textMuted, fontWeight: "800" },
    actionBtn: {
      minHeight: 40,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.card,
      borderWidth: 1,
      borderColor: theme.color.border,
      shadowColor: "#0f172a",
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    actionText: { fontSize: 12, color: theme.color.text, fontWeight: "800" },
  });
}
