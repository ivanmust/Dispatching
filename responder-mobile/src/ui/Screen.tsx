import React, { useMemo } from "react";
import { Platform, StatusBar, StyleSheet, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../contexts/ThemePreferenceContext";

export function Screen({
  children,
  style,
  padded = true,
  ...rest
}: ViewProps & { padded?: boolean }) {
  const { theme, isDark } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: theme.color.screenMuted },
        root: { flex: 1, backgroundColor: theme.color.screenMuted },
        padded: { paddingHorizontal: theme.space.lg },
      }),
    [theme],
  );

  return (
    <SafeAreaView style={styles.safe}>
      {Platform.OS !== "web" ? (
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.color.bg} />
      ) : null}
      <View style={[styles.root, padded && styles.padded, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}
