import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DeviceEventEmitter, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Incident, type NotificationItem } from "../lib/api";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { AppHeader } from "../components/AppHeader";
import { IncidentDetailsModal } from "../components/IncidentDetailsModal";
import { Screen } from "../ui/Screen";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";

function dedupeNotifications(rows: NotificationItem[]): NotificationItem[] {
  const byId = new Map<string, NotificationItem>();
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

export function NotificationsScreen() {
  const navigation = useNavigation();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createNotificationsStyles(theme), [theme]);
  const showBack = navigation.canGoBack();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { socket } = useSocketMobile();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardPad = width < 380 ? 10 : 12;

  const [detailIncident, setDetailIncident] = useState<Incident | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const emitAlertsBadgeRefresh = useCallback(() => {
    DeviceEventEmitter.emit("settings:alertsBadgeRefresh");
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const rows = await api.getNotifications(100, 0);
      setItems(dedupeNotifications(rows));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load alerts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (record: NotificationItem) => {
      setItems((prev) => dedupeNotifications([record, ...prev]));
      emitAlertsBadgeRefresh();
    };
    socket.on("notification:new", onNotification);
    return () => {
      socket.off("notification:new", onNotification);
    };
  }, [socket, emitAlertsBadgeRefresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onPressNotification = useCallback(
    async (n: NotificationItem) => {
      const incidentId = String((n.metadata as any)?.incidentId ?? "");
      if (!incidentId) return;

      setDetailLoading(true);
      try {
        try {
          await api.markNotificationRead(n.id);
        } catch {
          // Non-blocking.
        }
        setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, isRead: true } : p)));
        emitAlertsBadgeRefresh();

        const full = await api.getIncident(incidentId);
        setDetailIncident(full);
      } catch {
        setDetailIncident(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [emitAlertsBadgeRefresh],
  );

  const incidentNotifications = useMemo(() => {
    return items.filter((n) => !!(n.metadata as any)?.incidentId);
  }, [items]);

  return (
    <Screen style={styles.container} padded>
      <AppHeader
        title="Alerts"
        subtitle="Responder notifications"
        rightActionLabel={showBack ? "Back" : undefined}
        onRightActionPress={showBack ? () => navigation.goBack() : undefined}
      />
      <View style={styles.actionsRow}>
        <Button
          title="Mark all read"
          variant="secondary"
          onPress={async () => {
            await api.markAllNotificationsRead();
            setItems((prev) => prev.map((p) => ({ ...p, isRead: true })));
            emitAlertsBadgeRefresh();
          }}
        />
      </View>

      {loading ? <Text style={styles.status}>Loading alerts...</Text> : null}
      {!loading && error ? <Text style={[styles.status, styles.error]}>{error}</Text> : null}
      {!loading && !error && incidentNotifications.length === 0 ? <Text style={styles.status}>No alerts.</Text> : null}
      {!loading && !error ? (
        <FlatList
          style={styles.listFlex}
          data={incidentNotifications}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12) + 28,
            flexGrow: 1,
          }}
          renderItem={({ item: n }) => (
            <TouchableOpacity
              style={{ marginBottom: theme.space.md }}
              onPress={() => void onPressNotification(n)}
              activeOpacity={0.9}
            >
              <Card style={[styles.card, !n.isRead && styles.unread, { padding: cardPad }]}>
                <Text style={styles.cardTitle}>{n.title}</Text>
                <Text style={styles.body}>{n.body}</Text>
                <Text style={styles.date}>{new Date(n.createdAt).toLocaleString()}</Text>
              </Card>
            </TouchableOpacity>
          )}
        />
      ) : null}

      <IncidentDetailsModal
        visible={!!detailIncident}
        incident={detailIncident}
        onClose={() => setDetailIncident(null)}
        initialTab="details"
        hideChat
        hideVideo
      />

      {detailLoading ? (
        <View style={styles.detailLoadingOverlay} pointerEvents="none">
          <Text style={styles.detailLoadingText}>Loading notification...</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function createNotificationsStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, paddingTop: 0, backgroundColor: theme.color.screenMuted },
    listFlex: { flex: 1 },
    actionsRow: { marginTop: 10, marginBottom: 4 },
    status: { textAlign: "center", color: theme.color.lightTextMuted, marginTop: 14, fontWeight: "700" },
    error: { color: theme.color.dangerTextSoft },
    detailLoadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.color.backdrop,
      alignItems: "center",
      justifyContent: "center",
    },
    detailLoadingText: { color: theme.color.lightText, fontWeight: "900" },
    card: { backgroundColor: theme.color.lightSurface, borderColor: theme.color.lightBorderStrong },
    unread: { borderColor: theme.color.lightPrimary, backgroundColor: theme.color.lightPrimarySoft },
    cardTitle: { fontWeight: "900", marginBottom: 6, color: theme.color.lightText },
    body: { color: theme.color.lightTextMuted, marginBottom: 10, fontWeight: "700" },
    date: { color: theme.color.lightTextSubtle, fontSize: 12, fontWeight: "700" },
    cta: { color: theme.color.lightPrimary, fontSize: 12, fontWeight: "900", marginTop: 2 },
  });
}
