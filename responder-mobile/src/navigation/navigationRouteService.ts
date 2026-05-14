/**
 * Fetches directions from the API and normalizes path + maneuvers for map + UI.
 */

import { api } from "../lib/api";
import { NAV_DEBUG_DISTANCE_CHECK } from "../config";
import type { MapRoutePathPoint } from "../components/ResponderMapWebView";
import {
  haversineMeters,
  maneuverProgressThresholds,
  normalizeManeuverTimes,
  polylineLengthMeters,
  reconcileManeuverStepMetrics,
  reconcileRouteTotalMeters,
  type RouteManeuver,
} from "./routeNavigation";

export type NavigationManeuverRow = {
  text: string;
  lengthMeters?: number;
  timeMinutes?: number;
  path?: Array<{ lat: number; lon: number }>;
};

export type ResolvedNavigationRoute = {
  path: MapRoutePathPoint[];
  maneuvers: NavigationManeuverRow[];
  displayTotalMeters: number;
  apiEtaMinutes: number;
  /** API field for dispatcher publish (unchanged). */
  publishEtaMinutes: number | null | undefined;
  maneuverThresholds: number[];
  routeUnavailable: boolean;
};

function normalizePathDirection(
  path: MapRoutePathPoint[],
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number }
): MapRoutePathPoint[] {
  if (path.length < 2) return path;
  const first = path[0];
  const last = path[path.length - 1];
  const scoreAsIs = haversineMeters(first, origin) + haversineMeters(last, destination);
  const scoreReversed = haversineMeters(last, origin) + haversineMeters(first, destination);
  return scoreReversed + 10 < scoreAsIs ? [...path].reverse() : path;
}

function sanitizeManeuverMetrics(
  maneuvers: Array<{ text: string; lengthMeters?: number; timeMinutes?: number; path?: Array<{ lat: number; lon: number }> }>,
  totalDistanceMeters: number
) {
  const total = Number.isFinite(totalDistanceMeters) ? Math.max(0, totalDistanceMeters) : 0;
  return maneuvers.map((m) => {
    let length = typeof m.lengthMeters === "number" && Number.isFinite(m.lengthMeters) ? Math.max(0, m.lengthMeters) : undefined;
    let minutes = typeof m.timeMinutes === "number" && Number.isFinite(m.timeMinutes) ? Math.max(0, m.timeMinutes) : undefined;

    if (minutes != null && minutes > 180 && total > 0) {
      const speedMps = total / (minutes * 60);
      if (speedMps < 0.5) minutes = minutes / 60;
    }

    if (length != null && total > 0 && length > total * 1.05) {
      length = Math.min(length, total);
    }

    return { ...m, lengthMeters: length, timeMinutes: minutes };
  });
}

function logRouteDistanceDiagnostics(
  totalDistanceMeters: number,
  maneuvers: Array<{ lengthMeters?: number; timeMinutes?: number }>
) {
  if (!NAV_DEBUG_DISTANCE_CHECK) return;
  const total = Number.isFinite(totalDistanceMeters) ? Math.max(0, Number(totalDistanceMeters)) : 0;
  const stepDistances = maneuvers
    .map((m) => (typeof m.lengthMeters === "number" && Number.isFinite(m.lengthMeters) ? Math.max(0, m.lengthMeters) : 0))
    .filter((v) => v > 0);
  const stepTimes = maneuvers
    .map((m) => (typeof m.timeMinutes === "number" && Number.isFinite(m.timeMinutes) ? Math.max(0, m.timeMinutes) : 0))
    .filter((v) => v > 0);
  const sumSteps = stepDistances.reduce((a, n) => a + n, 0);
  const maxStep = stepDistances.length ? Math.max(...stepDistances) : 0;
  const sumStepMinutes = stepTimes.reduce((a, n) => a + n, 0);
  const distanceMismatchPct = total > 0 ? Math.abs(sumSteps - total) / total : 0;
  const hasImpossibleStep = total > 0 && maxStep > total * 1.1;

  const payload = {
    totalDistanceMeters: Math.round(total),
    sumStepDistanceMeters: Math.round(sumSteps),
    maxStepDistanceMeters: Math.round(maxStep),
    distanceMismatchPct: Math.round(distanceMismatchPct * 1000) / 10,
    sumStepMinutes: Math.round(sumStepMinutes * 10) / 10,
    stepCount: maneuvers.length,
    hasImpossibleStep,
  };
  if (hasImpossibleStep || distanceMismatchPct > 0.35) {
    console.warn("[nav-distance-check] suspicious", payload);
  } else {
    console.info("[nav-distance-check] ok", payload);
  }
}

/**
 * Calls the backend directions API and returns geometry + maneuvers aligned to one polyline.
 */
export async function resolveNavigationRoute(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number }
): Promise<ResolvedNavigationRoute> {
  const routeData = await api.getNavigationRoute(origin, destination);
  const normalizedPath = normalizePathDirection(routeData.path ?? [], origin, destination);
  const polyM = polylineLengthMeters(normalizedPath);
  const displayTotal = reconcileRouteTotalMeters(Number(routeData.distanceMeters) || 0, polyM);
  const fallbackManeuvers =
    routeData.maneuvers && routeData.maneuvers.length > 0
      ? routeData.maneuvers
      : [
          {
            text: "Head to destination",
            lengthMeters: displayTotal,
            timeMinutes: routeData.etaMinutes,
          },
          {
            text: "Arrive at destination",
            lengthMeters: 0,
          },
        ];
  const sanitized = sanitizeManeuverMetrics(fallbackManeuvers, displayTotal);
  const normalizedManeuvers: NavigationManeuverRow[] = normalizeManeuverTimes(sanitized as RouteManeuver[]).map((m) => ({
    ...m,
    path: m.path ?? undefined,
  }));
  const apiEta =
    typeof routeData.etaMinutes === "number" && Number.isFinite(routeData.etaMinutes) ? Math.max(0, routeData.etaMinutes) : 0;
  const reconciledManeuvers = reconcileManeuverStepMetrics(normalizedManeuvers, displayTotal, apiEta);
  logRouteDistanceDiagnostics(displayTotal, reconciledManeuvers);
  const maneuverThresholds = maneuverProgressThresholds(normalizedPath, reconciledManeuvers as RouteManeuver[]);

  return {
    path: normalizedPath,
    maneuvers: reconciledManeuvers,
    displayTotalMeters: displayTotal,
    apiEtaMinutes: apiEta,
    publishEtaMinutes: routeData.etaMinutes,
    maneuverThresholds,
    routeUnavailable: normalizedPath.length < 2,
  };
}
