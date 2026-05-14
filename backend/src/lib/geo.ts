/**
 * Generic geometry helpers used across the backend.
 *
 * Previously lived under `src/eta/geo.ts`. The `eta/` folder was removed when
 * routing / ETA / live navigation were retired so they can be re-implemented on
 * top of ArcGIS Enterprise. The handful of helpers below are pure geometry and
 * are still needed by the socket and responder-location endpoints (haversine
 * sorting in `/responders/closest`, speed estimation, geofence math).
 */

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance in meters. */
export function distanceMetersHaversine(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const R = 6_371_000;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Initial bearing from A to B in degrees [0, 360). */
export function bearingDegrees(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const y = Math.sin(toRadians(toLng - fromLng)) * Math.cos(toRadians(toLat));
  const x =
    Math.cos(toRadians(fromLat)) * Math.sin(toRadians(toLat)) -
    Math.sin(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.cos(toRadians(toLng - fromLng));
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
