import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { api, dedupeIncidentsByIdPreferNewest, type Incident } from "../lib/api";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { AppHeader } from "../components/AppHeader";
import { IncidentDetailsModal } from "../components/IncidentDetailsModal";
import { toUiStatus } from "../lib/incidentStatus";
import { Screen } from "../ui/Screen";
import { Card } from "../ui/Card";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { useTabBarOverlapReserve } from "../hooks/useTabBarOverlapReserve";

const CLOSED_STATES = new Set(["CLOSED", "RESOLVED"]);

function getStatusAccent(status: string, fallbackMuted: string): string {
  const s = String(status || "").toUpperCase();
  if (s === "NEW") return "#ef4444"; // Unassigned
  if (s === "ASSIGNED") return "#f59e0b";
  if (s === "IN_PROGRESS" || s === "EN_ROUTE" || s === "ON_SCENE") return "#3b82f6";
  if (s === "RESOLVED" || s === "CLOSED") return "#22c55e";
  return fallbackMuted;
}

export function HistoryScreen() {
  const { user } = useAuthMobile();
  const { socket } = useSocketMobile();
  const [rows, setRows] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailIncident, setDetailIncident] = useState<Incident | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const tablet = width >= 768;
  const cardPad = tablet ? 14 : compact ? 10 : 12;
  const contentMaxWidth = tablet ? 860 : undefined;
  const sidePad = tablet ? 18 : compact ? 8 : 12;
  const { theme } = useAppTheme();
  const tabBarOverlapReserve = useTabBarOverlapReserve();
  const styles = useMemo(() => createHistoryStyles(theme, { compact, tablet }), [theme, compact, tablet]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const incidents = await api.getAssignedIncidents();
      setRows(incidents);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onIncidentChanged = () => {
      void load();
    };
    socket.on("incident:statusChange", onIncidentChanged);
    socket.on("incident:statusUpdate", onIncidentChanged);
    return () => {
      socket.off("incident:statusChange", onIncidentChanged);
      socket.off("incident:statusUpdate", onIncidentChanged);
    };
  }, [socket, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const openIncidentDetail = useCallback(async (inc: Incident) => {
    setDetailLoading(true);
    try {
      const full = await api.getIncident(inc.id);
      setDetailIncident(full);
    } catch {
      setDetailIncident(inc);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const historyRows = useMemo(() => {
    const uid = user?.id;
    if (!uid) return [];
    return dedupeIncidentsByIdPreferNewest(
      rows.filter((r) => {
        const s = String(r.status).toUpperCase();
        const selfReport =
          String(r.createdById ?? "") === uid && String(r.createdByRole ?? "").toLowerCase() === "responder";
        if (selfReport) return true;
        return r.assignedResponderId === uid && CLOSED_STATES.has(s);
      }),
    );
  }, [rows, user?.id]);

  return (
    <Screen style={styles.container} padded>
      <View style={[styles.contentWrap, { maxWidth: contentMaxWidth }]}>
      <AppHeader title="History" subtitle="Your reports and completed assignments" />
      {loading ? <Text style={styles.status}>Loading history...</Text> : null}
      {!loading && error ? <Text style={[styles.status, styles.error]}>{error}</Text> : null}
      {!loading && !error && historyRows.length === 0 ? (
        <Text style={styles.status}>
          No history yet. Report an incident from Task (map), or complete an assigned incident to see it here.
        </Text>
      ) : null}
      {detailLoading ? <Text style={styles.status}>Opening details...</Text> : null}
      {!loading && !error ? (
        <FlatList
          style={styles.listFlex}
          data={historyRows}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{
            paddingTop: 10,
            paddingBottom: tabBarOverlapReserve + 20,
            paddingHorizontal: sidePad,
            flexGrow: 1,
          }}
          renderItem={({ item: inc }) => {
            const statusLabel = toUiStatus(inc.status);
            const statusColor = getStatusAccent(inc.status, theme.color.lightTextMuted);
            return (
              <TouchableOpacity
                style={{ marginBottom: theme.space.md }}
                onPress={() => void openIncidentDetail(inc)}
                activeOpacity={0.85}
              >
                <Card style={[styles.card, { padding: cardPad }]}>
                  <View style={styles.rowContent}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <View style={styles.textCol}>
                      <Text style={styles.lineLabel}>Task:</Text>
                      <Text style={styles.lineValue}>{inc.title || "-"}</Text>
                      <Text style={[styles.lineLabel, styles.topGap]}>Type: <Text style={styles.lineValue}>{inc.category || "-"}</Text></Text>
                      <Text style={styles.lineLabel}>Priority: <Text style={styles.lineValue}>{inc.priority || "None"}</Text></Text>
                      <Text style={styles.lineLabel}>
                        Status: <Text style={[styles.statusValue, { color: statusColor }]}>{statusLabel}</Text>
                      </Text>
                      <Text style={styles.dateText}>{new Date(inc.updatedAt).toLocaleString()}</Text>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          }}
        />
      ) : null}
      <IncidentDetailsModal
        visible={!!detailIncident}
        incident={detailIncident}
        onClose={() => setDetailIncident(null)}
      />
      </View>
    </Screen>
  );
}

function createHistoryStyles(theme: ThemeTokens, ui: { compact: boolean; tablet: boolean }) {
  return StyleSheet.create({
  container: { flex: 1, paddingTop: 0, backgroundColor: theme.color.screenMuted },
  contentWrap: { flex: 1, width: "100%", alignSelf: "center" },
  listFlex: { flex: 1 },
  status: { textAlign: "center", color: theme.color.lightTextMuted, marginTop: 14, fontWeight: "700" },
  error: { color: theme.color.dangerTextSoft },
  card: {
    backgroundColor: theme.color.white,
    borderColor: "rgba(15,23,42,0.1)",
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowContent: { flexDirection: "row", alignItems: "center", minHeight: ui.tablet ? 118 : 104 },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    marginRight: 12,
    shadowColor: theme.color.black,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 2,
  },
  textCol: { flex: 1 },
  lineLabel: {
    color: theme.color.lightText,
    fontSize: ui.tablet ? 17 : ui.compact ? 15 : 16,
    fontWeight: "600",
    lineHeight: ui.tablet ? 22 : 20,
  },
  lineValue: { color: theme.color.lightText, fontWeight: "400" },
  topGap: { marginTop: 2 },
  statusValue: { fontWeight: "900" },
  dateText: { color: theme.color.lightTextSubtle, fontSize: ui.tablet ? 15 : 14, fontWeight: "500", marginTop: 2 },
  });
}
