import type { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";
import { getNavigationRoute, getNavigationDiagnostics } from "../lib/arcgisNavService";

/**
 * ArcGIS reverse-geocode + admin-address routes.
 *
 * The implementation is **ArcGIS only**: it never queries the legacy
 * `osm_road_lines` / `osm_nodes` tables (which have been dropped). All data
 * comes from either the PostgreSQL `rwanda_admin_boundaries` table (imported
 * once from the official shapefile) or the in-country Esri Rwanda services on
 * `esrirw.rw`.
 *
 * Two URL families are exposed:
 *   - `/arcgis/*`  -> canonical new paths
 *   - `/osm/*`     -> deprecated aliases kept for the short transition window
 *                     until all deployed frontends (dispatcher, responder,
 *                     responder-mobile) are updated. Remove once the mobile
 *                     build graveyard is cleared.
 */

const reverseGeocodeSchema = z.object({
  lat: z.coerce.number(),
  lon: z.coerce.number(),
  radiusMeters: z.coerce.number().optional(),
});

const navigationRouteSchema = z.object({
  origin: z.object({ lat: z.number(), lon: z.number() }),
  destination: z.object({ lat: z.number(), lon: z.number() }),
});
const navigationDiagnosticSchema = z.object({
  origin: z.object({ lat: z.number(), lon: z.number() }),
  destination: z.object({ lat: z.number(), lon: z.number() }),
  includeRaw: z.boolean().optional(),
});

type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = Position[][][];
type Geometry =
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: MultiPolygonCoordinates };

type AdminAddress = {
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
};

let esriBoundaryDisabledUntilMs = 0;

function pointInRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, polygon: PolygonCoordinates): boolean {
  if (!polygon.length) return false;
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false;
  }
  return true;
}

function pointInGeometry(lon: number, lat: number, geometry: Geometry): boolean {
  if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
  return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon));
}

function hasValue(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function fetchLocalAdminAddress(lat: number, lon: number): Promise<AdminAddress> {
  let rows: Array<{
    province: string | null;
    district: string | null;
    sector: string | null;
    cell: string | null;
    village: string | null;
    geometry: unknown;
  }> = [];
  try {
    const result = await query<{
      province: string | null;
      district: string | null;
      sector: string | null;
      cell: string | null;
      village: string | null;
      geometry: unknown;
    }>(
      `SELECT province, district, sector, cell, village, geometry
       FROM rwanda_admin_boundaries
       WHERE min_lat <= $1 AND max_lat >= $1
         AND min_lon <= $2 AND max_lon >= $2
       ORDER BY
         (CASE WHEN village IS NOT NULL THEN 1 ELSE 0 END) DESC,
         (CASE WHEN cell IS NOT NULL THEN 1 ELSE 0 END) DESC,
         (CASE WHEN sector IS NOT NULL THEN 1 ELSE 0 END) DESC,
         (CASE WHEN district IS NOT NULL THEN 1 ELSE 0 END) DESC
       LIMIT 300`,
      [lat, lon]
    );
    rows = result.rows;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    // 42P01 => relation does not exist. Fall back to Esri boundary query when
    // the local table has not been imported.
    if (code === "42P01") return {};
    throw err;
  }

  for (const row of rows) {
    const g = row.geometry as Geometry | null;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    if (!pointInGeometry(lon, lat, g)) continue;
    return {
      province: hasValue(row.province) ? row.province.trim() : undefined,
      district: hasValue(row.district) ? row.district.trim() : undefined,
      sector: hasValue(row.sector) ? row.sector.trim() : undefined,
      cell: hasValue(row.cell) ? row.cell.trim() : undefined,
      village: hasValue(row.village) ? row.village.trim() : undefined,
    };
  }

  return {};
}

async function fetchAdminAddressFromEsriVillageBoundary(lat: number, lon: number): Promise<AdminAddress> {
  const now = Date.now();
  if (now < esriBoundaryDisabledUntilMs) return {};

  const base = process.env.ESRI_ADMIN_BOUNDARY_URL?.trim();
  const endpoints = [
    base,
    "https://esrirw.rw/server/rest/services/Hosted/Rwanda_Administrative_Boundaries1/FeatureServer/5/query",
    "https://esrirw.rw/server/rest/services/Hosted/Village/FeatureServer/4/query",
  ].filter((v): v is string => !!v);

  const readFromAttrs = (attrs: Record<string, unknown>) => {
    const keys = Object.keys(attrs);
    const pick = (...candidates: string[]) => {
      for (const c of candidates) {
        const k = keys.find((kk) => kk.toLowerCase() === c.toLowerCase());
        if (!k) continue;
        const v = attrs[k];
        if (typeof v === "string" && v.trim().length > 0) return v.trim();
      }
      return undefined;
    };
    return {
      province: pick("province", "prov_name"),
      district: pick("district", "dist_name"),
      sector: pick("sector", "sect_name"),
      cell: pick("cell", "cell_name"),
      village: pick("village", "vill_name"),
    };
  };

  for (const endpoint of endpoints) {
    const params = new URLSearchParams({
      where: "1=1",
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      f: "json",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "dispatch-master/1.0" },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        features?: Array<{ attributes?: Record<string, unknown> }>;
      };
      const attrs = json?.features?.[0]?.attributes ?? {};
      const admin = readFromAttrs(attrs);
      if (admin.village || admin.cell || admin.sector || admin.district || admin.province) {
        return admin;
      }
    } catch {
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }

  esriBoundaryDisabledUntilMs = Date.now() + 5 * 60 * 1000;
  return {};
}

/**
 * Optional road-name reverse geocode from an in-country Esri geocoder.
 * Configure via `ESRI_REVERSE_GEOCODE_URL` (e.g. esrirw.rw hosted GeocodeServer).
 * Silently returns undefined when unset or unreachable -- we prefer to leak no
 * requests to public geocoders when the operator has not explicitly configured
 * one.
 */
async function fetchArcgisRoadName(lat: number, lon: number): Promise<string | undefined> {
  const base = process.env.ESRI_REVERSE_GEOCODE_URL?.trim();
  if (!base) return undefined;
  const url = `${base.replace(/\/+$/, "")}/reverseGeocode`;

  const params = new URLSearchParams({
    location: `${lon},${lat}`,
    f: "json",
    outSR: "4326",
  });
  // Optional portal token for the in-country GeocodeServer. Falls back to the
  // legacy ETA_ARCGIS_TOKEN env var so existing deployments keep working while
  // they migrate to the dedicated ESRI_REVERSE_GEOCODE_TOKEN name.
  const token =
    process.env.ESRI_REVERSE_GEOCODE_TOKEN?.trim() || process.env.ETA_ARCGIS_TOKEN?.trim();
  if (token) params.set("token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`${url}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "dispatch-master/1.0" },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      address?: { Match_addr?: string; LongLabel?: string; Address?: string; StName?: string };
    };
    const a = data?.address;
    if (!a) return undefined;
    return (
      (typeof a.StName === "string" && a.StName.trim()) ||
      (typeof a.Address === "string" && a.Address.trim()) ||
      (typeof a.LongLabel === "string" && a.LongLabel.trim()) ||
      (typeof a.Match_addr === "string" && a.Match_addr.trim()) ||
      undefined
    );
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocodeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lon } = reverseGeocodeSchema.parse(req.query);

    let admin = await fetchLocalAdminAddress(lat, lon);
    if (!admin.village && !admin.cell && !admin.sector && !admin.district && !admin.province) {
      admin = await fetchAdminAddressFromEsriVillageBoundary(lat, lon);
    }

    const roadName = await fetchArcgisRoadName(lat, lon);

    const adminLine = [admin.village, admin.cell, admin.sector, admin.district, admin.province]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(", ");
    const addressLine = adminLine || (roadName ? `${roadName}, Rwanda` : "Selected map point, Rwanda");

    res.json({
      addressLine,
      roadName,
      ...admin,
    });
  } catch (err) {
    next(err);
  }
}

function statusHandler(_req: Request, res: Response) {
  // Routing/ETA was retired and will be rebuilt on ArcGIS Enterprise. The
  // remaining responsibility of this endpoint is reporting whether the
  // reverse-geocode dependencies (admin-boundary FeatureServer and optional
  // road-name GeocodeServer) are configured.
  const adminBoundaryUrl = process.env.ESRI_ADMIN_BOUNDARY_URL?.trim() || null;
  const reverseGeocodeUrl = process.env.ESRI_REVERSE_GEOCODE_URL?.trim() || null;
  res.json({
    provider: "arcgis",
    reverseGeocodeConfigured: !!(adminBoundaryUrl || reverseGeocodeUrl),
    adminBoundaryUrl,
    reverseGeocodeUrl,
  });
}

export function registerArcgisRoutes(router: Router) {
  // Canonical ArcGIS routes.
  router.get("/arcgis/reverse-geocode", reverseGeocodeHandler);
  router.get("/arcgis/status", statusHandler);
  router.post("/arcgis/navigation/route", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { origin, destination } = navigationRouteSchema.parse(req.body);
      const route = await getNavigationRoute(origin, destination);
      console.log(
        `[navigation] route request origin=${origin.lat},${origin.lon} destination=${destination.lat},${destination.lon} maneuvers=${route.maneuvers.length} pathPoints=${route.path.length}`
      );
      res.json(route);
    } catch (err) {
      next(err);
    }
  });
  router.post("/arcgis/navigation/diagnostic", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { origin, destination, includeRaw } = navigationDiagnosticSchema.parse(req.body);
      const diagnostics = await getNavigationDiagnostics(origin, destination, { includeRaw: !!includeRaw });
      res.json(diagnostics);
    } catch (err) {
      next(err);
    }
  });

  // Deprecated `/osm/*` aliases. They are not redirects (so GET clients keep
  // the same Cache-Control / CORS semantics) -- they route to the same
  // handler. Remove once the mobile/responder builds in the field have been
  // updated to the new paths.
  router.get("/osm/reverse-geocode", reverseGeocodeHandler);
  router.get("/osm/status", statusHandler);
}
