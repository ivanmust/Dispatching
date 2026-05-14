import React from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ESRI_MAP_NAVIGATION_MINIMAL, ESRI_PORTAL_MAP_VIEWER_URL } from "../config";
import { api } from "../lib/api";
import { useAppTheme } from "../contexts/ThemePreferenceContext";
import type { ThemeTokens } from "../ui/theme";
import { buildControlledMapHtml } from "../map/controlledMapHtml";

/**
 * Sample emitted by `onLocationUpdate`. Replaces the old `NavigationLocationSample`
 * type that lived in the (now-deleted) turn-by-turn navigation package.
 */
export type MapLocationSample = {
  lat: number;
  lon: number;
  timestampMs: number;
  speedMps: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
};

type MapFocusTarget = { id?: string; lat: number; lon: number } | null;

/**
 * Incident pin payload for the map. Status/priority/category/title are optional; when status is
 * provided the map renders the pin using the dispatcher's status color + clustered GeoJSON layer.
 */
export type IncidentMapPin = {
  id?: string;
  lat: number;
  lon: number;
  status?: string;
  priority?: string;
  category?: string;
  title?: string;
};

/** Other responders in the fleet (for situational-awareness parity with the dispatcher console). */
export type ResponderFleetMarker = {
  id: string;
  lat: number;
  lon: number;
  /** When false the responder is rendered as "busy" (orange car). Defaults to true. */
  available?: boolean;
  name?: string;
};

export type MapPointOfInterest = {
  id: string;
  type: string;
  lat: number;
  lon: number;
  label?: string | null;
};

export type MapGeofence = {
  id: string;
  name: string;
  geometry: Record<string, unknown>;
};

export type MapRoutePathPoint = { lat: number; lon: number };
export type MapRouteManeuver = {
  text: string;
  lengthMeters?: number;
  timeMinutes?: number;
  path?: MapRoutePathPoint[] | null;
};

export function ResponderMapWebView({
  focusTarget,
  onLocationUpdate,
  incidentPins,
  pickMode,
  onMapPick,
  syncResponderLocation = true,
  onIncidentPinPress,
  onUserMapGesture,
  onAuthPromptChange,
  /** Increment to center map on current GPS (used by external “my location” FAB). */
  gpsRecenterNonce = 0,
  /** When false, Esri map omits embedded Zoom / Home / Locate widgets (app provides overlays). Default true. */
  embedMapControls = true,
  /** Google Maps–style floating + / − buttons (injected zoom only). Default true. */
  floatingZoomControls = true,
  /** Optional fixed top position (px) for the +/− stack; overrides automatic placement when set. */
  floatingZoomTopOverride,
  zoomCommand,
  /** ESRI-only quick perspective mode: default map or satellite-like overview. */
  mapPerspectiveMode = "default",
  /**
   * When true, the map uses a slimmed-down look (slim "arcgis-navigation" basemap,
   * no POI / village / admin overlay layers, Search widget hidden). Defaults to the
   * value of `ESRI_MAP_NAVIGATION_MINIMAL` (env: `EXPO_PUBLIC_ESRI_MAP_NAVIGATION_MINIMAL`).
   * The flag is named "navigation" for historical reasons but it is purely about basemap
   * polish -- the dedicated turn-by-turn navigation feature has been removed.
   */
  navigationMinimal = ESRI_MAP_NAVIGATION_MINIMAL,
  /** Currently-selected incident (drawn with a larger highlight, pan-to on change). */
  selectedIncidentId,
  /** Fleet of other responders to render as car markers (Available / Busy / Suggested). */
  responders,
  /** Highlight a specific responder as "suggested" (yellow + larger, mirrors dispatcher). */
  suggestedResponderId,
  /** Points of interest (AED / hydrant / first_aid) to render on top of the basemap. */
  pointsOfInterest,
  /** Dispatcher geofences (currently only `{ type: "circle", lat, lon, radiusMeters }` is drawn). */
  geofences,
  routePath,
  routeStepPath,
  maneuvers,
  currentManeuverIndex,
  /** Recenters the map on GPS while navigating; uses throttled inject + optional heading-up rotation. */
  navigationFollowActive = false,
  /** When true with `navigationFollowActive`, rotate map using device course (when available). Default true. */
  navigationHeadingUp = true,
}: {
  focusTarget?: MapFocusTarget;
  onLocationUpdate?: (coords: MapLocationSample) => void;
  /** Incident / destination points (e.g. orange pins), separate from live location. */
  incidentPins?: IncidentMapPin[] | null;
  /** When true, map tap posts pick:lon,lat via onMapPick. */
  pickMode?: boolean;
  onMapPick?: (lat: number, lon: number) => void;
  /** When false, do not POST /responder/location (e.g. location-pick modal). */
  syncResponderLocation?: boolean;
  /** Map tap on an incident pin (not pick mode). */
  onIncidentPinPress?: (incidentId: string) => void;
  /** Fired when user manually drags/zooms map. */
  onUserMapGesture?: () => void;
  /** Fired when the embedded Esri sign-in dialog appears/disappears. */
  onAuthPromptChange?: (visible: boolean) => void;
  gpsRecenterNonce?: number;
  embedMapControls?: boolean;
  floatingZoomControls?: boolean;
  floatingZoomTopOverride?: number;
  zoomCommand?: { id: number; delta: number } | null;
  mapPerspectiveMode?: "default" | "satellite";
  navigationMinimal?: boolean;
  selectedIncidentId?: string | null;
  responders?: ResponderFleetMarker[] | null;
  suggestedResponderId?: string | null;
  pointsOfInterest?: MapPointOfInterest[] | null;
  geofences?: MapGeofence[] | null;
  routePath?: MapRoutePathPoint[] | null;
  routeStepPath?: MapRoutePathPoint[] | null;
  maneuvers?: MapRouteManeuver[] | null;
  currentManeuverIndex?: number;
  navigationFollowActive?: boolean;
  navigationHeadingUp?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [loading, setLoading] = React.useState(true);
  const [mapStatus, setMapStatus] = React.useState("Loading map...");
  const [coords, setCoords] = React.useState<{ lat: number; lon: number } | null>(null);
  const [mapReadyNonce, setMapReadyNonce] = React.useState(0);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const lastLocationSyncAtRef = React.useRef(0);
  const liveCoordsRef = React.useRef<{ lat: number; lon: number } | null>(null);
  const liveHeadingRef = React.useRef<number | null>(null);
  const webRef = React.useRef<WebView>(null);
  const loadingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createResponderMapWebViewStyles(theme), [theme]);
  const mapHtml = React.useMemo(
    () =>
      buildControlledMapHtml(
        ESRI_PORTAL_MAP_VIEWER_URL,
        {
        pickMode: !!pickMode,
        navigationMinimal,
        embedMapControls,
        floatingZoomControls,
        },
        {
          pageBg: theme.color.lightBg,
          widgetBg: theme.color.lightSurface,
          widgetBorder: theme.color.borderStrong,
        },
      ),
    [pickMode, embedMapControls, navigationMinimal, floatingZoomControls, theme],
  );

  React.useEffect(() => {
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const run = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (mounted) setLocationError("Location permission denied");
          return;
        }
        const current = await Location.getCurrentPositionAsync({});
        if (mounted) {
          const c = { lat: current.coords.latitude, lon: current.coords.longitude };
          liveCoordsRef.current = c;
          setCoords(c);
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1200,
            distanceInterval: 1,
          },
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
            liveCoordsRef.current = { lat: next.lat, lon: next.lon };
            const hd = next.headingDegrees;
            liveHeadingRef.current =
              typeof hd === "number" && Number.isFinite(hd) && hd >= 0 && hd <= 360 ? hd : null;
            setCoords({ lat: next.lat, lon: next.lon });
            onLocationUpdate?.(next);
            if (syncResponderLocation) void maybeSyncResponderLocation(next);
          },
        );
      } catch (e: any) {
        if (mounted) setLocationError(e?.message ?? "Unable to get location");
      }
    };

    void run();
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [onLocationUpdate, syncResponderLocation]);

  const wasNavigationFollowRef = React.useRef(false);
  React.useEffect(() => {
    if (navigationFollowActive) {
      wasNavigationFollowRef.current = true;
      return;
    }
    if (!wasNavigationFollowRef.current) return;
    wasNavigationFollowRef.current = false;
    const script = `
      (function () {
        if (typeof window.__dispatchClearNavigationFollow === "function") {
          window.__dispatchClearNavigationFollow();
        }
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [navigationFollowActive]);

  React.useEffect(() => {
    if (!navigationFollowActive) return;
    const tick = () => {
      const c = liveCoordsRef.current;
      if (!c || !webRef.current) return;
      const h = liveHeadingRef.current;
      const rot = navigationHeadingUp !== false;
      const hJs = h != null && Number.isFinite(h) ? String(h) : "null";
      const script = `
        (function () {
          if (typeof window.__dispatchSetNavigationFollow === "function") {
            window.__dispatchSetNavigationFollow(${c.lon}, ${c.lat}, ${hJs}, ${rot ? "true" : "false"});
          }
          true;
        })();
      `;
      webRef.current?.injectJavaScript(script);
    };
    tick();
    const id = setInterval(tick, 480);
    return () => clearInterval(id);
  }, [navigationFollowActive, navigationHeadingUp]);

  React.useEffect(() => {
    if (!focusTarget || navigationFollowActive) return;
    const script = `
      (function () {
        if (window.__dispatchSetFocus) {
          window.__dispatchSetFocus(${focusTarget.lon}, ${focusTarget.lat}, 16);
        }
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [focusTarget?.id, focusTarget?.lat, focusTarget?.lon, navigationFollowActive]);

  const lastGpsRecenterRef = React.useRef(0);
  React.useEffect(() => {
    if (gpsRecenterNonce <= 0) return;
    if (gpsRecenterNonce === lastGpsRecenterRef.current) return;
    lastGpsRecenterRef.current = gpsRecenterNonce;
    if (!coords) return;
    const zoom = 16;
    const script = `
      (function () {
        if (window.__dispatchSetFocus) {
          window.__dispatchSetFocus(${coords.lon}, ${coords.lat}, ${zoom});
        }
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [gpsRecenterNonce, coords?.lat, coords?.lon]);

  React.useEffect(() => {
    const payload = JSON.stringify({ pins: incidentPins ?? [] });
    const script = `
      (function () {
        try {
          window.__dispatchIncidentPinsPayload = ${payload};
          if (typeof window.__dispatchSetIncidentPins === "function") {
            window.__dispatchSetIncidentPins(window.__dispatchIncidentPinsPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [incidentPins]);

  React.useEffect(() => {
    const payload = JSON.stringify({ id: selectedIncidentId ?? null });
    const script = `
      (function () {
        try {
          window.__dispatchSelectedIncidentPayload = ${payload};
          if (typeof window.__dispatchSetSelectedIncident === "function") {
            window.__dispatchSetSelectedIncident(window.__dispatchSelectedIncidentPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [selectedIncidentId]);

  React.useEffect(() => {
    const payload = JSON.stringify({
      responders: responders ?? [],
      suggestedResponderId: suggestedResponderId ?? null,
    });
    const script = `
      (function () {
        try {
          window.__dispatchRespondersPayload = ${payload};
          if (typeof window.__dispatchSetResponders === "function") {
            window.__dispatchSetResponders(window.__dispatchRespondersPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [responders, suggestedResponderId]);

  React.useEffect(() => {
    const payload = JSON.stringify({ pois: pointsOfInterest ?? [] });
    const script = `
      (function () {
        try {
          window.__dispatchPoiPayload = ${payload};
          if (typeof window.__dispatchSetPointsOfInterest === "function") {
            window.__dispatchSetPointsOfInterest(window.__dispatchPoiPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [pointsOfInterest]);

  React.useEffect(() => {
    const payload = JSON.stringify({ geofences: geofences ?? [] });
    const script = `
      (function () {
        try {
          window.__dispatchGeofencesPayload = ${payload};
          if (typeof window.__dispatchSetGeofences === "function") {
            window.__dispatchSetGeofences(window.__dispatchGeofencesPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [geofences]);

  React.useEffect(() => {
    const payload = JSON.stringify({ path: routePath ?? [] });
    const script = `
      (function () {
        try {
          window.__dispatchRoutePayload = ${payload};
          if (typeof window.__dispatchSetRoutePath === "function") {
            window.__dispatchSetRoutePath(window.__dispatchRoutePayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [routePath]);

  React.useEffect(() => {
    const payload = JSON.stringify({ path: routeStepPath ?? [] });
    const script = `
      (function () {
        try {
          window.__dispatchRouteStepPayload = ${payload};
          if (typeof window.__dispatchSetRouteStepPath === "function") {
            window.__dispatchSetRouteStepPath(window.__dispatchRouteStepPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [routeStepPath]);

  React.useEffect(() => {
    const payload = JSON.stringify({ maneuvers: maneuvers ?? [], currentIndex: currentManeuverIndex ?? 0 });
    const script = `
      (function () {
        try {
          window.__dispatchManeuversPayload = ${payload};
          if (typeof window.__dispatchSetManeuvers === "function") {
            window.__dispatchSetManeuvers(window.__dispatchManeuversPayload);
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [maneuvers, currentManeuverIndex]);

  const injectLiveLocation = React.useCallback((next: { lat: number; lon: number } | null) => {
    if (!next) return;
    const script = `
      (function () {
        if (window.__dispatchSetLiveLocation) {
          window.__dispatchSetLiveLocation(${next.lon}, ${next.lat});
        }
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, []);

  React.useEffect(() => {
    injectLiveLocation(coords);
  }, [coords?.lat, coords?.lon, injectLiveLocation]);

  React.useEffect(() => {
    if (mapReadyNonce <= 0) return;
    injectLiveLocation(liveCoordsRef.current);
  }, [injectLiveLocation, mapReadyNonce]);

  const injectZoomDelta = React.useCallback((delta: number) => {
    const script = `
      (function () {
        try {
          if (typeof window.__dispatchZoomDelta === "function") {
            window.__dispatchZoomDelta(${delta});
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, []);

  React.useEffect(() => {
    if (!zoomCommand || !Number.isFinite(zoomCommand.delta)) return;
    injectZoomDelta(zoomCommand.delta);
  }, [injectZoomDelta, zoomCommand?.id, zoomCommand?.delta]);

  React.useEffect(() => {
    const mode = mapPerspectiveMode === "satellite" ? "satellite" : "default";
    const script = `
      (function () {
        try {
          if (typeof window.__dispatchSetPerspectiveMode === "function") {
            window.__dispatchSetPerspectiveMode(${JSON.stringify(mode)});
          }
        } catch (e) {}
        true;
      })();
    `;
    webRef.current?.injectJavaScript(script);
  }, [mapPerspectiveMode]);

  const maybeSyncResponderLocation = React.useCallback(async (next: { lat: number; lon: number }) => {
    const now = Date.now();
    // Keep backend in sync for dispatcher visibility, but throttle network chatter.
    if (now - lastLocationSyncAtRef.current < 3000) return;
    lastLocationSyncAtRef.current = now;
    try {
      await api.updateLocation(next.lat, next.lon);
    } catch {
      // Non-blocking: map should continue working even if location sync fails.
    }
  }, []);

  React.useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    };
  }, []);

  /** Keep +/− clear of top overlays (search + turn card on nav); pick map uses a smaller offset. */
  const floatingZoomTop = React.useMemo(() => {
    if (typeof floatingZoomTopOverride === "number" && Number.isFinite(floatingZoomTopOverride)) {
      return floatingZoomTopOverride;
    }
    if (pickMode) {
      return Math.max(insets.top, 8) + 56;
    }
    const preferred = Math.max(insets.top + 216, windowHeight * 0.26);
    const maxTop = windowHeight - insets.bottom - 100;
    return Math.min(preferred, Math.max(maxTop, insets.top + 140));
  }, [floatingZoomTopOverride, insets.top, insets.bottom, pickMode, windowHeight]);

  return (
    <View style={styles.container}>
      <WebView
        key={pickMode ? "map-pick" : "map-main"}
        ref={webRef}
        source={{ html: mapHtml, baseUrl: "https://esrirw.rw/" }}
        onLoadStart={() => {
          setLoading(true);
          setMapStatus("Loading map...");
          if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = setTimeout(() => {
            // Don't block interaction forever if webmap layers are slow.
            setLoading(false);
            setMapStatus("Map loaded (layers still loading)");
          }, 3500);
        }}
        onLoadEnd={() => {
          if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
          setLoading(false);
        }}
        onMessage={(event) => {
          const msg = String(event.nativeEvent.data ?? "");
          if (msg === "map-ready") {
            if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
            setMapStatus("Map ready");
            setLoading(false);
            setMapReadyNonce((n) => n + 1);
            const mode = mapPerspectiveMode === "satellite" ? "satellite" : "default";
            const script = `
              (function () {
                try {
                  if (typeof window.__dispatchSetPerspectiveMode === "function") {
                    window.__dispatchSetPerspectiveMode(${JSON.stringify(mode)});
                  }
                } catch (e) {}
                true;
              })();
            `;
            webRef.current?.injectJavaScript(script);
            return;
          }
          if (msg.startsWith("map-error:")) {
            const reason = msg.slice("map-error:".length);
            if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
            setLocationError(`Map failed to load: ${reason || "unknown error"}`);
            setLoading(false);
            return;
          }
          if (msg === "map-loading") {
            setMapStatus("Loading map layers...");
            return;
          }
          if (msg.startsWith("pick:")) {
            const rest = msg.slice(5);
            const [lonStr, latStr] = rest.split(",");
            const lon = parseFloat(lonStr);
            const lat = parseFloat(latStr);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              onMapPick?.(lat, lon);
            }
            return;
          }
          if (msg.startsWith("incidentTap:")) {
            const id = decodeURIComponent(msg.slice("incidentTap:".length).trim());
            if (id) {
              onIncidentPinPress?.(id);
            }
            return;
          }
          if (msg === "map-user-gesture") {
            onUserMapGesture?.();
            return;
          }
          if (msg === "map-auth-prompt-visible") {
            onAuthPromptChange?.(true);
            return;
          }
          if (msg === "map-auth-prompt-hidden") {
            onAuthPromptChange?.(false);
            return;
          }
        }}
        onError={() => {
          if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
          setLoading(false);
          setLocationError("WebView failed to load map (network/portal error).");
        }}
        startInLoadingState
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        style={styles.webview}
      />

      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator />
          <Text style={styles.loadingText}>{mapStatus}</Text>
        </View>
      )}

      {locationError ? (
        <View style={[styles.locationErrorWrap, { top: insets.top + 10 }]} pointerEvents="none">
          <Text style={styles.locationErrorText}>{locationError}</Text>
        </View>
      ) : null}

      {floatingZoomControls ? (
        <View
          style={[styles.floatingZoomColumn, { top: floatingZoomTop, right: Math.max(insets.right, 10) }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.floatingZoomBtn}
            onPress={() => injectZoomDelta(1)}
            activeOpacity={0.75}
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
          >
            <Text style={styles.floatingZoomBtnText}>+</Text>
          </TouchableOpacity>
          <View style={styles.floatingZoomDivider} />
          <TouchableOpacity
            style={styles.floatingZoomBtn}
            onPress={() => injectZoomDelta(-1)}
            activeOpacity={0.75}
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
          >
            <Text style={styles.floatingZoomBtnText}>−</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}


function createResponderMapWebViewStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: theme.color.black },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  loadingText: {
    marginTop: 8,
    color: theme.color.white,
    ...theme.text.sub,
  },
  locationErrorWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    alignItems: "flex-start",
  },
  locationErrorText: {
    backgroundColor: theme.color.white,
    color: theme.color.danger,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    ...theme.text.tiny,
  },
  floatingZoomColumn: {
    position: "absolute",
    zIndex: 6,
    width: 44,
    borderRadius: 10,
    backgroundColor: theme.color.white,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    ...Platform.select({
      ios: {
        shadowColor: theme.color.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  floatingZoomBtn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingZoomBtnText: {
    fontSize: 22,
    fontWeight: "400",
    color: theme.color.text,
    marginTop: -2,
  },
  floatingZoomDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.border,
  },
});
}

