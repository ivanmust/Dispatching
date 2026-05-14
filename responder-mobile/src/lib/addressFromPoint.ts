/**
 * Rwanda administrative boundaries + optional World Geocoder line (same sources as dispatcher).
 */

const RWANDA_LAYER =
  typeof process !== "undefined" && process.env?.EXPO_PUBLIC_RWANDA_VILLAGE_BOUNDARIES_URL
    ? String(process.env.EXPO_PUBLIC_RWANDA_VILLAGE_BOUNDARIES_URL)
    : "https://esrirw.rw/server/rest/services/Hosted/Rwanda_Administrative_Boundaries1/FeatureServer/5/query";

export async function queryRwandaAddress(lat: number, lon: number): Promise<{
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
}> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "province,district,sector,cell,village",
    returnGeometry: "false",
    f: "json",
  });
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${RWANDA_LAYER}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return {};
    const json = (await res.json()) as { features?: Array<{ attributes?: Record<string, unknown> }> };
    const attrs = json?.features?.[0]?.attributes ?? {};
    const getFirst = (...keys: string[]) => {
      for (const k of keys) {
        const v = attrs?.[k];
        if (typeof v === "string" && v.trim().length > 0) return v;
      }
      return undefined;
    };
    return {
      province: getFirst("province", "Province", "PROVINCE"),
      district: getFirst("district", "District", "DISTRICT"),
      sector: getFirst("sector", "Sector", "SECTOR"),
      cell: getFirst("cell", "Cell", "CELL"),
      village: getFirst("village", "Village", "VILLAGE"),
    };
  } catch {
    return {};
  }
}

export async function reverseGeocodeArcgisLine(lat: number, lon: number): Promise<string | undefined> {
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${encodeURIComponent(`${lon},${lat}`)}`;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      address?: { Match_addr?: string; LongLabel?: string; Address?: string };
    };
    const a = data?.address;
    if (!a) return undefined;
    return (
      (typeof a.LongLabel === "string" && a.LongLabel) ||
      (typeof a.Match_addr === "string" && a.Match_addr) ||
      (typeof a.Address === "string" && a.Address) ||
      undefined
    );
  } catch {
    return undefined;
  }
}

export type ResolvedFieldAddress = {
  addressLine?: string;
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
};

/** Fill address fields the same way as dispatcher map pick. */
export async function resolveAddressFromCoordinates(lat: number, lon: number): Promise<ResolvedFieldAddress> {
  const [rwanda, worldLine] = await Promise.all([
    queryRwandaAddress(lat, lon),
    reverseGeocodeArcgisLine(lat, lon),
  ]);
  let addressLine = worldLine;
  if (!addressLine && (rwanda.village || rwanda.sector || rwanda.district || rwanda.province)) {
    addressLine = [rwanda.village, rwanda.cell, rwanda.sector, rwanda.district, rwanda.province]
      .filter(Boolean)
      .join(", ");
  }
  return {
    addressLine,
    province: rwanda.province,
    district: rwanda.district,
    sector: rwanda.sector,
    cell: rwanda.cell,
    village: rwanda.village,
  };
}
