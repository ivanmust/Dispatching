# Routing, Navigation, and ETA — Deprecated

> **Status:** Removed. Will be rebuilt on top of ArcGIS Enterprise.

The previous routing / live-navigation / ETA stack — built around the in-country
Esri Rwanda Network Analysis GPServer (`FindRoutes`, `FindClosestFacilities`),
the `expo-speech` voice trigger, the `incident:etaUpdate` socket push, the
`POST /api/route` and `GET /api/eta` endpoints, the dispatcher route polylines,
and all of `backend/src/eta/*` — has been **retired** so the team can restart
the implementation cleanly on **ArcGIS Enterprise**.

## What was removed

### Backend
- `backend/src/eta/` (entire folder, including `arcgisRouteService`,
  `arcgisClosestFacility`, `etaService`, `etaCalculator`, `routeEngine`,
  `realtimeEtaPush`, `cacheStore`, `activeRouteSelectionStore`, `geo`, tests).
- `backend/src/routes/route.ts` (`POST /api/route`).
- `backend/src/routes/eta.ts` (`GET /api/eta`).
- `incident:etaUpdate` socket emit and the `active_routes_by_incident`
  payload on `POST /responder/location` and `responder:location` socket events.
- ArcGIS routing health probe (`RoutingEngineService.getArcgisHealth()`); the
  `/health/arcgis` and `/admin/health` endpoints now only report
  reverse-geocode readiness.
- All `ETA_*` and `ETA_ARCGIS_*` env vars (route URL, closest-facility URL,
  portal credentials for routing, traffic feeds, polyline emit toggles, cache
  buckets, circuit breakers, polling timeouts, etc.).
- `RoutingEngine` type and the `engine: "arcgis" | "fallback"` selector.

### Responder mobile
- `responder-mobile/src/lib/activeRouteSync.ts`,
  `responder-mobile/src/lib/navigationChip.ts` (and example tests).
- `responder-mobile/src/navigation/trigger/*` — the entire instruction trigger
  controller, GPS sample processor, voice trigger, movement detection,
  direction resolver, direction stability checker, haversine helper, and
  example tests.
- All navigation/ETA state, refs, polyline decoding, voice prompts, alternative
  route selection, "Navigate" button, and the full-screen navigation overlay
  in `ResponderHomeScreen.tsx` and `IncidentDetailsModal.tsx`.
- `api.getRoute()` and the `RouteResult` type in `responder-mobile/src/lib/api.ts`.
- The entire `NAV_TUNING` block in `responder-mobile/src/config.ts` and every
  `EXPO_PUBLIC_NAV_*` env var.
- All `nav*` palette entries in `responder-mobile/src/ui/theme.ts`.
- The `expo-speech` dependency.

### Dispatcher web
- The dispatcher map's ETA chip wiring still listens for the (now never sent)
  `incident:etaUpdate` event; that listener is harmless until it is removed in
  the rebuild.

## What is still ArcGIS-backed

- **Reverse-geocode for incident pins:** `/api/arcgis/reverse-geocode` (and the
  legacy `/api/osm/reverse-geocode` alias) keeps reading the local Postgres
  `rwanda_admin_boundaries` table and the `esrirw.rw` admin-boundary
  FeatureServer, with an optional road-name `GeocodeServer` lookup configured
  via `ESRI_REVERSE_GEOCODE_URL` / `ESRI_REVERSE_GEOCODE_TOKEN`.
- **Map basemaps** continue to use the Esri Rwanda tiled services on
  `esrirw.rw`. Nothing leaves the country.

## Rebuild plan (ArcGIS Enterprise)

The rebuild will live in a new module (likely `backend/src/routing/` and a
fresh navigation stack under `responder-mobile/src/navigation/`) and use the
ArcGIS Enterprise Network Analyst services (Route, Closest Facility, Service
Area) directly. Until that work lands, dispatchers can still see the
responder's live position on the map and suggest the closest responder via
haversine ordering on the latest `responder_locations` ping; what they do not
get back yet is road-aware travel time, polylines, turn-by-turn, or ETA.
