import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  NAV_ARRIVAL_METERS,
  NAV_OFF_ROUTE_METERS,
  NAV_ROUTE_REFRESH_MIN_INTERVAL_MS,
} from "../config";
import type { MapLocationSample, MapRoutePathPoint } from "../components/ResponderMapWebView";
import {
  haversineMeters,
  maneuverIndexForProgress,
  nearestProgressOnPolyline,
  remainingEtaMinutes,
} from "./routeNavigation";
import {
  resolveNavigationRoute,
  type NavigationManeuverRow,
  type ResolvedNavigationRoute,
} from "./navigationRouteService";

const FORCE_REROUTE_COOLDOWN_MS = 12_000;
const SOFT_ROUTE_REFRESH_MS = 180_000;
const LIVE_NAV_PUBLISH_MIN_INTERVAL_MS = 8_000;
const LIVE_NAV_PUBLISH_DISTANCE_DELTA_METERS = 30;
const LIVE_NAV_PUBLISH_ETA_DELTA_MINUTES = 0.5;

type LiveSessionRef = {
  apiEtaMinutes: number;
  displayTotalMeters: number;
  maneuverThresholds: number[];
};

export function useNavigationSession({
  destination,
  hasNavigationTarget,
  navigationIncidentId,
}: {
  destination: { lat: number; lon: number } | null;
  hasNavigationTarget: boolean;
  navigationIncidentId: string | null;
}) {
  const [routePath, setRoutePath] = useState<MapRoutePathPoint[] | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [maneuvers, setManeuvers] = useState<NavigationManeuverRow[]>([]);
  const [currentManeuverIndex, setCurrentManeuverIndex] = useState(0);
  const [directionsExpanded, setDirectionsExpanded] = useState(false);
  const [routeStatus, setRouteStatus] = useState<string>("Waiting for GPS...");
  const [nextInstruction, setNextInstruction] = useState<string>("—");
  const [spokenEnabled, setSpokenEnabled] = useState(true);
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugMetrics, setDebugMetrics] = useState<{
    offRouteMeters: number | null;
    progressedMeters: number | null;
    remainingMeters: number | null;
    routeTotalMeters: number | null;
    maneuverIndex: number;
    gpsAccuracyMeters: number | null;
    gpsSpeedMps: number | null;
  }>({
    offRouteMeters: null,
    progressedMeters: null,
    remainingMeters: null,
    routeTotalMeters: null,
    maneuverIndex: 0,
    gpsAccuracyMeters: null,
    gpsSpeedMps: null,
  });

  const lastRouteFetchAtRef = useRef(0);
  const lastForcedRerouteAtRef = useRef(0);
  const lastOriginRef = useRef<{ lat: number; lon: number } | null>(null);
  const routeLiveRef = useRef<LiveSessionRef>({
    apiEtaMinutes: 0,
    displayTotalMeters: 0,
    maneuverThresholds: [],
  });
  const maneuversRef = useRef(maneuvers);
  maneuversRef.current = maneuvers;
  const lastManeuverIdxRef = useRef(0);
  const routeRequestInFlightRef = useRef(false);
  const lastLivePublishRef = useRef<{
    at: number;
    distanceMeters: number | null;
    etaMinutes: number | null;
  }>({ at: 0, distanceMeters: null, etaMinutes: null });

  const distanceToDestinationMeters = useCallback((from: { lat: number; lon: number }, to: { lat: number; lon: number }) => {
    return haversineMeters(from, to);
  }, []);

  const applyResolvedRoute = useCallback(
    (resolved: ResolvedNavigationRoute, origin: { lat: number; lon: number }) => {
      routeLiveRef.current = {
        apiEtaMinutes: resolved.apiEtaMinutes,
        displayTotalMeters: resolved.displayTotalMeters,
        maneuverThresholds: resolved.maneuverThresholds,
      };
      setRoutePath(resolved.path);
      setEtaMinutes(
        typeof resolved.publishEtaMinutes === "number" && Number.isFinite(resolved.publishEtaMinutes)
          ? resolved.publishEtaMinutes
          : null
      );
      setDistanceMeters(resolved.displayTotalMeters);
      setManeuvers(resolved.maneuvers);
      setCurrentManeuverIndex(0);
      lastManeuverIdxRef.current = 0;
      setNextInstruction(resolved.maneuvers[0]?.text ?? "Continue to destination");
      setRouteStatus("Navigating");
      if (navigationIncidentId) {
        const pubEta =
          typeof resolved.publishEtaMinutes === "number" && Number.isFinite(resolved.publishEtaMinutes)
            ? resolved.publishEtaMinutes
            : undefined;
        lastLivePublishRef.current = {
          at: Date.now(),
          distanceMeters: resolved.displayTotalMeters,
          etaMinutes: pubEta ?? null,
        };
        void api.publishNavigationUpdate({
          incidentId: navigationIncidentId,
          origin,
          path: resolved.path,
          distanceMeters: resolved.displayTotalMeters,
          etaMinutes: pubEta,
          routeUnavailable: resolved.routeUnavailable,
          routingEngine: "arcgis",
        });
      }
    },
    [navigationIncidentId]
  );

  const clearRouteError = useCallback(
    (origin: { lat: number; lon: number }) => {
      routeLiveRef.current = { apiEtaMinutes: 0, displayTotalMeters: 0, maneuverThresholds: [] };
      setRoutePath(null);
      setManeuvers([]);
      setEtaMinutes(null);
      setDistanceMeters(null);
      if (navigationIncidentId) {
        lastLivePublishRef.current = {
          at: Date.now(),
          distanceMeters: 0,
          etaMinutes: 0,
        };
        void api.publishNavigationUpdate({
          incidentId: navigationIncidentId,
          origin,
          path: [],
          distanceMeters: 0,
          etaMinutes: 0,
          routeUnavailable: true,
          routingEngine: "fallback",
        });
      }
    },
    [navigationIncidentId]
  );

  const requestRoute = useCallback(
    async (origin: { lat: number; lon: number }, force = false) => {
      if (!destination) return;
      if (routeRequestInFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastRouteFetchAtRef.current < NAV_ROUTE_REFRESH_MIN_INTERVAL_MS) return;
      const prev = lastOriginRef.current;
      if (!force && prev) {
        const moved = Math.hypot((origin.lat - prev.lat) * 111_000, (origin.lon - prev.lon) * 111_000);
        if (moved < 15) return;
      }
      lastRouteFetchAtRef.current = now;
      lastOriginRef.current = origin;
      setRouteStatus("Calculating route...");
      routeRequestInFlightRef.current = true;
      try {
        const resolved = await resolveNavigationRoute(origin, destination);
        applyResolvedRoute(resolved, origin);
      } catch (e: any) {
        clearRouteError(origin);
        setRouteStatus(e?.message ? `Route error: ${e.message}` : "Route unavailable");
      } finally {
        routeRequestInFlightRef.current = false;
      }
    },
    [destination, applyResolvedRoute, clearRouteError]
  );

  useEffect(() => {
    if (routePath?.length || !destination) return;
    setRouteStatus("Waiting for GPS...");
  }, [destination, routePath?.length]);

  const handleLocationUpdate = useCallback(
    (next: MapLocationSample) => {
      if (!hasNavigationTarget) return;
      const current = { lat: next.lat, lon: next.lon };
      if (destination) {
        const toDest = distanceToDestinationMeters(current, destination);
        if (toDest <= NAV_ARRIVAL_METERS) {
          setRouteStatus("Arrived at incident location");
          setEtaMinutes(0);
          setDistanceMeters(0);
          setNextInstruction("You have arrived");
          if (navigationIncidentId) {
            void api.publishNavigationUpdate({
              incidentId: navigationIncidentId,
              origin: current,
              path: routePath ?? [],
              distanceMeters: 0,
              etaMinutes: 0,
              routeUnavailable: !(routePath && routePath.length >= 2),
              routingEngine: "arcgis",
            });
          }
          return;
        }
      }

      if (routePath && routePath.length >= 2) {
        const { progressMeters, offRouteMeters } = nearestProgressOnPolyline(current, routePath);
        const totalRouteMeters = routeLiveRef.current.displayTotalMeters;
        const remainingMeters = Math.max(0, totalRouteMeters - progressMeters);
        const thresholds = routeLiveRef.current.maneuverThresholds;
        const stepIdx =
          thresholds.length > 0 && maneuversRef.current.length > 0
            ? maneuverIndexForProgress(progressMeters, thresholds)
            : lastManeuverIdxRef.current;

        if (offRouteMeters > NAV_OFF_ROUTE_METERS) {
          const now = Date.now();
          if (now - lastForcedRerouteAtRef.current < FORCE_REROUTE_COOLDOWN_MS) return;
          lastForcedRerouteAtRef.current = now;
          setRouteStatus("Off route — recalculating…");
          void requestRoute(current, true);
          return;
        }

        if (Number.isFinite(remainingMeters)) setDistanceMeters(remainingMeters);
        const apiEta = routeLiveRef.current.apiEtaMinutes;
        let liveEtaMinutes: number | null = null;
        if (apiEta > 0 && totalRouteMeters > 0) {
          liveEtaMinutes = remainingEtaMinutes(apiEta, remainingMeters, totalRouteMeters);
          setEtaMinutes(liveEtaMinutes);
        } else if (remainingMeters <= NAV_ARRIVAL_METERS) {
          liveEtaMinutes = 0;
          setEtaMinutes(0);
        }

        if (navigationIncidentId && Number.isFinite(remainingMeters)) {
          const now = Date.now();
          const previous = lastLivePublishRef.current;
          const distanceDelta =
            typeof previous.distanceMeters === "number"
              ? Math.abs(previous.distanceMeters - remainingMeters)
              : Number.POSITIVE_INFINITY;
          const etaDelta =
            typeof previous.etaMinutes === "number" && typeof liveEtaMinutes === "number"
              ? Math.abs(previous.etaMinutes - liveEtaMinutes)
              : Number.POSITIVE_INFINITY;
          const shouldPublish =
            now - previous.at >= LIVE_NAV_PUBLISH_MIN_INTERVAL_MS ||
            distanceDelta >= LIVE_NAV_PUBLISH_DISTANCE_DELTA_METERS ||
            etaDelta >= LIVE_NAV_PUBLISH_ETA_DELTA_MINUTES;

          if (shouldPublish) {
            lastLivePublishRef.current = {
              at: now,
              distanceMeters: remainingMeters,
              etaMinutes: liveEtaMinutes,
            };
            void api.publishNavigationUpdate({
              incidentId: navigationIncidentId,
              origin: current,
              path: routePath,
              distanceMeters: remainingMeters,
              etaMinutes: liveEtaMinutes ?? undefined,
              routeUnavailable: false,
              routingEngine: "arcgis",
            });
          }
        }

        setDebugMetrics((prev) => ({
          ...prev,
          offRouteMeters,
          progressedMeters: progressMeters,
          remainingMeters,
          routeTotalMeters: totalRouteMeters,
          maneuverIndex: stepIdx,
          gpsAccuracyMeters: next.accuracyMeters ?? null,
          gpsSpeedMps: next.speedMps ?? null,
        }));

        if (thresholds.length > 0 && maneuversRef.current.length > 0 && stepIdx !== lastManeuverIdxRef.current) {
          lastManeuverIdxRef.current = stepIdx;
          setCurrentManeuverIndex(stepIdx);
          const t = maneuversRef.current[stepIdx]?.text;
          if (t) setNextInstruction(t);
        }

        const now = Date.now();
        if (now - lastRouteFetchAtRef.current > SOFT_ROUTE_REFRESH_MS) {
          void requestRoute(current, false);
        }
        return;
      }

      void requestRoute(current, true);
    },
    [hasNavigationTarget, destination, routePath, distanceToDestinationMeters, requestRoute, navigationIncidentId]
  );

  const selectManeuverStep = useCallback((idx: number, instruction: string) => {
    lastManeuverIdxRef.current = idx;
    setCurrentManeuverIndex(idx);
    setNextInstruction(instruction);
  }, []);

  const routeStatusIsError = /error|unavailable/i.test(routeStatus);
  const navigationFollowActive =
    hasNavigationTarget &&
    routeStatus === "Navigating" &&
    !routeStatusIsError &&
    !!routePath &&
    routePath.length >= 2;

  const maneuversWithPathCount = useMemo(
    () => maneuvers.filter((m) => Array.isArray(m.path) && m.path.length >= 2).length,
    [maneuvers]
  );
  const activePathPoints = useMemo(() => {
    const path = maneuvers[currentManeuverIndex]?.path;
    return Array.isArray(path) ? path.length : 0;
  }, [maneuvers, currentManeuverIndex]);

  return {
    routePath,
    etaMinutes,
    distanceMeters,
    maneuvers,
    currentManeuverIndex,
    directionsExpanded,
    setDirectionsExpanded,
    routeStatus,
    routeStatusIsError,
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
  };
}
