type LatLng = { lat: number; lon: number };

type ArcgisJobInfo = {
  jobId?: string;
  jobStatus?: string;
  messages?: Array<{ type?: string; description?: string }>;
  results?: Record<string, { paramUrl?: string }>;
};

let cachedToken: { value: string; expiresAtMs: number } | null = null;

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getRouteServiceUrl(): string {
  const configured =
    process.env.NAV_ARCGIS_ROUTE_URL?.trim() ||
    process.env.ETA_ARCGIS_ROUTE_URL?.trim() ||
    process.env.NAV_ARCGIS_CLOSEST_FACILITY_URL?.trim() || process.env.ETA_ARCGIS_CLOSEST_FACILITY_URL?.trim();
  if (!configured) {
    throw new Error("ArcGIS navigation service URL is not configured");
  }
  return normalizeUrl(configured);
}

function isRouteSolveService(url: string): boolean {
  return /\/NAServer\/Route$/i.test(normalizeUrl(url));
}

async function readJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ArcGIS request failed (${res.status}): ${txt || res.statusText}`);
  }
  return res.json();
}

async function fetchTokenFromPortal(): Promise<string | null> {
  const portalUrl = process.env.NAV_ARCGIS_PORTAL_URL?.trim() || process.env.ETA_ARCGIS_PORTAL_URL?.trim();
  const username = process.env.NAV_ARCGIS_USERNAME?.trim() || process.env.ETA_ARCGIS_USERNAME?.trim();
  const password = process.env.NAV_ARCGIS_PASSWORD?.trim() || process.env.ETA_ARCGIS_PASSWORD?.trim();
  if (!portalUrl || !username || !password) return null;

  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const generateTokenUrl = `${normalizeUrl(portalUrl)}/sharing/rest/generateToken`;
  const body = new URLSearchParams({
    username,
    password,
    client: "referer",
    referer: "https://esrirw.rw/portal/apps/mapviewer/index.html?webmap=3e190cfba7fd4d1f8c9600cc072a6d15",
    expiration: String(Number(process.env.NAV_ARCGIS_TOKEN_EXPIRATION_MINUTES ?? 120)),
    f: "json",
  });
  const json = await readJson(generateTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const token = typeof json?.token === "string" ? json.token : null;
  const expires = typeof json?.expires === "number" ? json.expires : Date.now() + 90 * 60 * 1000;
  if (!token) return null;
  cachedToken = { value: token, expiresAtMs: expires };
  return token;
}

async function getArcgisToken(): Promise<string | null> {
  const direct = process.env.NAV_ARCGIS_TOKEN?.trim() || process.env.ETA_ARCGIS_TOKEN?.trim();
  if (direct) return direct;
  return fetchTokenFromPortal();
}

function featureSetPoint(points: Array<{ id: string; lat: number; lon: number }>): string {
  return JSON.stringify({
    geometryType: "esriGeometryPoint",
    spatialReference: { wkid: 4326 },
    features: points.map((p) => ({
      geometry: { x: p.lon, y: p.lat, spatialReference: { wkid: 4326 } },
      attributes: { Name: p.id },
    })),
  });
}

function parsePathFromFeatureSet(data: any): Array<{ lat: number; lon: number }> {
  const features = data?.value?.features ?? data?.features ?? [];
  if (!Array.isArray(features) || !features.length) return [];
  const geom = features[0]?.geometry;
  const paths = Array.isArray(geom?.paths) ? geom.paths : [];
  const firstPath = Array.isArray(paths[0]) ? paths[0] : [];

  const parsed = firstPath
    .map((pt: any) => (Array.isArray(pt) && pt.length >= 2 ? { lon: Number(pt[0]), lat: Number(pt[1]) } : null))
    .filter((p: any): p is { lat: number; lon: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon));

  // Some ArcGIS routing services ignore outSR and return Web Mercator meters (EPSG:3857 / 102100).
  // Detect and convert to WGS84 degrees so clients can draw the polyline and compute distance/ETA.
  const looksLikeDegrees = (p: { lat: number; lon: number }) =>
    Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  const mercatorLike = (p: { lat: number; lon: number }) =>
    Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180;

  const degreeCount = parsed.reduce((acc, p) => acc + (looksLikeDegrees(p) ? 1 : 0), 0);
  const mercatorCount = parsed.reduce((acc, p) => acc + (mercatorLike(p) ? 1 : 0), 0);

  if (parsed.length >= 2 && mercatorCount > degreeCount) {
    const R = 20037508.34; // WebMercator max extent in meters
    const xToLon = (x: number) => (x / R) * 180;
    const yToLat = (y: number) => {
      const rad = (y / R) * Math.PI;
      const lat = (Math.atan(Math.exp(rad)) * 360) / Math.PI - 90;
      return lat;
    };
    return parsed
      .map((p) => ({ lon: xToLon(p.lon), lat: yToLat(p.lat) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && looksLikeDegrees(p));
  }

  return parsed;
}

function estimateDistanceMeters(path: Array<{ lat: number; lon: number }>): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const aa =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    total += 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  }
  return total;
}

function parseEtaFromAttributes(data: any): number | null {
  const features = data?.value?.features ?? data?.features ?? [];
  if (!Array.isArray(features) || !features.length) return null;
  const attrs = features[0]?.attributes ?? {};
  const candidates = ["Total_TravelTime", "Total_Minutes", "TravelTime", "Minutes", "TotalTime"];
  for (const key of candidates) {
    if (typeof attrs[key] === "number" && Number.isFinite(attrs[key])) return Number(attrs[key]);
  }
  return null;
}

function parseDistanceMetersFromAttributes(data: any): number | null {
  const features = data?.value?.features ?? data?.features ?? [];
  if (!Array.isArray(features) || !features.length) return null;
  const attrs = features[0]?.attributes ?? {};
  const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Number(v) : null);

  const metersDirect =
    asNum(attrs.Total_Meters) ??
    asNum(attrs.TotalMeters) ??
    asNum(attrs.Meters) ??
    asNum(attrs.total_meters);
  if (metersDirect != null) return Math.max(0, metersDirect);

  const kmDirect =
    asNum(attrs.Total_Kilometers) ??
    asNum(attrs.TotalKilometers) ??
    asNum(attrs.Kilometers) ??
    asNum(attrs.total_kilometers);
  if (kmDirect != null) return Math.max(0, kmDirect * 1000);

  const milesDirect =
    asNum(attrs.Total_Miles) ??
    asNum(attrs.TotalMiles) ??
    asNum(attrs.Miles) ??
    asNum(attrs.total_miles);
  if (milesDirect != null) return Math.max(0, milesDirect * 1609.344);

  return null;
}

function extractDirectionFeatures(directionResult: any): any[] {
  const collect = (node: any): any[] => {
    if (!node) return [];
    if (Array.isArray(node)) {
      // Some ArcGIS Route solve responses return `directions` directly as an array.
      for (const item of node) {
        const nested = collect(item);
        if (nested.length) return nested;
      }
      return [];
    }
    if (Array.isArray(node.features)) return node.features;
    if (Array.isArray(node.value?.features)) return node.value.features;
    if (Array.isArray(node.directions)) return collect(node.directions);
    if (Array.isArray(node.value?.directions)) return collect(node.value.directions);
    return [];
  };
  return collect(directionResult);
}

/**
 * When only `attributes.length` / `Length` exist, their unit matches the solve request's
 * `directionsLengthUnits` (e.g. esriNAUMeters → meters, esriNAUKilometers → km).
 * Treating meters as km here inflates each step (e.g. 462 m → "462 km").
 */
function parseManeuversFromDirections(
  directionResult: any,
  genericLengthUnit: "meters" | "kilometers" | "miles" = "kilometers"
): Array<{
  text: string;
  lengthMeters?: number;
  timeMinutes?: number;
  path?: Array<{ lat: number; lon: number }>;
}> {
  const dirFeatures = extractDirectionFeatures(directionResult);
  if (!Array.isArray(dirFeatures)) return [];
  const parsed: Array<{
    text: string;
    lengthMeters?: number;
    timeMinutes?: number;
    path?: Array<{ lat: number; lon: number }>;
  }> = [];
  for (const f of dirFeatures) {
    const a = f?.attributes ?? {};
    const text =
      (typeof a.text === "string" && a.text) ||
      (typeof a.Text === "string" && a.Text) ||
      (typeof a.displayText === "string" && a.displayText) ||
      "";
    if (!text) continue;
    const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Number(v) : null);
    const metersValue =
      asNum(a.lengthMeters) ??
      asNum(a.LengthMeters) ??
      asNum(a.meters) ??
      asNum(a.Meters) ??
      asNum(a.length_meters);
    const kmValue =
      asNum(a.lengthKilometers) ??
      asNum(a.LengthKilometers) ??
      asNum(a.kilometers) ??
      asNum(a.Kilometers) ??
      asNum(a.length_kilometers);
    const milesValue =
      asNum(a.lengthMiles) ??
      asNum(a.LengthMiles) ??
      asNum(a.miles) ??
      asNum(a.Miles) ??
      asNum(a.length_miles);
    const genericLength = asNum(a.length) ?? asNum(a.Length);
    let genericMeters: number | undefined;
    if (genericLength != null) {
      if (genericLengthUnit === "meters") genericMeters = genericLength;
      else if (genericLengthUnit === "kilometers") genericMeters = genericLength * 1000;
      else genericMeters = genericLength * 1609.344;
    }
    const len =
      metersValue != null
        ? metersValue
        : kmValue != null
        ? kmValue * 1000
        : milesValue != null
        ? milesValue * 1609.344
        : genericMeters;
    const minutesValue =
      asNum(a.time) ??
      asNum(a.Time) ??
      asNum(a.minutes) ??
      asNum(a.Minutes) ??
      asNum(a.time_minutes);
    const secondsValue =
      asNum(a.timeSeconds) ??
      asNum(a.TimeSeconds) ??
      asNum(a.seconds) ??
      asNum(a.Seconds) ??
      asNum(a.time_seconds);
    const hoursValue =
      asNum(a.timeHours) ??
      asNum(a.TimeHours) ??
      asNum(a.hours) ??
      asNum(a.Hours) ??
      asNum(a.time_hours);
    const mins =
      minutesValue != null
        ? minutesValue
        : secondsValue != null
        ? secondsValue / 60
        : hoursValue != null
        ? hoursValue * 60
        : undefined;
    const stepPath = parsePathFromFeatureSet({ features: [f] });
    parsed.push({ text, lengthMeters: len, timeMinutes: mins, path: stepPath.length ? stepPath : undefined });
  }
  return parsed;
}

/**
 * Normalize step distances against route total so impossible values
 * (e.g. step > total, often due to unit mismatch) are corrected.
 */
function normalizeManeuverDistances<
  T extends { lengthMeters?: number; timeMinutes?: number; path?: Array<{ lat: number; lon: number }> }
>(maneuvers: T[], routeTotalMeters: number): T[] {
  const total = Number.isFinite(routeTotalMeters) ? Math.max(0, routeTotalMeters) : 0;
  if (!maneuvers.length || total <= 0) return maneuvers;

  const finiteLens = maneuvers
    .map((m) => (typeof m.lengthMeters === "number" && Number.isFinite(m.lengthMeters) ? Math.max(0, m.lengthMeters) : 0))
    .filter((n) => n > 0);
  if (!finiteLens.length) return maneuvers;

  const sum = finiteLens.reduce((a, n) => a + n, 0);
  const candidates = [1, 0.001, 1000, 1.609344, 1 / 1.609344];
  const baselineErr = Math.abs(sum - total);
  let best = 1;
  let bestErr = baselineErr;
  for (const f of candidates) {
    const err = Math.abs(sum * f - total);
    if (err < bestErr) {
      bestErr = err;
      best = f;
    }
  }
  // Apply factor only when materially better than baseline.
  const useFactor = best !== 1 && bestErr < baselineErr * 0.7 ? best : 1;

  return maneuvers.map((m) => {
    let length = typeof m.lengthMeters === "number" && Number.isFinite(m.lengthMeters) ? Math.max(0, m.lengthMeters) : undefined;
    if (length != null) {
      length = length * useFactor;
      // Guardrail: a single step should not exceed total route distance.
      if (length > total * 1.1) {
        const downscaled = length / 1000;
        length = downscaled <= total * 1.1 ? downscaled : Math.min(length, total);
      }
    }
    return { ...m, lengthMeters: length };
  });
}

async function fetchResultByParam(
  baseUrl: string,
  jobId: string,
  paramName: string,
  token: string | null
): Promise<any> {
  const params = new URLSearchParams({ f: "json" });
  if (token) params.set("token", token);
  return readJson(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(paramName)}?${params}`);
}

export async function getNavigationRoute(origin: LatLng, destination: LatLng): Promise<{
  path: Array<{ lat: number; lon: number }>;
  distanceMeters: number;
  etaMinutes: number;
  maneuvers: Array<{
    text: string;
    lengthMeters?: number;
    timeMinutes?: number;
    path?: Array<{ lat: number; lon: number }>;
  }>;
}> {
  const solved = await solveNavigation(origin, destination);
  return {
    path: solved.path,
    distanceMeters: solved.distanceMeters,
    etaMinutes: solved.etaMinutes,
    maneuvers: solved.maneuvers,
  };
}

async function solveNavigation(origin: LatLng, destination: LatLng): Promise<{
  jobId: string;
  baseUrl: string;
  path: Array<{ lat: number; lon: number }>;
  distanceMeters: number;
  etaMinutes: number;
  maneuvers: Array<{
    text: string;
    lengthMeters?: number;
    timeMinutes?: number;
    path?: Array<{ lat: number; lon: number }>;
  }>;
  routeParam: string;
  directionParam: string | null;
  resultParamNames: string[];
  routeResult: any;
  directionResult: any | null;
  jobMessages: Array<{ type?: string; description?: string }>;
}> {
  const baseUrl = getRouteServiceUrl();
  const token = await getArcgisToken();
  if (isRouteSolveService(baseUrl)) {
    const runSolve = async (directionsOutputType: string) => {
      const reqParams = new URLSearchParams({
        f: "json",
        stops: `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`,
        returnRoutes: "true",
        returnDirections: "true",
        returnStops: "false",
        returnBarriers: "false",
        outSR: "4326",
        directionsLengthUnits: "esriNAUMeters",
        directionsOutputType,
      });
      if (token) reqParams.set("token", token);

      const solveResult = await readJson(`${baseUrl}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: reqParams.toString(),
      });
      if (solveResult?.error) {
        throw new Error(solveResult.error?.message || "ArcGIS Route solve failed");
      }
      const directionsFeatureSet = solveResult?.directions ?? null;
      return {
        solveResult,
        directionsFeatureSet,
        // Must match `directionsLengthUnits: "esriNAUMeters"` on the solve request.
        maneuvers: parseManeuversFromDirections(directionsFeatureSet, "meters"),
      };
    };

    const attempts = [await runSolve("esriDOTComplete")];
    if (attempts[0].maneuvers.length <= 2) {
      for (const altType of ["esriDOTCompleteNoEvents", "esriDOTInstructionsOnly"]) {
        try {
          attempts.push(await runSolve(altType));
        } catch {
          // Keep best available directions from successful attempts.
        }
      }
    }
    const best = attempts.reduce((acc, curr) => (curr.maneuvers.length > acc.maneuvers.length ? curr : acc), attempts[0]);
    const routesFeatureSet = best.solveResult?.routes ?? null;
    const directionsFeatureSet = best.directionsFeatureSet;
    const path = parsePathFromFeatureSet(routesFeatureSet);
    if (!path.length) throw new Error("ArcGIS route geometry is empty");
    const distanceMeters = parseDistanceMetersFromAttributes(routesFeatureSet) ?? estimateDistanceMeters(path);
    const etaFromService = parseEtaFromAttributes(routesFeatureSet);
    const fallbackEtaMinutes = Math.max(1, (distanceMeters / 1000 / 35) * 60);
    const etaMinutes =
      etaFromService == null
        ? fallbackEtaMinutes
        : etaFromService > Math.max(24 * 60, fallbackEtaMinutes * 6)
        ? fallbackEtaMinutes
        : etaFromService;
    const maneuvers = normalizeManeuverDistances(best.maneuvers, distanceMeters);

    return {
      jobId: "solve",
      baseUrl,
      path,
      distanceMeters,
      etaMinutes,
      maneuvers,
      routeParam: "routes",
      directionParam: directionsFeatureSet ? "directions" : null,
      resultParamNames: ["routes", ...(directionsFeatureSet ? ["directions"] : [])],
      routeResult: routesFeatureSet,
      directionResult: directionsFeatureSet,
      jobMessages: [],
    };
  }
  const reqParams = new URLSearchParams({
    f: "json",
    incidents: featureSetPoint([{ id: "incident", lat: destination.lat, lon: destination.lon }]),
    facilities: featureSetPoint([{ id: "responder", lat: origin.lat, lon: origin.lon }]),
    defaultTargetFacilityCount: "1",
    returnDirections: "true",
    outSR: "4326",
  });
  if (token) reqParams.set("token", token);

  const submit = await readJson(`${baseUrl}/submitJob`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: reqParams.toString(),
  });
  const jobId = typeof submit?.jobId === "string" ? submit.jobId : null;
  if (!jobId) {
    throw new Error(submit?.error?.message || "ArcGIS submitJob did not return jobId");
  }

  const pollTimeoutMs = Number(process.env.NAV_ARCGIS_POLL_TIMEOUT_MS ?? 18_000);
  const pollIntervalMs = Number(process.env.NAV_ARCGIS_POLL_INTERVAL_MS ?? 750);
  const startedAt = Date.now();
  let job: ArcgisJobInfo | null = null;

  while (Date.now() - startedAt < pollTimeoutMs) {
    const qs = new URLSearchParams({ f: "json" });
    if (token) qs.set("token", token);
    job = await readJson(`${baseUrl}/jobs/${encodeURIComponent(jobId)}?${qs.toString()}`);
    const status = String(job?.jobStatus ?? "");
    if (status === "esriJobSucceeded") break;
    if (status === "esriJobFailed" || status === "esriJobCancelled" || status === "esriJobTimedOut") {
      const details = (job?.messages ?? []).map((m) => m?.description).filter(Boolean).join(" | ");
      throw new Error(details || `ArcGIS job failed (${status})`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  if (!job || String(job.jobStatus) !== "esriJobSucceeded") {
    throw new Error("ArcGIS route job polling timed out");
  }

  const resultParamNames = Object.keys(job.results ?? {});
  const routeParam =
    resultParamNames.find((k) => /route/i.test(k)) ||
    resultParamNames.find((k) => /routes/i.test(k)) ||
    resultParamNames[0];
  if (!routeParam) throw new Error("ArcGIS route result not found");

  const routeResult = await fetchResultByParam(baseUrl, jobId, routeParam, token);
  const path = parsePathFromFeatureSet(routeResult);
  if (!path.length) throw new Error("ArcGIS route geometry is empty");

  const distanceMeters = parseDistanceMetersFromAttributes(routeResult) ?? estimateDistanceMeters(path);
  const etaFromService = parseEtaFromAttributes(routeResult);
  const fallbackEtaMinutes = Math.max(1, (distanceMeters / 1000 / 35) * 60);
  const etaMinutes =
    etaFromService == null
      ? fallbackEtaMinutes
      : // Some services return travel time in unexpected units/fields (e.g. seconds or hours) or garbage.
        // If the ETA is wildly larger than a generous multiple of our fallback, ignore it.
        etaFromService > Math.max(24 * 60, fallbackEtaMinutes * 6)
        ? fallbackEtaMinutes
        : etaFromService;
  const directionParam = resultParamNames.find((k) => /direction/i.test(k));
  let directionResult: any | null = null;
  let maneuvers: Array<{
    text: string;
    lengthMeters?: number;
    timeMinutes?: number;
    path?: Array<{ lat: number; lon: number }>;
  }> = [];
  if (directionParam) {
    try {
      directionResult = await fetchResultByParam(baseUrl, jobId, directionParam, token);
      // Closest-facility directions typically use the same length units as the route (meters);
      // defaulting to kilometers inflates `length` when only a generic Length field exists.
      maneuvers = parseManeuversFromDirections(directionResult, "meters");
    } catch {
      // Directions are optional; keep route result usable even when direction payload differs.
    }
  }
  maneuvers = normalizeManeuverDistances(maneuvers, distanceMeters);

  return {
    jobId,
    baseUrl,
    path,
    distanceMeters,
    etaMinutes,
    maneuvers,
    routeParam,
    directionParam: directionParam ?? null,
    resultParamNames,
    routeResult,
    directionResult,
    jobMessages: job?.messages ?? [],
  };
}

export async function getNavigationDiagnostics(
  origin: LatLng,
  destination: LatLng,
  opts?: { includeRaw?: boolean },
): Promise<{
  serviceUrl: string;
  jobId: string;
  resultParams: string[];
  chosenRouteParam: string;
  chosenDirectionParam: string | null;
  pathPointCount: number;
  maneuverCount: number;
  maneuverTextSamples: string[];
  directionFeatureCount: number;
  directionAttributeKeysSample: string[];
  jobMessages: Array<{ type?: string; description?: string }>;
  routeSummary: { distanceMeters: number; etaMinutes: number };
  raw?: { routeResult?: any; directionResult?: any | null };
}> {
  const solved = await solveNavigation(origin, destination);
  const dirFeatures = extractDirectionFeatures(solved.directionResult);
  const firstDirAttrs = dirFeatures?.[0]?.attributes ?? {};
  const directionAttributeKeysSample = Object.keys(firstDirAttrs).slice(0, 20);

  return {
    serviceUrl: solved.baseUrl,
    jobId: solved.jobId,
    resultParams: solved.resultParamNames,
    chosenRouteParam: solved.routeParam,
    chosenDirectionParam: solved.directionParam,
    pathPointCount: solved.path.length,
    maneuverCount: solved.maneuvers.length,
    maneuverTextSamples: solved.maneuvers.slice(0, 8).map((m) => m.text),
    directionFeatureCount: Array.isArray(dirFeatures) ? dirFeatures.length : 0,
    directionAttributeKeysSample,
    jobMessages: solved.jobMessages,
    routeSummary: {
      distanceMeters: solved.distanceMeters,
      etaMinutes: solved.etaMinutes,
    },
    ...(opts?.includeRaw
      ? { raw: { routeResult: solved.routeResult, directionResult: solved.directionResult } }
      : {}),
  };
}

