import type { CompositeNavigationProp } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { AppHeader } from "../components/AppHeader";
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import { api } from "../lib/api";
import type { MainTabParamList, RootStackParamList } from "../navigation/types";
import { Screen } from "../ui/Screen";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import type { ThemeTokens } from "../ui/theme";
import { useTabBarOverlapReserve } from "../hooks/useTabBarOverlapReserve";

type SettingsNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, "Settings">,
  NativeStackNavigationProp<RootStackParamList>
>;

export function SettingsScreen() {
  const navigation = useNavigation<SettingsNav>();
  const { user, logout } = useAuthMobile();
  const { theme, isDark, setDarkMode } = useAppTheme();
  const tabBarOverlapReserve = useTabBarOverlapReserve();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const tablet = width >= 768;
  const contentMaxWidth = tablet ? 760 : 560;
  const sidePad = tablet ? 18 : compact ? 10 : 14;
  const styles = useMemo(() => createSettingsStyles(theme, { compact, tablet }), [theme, compact, tablet]);

  const [alertsUnread, setAlertsUnread] = useState(0);

  const refreshAlerts = useCallback(async () => {
    try {
      const { count } = await api.getUnreadNotificationCount();
      setAlertsUnread(Number(count ?? 0));
    } catch {
      setAlertsUnread(0);
    }
  }, []);

  useEffect(() => {
    void refreshAlerts();
  }, [refreshAlerts]);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => void refreshAlerts());
    return unsub;
  }, [navigation, refreshAlerts]);

  const usernameDisplay = user?.username?.trim() || user?.name?.trim() || "—";

  return (
    <Screen style={styles.container} padded>
      <AppHeader title="Settings" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: tabBarOverlapReserve + theme.space.xl, paddingHorizontal: sidePad }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.contentWrap, { maxWidth: contentMaxWidth }]}>
          <Card style={styles.card}>
            <Text style={styles.rowLabel}>Username</Text>
            <Text style={styles.rowValue}>{usernameDisplay}</Text>
          </Card>

          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.toggleLabel}>Dark mode</Text>
              <Switch
                value={isDark}
                onValueChange={(v) => void setDarkMode(v)}
                trackColor={{ false: theme.color.borderStrong, true: theme.color.primarySoftStrong }}
                thumbColor={isDark ? theme.color.primary2 : theme.color.text}
              />
            </View>
          </Card>

          <Pressable
            style={({ pressed }) => [styles.alertsRow, pressed && styles.alertsRowPressed]}
            onPress={() => navigation.navigate("Alerts")}
          >
            <Card style={styles.cardFlat}>
              <View style={styles.rowBetween}>
                <Text style={styles.toggleLabel}>Alerts</Text>
                {alertsUnread > 0 ? (
                  <View style={styles.alertsBadge}>
                    <Text style={styles.alertsBadgeText}>{alertsUnread > 99 ? "99+" : alertsUnread}</Text>
                  </View>
                ) : null}
              </View>
            </Card>
          </Pressable>

          <Button title="Log out" variant="danger" style={styles.logoutBtn} onPress={() => void logout()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function createSettingsStyles(theme: ThemeTokens, ui: { compact: boolean; tablet: boolean }) {
  return StyleSheet.create({
    container: { flex: 1, paddingTop: 0, backgroundColor: theme.color.screenMuted },
    scroll: { flex: 1 },
    contentWrap: { width: "100%", alignSelf: "center" },
    card: {
      marginBottom: theme.space.md,
      backgroundColor: theme.color.card,
      borderColor: theme.color.border,
    },
    cardFlat: {
      marginBottom: 0,
      backgroundColor: theme.color.card,
      borderColor: theme.color.border,
      shadowOpacity: 0,
      elevation: 0,
    },
    rowLabel: { ...theme.text.sub, color: theme.color.textMuted, fontWeight: "800", marginBottom: 6, fontSize: ui.tablet ? 13 : 12 },
    rowValue: { ...theme.text.body, color: theme.color.text, fontWeight: "900", fontSize: ui.tablet ? 18 : ui.compact ? 15 : 16 },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    toggleLabel: { ...theme.text.body, color: theme.color.text, fontWeight: "800", flex: 1, fontSize: ui.tablet ? 16 : 14 },
    alertsRow: { marginBottom: theme.space.md },
    alertsRowPressed: { opacity: 0.92 },
    alertsBadge: {
      minWidth: ui.tablet ? 26 : 22,
      height: ui.tablet ? 22 : 20,
      paddingHorizontal: 7,
      borderRadius: ui.tablet ? 11 : 10,
      backgroundColor: theme.color.danger,
      alignItems: "center",
      justifyContent: "center",
    },
    alertsBadgeText: { color: theme.color.white, fontSize: ui.tablet ? 12 : 11, fontWeight: "900" },
    logoutBtn: { marginTop: theme.space.sm, minHeight: ui.tablet ? 48 : undefined },
  });
}
