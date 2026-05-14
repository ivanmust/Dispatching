import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Alert,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { ResponderMapWebView, type MapRouteManeuver } from "../components/ResponderMapWebView";
import { Screen } from "../ui/Screen";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { api, type Geofence, type Incident, type PointOfInterest, type ResponderListItem } from "../lib/api";
import { useSocketMobile } from "../contexts/SocketContextMobile";
import { useNavigationSession } from "../navigation/useNavigationSession";

type MapRouteParams = {
  incidentId?: string;
  lat?: number;
  lon?: number;
  title?: string;
};

function formatStepDistance(meters?: number): string {
  if (!Number.isFinite(meters)) return "";
  const m = Math.max(0, Number(meters));
  if (m <= 0) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatStepTime(minutes?: number): string {
  if (!Number.isFinite(minutes)) return "";
  const min = Math.max(0, Number(minutes));
  const sec = min * 60;
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  if (min < 10) {
    const rounded = Math.round(min * 10) / 10;
    return rounded % 1 === 0 ? `${Math.round(rounded)} min` : `${rounded.toFixed(1)} min`;
  }
  return `${Math.round(min)} min`;
}

function formatArrivalClock(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const min = Math.max(0, Number(minutes));
  const arrival = new Date(Date.now() + min * 60_000);
  return arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function maneuverIconName(text?: string): keyof typeof Ionicons.glyphMap {
  const t = String(text ?? "").toLowerCase();
  if (!t) return "arrow-forward";
  if (t.includes("u-turn")) return "return-up-back";
  if (t.includes("roundabout")) return "sync-outline";
  if (t.includes("slight right")) return "arrow-forward-outline";
  if (t.includes("right")) return "arrow-forward";
  if (t.includes("slight left")) return "arrow-back-outline";
  if (t.includes("left")) return "arrow-back";
  if (t.includes("arrive")) return "flag";
  if (t.includes("start") || t.includes("head")) return "navigate";
  return "arrow-up";
}

type DirectionStep = {
  text: string;
  lengthMeters?: number;
  timeMinutes?: number;
};

function DirectionStepCard({
  styles,
  idx,
  step,
  active,
  onPress,
}: {
  styles: any;
  idx: number;
  step: DirectionStep;
  active: boolean;
  onPress: () => void;
}) {
  const meta = [formatStepDistance(step.lengthMeters), formatStepTime(step.timeMinutes)].filter(Boolean).join(" · ");
  const icon = maneuverIconName(step.text);
  return (
    <TouchableOpacity
      style={active ? styles.stepCardActive : styles.stepCard}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`Direction step ${idx + 1}`}
    >
      <View style={styles.stepRow}>
        <View style={active ? styles.stepIndexBadgeActive : styles.stepIndexBadge}>
          <Text style={active ? styles.stepIndexBadgeTextActive : styles.stepIndexBadgeText}>{idx + 1}</Text>
        </View>
        <View style={active ? styles.stepIconWrapActive : styles.stepIconWrap}>
          <Ionicons name={icon} size={active ? 20 : 18} color={active ? "#ffffff" : "rgba(217,232,248,0.72)"} />
        </View>
        <View style={styles.stepBody}>
          <Text style={active ? styles.stepTextActive : styles.stepText} numberOfLines={3}>
            {step.text}
          </Text>
          {meta ? <Text style={active ? styles.stepMetaActive : styles.stepMeta}>{meta}</Text> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function ResponderIncidentMapScreen({ route, navigation }: { route?: { params?: MapRouteParams }; navigation?: any }) {
  const { socket } = useSocketMobile();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = width < 390;
  const tablet = width >= 768;
  const chromeInset = tablet ? 18 : compact ? 8 : 10;
  const sheetHorizontalInset = tablet ? Math.max(18, Math.floor((width - 820) / 2)) : 0;
  const ui = useMemo(
    () => ({
      compact,
      tablet,
      phone: !tablet,
      topInsetOffset: tablet ? 10 : 6,
      debugTopOffset: tablet ? 92 : 76,
      backFabSize: tablet ? 50 : compact ? 40 : 44,
      backIconSize: tablet ? 26 : compact ? 20 : 22,
      turnIconSize: tablet ? 28 : compact ? 22 : 24,
      voiceIconSize: tablet ? 22 : 19,
      maneuverListHeightRatio: tablet ? 0.42 : 0.34,
      maneuverListMinHeight: tablet ? 260 : 200,
      maneuverListMaxHeight: tablet ? 460 : 360,
      /** Keep the RN navigation row below the embedded Esri widgets. */
      mapUiReserveTop: tablet ? 78 : 0,
      mapUiReserveLeft: tablet ? 8 : 4,
      /** Cap direction banner width so map controls stay usable. */
      navCardMaxWidth: tablet ? Math.min(440, Math.round(width * 0.42)) : Math.min(270, Math.max(232, width - 148)),
    }),
    [compact, tablet, width],
  );
  const { theme } = useAppTheme();
  const styles = useMemo(() => createResponderIncidentMapStyles(theme, ui), [theme, ui]);

  const [mapIncidents, setMapIncidents] = useState<Incident[]>([]);
  const [fleet, setFleet] = useState<ResponderListItem[]>([]);
  const [fleetLocations, setFleetLocations] = useState<Record<string, { lat: number; lon: number }>>({});
  const [fleetAvailability, setFleetAvailability] = useState<Record<string, boolean>>({});
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);
  const [mapGeofences, setMapGeofences] = useState<Geofence[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(route?.params?.incidentId ?? null);
  const [focusTarget, setFocusTarget] = useState<{ id?: string; lat: number; lon: number } | null>(
    Number.isFinite(route?.params?.lat) && Number.isFinite(route?.params?.lon)
      ? { id: route?.params?.incidentId, lat: Number(route?.params?.lat), lon: Number(route?.params?.lon) }
      : null
  );
  const [gpsRecenterNonce, setGpsRecenterNonce] = useState(0);
  const [followPausedByGesture, setFollowPausedByGesture] = useState(false);
  const [mapPerspectiveMode, setMapPerspectiveMode] = useState<"default" | "satellite">("satellite");
  const [zoomCommand, setZoomCommand] = useState<{ id: number; delta: number } | null>(null);
  const [mapAuthPromptVisible, setMapAuthPromptVisible] = useState(false);
  const [startingTrip, setStartingTrip] = useState(false);
  const followResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomCommandIdRef = useRef(0);
  const lastSpokenInstructionRef = useRef<string>("");
  const navigationIncidentId = useMemo(
    () => route?.params?.incidentId ?? selectedIncidentId ?? null,
    [route?.params?.incidentId, selectedIncidentId],
  );

  const loadMapContext = useCallback(async () => {
    await Promise.all([
      // Responder map must only show incidents assigned to the logged-in responder.
      api.getAssignedIncidents().then((rows) => setMapIncidents(rows)).catch(() => {}),
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

  useEffect(() => {
    if (!socket) return;
    const onLocation = (data: { responderId: string; lat: number; lon: number }) => {
      if (!data?.responderId || typeof data.lat !== "number" || typeof data.lon !== "number") return;
      setFleetLocations((prev) => ({ ...prev, [data.responderId]: { lat: data.lat, lon: data.lon } }));
    };
    const onAvailability = (data: { responderId: string; available: boolean }) => {
      if (!data?.responderId) return;
      setFleetAvailability((prev) => ({ ...prev, [data.responderId]: !!data.available }));
    };
    socket.on("responder:location", onLocation);
    socket.on("responder:availability", onAvailability);
    return () => {
      socket.off("responder:location", onLocation);
      socket.off("responder:availability", onAvailability);
    };
  }, [socket]);

  const incidentPins = useMemo(
    () =>
      mapIncidents
        .filter((inc) => inc?.id && Number.isFinite(inc.location?.lat) && Number.isFinite(inc.location?.lon))
        .map((i) => ({
          id: i.id,
          lat: i.location.lat,
          lon: i.location.lon,
          status: i.status,
          title: i.title,
          priority: i.priority,
          category: i.category,
        })),
    [mapIncidents]
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

  const mapGeofenceList = useMemo(
    () => mapGeofences.map((gf) => ({ id: gf.id, name: gf.name, geometry: gf.geometry })),
    [mapGeofences]
  );

  const destination = useMemo(() => {
    if (Number.isFinite(route?.params?.lat) && Number.isFinite(route?.params?.lon)) {
      return { lat: Number(route?.params?.lat), lon: Number(route?.params?.lon) };
    }
    const incident = mapIncidents.find((i) => i.id === selectedIncidentId);
    if (!incident) return null;
    if (!Number.isFinite(incident.location?.lat) || !Number.isFinite(incident.location?.lon)) return null;
    return { lat: incident.location.lat, lon: incident.location.lon };
  }, [route?.params?.lat, route?.params?.lon, selectedIncidentId, mapIncidents]);
  const hasNavigationTarget = !!destination;
  const {
    routePath,
    etaMinutes,
    distanceMeters,
    maneuvers,
    currentManeuverIndex,
    directionsExpanded,
    setDirectionsExpanded,
    nextInstruction,
    spokenEnabled,
    setSpokenEnabled,
    debugVisible,
    setDebugVisible,
    debugMetrics,
    handleLocationUpdate,
    navigationFollowActive,
    maneuversWithPathCount,
    activePathPoints,
    selectManeuverStep,
  } = useNavigationSession({ destination, hasNavigationTarget, navigationIncidentId });

  useEffect(() => {
    if (!spokenEnabled) return;
    if (!nextInstruction || nextInstruction === "—") return;
    const normalized = nextInstruction.trim().toLowerCase();
    if (!normalized || normalized === lastSpokenInstructionRef.current) return;
    lastSpokenInstructionRef.current = normalized;
    if (normalized === "you have arrived") {
      Speech.stop();
      void Speech.speak("You have arrived at the incident location.", {
        rate: 0.95,
        pitch: 1.0,
      });
      return;
    }
    Speech.stop();
    void Speech.speak(nextInstruction, {
      rate: 0.96,
      pitch: 1.0,
    });
  }, [nextInstruction, spokenEnabled]);

  useEffect(() => {
    return () => {
      Speech.stop();
      if (followResumeTimerRef.current) clearTimeout(followResumeTimerRef.current);
    };
  }, []);

  const etaLabel =
    etaMinutes != null
      ? etaMinutes <= 0
        ? "Arriving"
        : etaMinutes < 1
          ? "<1 min"
          : `${Math.max(1, Math.round(etaMinutes))} min`
      : "—";
  const distLabel = distanceMeters != null ? formatStepDistance(distanceMeters) : "—";
  const currentStep = maneuvers[currentManeuverIndex] ?? null;
  const arrivalClockLabel = formatArrivalClock(etaMinutes);
  const stepProgressLabel = maneuvers.length ? `Step ${Math.min(currentManeuverIndex + 1, maneuvers.length)} of ${maneuvers.length}` : "";
  const sheetReveal = useRef(new Animated.Value(directionsExpanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(sheetReveal, {
      toValue: directionsExpanded ? 1 : 0,
      useNativeDriver: true,
      tension: 72,
      friction: 12,
    }).start();
  }, [directionsExpanded, sheetReveal]);
  const sheetContentAnimatedStyle = {
    opacity: sheetReveal,
    transform: [
      {
        translateY: sheetReveal.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };
  const effectiveNavigationFollowActive = navigationFollowActive && !followPausedByGesture;
  const floatingZoomTopOverride = Math.min(
    Math.max(insets.top + ui.mapUiReserveTop + 168, height * 0.42),
    height - Math.max(insets.bottom, 12) - 210,
  );
  const maneuverListMaxH = Math.min(
    Math.max(height * ui.maneuverListHeightRatio, ui.maneuverListMinHeight),
    ui.maneuverListMaxHeight,
  );
  const issueZoomCommand = useCallback((delta: number) => {
    zoomCommandIdRef.current += 1;
    setZoomCommand({ id: zoomCommandIdRef.current, delta });
  }, []);
  const recenterNavigation = useCallback(() => {
    setFollowPausedByGesture(false);
    if (followResumeTimerRef.current) {
      clearTimeout(followResumeTimerRef.current);
      followResumeTimerRef.current = null;
    }
    setGpsRecenterNonce((n) => n + 1);
  }, []);
  const startTrip = useCallback(async () => {
    if (!navigationIncidentId || !destination) {
      Alert.alert("Trip unavailable", "This incident does not have a valid destination.");
      return;
    }
    setStartingTrip(true);
    try {
      const started = await api.startAssignedIncident(navigationIncidentId);
      navigation?.replace?.("TripNavigation", {
        incidentId: navigationIncidentId,
        lat: destination.lat,
        lon: destination.lon,
        title: route?.params?.title ?? started.title,
      });
    } catch (e: any) {
      Alert.alert("Start trip failed", e?.message ?? "Could not start this trip.");
    } finally {
      setStartingTrip(false);
    }
  }, [destination, navigation, navigationIncidentId, route?.params?.title]);
  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy < -24) setDirectionsExpanded(true);
          if (gesture.dy > 24) setDirectionsExpanded(false);
        },
      }),
    [setDirectionsExpanded],
  );

  return (
    <Screen style={styles.root} padded={false}>
      <View style={styles.mapRoot}>
        <View style={styles.mapFill}>
          <ResponderMapWebView
            focusTarget={effectiveNavigationFollowActive ? null : focusTarget}
            gpsRecenterNonce={gpsRecenterNonce}
            floatingZoomTopOverride={floatingZoomTopOverride}
            floatingZoomControls={false}
            embedMapControls={false}
            mapPerspectiveMode={mapPerspectiveMode}
            zoomCommand={zoomCommand}
            incidentPins={incidentPins}
            routePath={routePath}
            maneuvers={maneuvers as MapRouteManeuver[]}
            currentManeuverIndex={currentManeuverIndex}
            navigationFollowActive={effectiveNavigationFollowActive}
            navigationHeadingUp
            selectedIncidentId={selectedIncidentId}
            responders={fleetMarkers}
            pointsOfInterest={pointsOfInterest}
            geofences={mapGeofenceList}
            onLocationUpdate={handleLocationUpdate}
            onUserMapGesture={() => {
              if (!navigationFollowActive) return;
              setFollowPausedByGesture(true);
              if (followResumeTimerRef.current) clearTimeout(followResumeTimerRef.current);
              followResumeTimerRef.current = setTimeout(() => {
                setFollowPausedByGesture(false);
                followResumeTimerRef.current = null;
              }, 30_000);
            }}
            onAuthPromptChange={setMapAuthPromptVisible}
            onIncidentPinPress={(id) => {
              setSelectedIncidentId(id);
              const pin = incidentPins.find((p) => p.id === id);
              if (pin) setFocusTarget({ id, lat: pin.lat, lon: pin.lon });
            }}
          />
        </View>

        {!mapAuthPromptVisible && !hasNavigationTarget ? (
          <View
            style={[
              styles.mapOnlyGlass,
              {
                top: insets.top + 12,
                left: Math.max(chromeInset, insets.left + 14),
                right: Math.max(insets.right + 76, 76),
              },
            ]}
            pointerEvents="box-none"
          >
            <Text style={styles.mapOnlyTitle} numberOfLines={1}>
              Esri responder map
            </Text>
            <Text style={styles.mapOnlyBody} numberOfLines={2}>
              Open Navigate from an assigned incident for turn-by-turn directions.
            </Text>
          </View>
        ) : null}

        {!mapAuthPromptVisible ? (
        <View
          style={[
            styles.floatingControlRail,
            {
              top: insets.top + 12,
              right: Math.max(insets.right + 14, 14),
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={[styles.glassControlButton, styles.closeControlButton]}
            onPress={() => navigation?.goBack?.()}
            activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
          >
            <Ionicons name="close" size={22} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.glassControlButton}
            onPress={() => setMapPerspectiveMode((mode) => (mode === "satellite" ? "default" : "satellite"))}
            activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel="Toggle map layers"
          >
            <Ionicons name={mapPerspectiveMode === "satellite" ? "map" : "layers"} size={21} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.glassControlButton}
            onPress={recenterNavigation}
            activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel="Recenter map"
          >
            <Ionicons name="navigate" size={21} color={effectiveNavigationFollowActive ? "#7bdcff" : "#ffffff"} />
          </TouchableOpacity>
          {hasNavigationTarget ? (
            <TouchableOpacity
              style={styles.glassControlButton}
              onPress={() => setSpokenEnabled((v) => !v)}
              activeOpacity={0.86}
              accessibilityRole="button"
              accessibilityLabel={spokenEnabled ? "Mute voice guidance" : "Enable voice guidance"}
            >
              <Ionicons name={spokenEnabled ? "volume-high" : "volume-mute"} size={21} color="#ffffff" />
            </TouchableOpacity>
          ) : null}
          <View style={styles.zoomControlGroup}>
            <TouchableOpacity
              style={styles.zoomControlButton}
              onPress={() => issueZoomCommand(1)}
              activeOpacity={0.86}
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
            >
              <Ionicons name="add" size={23} color="#ffffff" />
            </TouchableOpacity>
            <View style={styles.zoomControlDivider} />
            <TouchableOpacity
              style={styles.zoomControlButton}
              onPress={() => issueZoomCommand(-1)}
              activeOpacity={0.86}
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
            >
              <Ionicons name="remove" size={23} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
        ) : null}

        {!mapAuthPromptVisible && debugVisible && __DEV__ ? (
          <View style={[styles.debugFloat, { top: insets.top + ui.debugTopOffset, left: chromeInset, right: chromeInset }]}>
            <Text style={styles.debugTitle}>Navigation debug</Text>
            <Text style={styles.debugLine}>
              Off-route: {debugMetrics.offRouteMeters != null ? `${debugMetrics.offRouteMeters.toFixed(1)} m` : "—"}
            </Text>
            <Text style={styles.debugLine}>
              Progress:{" "}
              {debugMetrics.progressedMeters != null ? `${debugMetrics.progressedMeters.toFixed(1)} m` : "—"} /{" "}
              {debugMetrics.routeTotalMeters != null ? `${debugMetrics.routeTotalMeters.toFixed(1)} m` : "—"}
            </Text>
            <Text style={styles.debugLine}>
              Remaining: {debugMetrics.remainingMeters != null ? `${debugMetrics.remainingMeters.toFixed(1)} m` : "—"}
            </Text>
            <Text style={styles.debugLine}>Maneuver: {debugMetrics.maneuverIndex + 1}</Text>
            <Text style={styles.debugLine}>
              GPS σ: {debugMetrics.gpsAccuracyMeters != null ? `${debugMetrics.gpsAccuracyMeters.toFixed(0)} m` : "—"} · v:{" "}
              {debugMetrics.gpsSpeedMps != null ? `${debugMetrics.gpsSpeedMps.toFixed(1)} m/s` : "—"}
            </Text>
            <Text style={styles.debugLine}>
              Paths: {maneuversWithPathCount} steps · current leg pts: {activePathPoints}
            </Text>
          </View>
        ) : null}

        {!mapAuthPromptVisible && maneuvers.length > 0 ? (
          <Animated.View
            style={[
              styles.navigationSheet,
              {
                paddingBottom: Math.max(insets.bottom, tablet ? 14 : 10),
                left: Math.max(sheetHorizontalInset, insets.left),
                right: Math.max(sheetHorizontalInset, insets.right),
              },
            ]}
          >
            <View style={styles.sheetHandleWrap} {...sheetPanResponder.panHandlers}>
              <View style={styles.sheetHandle} />
            </View>
            <TouchableOpacity
              style={styles.sheetSummary}
              onPress={() => setDirectionsExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={directionsExpanded ? "Collapse route steps" : "Expand route steps"}
              activeOpacity={0.85}
            >
              <View style={styles.sheetSummaryTextBlock}>
                <Text style={styles.sheetEyebrow} numberOfLines={1}>
                  Live route
                </Text>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {etaLabel} · {distLabel}
                </Text>
                <Text style={styles.sheetSubtitle} numberOfLines={1}>
                  {currentStep ? `Step ${Math.min(currentManeuverIndex + 1, maneuvers.length)} of ${maneuvers.length}` : "Turn-by-turn guidance"}
                </Text>
              </View>
              <View style={styles.sheetSummaryActions}>
                <View style={styles.sheetArrivalPill}>
                  <Text style={styles.sheetArrivalLabel}>Arrive</Text>
                  <Text style={styles.sheetArrivalValue}>{arrivalClockLabel || "—"}</Text>
                </View>
                <View style={styles.sheetChevronButton}>
                  <Ionicons name={directionsExpanded ? "chevron-down" : "chevron-up"} size={22} color="#ffffff" />
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.routeAlternatives}>
              <TouchableOpacity style={styles.routeAlternativeActive} activeOpacity={0.9}>
                <Text style={styles.routeAlternativeTitle}>Fastest</Text>
                <Text style={styles.routeAlternativeMeta}>
                  {etaLabel} · {distLabel}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.routeAlternative} activeOpacity={0.9}>
                <Text style={styles.routeAlternativeTitle}>Balanced</Text>
                <Text style={styles.routeAlternativeMeta}>Auto reroute</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.startTripButton}
              onPress={startTrip}
              disabled={startingTrip || !navigationIncidentId || !destination}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Start trip navigation"
            >
              {startingTrip ? <ActivityIndicator size="small" color="#052e1a" /> : <Ionicons name="play" size={18} color="#052e1a" />}
              <Text style={styles.startTripButtonText}>{startingTrip ? "Starting trip..." : "Start Trip"}</Text>
            </TouchableOpacity>

            {directionsExpanded ? (
              <Animated.View style={sheetContentAnimatedStyle}>
                <ScrollView
                  style={[styles.maneuverList, { maxHeight: maneuverListMaxH }]}
                  contentContainerStyle={styles.maneuverListContent}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  bounces
                  showsVerticalScrollIndicator={false}
                >
                  {maneuvers.map((m, idx) => {
                    const active = idx === currentManeuverIndex;
                    return (
                      <DirectionStepCard
                        key={`${idx}-${m.text}`}
                        styles={styles}
                        idx={idx}
                        step={m}
                        active={active}
                        onPress={() => selectManeuverStep(idx, m.text)}
                      />
                    );
                  })}
                </ScrollView>
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </Screen>
  );
}

function createResponderIncidentMapStyles(
  theme: ThemeTokens,
  ui: {
    compact: boolean;
    tablet: boolean;
    phone: boolean;
    backFabSize: number;
    navCardMaxWidth: number;
  },
) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: "#000000" },
    mapRoot: { flex: 1, position: "relative" },
    mapFill: { ...StyleSheet.absoluteFillObject },
    navGlassCardWrap: {
      position: "absolute",
      zIndex: 22,
    },
    navGlassCard: {
      width: "100%",
      minHeight: ui.tablet ? 196 : ui.compact ? 178 : 188,
      borderRadius: ui.tablet ? 32 : 28,
      paddingHorizontal: ui.tablet ? 22 : ui.compact ? 16 : 18,
      paddingVertical: ui.tablet ? 20 : ui.compact ? 16 : 18,
      backgroundColor: "rgba(8, 14, 23, 0.84)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.22)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.36,
      shadowRadius: 28,
      elevation: 24,
    },
    navGlassMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: ui.tablet ? 16 : 12,
    },
    navGlassPill: {
      flexShrink: 0,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: "rgba(255,255,255,0.14)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.18)",
    },
    navGlassPillText: {
      color: "#d7e8ff",
      fontSize: ui.tablet ? 12 : 11,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    navGlassArrival: {
      flexShrink: 1,
      color: "rgba(237,246,255,0.86)",
      fontSize: ui.tablet ? 14 : 12,
      fontWeight: "800",
      textAlign: "right",
    },
    navGlassPrimaryRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: ui.tablet ? 18 : 14,
    },
    navGlassTurn: {
      width: ui.tablet ? 68 : ui.compact ? 56 : 60,
      height: ui.tablet ? 68 : ui.compact ? 56 : 60,
      borderRadius: ui.tablet ? 24 : 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#0a84ff",
      shadowColor: "#0a84ff",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.35,
      shadowRadius: 18,
      elevation: 10,
    },
    navGlassTurnSoon: {
      backgroundColor: "#ff9f0a",
      shadowColor: "#ff9f0a",
    },
    navGlassTurnUrgent: {
      backgroundColor: "#ff453a",
      shadowColor: "#ff453a",
    },
    navGlassInstructionBlock: {
      flex: 1,
      minWidth: 0,
      paddingTop: 1,
    },
    navGlassDistanceRow: {
      flexDirection: "row",
      alignItems: "baseline",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: ui.tablet ? 8 : 6,
    },
    navGlassCue: {
      color: "rgba(231,242,255,0.7)",
      fontSize: ui.tablet ? 12 : 11,
      fontWeight: "900",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    navGlassCueSoon: { color: "#ffd38a" },
    navGlassCueUrgent: { color: "#ffb0aa" },
    navGlassDistance: {
      color: "#eaf5ff",
      fontSize: ui.tablet ? 34 : ui.compact ? 25 : 29,
      lineHeight: ui.tablet ? 39 : ui.compact ? 31 : 35,
      fontWeight: "900",
      letterSpacing: -0.8,
    },
    navGlassDistanceSoon: { color: "#ffd38a" },
    navGlassDistanceUrgent: { color: "#ffb0aa" },
    navGlassTime: {
      color: "rgba(231,242,255,0.72)",
      fontSize: ui.tablet ? 14 : 12,
      fontWeight: "800",
    },
    navGlassInstruction: {
      color: "#ffffff",
      fontSize: ui.tablet ? 24 : ui.compact ? 18 : 20,
      lineHeight: ui.tablet ? 31 : ui.compact ? 24 : 27,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    navGlassStatsRow: {
      marginTop: ui.tablet ? 18 : 16,
      flexDirection: "row",
      gap: ui.compact ? 8 : 10,
    },
    navGlassStat: {
      flex: 1,
      minWidth: 0,
      borderRadius: 18,
      paddingHorizontal: ui.compact ? 10 : 12,
      paddingVertical: ui.compact ? 9 : 10,
      backgroundColor: "rgba(255,255,255,0.12)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.15)",
    },
    navGlassStatLabel: {
      color: "rgba(226,239,255,0.62)",
      fontSize: ui.tablet ? 11 : 10,
      fontWeight: "900",
      letterSpacing: 0.45,
      textTransform: "uppercase",
    },
    navGlassStatValue: {
      marginTop: 3,
      color: "#ffffff",
      fontSize: ui.tablet ? 17 : ui.compact ? 13 : 15,
      lineHeight: ui.tablet ? 22 : ui.compact ? 17 : 20,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    navGlassDestination: {
      marginTop: 12,
      color: "rgba(232,242,255,0.68)",
      fontSize: ui.tablet ? 14 : 12,
      fontWeight: "800",
    },
    navGlassStatus: {
      marginTop: 10,
      color: "rgba(232,242,255,0.72)",
      fontSize: ui.tablet ? 14 : 12,
      lineHeight: ui.tablet ? 19 : 17,
      fontWeight: "700",
    },
    navGlassStatusAlert: {
      color: "#ffb0aa",
    },
    mapOnlyGlass: {
      position: "absolute",
      zIndex: 20,
      borderRadius: 24,
      paddingHorizontal: 18,
      paddingVertical: 15,
      backgroundColor: "rgba(8, 14, 23, 0.82)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.18)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.28,
      shadowRadius: 20,
      elevation: 18,
    },
    floatingControlRail: {
      position: "absolute",
      zIndex: 24,
      alignItems: "center",
      gap: 10,
    },
    glassControlButton: {
      width: ui.tablet ? 50 : 46,
      height: ui.tablet ? 50 : 46,
      borderRadius: ui.tablet ? 25 : 23,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(8, 14, 23, 0.76)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.22)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.28,
      shadowRadius: 16,
      elevation: 14,
    },
    closeControlButton: {
      backgroundColor: "rgba(0,0,0,0.78)",
    },
    zoomControlGroup: {
      width: ui.tablet ? 50 : 46,
      borderRadius: ui.tablet ? 25 : 23,
      overflow: "hidden",
      backgroundColor: "rgba(8, 14, 23, 0.76)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.22)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.28,
      shadowRadius: 16,
      elevation: 14,
    },
    zoomControlButton: {
      width: "100%",
      height: ui.tablet ? 50 : 46,
      alignItems: "center",
      justifyContent: "center",
    },
    zoomControlDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: "rgba(255,255,255,0.18)",
    },
    topChrome: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: ui.tablet ? 14 : 10,
    },
    topChromeNavigation: {
      justifyContent: "center",
    },
    backFab: {
      flexShrink: 0,
      width: ui.backFabSize,
      height: ui.backFabSize,
      borderRadius: ui.backFabSize / 2,
      backgroundColor: "rgba(255,255,255,0.96)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.08)",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.14,
      shadowRadius: 10,
      elevation: 6,
    },
    backFabNavigation: {
      position: "absolute",
      left: ui.tablet ? 18 : 16,
      top: ui.tablet ? 88 : 82,
    },
    topChromeSpacer: {
      flex: 1,
      minWidth: 0,
      minHeight: 1,
    },
    navCard: {
      flexGrow: 0,
      flexShrink: 1,
      maxWidth: ui.navCardMaxWidth,
      flexDirection: "row",
      alignItems: "center",
      minHeight: ui.tablet ? 92 : ui.compact ? 62 : 68,
      borderRadius: ui.tablet ? 20 : 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.08)",
      backgroundColor: "rgba(255,255,255,0.97)",
      paddingVertical: ui.tablet ? 12 : ui.compact ? 7 : 8,
      paddingLeft: ui.tablet ? 16 : 9,
      paddingRight: ui.phone ? 6 : 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 7,
    },
    navCardMain: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: ui.tablet ? 14 : 8 },
    navTurnCircle: {
      width: ui.tablet ? 54 : ui.compact ? 40 : 44,
      height: ui.tablet ? 54 : ui.compact ? 40 : 44,
      borderRadius: ui.tablet ? 27 : ui.compact ? 20 : 22,
      backgroundColor: "#1a73e8",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#1a73e8",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 4,
    },
    navTextBlock: { flex: 1, minWidth: 0, paddingTop: 1 },
    navDebugChipWrap: { marginBottom: 4 },
    navMetaRow: {
      marginBottom: ui.phone ? 4 : 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    navMetaPill: {
      maxWidth: "62%",
      paddingHorizontal: ui.phone ? 8 : 8,
      paddingVertical: ui.phone ? 3 : 4,
      borderRadius: 999,
      backgroundColor: "#e8f0fe",
      alignSelf: "flex-start",
    },
    navMetaPillText: {
      fontSize: ui.tablet ? 12 : 11,
      lineHeight: ui.tablet ? 16 : 14,
      fontWeight: "700",
      color: "#1a73e8",
    },
    navArrivalText: {
      flexShrink: 1,
      fontSize: ui.tablet ? 12 : 11,
      lineHeight: ui.tablet ? 16 : 14,
      fontWeight: "700",
      color: "#5f6368",
      textAlign: "right",
    },
    navNextTurnStrip: {
      marginBottom: ui.phone ? 6 : 8,
      paddingHorizontal: ui.phone ? 9 : 10,
      paddingVertical: ui.phone ? 6 : 7,
      borderRadius: 13,
      backgroundColor: "#eef3fd",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    navNextTurnStripSoon: {
      backgroundColor: "#fff4e5",
    },
    navNextTurnStripUrgent: {
      backgroundColor: "#fce8e6",
    },
    navNextTurnCue: {
      fontSize: ui.tablet ? 11 : 10,
      lineHeight: ui.tablet ? 16 : 14,
      fontWeight: "800",
      color: "#5f6368",
      textTransform: "uppercase",
    },
    navNextTurnCueSoon: {
      color: "#b06000",
    },
    navNextTurnCueUrgent: {
      color: "#c5221f",
    },
    navNextTurnPrimary: {
      flex: 1,
      minWidth: 0,
    },
    navNextTurnDistance: {
      fontSize: ui.tablet ? 22 : ui.compact ? 17 : 19,
      lineHeight: ui.tablet ? 28 : ui.compact ? 21 : 24,
      fontWeight: "800",
      color: "#174ea6",
      letterSpacing: -0.3,
    },
    navNextTurnDistanceSoon: {
      color: "#b06000",
    },
    navNextTurnDistanceUrgent: {
      color: "#c5221f",
    },
    navNextTurnTime: {
      flexShrink: 0,
      fontSize: ui.tablet ? 13 : 12,
      lineHeight: ui.tablet ? 18 : 16,
      fontWeight: "700",
      color: "#5f6368",
    },
    navHeadline: {
      fontSize: ui.tablet ? 20 : ui.compact ? 14 : 15,
      fontWeight: "700",
      color: "#202124",
      letterSpacing: -0.2,
      lineHeight: ui.tablet ? 26 : ui.compact ? 20 : 22,
    },
    navMetricRow: {
      marginTop: ui.phone ? 6 : 8,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    navMetricChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: ui.phone ? 9 : 8,
      paddingVertical: ui.phone ? 4 : 5,
      borderRadius: 999,
      backgroundColor: "#f1f3f4",
    },
    navMetricLabel: {
      fontSize: ui.tablet ? 11 : 10,
      fontWeight: "700",
      color: "#5f6368",
      textTransform: "uppercase",
    },
    navMetricValue: {
      fontSize: ui.tablet ? 12 : ui.compact ? 11 : 12,
      fontWeight: "700",
      color: "#202124",
    },
    navDest: { marginTop: 6, fontSize: ui.tablet ? 14 : ui.compact ? 11 : 12, fontWeight: "600", color: "#80868b" },
    navStatusLine: { marginTop: 4, fontSize: ui.tablet ? 13 : 12, fontWeight: "600" },
    navStatusMuted: { color: "#5f6368" },
    navStatusAlert: { color: "#c5221f" },
    navTurnCircleSoon: {
      backgroundColor: "#f29900",
    },
    navTurnCircleUrgent: {
      backgroundColor: "#d93025",
    },
    voiceIconBtn: {
      width: ui.tablet ? 48 : ui.compact ? 36 : 38,
      height: ui.tablet ? 48 : ui.compact ? 36 : 38,
      borderRadius: ui.tablet ? 24 : ui.compact ? 20 : 22,
      backgroundColor: "#f8f9fa",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.08)",
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "flex-start",
      marginTop: 4,
    },
    mapOnlyCard: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: "rgba(255,255,255,0.96)",
      paddingHorizontal: 14,
      paddingVertical: 10,
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.15,
      shadowRadius: 5,
      elevation: 4,
    },
    mapOnlyTitle: { fontSize: 16, fontWeight: "900", color: "#ffffff" },
    mapOnlyBody: { marginTop: 5, fontSize: 13, fontWeight: "700", color: "rgba(232,242,255,0.72)", lineHeight: 18 },
    debugBadge: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.color.warn,
      backgroundColor: theme.color.warnSoft,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    debugBadgeText: { fontSize: 9, color: theme.color.warn, fontWeight: "900", letterSpacing: 0.2 },
    debugFloat: {
      position: "absolute",
      left: 10,
      right: 10,
      zIndex: 19,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.96)",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 4,
    },
    debugTitle: { ...theme.text.tiny, color: theme.color.lightPrimary, fontWeight: "900", marginBottom: 4 },
    debugLine: { ...theme.text.tiny, color: theme.color.lightTextMuted, fontWeight: "600", lineHeight: 16 },
    navigationSheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(7, 12, 20, 0.92)",
      borderTopLeftRadius: ui.tablet ? 34 : 30,
      borderTopRightRadius: ui.tablet ? 34 : 30,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.18)",
      overflow: "hidden",
      zIndex: 18,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -16 },
      shadowOpacity: 0.36,
      shadowRadius: 30,
      elevation: 26,
    },
    sheetSummary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: ui.tablet ? 24 : 18,
      paddingTop: ui.tablet ? 12 : 10,
      paddingBottom: ui.tablet ? 16 : 14,
      gap: 14,
    },
    sheetSummaryTextBlock: {
      flex: 1,
      minWidth: 0,
    },
    sheetEyebrow: {
      color: "rgba(217,232,248,0.62)",
      fontSize: ui.tablet ? 12 : 11,
      fontWeight: "900",
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    sheetTitle: {
      marginTop: 3,
      color: "#ffffff",
      fontSize: ui.tablet ? 28 : ui.compact ? 21 : 24,
      lineHeight: ui.tablet ? 34 : ui.compact ? 27 : 30,
      fontWeight: "900",
      letterSpacing: -0.7,
    },
    sheetSubtitle: {
      marginTop: 3,
      color: "rgba(217,232,248,0.68)",
      fontSize: ui.tablet ? 14 : 12,
      fontWeight: "700",
    },
    sheetSummaryActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    },
    sheetArrivalPill: {
      minWidth: ui.compact ? 68 : 76,
      borderRadius: 18,
      paddingHorizontal: 11,
      paddingVertical: 9,
      backgroundColor: "rgba(255,255,255,0.12)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.14)",
      alignItems: "center",
    },
    sheetArrivalLabel: {
      color: "rgba(217,232,248,0.58)",
      fontSize: 10,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sheetArrivalValue: {
      marginTop: 2,
      color: "#ffffff",
      fontSize: ui.tablet ? 16 : 13,
      fontWeight: "900",
    },
    sheetChevronButton: {
      width: ui.tablet ? 42 : 38,
      height: ui.tablet ? 42 : 38,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.12)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.14)",
    },
    transportSelector: {
      marginHorizontal: ui.tablet ? 24 : 18,
      marginBottom: 12,
      padding: 4,
      borderRadius: 22,
      flexDirection: "row",
      gap: 4,
      backgroundColor: "rgba(255,255,255,0.1)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.12)",
    },
    transportPill: {
      flex: 1,
      minHeight: 42,
      borderRadius: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    transportPillActive: {
      flex: 1,
      minHeight: 42,
      borderRadius: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: "#f2f8ff",
    },
    transportText: {
      color: "#d9e8f8",
      fontSize: ui.tablet ? 14 : 12,
      fontWeight: "900",
    },
    transportTextActive: {
      color: "#06131f",
      fontSize: ui.tablet ? 14 : 12,
      fontWeight: "900",
    },
    routeAlternatives: {
      marginHorizontal: ui.tablet ? 24 : 18,
      marginBottom: 12,
      flexDirection: "row",
      gap: 10,
    },
    routeAlternative: {
      flex: 1,
      minWidth: 0,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: "rgba(255,255,255,0.1)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.12)",
    },
    routeAlternativeActive: {
      flex: 1.15,
      minWidth: 0,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: "rgba(10,132,255,0.22)",
      borderWidth: 1,
      borderColor: "rgba(125,220,255,0.52)",
    },
    routeAlternativeTitle: {
      color: "#ffffff",
      fontSize: ui.tablet ? 15 : 13,
      fontWeight: "900",
    },
    routeAlternativeMeta: {
      marginTop: 4,
      color: "rgba(217,232,248,0.68)",
      fontSize: ui.tablet ? 13 : 11,
      fontWeight: "700",
    },
    startTripButton: {
      marginHorizontal: ui.tablet ? 24 : 18,
      marginBottom: 14,
      minHeight: ui.tablet ? 58 : 54,
      borderRadius: 22,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      backgroundColor: "#7CFF9B",
      shadowColor: "#34c759",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.28,
      shadowRadius: 18,
      elevation: 12,
    },
    startTripButtonText: {
      color: "#052e1a",
      fontSize: ui.tablet ? 17 : 15,
      fontWeight: "900",
      letterSpacing: 0.2,
    },
    bottomSheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "#fbfbfc",
      borderTopLeftRadius: ui.tablet ? 24 : 22,
      borderTopRightRadius: ui.tablet ? 24 : 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.08)",
      overflow: "hidden",
      zIndex: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.14,
      shadowRadius: 18,
      elevation: 18,
    },
    sheetHandleWrap: {
      alignItems: "center",
      paddingTop: 12,
      paddingBottom: 4,
    },
    sheetHandle: {
      width: 48,
      height: 5,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.34)",
    },
    directionsHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: ui.tablet ? 20 : 16,
      paddingTop: ui.tablet ? 14 : 12,
      paddingBottom: ui.tablet ? 14 : 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#e8eaed",
    },
    directionsHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
    directionsHeaderTitleWrap: { flex: 1, minWidth: 0 },
    directionsHeaderTitle: { fontSize: ui.tablet ? 18 : ui.compact ? 14 : 16, fontWeight: "700", color: "#202124" },
    directionsHeaderSubtitle: {
      marginTop: 2,
      fontSize: ui.tablet ? 13 : 12,
      fontWeight: "500",
      color: "#5f6368",
    },
    stepCountPill: {
      minWidth: 24,
      height: 24,
      paddingHorizontal: 9,
      borderRadius: 12,
      backgroundColor: "#e8f0fe",
      alignItems: "center",
      justifyContent: "center",
    },
    stepCountPillText: { fontSize: 12, fontWeight: "700", color: "#1a73e8" },
    directionsChevronWrap: {
      width: ui.tablet ? 34 : 32,
      height: ui.tablet ? 34 : 32,
      borderRadius: 999,
      backgroundColor: "#f1f3f4",
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 10,
    },
    maneuverList: {} as any,
    maneuverListContent: {
      paddingTop: ui.tablet ? 10 : 8,
      paddingHorizontal: ui.tablet ? 24 : 18,
      paddingBottom: ui.tablet ? 20 : 16,
      gap: 8,
    } as any,
    stepCard: {
      paddingVertical: ui.tablet ? 14 : 12,
      paddingHorizontal: ui.tablet ? 14 : 12,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.12)",
      backgroundColor: "rgba(255,255,255,0.09)",
    },
    stepCardActive: {
      paddingVertical: ui.tablet ? 14 : 12,
      paddingHorizontal: ui.tablet ? 14 : 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: "rgba(125,220,255,0.5)",
      backgroundColor: "rgba(10,132,255,0.24)",
      shadowColor: "#0a84ff",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.14,
      shadowRadius: 10,
      elevation: 2,
    },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 } as any,
    stepBody: { flex: 1, minWidth: 0, gap: 4 } as any,
    stepIndexBadge: {
      minWidth: 24,
      height: 24,
      paddingHorizontal: 6,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    stepIndexBadgeActive: {
      minWidth: 24,
      height: 24,
      paddingHorizontal: 6,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(125,220,255,0.24)",
    },
    stepIndexBadgeText: {
      fontSize: 11,
      fontWeight: "800",
      color: "rgba(217,232,248,0.76)",
    },
    stepIndexBadgeTextActive: {
      fontSize: 11,
      fontWeight: "800",
      color: "#ffffff",
    },
    stepIconWrap: {
      width: ui.tablet ? 40 : ui.compact ? 32 : 36,
      height: ui.tablet ? 40 : ui.compact ? 32 : 36,
      borderRadius: ui.tablet ? 20 : ui.compact ? 16 : 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    stepIconWrapActive: {
      width: ui.tablet ? 40 : ui.compact ? 32 : 36,
      height: ui.tablet ? 40 : ui.compact ? 32 : 36,
      borderRadius: ui.tablet ? 20 : ui.compact ? 16 : 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#0a84ff",
    },
    stepText: {
      fontSize: ui.tablet ? 17 : ui.compact ? 14 : 15,
      fontWeight: "700",
      color: "rgba(255,255,255,0.9)",
      lineHeight: ui.tablet ? 23 : ui.compact ? 19 : 20,
    },
    stepTextActive: {
      fontSize: ui.tablet ? 17 : ui.compact ? 14 : 15,
      fontWeight: "800",
      color: "#ffffff",
      lineHeight: ui.tablet ? 23 : ui.compact ? 19 : 20,
    },
    stepMeta: { fontSize: ui.tablet ? 13 : 12, fontWeight: "700", color: "rgba(217,232,248,0.6)" },
    stepMetaActive: { fontSize: ui.tablet ? 13 : 12, fontWeight: "800", color: "#a8e8ff" },
  });
}

export default ResponderIncidentMapScreen;
