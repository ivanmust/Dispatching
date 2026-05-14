export type LatLon = { lat: number; lon: number };

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371; // Earth radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export type NearestResponder = { responderId: string; distanceKm: number } | null;

export function findNearestResponder(
  incidentLocation: LatLon,
  responders: Array<{ id: string; position: LatLon; available: boolean }>
): NearestResponder {
  let best: NearestResponder = null;

  for (const r of responders) {
    if (!r.available) continue;
    const d = haversineKm(incidentLocation, r.position);
    if (!best || d < best.distanceKm) best = { responderId: r.id, distanceKm: d };
  }

  return best;
}

