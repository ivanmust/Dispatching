import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Load backend/.env even when the shell cwd is not the backend folder.
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { query } from "../src/db";

type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = Position[][][];
type Geometry =
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: MultiPolygonCoordinates };

type Feature = {
  type: "Feature";
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: Geometry | null;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
  properties?: Record<string, unknown>;
};

function toStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function firstNonEmpty(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    const t = toStr(c);
    if (t) return t;
  }
  return undefined;
}

function firstProp(props: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = toStr(props[key]);
    if (val) return val;
  }
  return undefined;
}

function walkPositions(geometry: Geometry, cb: (p: Position) => void) {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      for (const pos of ring) cb(pos);
    }
    return;
  }
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      for (const pos of ring) cb(pos);
    }
  }
}

/** Layer URL for import when no CLI arg: ESRI_ADMIN_BOUNDARY_URL without /query, or project default. */
function defaultAdminBoundariesSource(): string {
  const raw = process.env.ESRI_ADMIN_BOUNDARY_URL?.trim();
  if (raw) {
    const base = raw.split("?")[0].replace(/\/query\/?$/i, "");
    if (/\/FeatureServer\/\d+$/i.test(base) || /\/FeatureServer$/i.test(base)) {
      return base;
    }
  }
  return "https://esrirw.rw/server/rest/services/Hosted/Rwanda_Administrative_Boundaries1/FeatureServer/5";
}

async function main() {
  const input =
    firstNonEmpty(process.argv[2], process.env.RWANDA_ADMIN_BOUNDARIES_GEOJSON) ??
    defaultAdminBoundariesSource();

  const json = await loadFeatureCollection(input);

  await query("BEGIN");
  try {
    await query("TRUNCATE TABLE rwanda_admin_boundaries RESTART IDENTITY");

    let inserted = 0;
    for (const f of json.features) {
      const g = f.geometry;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
      const props = (f.properties ?? {}) as Record<string, unknown>;

      let minLat = Infinity;
      let minLon = Infinity;
      let maxLat = -Infinity;
      let maxLon = -Infinity;
      walkPositions(g, ([lon, lat]) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (lat < minLat) minLat = lat;
        if (lon < minLon) minLon = lon;
        if (lat > maxLat) maxLat = lat;
        if (lon > maxLon) maxLon = lon;
      });
      if (!Number.isFinite(minLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLat) || !Number.isFinite(maxLon)) {
        continue;
      }

      const sourceId =
        toStr(f.id) ??
        firstProp(props, "id", "ID", "objectid", "OBJECTID", "fid", "FID") ??
        null;

      const province = firstProp(props, "province", "Province", "PROVINCE");
      const district = firstProp(props, "district", "District", "DISTRICT");
      const sector = firstProp(props, "sector", "Sector", "SECTOR");
      const cell = firstProp(props, "cell", "Cell", "CELL");
      const village = firstProp(props, "village", "Village", "VILLAGE");

      await query(
        `INSERT INTO rwanda_admin_boundaries (
           source_id, province, district, sector, cell, village, geometry,
           min_lat, min_lon, max_lat, max_lon
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
        [sourceId, province ?? null, district ?? null, sector ?? null, cell ?? null, village ?? null, JSON.stringify(g), minLat, minLon, maxLat, maxLon]
      );
      inserted += 1;
    }

    await query("COMMIT");
    console.log(`[osm] Imported ${inserted} admin boundary features from ${input}`);
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}

main().catch((err) => {
  console.error("[osm] Failed to import Rwanda admin boundaries", err);
  process.exit(1);
});

async function loadFeatureCollection(input: string): Promise<FeatureCollection> {
  if (/^https?:\/\//i.test(input)) {
    return loadFeatureCollectionFromArcgis(input);
  }
  const absolutePath = path.resolve(process.cwd(), input);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const json = JSON.parse(raw) as FeatureCollection;
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw new Error("Invalid GeoJSON: expected FeatureCollection with features array");
  }
  return json;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "dispatch-master/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function extractItemId(inputUrl: string): string | null {
  const m = inputUrl.match(/[?&]id=([a-f0-9]{32})/i);
  return m?.[1] ?? null;
}

async function resolveFeatureLayerUrl(inputUrl: string): Promise<string> {
  let featureServerUrl = inputUrl.trim();
  const itemId = extractItemId(featureServerUrl);
  if (itemId) {
    const item = await fetchJson<{ url?: string }>(
      `https://esrirw.rw/portal/sharing/rest/content/items/${encodeURIComponent(itemId)}?f=json`
    );
    if (!item.url) throw new Error(`ArcGIS item ${itemId} has no service URL`);
    featureServerUrl = item.url;
  }

  featureServerUrl = featureServerUrl.replace(/\/+$/, "");
  const layerIdMatch = featureServerUrl.match(/\/FeatureServer\/(\d+)$/i);
  if (layerIdMatch) return featureServerUrl;

  if (!/\/FeatureServer$/i.test(featureServerUrl)) {
    throw new Error("Expected ArcGIS FeatureServer URL or portal item URL");
  }

  const service = await fetchJson<{ layers?: Array<{ id: number; geometryType?: string }> }>(
    `${featureServerUrl}?f=pjson`
  );
  const polygonLayer =
    service.layers?.find((l) => l.geometryType === "esriGeometryPolygon") ?? service.layers?.[0];
  if (!polygonLayer) throw new Error("No layers found on FeatureServer");
  return `${featureServerUrl}/${polygonLayer.id}`;
}

async function loadFeatureCollectionFromArcgis(inputUrl: string): Promise<FeatureCollection> {
  const layerUrl = await resolveFeatureLayerUrl(inputUrl);
  const features: Feature[] = [];
  const pageSize = 2000;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "objectid,province,district,sector,cell,village,village_id",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const page = await fetchJson<FeatureCollection>(`${layerUrl}/query?${params.toString()}`);
    const batch = Array.isArray(page.features) ? page.features : [];
    features.push(...batch);
    const exceeded = Boolean(page.properties?.exceededTransferLimit);
    if (!exceeded || batch.length === 0) break;
    offset += batch.length;
  }

  return { type: "FeatureCollection", features };
}

