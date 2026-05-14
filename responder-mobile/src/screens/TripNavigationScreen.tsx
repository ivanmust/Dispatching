import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ResponderMapWebView, type MapRouteManeuver } from "../components/ResponderMapWebView";
import { Screen } from "../ui/Screen";
import { useNavigationSession } from "../navigation/useNavigationSession";

type TripNavigationParams = {
  incidentId?: string;
  lat?: number;
  lon?: number;
  title?: string;
};

function formatDistance(meters?: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  const safe = Math.max(0, Number(meters));
  if (safe < 1000) return `${Math.round(safe)} m`;
  return `${(safe / 1000).toFixed(1)} km`;
}

function formatEta(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const safe = Math.max(0, Number(minutes));
  if (safe <= 0) return "Arriving";
  if (safe < 1) return "<1 min";
  return `${Math.max(1, Math.round(safe))} min`;
}

function formatArrivalClock(minutes?: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const arrival = new Date(Date.now() + Math.max(0, Number(minutes)) * 60_000);
  return arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function maneuverIconName(text?: string): keyof typeof Ionicons.glyphMap {
  const t = String(text ?? "").toLowerCase();
  if (t.includes("u-turn")) return "return-up-back";
  if (t.includes("roundabout")) return "sync-outline";
  if (t.includes("right")) return "arrow-forward";
  if (t.includes("left")) return "arrow-back";
  if (t.includes("arrive")) return "flag";
  return "arrow-up";
}

function towardInstruction(text?: string, fallback?: string): string {
  const raw = String(text ?? "").trim();
  if (!raw || raw === "—") return fallback ? `Toward ${fallback}` : "Follow route";
  if (/arriv/i.test(raw)) return raw;
  const onMatch = raw.match(/\bon\s+(.+)$/i);
  if (onMatch?.[1]) return `Toward ${onMatch[1].trim()}`;
  return raw;
}

export function TripNavigationScreen({ route, navigation }: { route?: { params?: TripNavigationParams }; navigation?: any }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const styles = useMemo(() => createTripNavigationStyles({ compact }), [compact]);
  const [gpsRecenterNonce, setGpsRecenterNonce] = useState(0);
  const [followPausedByGesture, setFollowPausedByGesture] = useState(false);
  const [mapAuthPromptVisible, setMapAuthPromptVisible] = useState(false);
  const followResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenInstructionRef = useRef("");

  const destination = useMemo(() => {
    const lat = Number(route?.params?.lat);
    const lon = Number(route?.params?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }, [route?.params?.lat, route?.params?.lon]);

  const incidentId = route?.params?.incidentId ?? null;
  const {
    routePath,
    etaMinutes,
    distanceMeters,
    maneuvers,
    currentManeuverIndex,
    nextInstruction,
    spokenEnabled,
    setSpokenEnabled,
    handleLocationUpdate,
    navigationFollowActive,
  } = useNavigationSession({
    destination,
    hasNavigationTarget: !!destination,
    navigationIncidentId: incidentId,
  });

  useEffect(() => {
    if (!spokenEnabled) return;
    const instruction = String(nextInstruction ?? "").trim();
    if (!instruction || instruction === "—") return;
    const normalized = instruction.toLowerCase();
    if (normalized === lastSpokenInstructionRef.current) return;
    lastSpokenInstructionRef.current = normalized;
    Speech.stop();
    void Speech.speak(normalized === "you have arrived" ? "You have arrived at the incident location." : instruction, {
      rate: 0.96,
      pitch: 1,
    });
  }, [nextInstruction, spokenEnabled]);

  useEffect(() => {
    return () => {
      Speech.stop();
      if (followResumeTimerRef.current) clearTimeout(followResumeTimerRef.current);
    };
  }, []);

  const recenter = useCallback(() => {
    setFollowPausedByGesture(false);
    if (followResumeTimerRef.current) {
      clearTimeout(followResumeTimerRef.current);
      followResumeTimerRef.current = null;
    }
    setGpsRecenterNonce((n) => n + 1);
  }, []);

  const exitTrip = useCallback(() => {
    Speech.stop();
    navigation?.goBack?.();
  }, [navigation]);

  const effectiveFollow = navigationFollowActive && !followPausedByGesture;
  const currentStep = maneuvers[currentManeuverIndex];
  const instruction = towardInstruction(nextInstruction, route?.params?.title);

  return (
    <Screen style={styles.root} padded={false}>
      <View style={styles.mapRoot}>
        <ResponderMapWebView
          focusTarget={effectiveFollow ? null : destination}
          gpsRecenterNonce={gpsRecenterNonce}
          floatingZoomControls={false}
          embedMapControls={false}
          mapPerspectiveMode="satellite"
          incidentPins={
            destination
              ? [{ id: incidentId ?? "trip-destination", lat: destination.lat, lon: destination.lon, title: route?.params?.title }]
              : []
          }
          selectedIncidentId={incidentId}
          routePath={routePath}
          maneuvers={maneuvers as MapRouteManeuver[]}
          currentManeuverIndex={currentManeuverIndex}
          navigationFollowActive={effectiveFollow}
          navigationHeadingUp
          onLocationUpdate={handleLocationUpdate}
          onAuthPromptChange={setMapAuthPromptVisible}
          onUserMapGesture={() => {
            if (!navigationFollowActive) return;
            setFollowPausedByGesture(true);
            if (followResumeTimerRef.current) clearTimeout(followResumeTimerRef.current);
            followResumeTimerRef.current = setTimeout(() => {
              setFollowPausedByGesture(false);
              followResumeTimerRef.current = null;
            }, 30_000);
          }}
        />

        {!mapAuthPromptVisible ? (
          <>
            <View style={[styles.topBanner, { top: insets.top + 12, left: 14, right: 84 }]}>
              <View style={styles.turnIcon}>
                <Ionicons name={maneuverIconName(nextInstruction)} size={26} color="#072314" />
              </View>
              <View style={styles.bannerTextBlock}>
                <Text style={styles.bannerEyebrow} numberOfLines={1}>
                  {currentStep ? `Step ${Math.min(currentManeuverIndex + 1, maneuvers.length)} of ${maneuvers.length}` : "Live navigation"}
                </Text>
                <Text style={styles.bannerInstruction} numberOfLines={2}>
                  {instruction}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.bannerVoiceButton}
                onPress={() => setSpokenEnabled((v) => !v)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={spokenEnabled ? "Mute trip voice" : "Enable trip voice"}
              >
                <Ionicons name={spokenEnabled ? "mic" : "mic-off"} size={20} color="#d9ffe6" />
              </TouchableOpacity>
            </View>

            <View style={[styles.rightControls, { top: insets.top + 12, right: 14 }]}>
              <TouchableOpacity style={styles.roundButton} onPress={recenter} activeOpacity={0.86}>
                <Ionicons name="navigate" size={22} color={effectiveFollow ? "#7CFF9B" : "#ffffff"} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.roundButton}
                onPress={() => Alert.alert("Search", "Search can be opened from the ESRI map tools after exiting active navigation.")}
                activeOpacity={0.86}
              >
                <Ionicons name="search" size={22} color="#ffffff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.roundButton} onPress={() => setSpokenEnabled((v) => !v)} activeOpacity={0.86}>
                <Ionicons name={spokenEnabled ? "volume-high" : "volume-mute"} size={22} color="#ffffff" />
              </TouchableOpacity>
            </View>

            <View style={[styles.bottomPanel, { paddingBottom: Math.max(insets.bottom, 12), left: 0, right: 0 }]}>
              <View style={styles.panelHandle} />
              <View style={styles.metricsRow}>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>Remaining</Text>
                  <Text style={styles.metricValue}>{formatEta(etaMinutes)}</Text>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>Distance</Text>
                  <Text style={styles.metricValue}>{formatDistance(distanceMeters)}</Text>
                </View>
                <View style={styles.metricBlock}>
                  <Text style={styles.metricLabel}>ETA</Text>
                  <Text style={styles.metricValue}>{formatArrivalClock(etaMinutes)}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.exitButton} onPress={exitTrip} activeOpacity={0.9}>
                <Ionicons name="close-circle" size={20} color="#ffffff" />
                <Text style={styles.exitButtonText}>Exit Trip</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

function createTripNavigationStyles({ compact }: { compact: boolean }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: "#000" },
    mapRoot: { flex: 1, position: "relative" },
    topBanner: {
      position: "absolute",
      zIndex: 24,
      minHeight: compact ? 86 : 92,
      borderRadius: 26,
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: "rgba(8, 64, 38, 0.9)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(160,255,190,0.35)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.28,
      shadowRadius: 22,
      elevation: 18,
    },
    turnIcon: {
      width: compact ? 54 : 58,
      height: compact ? 54 : 58,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#7CFF9B",
    },
    bannerTextBlock: { flex: 1, minWidth: 0 },
    bannerEyebrow: {
      color: "rgba(218,255,230,0.76)",
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    bannerInstruction: {
      marginTop: 3,
      color: "#ffffff",
      fontSize: compact ? 18 : 20,
      lineHeight: compact ? 23 : 25,
      fontWeight: "900",
      letterSpacing: -0.3,
    },
    bannerVoiceButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.14)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.18)",
    },
    rightControls: {
      position: "absolute",
      zIndex: 25,
      gap: 10,
    },
    roundButton: {
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(8, 14, 23, 0.78)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.2)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.28,
      shadowRadius: 16,
      elevation: 14,
    },
    bottomPanel: {
      position: "absolute",
      bottom: 0,
      zIndex: 22,
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      paddingHorizontal: 18,
      paddingTop: 12,
      backgroundColor: "rgba(7, 12, 20, 0.93)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.18)",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -14 },
      shadowOpacity: 0.34,
      shadowRadius: 28,
      elevation: 24,
    },
    panelHandle: {
      alignSelf: "center",
      width: 54,
      height: 5,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.34)",
      marginBottom: 16,
    },
    metricsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 14,
    },
    metricBlock: {
      flex: 1,
      minWidth: 0,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: "rgba(255,255,255,0.1)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.14)",
    },
    metricLabel: {
      color: "rgba(217,232,248,0.62)",
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    metricValue: {
      marginTop: 4,
      color: "#ffffff",
      fontSize: compact ? 15 : 17,
      fontWeight: "900",
      letterSpacing: -0.3,
    },
    exitButton: {
      minHeight: 52,
      borderRadius: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: "rgba(255,69,58,0.9)",
    },
    exitButtonText: {
      color: "#ffffff",
      fontSize: 15,
      fontWeight: "900",
    },
  });
}

export default TripNavigationScreen;
