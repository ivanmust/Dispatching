import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  api,
  dedupeIncidentsByIdPreferNewest,
  incidentDedupeKey,
  type Geofence,
  type Incident,
  type PointOfInterest,
  type ResponderListItem,
} from "../lib/api";
type MapLocationSample = {
  lat: number;
  lon: number;
  timestampMs: number;
  speedMps: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
};
import { useAuthMobile } from "../contexts/AuthContextMobile";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { IncidentDetailsModal } from "../components/IncidentDetailsModal";
import { CreateIncidentModal } from "../components/CreateIncidentModal";
import { ResponderMapWebView } from "../components/ResponderMapWebView";
import { canAcceptIncident, canCompleteIncident, canRejectIncident, toUiStatus } from "../lib/incidentStatus";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import { Screen } from "../ui/Screen";
import type { ThemeTokens } from "../ui/theme";
import { useTabBarOverlapReserve } from "../hooks/useTabBarOverlapReserve";

function userInitials(name?: string | null): string {
  const n = String(name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

/**
 * Responder home screen.
 *
 * Map-only build: turn-by-turn navigation, ETA, and route polylines have been removed
 * intentionally so they can be re-implemented on top of ArcGIS Enterprise. This screen
 * shows the incident list, accept/reject/complete actions, the create-incident flow,
 * and a live Esri Rwanda map with dispatcher-parity overlays (incidents, fleet, POI,
 * geofences). It does NOT call POST /api/route or listen for `incident:etaUpdate`.
 */
export function ResponderHomeScreen({ route, navigation }: { route?: any; navigation?: any }) {
  const { user } = useAuthMobile();
  const { socket, connected } = useSocketMobile();
  const insets = useSafeAreaInsets();
  const tabBarOverlapReserve = useTabBarOverlapReserve();
  const { width, height } = useWindowDimensions();
  const compact = width < 390;
  const tablet = width >= 768;
  const ui = useMemo(
    () => ({
      compact,
      tablet,
      fabSize: tablet ? 70 : compact ? 54 : 62,
      fabIconSize: tablet ? 30 : compact ? 22 : 26,
      avatarSize: tablet ? 62 : compact ? 50 : 56,
      avatarTextSize: tablet ? 20 : compact ? 16 : 18,
      topInsetOffset: tablet ? 8 : 4,
      sideInset: tablet ? 20 : 14,
      sheetInset: tablet ? Math.max(18, Math.floor((width - 860) / 2)) : 0,
      listMaxHeight: tablet ? Math.max(280, Math.floor(height * 0.34)) : Math.max(220, Math.floor(height * 0.28)),
    }),
    [compact, tablet, width, height],
  );

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [createIncidentOpen, setCreateIncidentOpen] = useState(false);
  const [myCoords, setMyCoords] = useState<MapLocationSample | null>(null);
  const lastLocationSyncRef = useRef(0);
  const openedIncidentRef = useRef<string | null>(null);
  const [gpsRecenterNonce, setGpsRecenterNonce] = useState(0);
  const [mapPerspectiveMode] = useState<"default" | "satellite">("satellite");
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);
  const [mapGeofences, setMapGeofences] = useState<Geofence[]>([]);
  const [fleet, setFleet] = useState<ResponderListItem[]>([]);
  const [fleetLocations, setFleetLocations] = useState<Record<string, { lat: number; lon: number }>>({});
  const [fleetAvailability, setFleetAvailability] = useState<Record<string, boolean>>({});
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createResponderHomeStyles(theme, ui), [theme, ui]);

  const incidentsUnique = useMemo(() => dedupeIncidentsByIdPreferNewest(incidents), [incidents]);

  const horizontalPad = compact ? 8 : tablet ? 14 : 12;
  // ---------- Incident list ----------

  const loadIncidents = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.getAssignedIncidents();
      setIncidents(data);
      DeviceEventEmitter.emit("tasks:badgeRefresh");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load incidents.");
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadIncidents();
    } finally {
      setRefreshing(false);
    }
  }, [loadIncidents]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  useFocusEffect(
    useCallback(() => {
      setOverlayExpanded(true);
    }, []),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("tasks:toggleIncidentList", () => {
      setOverlayExpanded((v) => !v);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void loadIncidents();
    }, 8000);
    return () => clearInterval(id);
  }, [loadIncidents]);

  const loadMapContext = useCallback(async () => {
    await Promise.all([
      api.getResponders().then((rows) => setFleet(rows)).catch(() => {}),
      api.getPointsOfInterest().then((rows) => setPointsOfInterest(rows)).catch(() => {}),
      api.getGeofences().then((rows) => setMapGeofences(rows)).catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    void loadMapContext();
  }, [loadMapContext]);

  useEffect(() => {
    const id = setInterval(() => {
      void loadMapContext();
    }, 30000);
    return () => clearInterval(id);
  }, [loadMapContext]);

  // ---------- Sockets ----------

  useEffect(() => {
    if (!socket || !user?.id) return;
    socket.emit("responder:availability", { responderId: user.id, available });
  }, [socket, user?.id, available]);

  useEffect(() => {
    if (!socket) return;
    const onAssigned = () => {
      setAvailable(false);
      void loadIncidents();
    };
    const onNowAvailable = () => setAvailable(true);
    const reloadIncidents = () => void loadIncidents();
    const onResponderLocation = (data: { responderId: string; lat: number; lon: number }) => {
      if (!data?.responderId || typeof data.lat !== "number" || typeof data.lon !== "number") return;
      setFleetLocations((prev) => ({ ...prev, [data.responderId]: { lat: data.lat, lon: data.lon } }));
    };
    const onResponderAvailability = (data: { responderId: string; available: boolean }) => {
      if (!data?.responderId) return;
      setFleetAvailability((prev) => ({ ...prev, [data.responderId]: !!data.available }));
    };
    socket.on("incident:assigned", onAssigned);
    socket.on("responder:nowAvailable", onNowAvailable);
    socket.on("incident:statusChange", reloadIncidents);
    socket.on("incident:statusUpdate", reloadIncidents);
    socket.on("incident:updated", reloadIncidents);
    socket.on("incident:unassigned", reloadIncidents);
    socket.on("responder:location", onResponderLocation);
    socket.on("responder:availability", onResponderAvailability);
    return () => {
      socket.off("incident:assigned", onAssigned);
      socket.off("responder:nowAvailable", onNowAvailable);
      socket.off("incident:statusChange", reloadIncidents);
      socket.off("incident:statusUpdate", reloadIncidents);
      socket.off("incident:updated", reloadIncidents);
      socket.off("incident:unassigned", reloadIncidents);
      socket.off("responder:location", onResponderLocation);
      socket.off("responder:availability", onResponderAvailability);
    };
  }, [socket, loadIncidents]);

  // ---------- GPS ----------

  // The map WebView already requests its own GPS for live location rendering. We keep
  // a parallel coarse subscription here so (a) CreateIncidentModal can pre-fill the
  // reporter's coordinates and (b) the dispatcher's "responder location" view stays
  // up to date even when the user is on a screen that hides the map.
  useEffect(() => {
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || !mounted) return;
        const current = await Location.getCurrentPositionAsync({});
        if (mounted) {
          setMyCoords({
            lat: current.coords.latitude,
            lon: current.coords.longitude,
            timestampMs: typeof (current as any).timestamp === "number" ? (current as any).timestamp : Date.now(),
            speedMps: typeof current.coords.speed === "number" ? current.coords.speed : null,
            headingDegrees: typeof current.coords.heading === "number" ? current.coords.heading : null,
            accuracyMeters: typeof current.coords.accuracy === "number" ? current.coords.accuracy : null,
          });
        }
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 10 },
          (pos) => {
        if (!mounted) return;
            const next: MapLocationSample = {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              timestampMs: typeof pos.timestamp === "number" ? pos.timestamp : Date.now(),
              speedMps: typeof pos.coords.speed === "number" ? pos.coords.speed : null,
              headingDegrees: typeof pos.coords.heading === "number" ? pos.coords.heading : null,
              accuracyMeters: typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
            };
            setMyCoords(next);
            const now = Date.now();
            if (now - lastLocationSyncRef.current < 4000) return;
            lastLocationSyncRef.current = now;
            void api.updateLocation(next.lat, next.lon).catch(() => {});
          },
        );
      } catch {
        /* permission denied or hardware error: silently fall back */
      }
    })();
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  // ---------- Deep-link: open an incident from a route param ----------

  useEffect(() => {
    const openIncidentId = route?.params?.openIncidentId as string | undefined;
    if (!openIncidentId || openedIncidentRef.current === openIncidentId) return;
    openedIncidentRef.current = openIncidentId;
    void (async () => {
      try {
        const latest = await api.getAssignedIncidents();
        setIncidents(latest);
        const hit = latest.find((i) => incidentDedupeKey(i.id) === incidentDedupeKey(openIncidentId));
        if (hit) {
          setSelectedIncident(hit);
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const incident = await api.getIncident(openIncidentId);
        setSelectedIncident(incident);
      } catch {
        /* no access */
      }
    })();
  }, [route?.params?.openIncidentId]);

  // ---------- Actions ----------

  const accept = useCallback(
    async (id: string) => {
      try {
        await api.acceptAssignedIncident(id);
        await loadIncidents();
      } catch (e: any) {
        Alert.alert("Accept failed", e?.message ?? "Try again.");
      }
    },
    [loadIncidents],
  );

  const reject = useCallback(
    (id: string) => {
      Alert.alert(
        "Reject incident",
        "Reject this assigned incident?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reject",
            style: "destructive",
            onPress: async () => {
              try {
                await api.rejectAssignedIncident(id);
                await loadIncidents();
              } catch (e: any) {
                Alert.alert("Reject failed", e?.message ?? "Try again.");
              }
            },
          },
        ],
        { cancelable: true },
      );
    },
    [loadIncidents],
  );

  const complete = useCallback(
    (id: string) => {
      Alert.alert(
        "Complete incident",
        "Mark this incident as complete?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Complete",
            style: "default",
            onPress: async () => {
              try {
                await api.completeAssignedIncident(id);
                await loadIncidents();
              } catch (e: any) {
                Alert.alert("Complete failed", e?.message ?? "Try again.");
              }
            },
          },
        ],
        { cancelable: true },
      );
    },
    [loadIncidents],
  );

  // ---------- Derived data ----------

  const activeIncidents = useMemo(() => {
    return incidentsUnique.filter((i) => {
      const s = String(i.status).toUpperCase();
      return (
        s === "ASSIGNED" ||
        s === "IN_PROGRESS" ||
        s === "EN_ROUTE" ||
        s === "ON_SCENE" ||
        s === "RESOLVED" ||
        s === "CLOSED"
      );
    });
  }, [incidentsUnique]);

  const pendingOwnReports = useMemo(() => {
    const uid = user?.id;
    if (!uid) return [];
    return incidentsUnique.filter((i) => {
      const s = String(i.status).toUpperCase();
      const selfReport =
        String(i.createdById ?? "") === uid && String(i.createdByRole ?? "").toLowerCase() === "responder";
      return selfReport && s === "NEW" && !i.assignedResponderId;
    });
  }, [incidentsUnique, user?.id]);

  const openToolsMenu = useCallback(() => {
    Alert.alert(
      "Tools",
      `${activeIncidents.length} active incident${activeIncidents.length === 1 ? "" : "s"}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report incident",
          onPress: () => setCreateIncidentOpen(true),
        },
        {
          text: overlayExpanded ? "Hide incident list" : "Show incident list",
          onPress: () => setOverlayExpanded((v) => !v),
        },
        {
          text: available ? "Set busy" : "Set available",
          onPress: () => setAvailable((v) => !v),
        },
      ],
      { cancelable: true },
    );
  }, [activeIncidents.length, available, overlayExpanded]);

  const openMapForIncident = useCallback((inc: Incident) => {
    const lat = Number(inc.location?.lat);
    const lon = Number(inc.location?.lon);
    navigation?.navigate?.("IncidentMap", {
      incidentId: inc.id,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      title: inc.title,
    });
  }, [navigation]);

  const openDirectionsFromCompass = useCallback(() => {
    const hasCoords = (inc: Incident | null | undefined) =>
      !!inc && Number.isFinite(Number(inc.location?.lat)) && Number.isFinite(Number(inc.location?.lon));
    const distanceMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const R = 6_371_000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    };
    const statusRank = (status: Incident["status"]) => {
      const s = String(status).toUpperCase();
      if (s === "IN_PROGRESS" || s === "ON_SCENE") return 0;
      if (s === "EN_ROUTE") return 1;
      if (s === "ASSIGNED") return 2;
      if (s === "NEW") return 3;
      if (s === "RESOLVED") return 4;
      if (s === "CLOSED") return 5;
      return 6;
    };

    if (hasCoords(selectedIncident)) {
      openMapForIncident(selectedIncident as Incident);
      return;
    }

    const candidates = activeIncidents.filter((inc) => hasCoords(inc));
    if (!candidates.length) {
      Alert.alert("No destination", "Pick an incident with a valid map location to show directions.");
      return;
    }

    let fallback: Incident | undefined;
    if (myCoords && Number.isFinite(myCoords.lat) && Number.isFinite(myCoords.lon)) {
      const origin = { lat: myCoords.lat, lon: myCoords.lon };
      fallback = [...candidates].sort((a, b) => {
        const aLoc = { lat: Number(a.location?.lat), lon: Number(a.location?.lon) };
        const bLoc = { lat: Number(b.location?.lat), lon: Number(b.location?.lon) };
        const byStatus = statusRank(a.status) - statusRank(b.status);
        if (byStatus !== 0) return byStatus;
        return distanceMeters(origin, aLoc) - distanceMeters(origin, bLoc);
      })[0];
    } else {
      fallback = [...candidates].sort((a, b) => statusRank(a.status) - statusRank(b.status))[0];
    }

    if (fallback) {
      openMapForIncident(fallback);
      return;
    }

    Alert.alert("No destination", "Pick an incident with a valid map location to show directions.");
  }, [activeIncidents, myCoords, openMapForIncident, selectedIncident]);

  const incidentPins = useMemo(
    () =>
      incidentsUnique
        .filter((inc) => Number.isFinite(inc.location?.lat) && Number.isFinite(inc.location?.lon))
        .map((inc) => ({
          id: inc.id,
          lat: inc.location.lat,
          lon: inc.location.lon,
          status: inc.status,
          title: inc.title,
          priority: inc.priority,
          category: inc.category,
        })),
    [incidentsUnique]
  );

  const fleetMarkers = useMemo(() => {
    return fleet
      .filter((r) => r && r.id)
      .map((r) => {
        const loc = fleetLocations[r.id];
        const isAvailable =
          r.id in fleetAvailability
            ? fleetAvailability[r.id]
            : String(r.status).toUpperCase() !== "BUSY" && String(r.status).toUpperCase() !== "OFF_DUTY";
        return loc ? { id: r.id, name: r.name, lat: loc.lat, lon: loc.lon, available: isAvailable } : null;
      })
      .filter((m): m is { id: string; name: string; lat: number; lon: number; available: boolean } => m !== null);
  }, [fleet, fleetLocations, fleetAvailability]);

  // ---------- Render ----------

    return (
    <Screen style={styles.root} padded={false}>
      <View style={styles.mapFull}>
        <ResponderMapWebView
          mapPerspectiveMode={mapPerspectiveMode}
          embedMapControls={false}
          floatingZoomControls={false}
          incidentPins={incidentPins}
          selectedIncidentId={selectedIncident?.id ?? null}
          responders={fleetMarkers}
          pointsOfInterest={pointsOfInterest}
          geofences={mapGeofences.map((gf) => ({ id: gf.id, name: gf.name, geometry: gf.geometry }))}
          gpsRecenterNonce={gpsRecenterNonce}
          onIncidentPinPress={(id) => {
            const hit = incidentsUnique.find((i) => incidentDedupeKey(i.id) === incidentDedupeKey(id));
            if (hit) setSelectedIncident(hit);
          }}
        />
      </View>

      <View style={[styles.topRightColumn, { top: Math.max(insets.top, 10) + ui.topInsetOffset, right: ui.sideInset }]}>
        <View style={styles.avatarCluster}>
          <TouchableOpacity
            style={styles.avatarCircle}
            activeOpacity={0.92}
            onPress={() => {
              const sub = [user?.callsign ? `Callsign ${user.callsign}` : null, user?.unit ? `Unit ${user.unit}` : null]
                .filter(Boolean)
                .join(" · ");
              Alert.alert(user?.name ?? "Responder", sub || "Responder profile", [{ text: "OK" }]);
            }}
          >
            <Text style={styles.avatarInitials}>{userInitials(user?.name)}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.circleFab} activeOpacity={0.9} onPress={openDirectionsFromCompass}>
          <Ionicons name="compass" size={ui.fabIconSize} color={theme.color.lightPrimary} />
        </TouchableOpacity>
      </View>

      <View style={[styles.mapFabStack, { bottom: tabBarOverlapReserve + (tablet ? 16 : 12), right: ui.sideInset }]}>
        <TouchableOpacity style={styles.circleFab} activeOpacity={0.9} onPress={openToolsMenu}>
          <Ionicons name="construct-outline" size={ui.fabIconSize} color={theme.color.lightPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.circleFab} activeOpacity={0.9} onPress={() => setGpsRecenterNonce((n) => n + 1)}>
          <Ionicons name="navigate" size={ui.fabIconSize} color={theme.color.lightPrimary} />
        </TouchableOpacity>
      </View>

      {overlayExpanded ? (
        <View style={[styles.bottomSheetWrap, { paddingBottom: tabBarOverlapReserve, left: ui.sheetInset, right: ui.sheetInset }]}>
          <View style={styles.bottomSheetShelf}>
            <TouchableOpacity
              style={styles.sheetHandleButton}
              activeOpacity={0.85}
              onPress={() => setOverlayExpanded(false)}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHandleRow}>
                {loading ? <ActivityIndicator size="small" color={theme.color.lightPrimary} /> : null}
                <Text style={styles.sheetHandleLabel}>Incident list · {activeIncidents.length}</Text>
              </View>
            </TouchableOpacity>

            {!loading && error ? <Text style={[styles.overlayHint, styles.overlayHintError]}>{error}</Text> : null}

            {!loading && !error && (pendingOwnReports.length > 0 || activeIncidents.length > 0) ? (
              <View style={[styles.listPanel, { marginHorizontal: 8 }]}>
                <ScrollView
                  style={[styles.minimalList, { maxHeight: ui.listMaxHeight }]}
                  contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8 }}
                >
                  {pendingOwnReports.map((inc) => (
                    <TouchableOpacity key={inc.id} style={styles.minimalItem} onPress={() => setSelectedIncident(inc)} activeOpacity={0.9}>
                      <View style={styles.minimalItemHead}>
                        <Text style={styles.minimalStatus}>{toUiStatus(inc.status)}</Text>
                        <Text style={styles.minimalPriority}>{String(inc.priority).toUpperCase()}</Text>
                      </View>
                      <Text style={styles.minimalTitle} numberOfLines={1}>{inc.title}</Text>
                    </TouchableOpacity>
                  ))}
                  {activeIncidents.map((inc) => (
                    <View key={inc.id} style={styles.minimalItem}>
                      <Pressable onPress={() => setSelectedIncident(inc)}>
                        <View style={styles.minimalItemHead}>
                          <Text style={styles.minimalStatus}>{toUiStatus(inc.status)}</Text>
                          <Text style={styles.minimalPriority}>{String(inc.priority).toUpperCase()}</Text>
                        </View>
                        <Text style={styles.minimalTitle} numberOfLines={1}>{inc.title}</Text>
                      </Pressable>
                      <View style={styles.minimalActions}>
                        {canAcceptIncident(inc.status) ? (
                          <TouchableOpacity style={styles.actionPill} onPress={() => accept(inc.id)}><Text style={styles.actionPillText}>Accept</Text></TouchableOpacity>
                        ) : null}
                        {canRejectIncident(inc.status) ? (
                          <TouchableOpacity style={[styles.actionPill, styles.actionPillDanger]} onPress={() => reject(inc.id)}><Text style={styles.actionPillText}>Reject</Text></TouchableOpacity>
                        ) : null}
                        {canCompleteIncident(inc.status) ? (
                          <TouchableOpacity style={styles.actionPill} onPress={() => complete(inc.id)}><Text style={styles.actionPillText}>Complete</Text></TouchableOpacity>
                        ) : null}
                        {["IN_PROGRESS", "EN_ROUTE", "ON_SCENE"].includes(String(inc.status).toUpperCase()) ? (
                          <TouchableOpacity style={styles.actionPill} onPress={() => openMapForIncident(inc)}><Text style={styles.actionPillText}>Navigate</Text></TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <CreateIncidentModal
        visible={createIncidentOpen}
        onClose={() => setCreateIncidentOpen(false)}
        location={myCoords}
        onCreated={() => void loadIncidents()}
      />
      <IncidentDetailsModal
        visible={!!selectedIncident}
        incident={selectedIncident}
        onClose={() => setSelectedIncident(null)}
      />
    </Screen>
  );
}

function createResponderHomeStyles(
  theme: ThemeTokens,
  ui: { compact: boolean; tablet: boolean; fabSize: number; avatarSize: number; avatarTextSize: number },
) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.lightBg },
  mapFull: { ...StyleSheet.absoluteFillObject },
  topRightColumn: {
    position: "absolute",
    zIndex: 12,
    alignItems: "flex-end",
    gap: ui.tablet ? 12 : 10,
  } as any,
  avatarCluster: {
    position: "relative",
    alignItems: "center",
    marginBottom: 2,
  },
  avatarCircle: {
    width: ui.avatarSize,
    height: ui.avatarSize,
    borderRadius: ui.avatarSize / 2,
    backgroundColor: "#a87143",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
    shadowColor: "#0f172a",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  avatarInitials: {
    fontSize: ui.avatarTextSize,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.3,
  },
  mapFabStack: {
    position: "absolute",
    zIndex: 11,
    alignItems: "center",
    gap: ui.tablet ? 14 : 12,
  } as any,
  circleFab: {
    width: ui.fabSize,
    height: ui.fabSize,
    borderRadius: ui.fabSize / 2,
    backgroundColor: theme.color.fabBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.fabBorder,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.fab,
  },
  bottomSheetWrap: {
    position: "absolute",
    bottom: 0,
    zIndex: 8,
    paddingTop: 6,
  },
  bottomSheetShelf: {
    marginHorizontal: ui.tablet ? 14 : 10,
    borderTopLeftRadius: theme.radius.sheetTop,
    borderTopRightRadius: theme.radius.sheetTop,
    backgroundColor: theme.color.sheetShelfBg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: theme.color.sheetShelfBorder,
    paddingTop: 6,
    paddingBottom: 4,
    shadowColor: "#0f172a",
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -12 },
    elevation: 12,
    overflow: "hidden",
  },
  sheetHandleButton: { alignItems: "center", justifyContent: "center", paddingBottom: 6 },
  sheetHandleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
  },
  overlayHint: {
    marginHorizontal: 14,
    marginBottom: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.color.overlayHintBg,
    color: theme.color.lightTextMuted,
    ...theme.text.sub,
  },
  overlayHintError: { color: theme.color.danger },
  listPanel: {
    backgroundColor: theme.color.listPanelBg,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.listPanelBorder,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    marginBottom: 6,
  },
  minimalList: { flexGrow: 0 },
  minimalItem: {
    borderRadius: theme.radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    backgroundColor: theme.color.lightSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.minimalRowBorder,
  },
  minimalItemHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  minimalStatus: { ...theme.text.tiny, color: theme.color.lightPrimary, fontWeight: "900" },
  minimalPriority: { ...theme.text.tiny, color: theme.color.lightTextMuted, fontWeight: "900" },
  minimalTitle: { ...theme.text.body, color: theme.color.lightText, fontWeight: "800", marginTop: 4 },
  minimalActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 } as any,
  actionPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.color.actionPillBorder,
    backgroundColor: theme.color.actionPillBg,
  },
  actionPillDanger: { borderColor: "rgba(239,68,68,0.45)", backgroundColor: "rgba(254,226,226,0.95)" },
  actionPillText: { fontSize: 12, color: theme.color.lightText, fontWeight: "900" },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 999,
    marginBottom: 6,
    backgroundColor: "rgba(15,23,42,0.18)",
  },
  sheetHandleLabel: { ...theme.text.tiny, color: theme.color.lightTextMuted, fontWeight: "800", fontSize: ui.tablet ? 12 : 11 },
  mapWrap: {
    width: "100%",
    borderBottomWidth: 1,
    borderBottomColor: theme.color.lightBorderStrong,
    overflow: "hidden",
    position: "relative",
  },
  recenterBtn: {
    position: "absolute",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.color.white,
    borderWidth: 1,
    borderColor: theme.color.border,
    shadowColor: theme.color.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 9,
  },
  recenterBtnText: { fontSize: 12, fontWeight: "800", color: theme.color.lightText },
  hideMapBtn: {
    position: "absolute",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.color.white,
    borderWidth: 1,
    borderColor: theme.color.border,
    shadowColor: theme.color.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 3,
    zIndex: 9,
  },
  hideMapBtnText: { fontSize: 12, fontWeight: "800", color: theme.color.lightText },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: theme.space.md, paddingBottom: theme.space.md },
  createIncidentWrap: { marginBottom: theme.space.md },
  cardPressWrap: { marginBottom: theme.space.md },
  activeSection: { marginBottom: theme.space.sm },
  summaryCard: {
    marginBottom: theme.space.md,
    backgroundColor: theme.color.summaryCardBg,
    borderColor: theme.color.listPanelBorder,
  },
  summaryHeader: { marginBottom: theme.space.sm },
  summaryTitle: { ...theme.text.body, color: theme.color.lightText, fontWeight: "900" },
  summarySubtitle: { ...theme.text.sub, color: theme.color.lightTextSubtle, marginTop: 2 },
  summaryPills: { flexDirection: "row", flexWrap: "wrap", gap: 8 } as any,
  summaryPill: {
    borderWidth: 1,
    borderColor: theme.color.lightBorderStrong,
    borderRadius: 12,
    backgroundColor: theme.color.lightSurface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 88,
  },
  summaryPillGood: { borderColor: theme.color.success, backgroundColor: theme.color.successSoft },
  summaryPillWarn: { borderColor: theme.color.warn, backgroundColor: theme.color.warnSoft },
  summaryPillLabel: { ...theme.text.tiny, color: theme.color.lightTextMuted, fontWeight: "700", marginBottom: 1 },
  summaryPillValue: { ...theme.text.sub, color: theme.color.lightText, fontWeight: "900" },
  feedbackCard: {
    marginBottom: theme.space.md,
    backgroundColor: theme.color.lightSurface,
    borderColor: theme.color.lightBorderStrong,
  },
  feedbackCardError: { borderColor: theme.color.danger },
  statusText: { textAlign: "center", color: theme.color.lightTextMuted, paddingVertical: 10, ...theme.text.sub },
  errorText: { color: theme.color.dangerTextSoft },
  pendingSection: { marginBottom: 12 },
  sectionLabel: { ...theme.text.sub, fontWeight: "900", color: theme.color.lightPrimary, marginBottom: 8 },
  pendingCard: { backgroundColor: theme.color.successSoft, borderColor: theme.color.success, borderLeftWidth: 4 },
  incidentCard: {
    backgroundColor: theme.color.incidentCardBg,
    borderLeftWidth: 4,
    borderLeftColor: theme.color.primarySoftStrong,
  },
  incidentHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 8,
  } as any,
  metaPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: theme.color.lightSurface,
    borderColor: theme.color.lightBorderStrong,
  },
  metaPillPending: { borderColor: theme.color.success, backgroundColor: theme.color.successSoft },
  metaPillStatus: { borderColor: theme.color.primarySoftStrong, backgroundColor: theme.color.primarySoft },
  priorityCritical: { borderColor: theme.color.danger, backgroundColor: theme.color.dangerSoft },
  priorityHigh: { borderColor: theme.color.warn, backgroundColor: theme.color.warnSoft },
  priorityMedium: { borderColor: theme.color.primarySoftStrong, backgroundColor: theme.color.primarySoft },
  priorityLow: { borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  metaPillText: { ...theme.text.tiny, color: theme.color.lightText, fontWeight: "900", letterSpacing: 0.2 },
  incidentTitle: { ...theme.text.body, fontWeight: "900", marginBottom: 6, color: theme.color.lightText },
  incidentMeta: { ...theme.text.sub, color: theme.color.lightTextMuted, marginBottom: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 } as any,
  actionCol: { flexBasis: "48%", flexGrow: 1 } as any,
  });
}
