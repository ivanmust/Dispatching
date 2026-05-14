/**
 * Pure navigation helpers: polyline metrics, progress along route, ETA scaling,
 * and maneuver thresholds aligned to the same geometry as the drawn blue line.
 */

import type { MapRoutePathPoint } from "../components/ResponderMapWebView";

export type RouteManeuver = {
  text: string;
  lengthMeters?: number;
  timeMinutes?: number;
  path?: Array<{ lat: number; lon: number }> | null;
};

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Total length along polyline (ground truth for “trip distance” vs step sums). */
export function polylineLengthMeters(path: MapRoutePathPoint[] | null | undefined): number {
  if (!path || path.length < 2) return 0;
  let t = 0;
  for (let i = 1; i < path.length; i++) {
    t += haversineMeters(path[i - 1], path[i]);
  }
  return t;
}

/**
 * Distance from point to segment AB and along-route progress at the closest point
 * (clamped to the segment). Uses a small local equirectangular approximation — fine for step-sized segments.
 */
function distanceToSegmentMeters(
  p: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): { dist: number; t: number; progressFromA: number } {
  const segLen = haversineMeters(a, b);
  if (segLen < 0.5) {
    return { dist: haversineMeters(p, a), t: 0, progressFromA: 0 };
  }
  const latMid = (a.lat + b.lat) / 2;
  const cos = Math.cos((latMid * Math.PI) / 180);
  const ax = a.lon * cos;
  const bx = b.lon * cos;
  const px = p.lon * cos;
  const ay = a.lat;
  const by = b.lat;
  const py = p.lat;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const closest = { lat: cy, lon: cx / (cos || 1e-6) };
  return { dist: haversineMeters(p, closest), t, progressFromA: t * segLen };
}

/**
 * Nearest location along the polyline: returns cumulative distance from start to the closest point,
 * and perpendicular distance to the polyline (off-route).
 */
export function nearestProgressOnPolyline(
  point: { lat: number; lon: number },
  path: MapRoutePathPoint[]
): { progressMeters: number; offRouteMeters: number } {
  if (path.length < 2) return { progressMeters: 0, offRouteMeters: Number.POSITIVE_INFINITY };
  let cumulative = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = haversineMeters(a, b);
    const { dist, progressFromA } = distanceToSegmentMeters(point, a, b);
    const progress = cumulative + progressFromA;
    if (dist < bestDist) {
      bestDist = dist;
      bestProgress = progress;
    }
    cumulative += segLen;
  }
  return { progressMeters: Math.max(0, bestProgress), offRouteMeters: bestDist };
}

/** Reconcile API distance with polyline length (meters). */
export function reconcileRouteTotalMeters(apiMeters: number, polylineMeters: number): number {
  const api = Number.isFinite(apiMeters) ? Math.max(0, apiMeters) : 0;
  const poly = Number.isFinite(polylineMeters) ? Math.max(0, polylineMeters) : 0;
  if (poly <= 0) return api;
  if (api <= 0) return poly;
  const ratio = Math.abs(poly - api) / Math.max(api, poly);
  // Prefer polyline when API is clearly wrong vs geometry
  if (ratio > 0.2) return poly;
  return (api + poly) / 2;
}

/**
 * Scale total ETA (minutes from directions) by remaining fraction of reconciled distance.
 */
export function remainingEtaMinutes(totalEtaMinutes: number, remainingMeters: number, totalMeters: number): number {
  const rem = Math.max(0, Number.isFinite(remainingMeters) ? remainingMeters : 0);
  if (rem <= 0) return 0;
  const total = Number.isFinite(totalMeters) ? Math.max(1, totalMeters) : 1;
  const eta = Math.max(0, Number.isFinite(totalEtaMinutes) ? totalEtaMinutes : 0);
  if (eta <= 0) return Math.max(1, Math.round(rem / 8)); // ~8 m/s driving fallback
  const minutes = eta * Math.min(1, rem / total);
  return Math.max(1, Math.round(minutes));
}

/** Cumulative distance along path to the vertex closest to `geoPoint`. */
function cumulativeToNearestVertex(geoPoint: { lat: number; lon: number }, path: MapRoutePathPoint[]): number {
  if (!path.length) return 0;
  let cumulative = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCum = 0;
  for (let i = 0; i < path.length; i++) {
    const d = haversineMeters(geoPoint, path[i]);
    if (d < bestDist) {
      bestDist = d;
      bestCum = cumulative;
    }
    if (i < path.length - 1) cumulative += haversineMeters(path[i], path[i + 1]);
  }
  return bestCum;
}

/**
 * For each maneuver, distance along main `routePath` where that step starts (for step index sync).
 */
export function maneuverProgressThresholds(routePath: MapRoutePathPoint[], maneuvers: RouteManeuver[]): number[] {
  if (!routePath.length || !maneuvers.length) return maneuvers.map(() => 0);
  const total = polylineLengthMeters(routePath);
  const thresholds: number[] = [];
  let accFromLengths = 0;
  for (let i = 0; i < maneuvers.length; i++) {
    const m = maneuvers[i];
    const stepPath = m?.path;
    if (stepPath?.length && Number.isFinite(stepPath[0].lat) && Number.isFinite(stepPath[0].lon)) {
      const t = cumulativeToNearestVertex({ lat: stepPath[0].lat, lon: stepPath[0].lon }, routePath);
      thresholds.push(t);
    } else if (i === 0) {
      thresholds.push(0);
    } else {
      const prev = maneuvers[i - 1];
      const prevLen =
        typeof prev?.lengthMeters === "number" && Number.isFinite(prev.lengthMeters) ? Math.max(0, prev.lengthMeters) : 0;
      accFromLengths += prevLen;
      thresholds.push(Math.min(total, accFromLengths));
    }
  }
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i] < thresholds[i - 1]) thresholds[i] = thresholds[i - 1];
  }
  return thresholds;
}

export function maneuverIndexForProgress(progressMeters: number, thresholds: number[]): number {
  if (!thresholds.length) return 0;
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (progressMeters + 12 >= thresholds[i]) idx = i;
    else break;
  }
  return Math.max(0, Math.min(idx, thresholds.length - 1));
}

/** Light normalization: if `timeMinutes` looks like seconds, convert. */
export function normalizeManeuverTimes(maneuvers: RouteManeuver[]): RouteManeuver[] {
  return maneuvers.map((m) => {
    let minutes = m.timeMinutes;
    if (typeof minutes !== "number" || !Number.isFinite(minutes)) return m;
    if (minutes > 180) {
      const asSec = minutes / 60;
      if (asSec > 0 && asSec < 180) minutes = asSec;
    }
    return { ...m, timeMinutes: Math.max(0, minutes) };
  });
}

type ManeuverWithPath = {
  text?: string;
  lengthMeters?: number;
  timeMinutes?: number;
  path?: Array<{ lat: number; lon: number }> | null;
};

function isTerminalArrivalStep(m: ManeuverWithPath, index: number, total: number): boolean {
  if (index !== total - 1) return false;
  const t = String(m.text ?? "").toLowerCase();
  return t.includes("arrive") || t.includes("destination") || t.includes("finish") || t.includes("end at");
}

/**
 * Per-step distance from step polylines when present; scale to match route total.
 * Per-step time proportional to distance vs directions API total duration (ground-truth timing).
 */
export function reconcileManeuverStepMetrics<T extends ManeuverWithPath>(
  maneuvers: T[],
  routeTotalMeters: number,
  routeTotalMinutes: number
): T[] {
  const total = Math.max(0, Number(routeTotalMeters) || 0);
  const totalMin = Math.max(0, Number(routeTotalMinutes) || 0);
  if (!maneuvers.length) return maneuvers;

  let lens = maneuvers.map((m, i) => {
    if (isTerminalArrivalStep(m, i, maneuvers.length)) return 0;
    if (m.path && m.path.length >= 2) return polylineLengthMeters(m.path as MapRoutePathPoint[]);
    if (typeof m.lengthMeters === "number" && Number.isFinite(m.lengthMeters)) return Math.max(0, m.lengthMeters);
    return 0;
  });

  const drivableIdx = maneuvers.map((m, i) => (isTerminalArrivalStep(m, i, maneuvers.length) ? -1 : i)).filter((i) => i >= 0);

  let sum = lens.reduce((a, b) => a + b, 0);
  if (total > 0) {
    if (sum <= 0 && drivableIdx.length > 0) {
      const each = total / drivableIdx.length;
      lens = maneuvers.map((m, i) => (isTerminalArrivalStep(m, i, maneuvers.length) ? 0 : each));
      sum = lens.reduce((a, b) => a + b, 0);
    }
    if (sum > 0) {
      const scale = total / sum;
      lens = lens.map((L) => (L > 0 ? L * scale : 0));
      sum = lens.reduce((a, b) => a + b, 0);
      const drift = total - sum;
      if (Math.abs(drift) > 0.5 && drivableIdx.length) {
        const j = drivableIdx[drivableIdx.length - 1];
        lens[j] = Math.max(0, lens[j] + drift);
      }
    }
  }

  const fallbackMinPerKm = (L: number) => (L / 1000 / 32) * 60;

  return maneuvers.map((m, i) => {
    const L = lens[i];
    const terminal = isTerminalArrivalStep(m, i, maneuvers.length);
    let minutes: number | undefined;
    if (!terminal && L > 0 && total > 0) {
      minutes = totalMin > 0 ? (totalMin * L) / total : fallbackMinPerKm(L);
    }
    return {
      ...m,
      lengthMeters: terminal ? 0 : L > 0 ? L : undefined,
      timeMinutes: minutes != null && minutes > 0 ? minutes : undefined,
    };
  });
}
