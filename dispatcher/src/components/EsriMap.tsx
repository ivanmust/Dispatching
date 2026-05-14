/* eslint-disable @typescript-eslint/no-explicit-any */
import '@arcgis/map-components/main.css';
import { useEffect, useRef, useState } from 'react';
import type { Incident } from '@/types/incident';
import {
  STATUS_COLORS,
  incidentCategoryDisplayLabel,
  incidentPriorityDisplayLabel,
  incidentStatusDisplayLabel,
} from '@/types/incident';
import type { PointOfInterest } from '@/lib/pointsOfInterest';

interface EsriMapProps {
  incidents: Incident[];
  selectedIncidentId: string | null;
  onSelectIncident: (id: string) => void;
  pickMode?: boolean;
  onMapClick?: (lat: number, lon: number) => void;
  userLocation?: { lat: number; lon: number } | null;
  responders?: { id: string; lat: number; lon: number; available?: boolean }[];
  suggestedResponderId?: string | null;
  pointsOfInterest?: PointOfInterest[];
  geofences?: Array<{ id: string; name: string; geometry: Record<string, unknown> }>;
  etaRoutePolyline?: string | null;
  etaAltRoutePolylines?: string[] | null;
}

function decodePolylineGoogle(polyline: string, precision = 5): Array<{ lat: number; lng: number }> {
  const factor = 10 ** precision;
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < polyline.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = polyline.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < polyline.length);
    const dLat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dLat;

    result = 0;
    shift = 0;
    do {
      b = polyline.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < polyline.length);
    const dLng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

function isWebGL2Supported(): boolean {
  try {
    if (typeof WebGL2RenderingContext === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return !!gl;
  } catch {
    return false;
  }
}

function circleToRing(lon: number, lat: number, radiusMeters: number, numPoints = 32): number[][][] {
  const radiusDeg = radiusMeters / 111320;
  const ring: number[][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    ring.push([lon + radiusDeg * Math.cos(angle), lat + radiusDeg * Math.sin(angle)]);
  }
  return [ring];
}

// Dispatcher baseline map profile:
// keep Search + Layer List + Basemap Gallery controls.
// POI/admin/bus-stop overlays are off by default and can be enabled in Layer List.
const POI_COLORS: Record<string, string> = { AED: '#dc2626', hydrant: '#2563eb', first_aid: '#16a34a' };

const MAP_VIEWER_URL =
  import.meta.env.VITE_ESRI_MAP_VIEWER_URL ??
  'https://esrirw.rw/portal/apps/mapviewer/index.html?webmap=3e190cfba7fd4d1f8c9600cc072a6d15';
const POI_ITEM_ID =
  (import.meta.env.VITE_ESRI_POI_ITEM_ID as string | undefined)?.trim() ||
  '2bdce68231634e0598c206a4447e5b61';
const VILLAGE_BOUNDARY_ITEM_ID =
  (import.meta.env.VITE_ESRI_VILLAGE_BOUNDARY_ITEM_ID as string | undefined)?.trim() ||
  '6358416b7aa64469ad5a3d3c421d80a9';
const RW_ADMIN_BOUNDARY_URL =
  (import.meta.env.VITE_ESRI_RW_ADMIN_BOUNDARY_URL as string | undefined)?.trim() ||
  'https://esrirw.rw/server/rest/services/Hosted/Rwanda_Administrative_Boundaries1/FeatureServer/5';

const KIGALI_BUS_LINES_URL =
  (import.meta.env.VITE_ESRI_KIGALI_BUS_LINES_URL as string | undefined)?.trim() ||
  'https://esrirw.rw/server/rest/services/Hosted/Kigali_Bus_Lines_and_Stops_Network/FeatureServer/0';
const KIGALI_BUS_STOPS_URL =
  (import.meta.env.VITE_ESRI_KIGALI_BUS_STOPS_URL as string | undefined)?.trim() ||
  'https://esrirw.rw/server/rest/services/Hosted/Kigali_Bus_Lines_and_Stops_Network/FeatureServer/1';

/** When portal preflight fails, skip FeatureServer layers on the same host to avoid long hangs. */
function layerUrlSharesPortalHostname(layerUrl: string | undefined | null, portalUrlStr: string): boolean {
  if (!layerUrl) return false;
  try {
    return new URL(layerUrl).hostname.toLowerCase() === new URL(portalUrlStr).hostname.toLowerCase();
  } catch {
    return false;
  }
}

function derivePortalUrlFromMapViewer(viewerUrl: string): string {
  try {
    const u = new URL(viewerUrl);
    const idx = u.pathname.indexOf('/portal');
    if (idx >= 0) {
      return `${u.origin}${u.pathname.slice(0, idx + '/portal'.length)}`;
    }
  } catch {
    // ignore
  }
  return 'https://esrirw.rw/portal';
}

const ESRI_PORTAL_URL =
  import.meta.env.VITE_ESRI_PORTAL_URL?.trim() ||
  derivePortalUrlFromMapViewer(MAP_VIEWER_URL);
const ESRI_USE_VITE_PROXY = String(import.meta.env.VITE_ESRI_VITE_PROXY ?? '')
  .toLowerCase()
  .trim() === '1' || String(import.meta.env.VITE_ESRI_VITE_PROXY ?? '').toLowerCase().trim() === 'true';

function isArcgisOnlineHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'www.arcgis.com' || h === 'arcgis.com' || h.endsWith('.arcgis.com');
}

/** In dev, route enterprise portal traffic through the Vite `/portal` + `/sharing` proxy. */
function shouldRouteArcGisPortalThroughViteProxy(urlStr: string): boolean {
  if (!import.meta.env.DEV || !ESRI_USE_VITE_PROXY) return false;
  try {
    return !isArcgisOnlineHost(new URL(urlStr).hostname);
  } catch {
    return false;
  }
}

const ESRI_DISABLE_ARCGIS_JS = String(import.meta.env.VITE_ESRI_DISABLE_ARCGIS_JS ?? '')
  .toLowerCase()
  .trim() === '1' || String(import.meta.env.VITE_ESRI_DISABLE_ARCGIS_JS ?? '').toLowerCase().trim() === 'true';

const ESRI_SHOW_OPEN_IN_NEW_TAB = String(import.meta.env.VITE_ESRI_SHOW_MAP_IN_NEW_TAB ?? '')
  .toLowerCase()
  .trim() === '1' || String(import.meta.env.VITE_ESRI_SHOW_MAP_IN_NEW_TAB ?? '').toLowerCase().trim() === 'true';
const ESRI_WEBMAP_ID = (() => {
  const m = MAP_VIEWER_URL.match(/[?&]webmap=([a-f0-9]+)/i);
  return m ? m[1] : '3e190cfba7fd4d1f8c9600cc072a6d15';
})();

const ESRI_DISABLE_POI_LAYER =
  String(import.meta.env.VITE_ESRI_DISABLE_POI_LAYER ?? '')
    .toLowerCase()
    .trim() === '1' ||
  String(import.meta.env.VITE_ESRI_DISABLE_POI_LAYER ?? '').toLowerCase().trim() === 'true';

const MAP_VIEWER_IFRAME_SRC = (() => {
  try {
    const url = new URL(MAP_VIEWER_URL);

    // In dev, route the iframe through Vite so the request becomes same-origin.
    // This helps when the ArcGIS viewer uses `X-Frame-Options: SAMEORIGIN` (otherwise Chrome shows `chrome-error://...`).
    if (shouldRouteArcGisPortalThroughViteProxy(MAP_VIEWER_URL)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // ignore; fallback to original URL
  }
  return MAP_VIEWER_URL;
})();

export function EsriMap({
  incidents,
  selectedIncidentId,
  onSelectIncident,
  pickMode,
  onMapClick,
  userLocation,
  responders = [],
  suggestedResponderId,
  pointsOfInterest = [],
  geofences = [],
  etaRoutePolyline,
  etaAltRoutePolylines,
}: EsriMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const graphicsLayerRef = useRef<any>(null);
  const etaRouteLayerRef = useRef<any>(null);
  const etaAltRouteLayerRef = useRef<any>(null);
  const incidentLayerRef = useRef<any>(null);
  const incidentBlobUrlRef = useRef<string | null>(null);
  const poiFeatureLayerRef = useRef<any>(null);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [useIframeFallback, setUseIframeFallback] = useState(ESRI_DISABLE_ARCGIS_JS);
  const [iframeReloadTick, setIframeReloadTick] = useState(0);
  const [iframeReloadCount, setIframeReloadCount] = useState(0);

  useEffect(() => {
    let destroyed = false;

    async function init() {
      if (ESRI_DISABLE_ARCGIS_JS) {
        setUseIframeFallback(true);
        setMapLoadError(null);
        return;
      }

      if (!isWebGL2Supported()) {
        setMapLoadError(
          'Map requires WebGL2, but it is not supported in this environment. Try enabling hardware acceleration, updating GPU drivers, or using a different browser/device.',
        );
        return;
      }

      const [
        { default: esriConfig },
        { default: Map },
        { default: WebMap },
        { default: MapView },
        { default: GraphicsLayer },
        { default: Collection },
        { default: FeatureLayer },
      ] = await Promise.all([
        import('@arcgis/core/config'),
        import('@arcgis/core/Map'),
        import('@arcgis/core/WebMap'),
        import('@arcgis/core/views/MapView'),
        import('@arcgis/core/layers/GraphicsLayer'),
        import('@arcgis/core/core/Collection'),
        import('@arcgis/core/layers/FeatureLayer'),
      ]);

      await Promise.all([
        import('@arcgis/map-components/components/arcgis-search'),
        import('@arcgis/map-components/components/arcgis-expand'),
        import('@arcgis/map-components/components/arcgis-layer-list'),
        import('@arcgis/map-components/components/arcgis-basemap-gallery'),
      ]);

      if (destroyed || !containerRef.current) return;

      // In dev, ArcGIS JS requests the portal directly based on `portalUrl`.
      // If we enable the Vite proxy, route portal traffic through same-origin.
      esriConfig.portalUrl = ESRI_PORTAL_URL;
      try {
        const portalUrl = new URL(ESRI_PORTAL_URL);
        if (shouldRouteArcGisPortalThroughViteProxy(ESRI_PORTAL_URL)) {
          esriConfig.portalUrl = `${window.location.origin}${portalUrl.pathname}`;
        }
      } catch {
        // ignore; keep the absolute portalUrl
      }
      esriConfig.request.timeout = 45000;

      const gl = new GraphicsLayer();
      graphicsLayerRef.current = gl;
      const etaRouteLayer = new GraphicsLayer({ id: 'eta-route-layer' } as any);
      const etaAltRouteLayer = new GraphicsLayer({ id: 'eta-alt-route-layer' } as any);
      etaRouteLayerRef.current = etaRouteLayer;
      etaAltRouteLayerRef.current = etaAltRouteLayer;

      let portalOk = false;
      try {
        const controller = new AbortController();
        // Fail fast here: when portal is unreachable, continuing to load WebMap causes noisy failures.
        const timer = setTimeout(() => controller.abort(), 8000);
        const portalSelfCheckUrl = (() => {
          try {
            if (shouldRouteArcGisPortalThroughViteProxy(ESRI_PORTAL_URL)) {
              const portalPath = new URL(ESRI_PORTAL_URL).pathname.replace(/\/$/, '') || '/portal';
              return `${portalPath}/sharing/rest/portals/self?f=json`;
            }
          } catch {
            // ignore and fall back to the absolute URL
          }
          const base = String(esriConfig.portalUrl || '').replace(/\/$/, '');
          return `${base}/sharing/rest/portals/self?f=json`;
        })();
        if (portalSelfCheckUrl) {
          const resp = await fetch(portalSelfCheckUrl, { signal: controller.signal });
          clearTimeout(timer);
          // Private portals can legitimately return 401/403 before interactive sign-in.
          // Treat those as reachable so we still attempt WebMap.load() and allow auth flows.
          portalOk = resp.ok || resp.status === 401 || resp.status === 403;
        } else portalOk = true;
      } catch {
        portalOk = false;
      }

      // Prefer loading the portal WebMap when reachable, but always ensure we show *some* map.
      let map: any;
      if (portalOk) {
        map = new WebMap({
          portalItem: { id: ESRI_WEBMAP_ID },
        });
        try {
          await Promise.race([
            map.load(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("webmap_load_timeout")), 60000)),
          ]);
          setMapLoadError(null);
        } catch {
          // If the WebMap can't load, fall back to a basemap instead of a blank screen.
          setMapLoadError("Web map failed to load. Falling back to standard basemap.");
          map = new Map({ basemap: "satellite" } as any);
          setUseIframeFallback(false);
        }
      } else {
        // Portal unreachable: use a standard ArcGIS basemap (no portal dependency).
        // This is a normal fallback in constrained environments, so do not surface a noisy error banner.
        setMapLoadError(null);
        map = new Map({ basemap: "satellite" } as any);
        setUseIframeFallback(false);
      }

      try {
        await map.load?.();
      } catch {
        // ignore
      }

      /** Load portal/URL layers before adding so auth failures (e.g. user-aborted) do not leave broken layer views. */
      async function addFeatureLayerIfLoads(targetMap: any, props: any): Promise<any | null> {
        const layer = new FeatureLayer(props as any);
        try {
          await layer.load();
          targetMap.add(layer);
          return layer;
        } catch {
          try {
            layer.destroy();
          } catch {
            // ignore
          }
          return null;
        }
      }

      let poiFeatureLayer: any | null = null;
      // Portal-only layers: skip entirely when the portal preflight failed (timeouts → noisy ArcGIS console spam).
      if (portalOk && !ESRI_DISABLE_POI_LAYER && POI_ITEM_ID) {
        poiFeatureLayer = await addFeatureLayerIfLoads(map, {
          portalItem: { id: POI_ITEM_ID, portal: { url: ESRI_PORTAL_URL } as any } as any,
          layerId: 0,
          title: 'Points of interest',
          opacity: 1,
          visible: false,
        } as any);
        // Ensure a readable POI symbology (type-colored markers) even when the portal layer's renderer changes.
        if (poiFeatureLayer) {
          poiFeatureLayerRef.current = poiFeatureLayer;
          try {
            poiFeatureLayer.renderer = {
              type: 'simple',
              symbol: {
                type: 'simple-marker',
                style: 'circle',
                size: 10,
                color: '#6b7280',
                outline: { color: '#ffffff', width: 1.5 },
              },
              visualVariables: [
                {
                  type: 'color',
                  field: 'type',
                  stops: [
                    { value: 'AED', color: POI_COLORS.AED },
                    { value: 'hydrant', color: POI_COLORS.hydrant },
                    { value: 'first_aid', color: POI_COLORS.first_aid },
                  ],
                },
              ],
            } as any;
            poiFeatureLayer.popupEnabled = true;
          } catch {
            // ignore
          }
        }
      }

      const villageFromPortal =
        portalOk && VILLAGE_BOUNDARY_ITEM_ID
        ? await addFeatureLayerIfLoads(map, {
            portalItem: { id: VILLAGE_BOUNDARY_ITEM_ID, portal: { url: ESRI_PORTAL_URL } as any } as any,
            title: 'Village boundaries',
            opacity: 0.6,
            visible: false,
            renderer: {
              type: 'simple',
              symbol: {
                type: 'simple-fill',
                color: [0, 0, 0, 0],
                outline: { color: [110, 110, 110, 200], width: 1 },
              },
            } as any,
          } as any)
        : null;
      // When the portal preflight failed, the browser usually cannot reach the portal host’s GIS Server either.
      // Skip hosted FeatureServer layers on that host to avoid long hangs and noisy ArcGIS console errors.
      const tryRwAdminFeatureService =
        !!RW_ADMIN_BOUNDARY_URL &&
        (portalOk || !layerUrlSharesPortalHostname(RW_ADMIN_BOUNDARY_URL, ESRI_PORTAL_URL));
      const tryBusFeatureService =
        portalOk || !layerUrlSharesPortalHostname(KIGALI_BUS_LINES_URL, ESRI_PORTAL_URL);

      if (!villageFromPortal && tryRwAdminFeatureService) {
        await addFeatureLayerIfLoads(map, {
          url: RW_ADMIN_BOUNDARY_URL,
          title: 'Village boundaries (fallback)',
          opacity: 0.6,
          visible: false,
          renderer: {
            type: 'simple',
            symbol: {
              type: 'simple-fill',
              color: [0, 0, 0, 0],
              outline: { color: [110, 110, 110, 200], width: 1 },
            },
          } as any,
        } as any);
      }

      if (tryRwAdminFeatureService) {
        await addFeatureLayerIfLoads(map, {
          url: RW_ADMIN_BOUNDARY_URL,
          title: 'Rwanda administrative boundaries',
          opacity: 0.55,
          visible: false,
          renderer: {
            type: 'simple',
            symbol: {
              type: 'simple-fill',
              color: [0, 0, 0, 0],
              outline: { color: [59, 130, 246, 210], width: 1 },
            },
          } as any,
        } as any);
      }

      // Kigali bus transit network (same GIS host as portal). Published as two sublayers:
      //   /0 = bus line polylines, /1 = bus stop points. If the service reorders or
      //   requires auth we silently skip so the rest of the map keeps working.
      // Bus lines: transit-themed dashed deep-blue stroke so they read clearly against both
      // the satellite basemap and the incident/route layers (which use red/green/yellow).
      if (tryBusFeatureService) {
        await addFeatureLayerIfLoads(map, {
          url: KIGALI_BUS_LINES_URL,
          title: 'Bus lines',
          opacity: 0.9,
          renderer: {
            type: 'simple',
            symbol: {
              type: 'simple-line',
              color: [29, 78, 216, 230], // Tailwind blue-700
              width: 2.5,
              style: 'dash',
              cap: 'round',
              join: 'round',
            },
          } as any,
        } as any);
        // Bus stops: white-filled square with a thick crimson outline so they are visually
        // distinct from the blue bus-line polylines above and the round POI / incident markers.
        await addFeatureLayerIfLoads(map, {
          url: KIGALI_BUS_STOPS_URL,
          title: 'Bus stops',
          opacity: 0.95,
          visible: false,
          renderer: {
            type: 'simple',
            symbol: {
              type: 'simple-marker',
              style: 'square',
              color: [255, 255, 255, 240],
              size: 8,
              outline: { color: [220, 38, 38, 240], width: 1.8 }, // Tailwind red-600
            },
          } as any,
        } as any);
      }

      map.add(gl);
      map.add(etaAltRouteLayer);
      map.add(etaRouteLayer);

      let view: any;
      try {
        view = new MapView({
          container: containerRef.current,
          map,
          center: [30.06, -1.95],
          zoom: 9,
          constraints: {
            rotationEnabled: false,
            geometry: {
              type: 'extent',
              xmin: 28.86,
              ymin: -2.9,
              xmax: 30.9,
              ymax: -1.0,
              spatialReference: { wkid: 4326 },
            } as any,
            minZoom: 7,
            maxZoom: 20,
          } as any,
        });
        viewRef.current = view;
      } catch (e: any) {
        const msg = typeof e?.message === 'string' && e.message.length > 0 ? e.message : 'Failed to initialize map view.';
        setMapLoadError(msg);
        return;
      }

      // If we aren't using a portal WebMap, ensure we start centered in Rwanda.
      if (!portalOk) {
        try {
          await view.when();
          await view.goTo({ center: [30.06, -1.95], zoom: 12 }, { animate: false });
        } catch {
          // ignore
        }
      }

      // Map UI: use map-components (arcgis-*) instead of deprecated JSAPI widgets (Search, Expand, etc.).
      try {
        const sources = new Collection([
          {
            url: 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer',
            singleLineFieldName: 'SingleLine',
            name: 'Address',
            placeholder: 'Search address',
            countryCode: 'RWA',
            maxResults: 8,
            maxSuggestions: 8,
            suggestionsEnabled: true,
            minSuggestCharacters: 2,
          },
        ] as any);
        const searchEl = document.createElement('arcgis-search') as HTMLElement & {
          view: typeof view;
          includeDefaultSourcesDisabled: boolean;
          allPlaceholder: string;
          sources: typeof sources;
          popupDisabled: boolean;
        };
        searchEl.view = view;
        searchEl.includeDefaultSourcesDisabled = true;
        searchEl.allPlaceholder = 'Search place or address';
        searchEl.sources = sources;
        searchEl.popupDisabled = false;
        searchEl.style.borderRadius = '14px';
        searchEl.style.boxShadow = '0 12px 40px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.06)';
        searchEl.style.margin = '12px';
        searchEl.style.overflow = 'hidden';
        searchEl.style.border = '1px solid rgba(255, 255, 255, 0.65)';

        if (poiFeatureLayer) {
          try {
            sources.add({
              layer: poiFeatureLayer,
              name: 'POI',
              placeholder: 'Search POIs',
              searchFields: ['name', 'label', 'type', 'title'],
              displayField: 'name',
              outFields: ['*'],
              maxResults: 8,
              maxSuggestions: 8,
              suggestionTemplate: '{name}',
              exactMatch: false,
            } as any);
          } catch {
            // ignore
          }
        }
        view.ui.add(searchEl, 'top-right');
      } catch {
        // ignore
      }

      try {
        const layerListEl = document.createElement('arcgis-layer-list') as HTMLElement & { view: typeof view };
        layerListEl.view = view;

        const layerListExpand = document.createElement('arcgis-expand') as HTMLElement & {
          view: typeof view;
          expandIcon: string;
          expandTooltip: string;
          collapseTooltip: string;
          group: string;
        };
        layerListExpand.view = view;
        layerListExpand.expandIcon = 'layers';
        layerListExpand.expandTooltip = 'Layer list';
        layerListExpand.collapseTooltip = 'Close';
        layerListExpand.group = 'top-left';
        layerListExpand.style.marginTop = '12px';
        layerListExpand.style.marginLeft = '12px';
        layerListExpand.style.filter =
          'drop-shadow(0 10px 28px rgba(15, 23, 42, 0.12)) drop-shadow(0 2px 6px rgba(15, 23, 42, 0.06))';
        layerListExpand.appendChild(layerListEl);
        view.ui.add(layerListExpand, 'top-left');

        const basemapGalleryEl = document.createElement('arcgis-basemap-gallery') as HTMLElement & {
          view: typeof view;
        };
        basemapGalleryEl.view = view;
        // Keep gallery panel readable; default host sizing can collapse to a tiny strip.
        basemapGalleryEl.style.display = 'block';
        basemapGalleryEl.style.width = '320px';
        basemapGalleryEl.style.maxWidth = 'min(85vw, 360px)';
        basemapGalleryEl.style.maxHeight = '60vh';
        basemapGalleryEl.style.overflow = 'auto';
        basemapGalleryEl.style.background = 'rgba(255, 255, 255, 0.96)';
        basemapGalleryEl.style.borderRadius = '14px';
        basemapGalleryEl.style.border = '1px solid rgba(15, 23, 42, 0.08)';
        basemapGalleryEl.style.boxShadow =
          '0 16px 48px rgba(15, 23, 42, 0.12), 0 4px 12px rgba(15, 23, 42, 0.06)';

        const basemapExpand = document.createElement('arcgis-expand') as HTMLElement & {
          view: typeof view;
          expandIcon: string;
          expandTooltip: string;
          collapseTooltip: string;
          group: string;
        };
        basemapExpand.view = view;
        basemapExpand.expandIcon = 'basemap';
        basemapExpand.expandTooltip = 'Basemap gallery';
        basemapExpand.collapseTooltip = 'Close';
        basemapExpand.group = 'top-left';
        basemapExpand.style.maxWidth = 'min(90vw, 380px)';
        basemapExpand.style.marginTop = '12px';
        basemapExpand.style.marginLeft = '12px';
        basemapExpand.style.filter =
          'drop-shadow(0 10px 28px rgba(15, 23, 42, 0.12)) drop-shadow(0 2px 6px rgba(15, 23, 42, 0.06))';
        basemapExpand.appendChild(basemapGalleryEl);
        view.ui.add(basemapExpand, 'top-left');
      } catch {
        // ignore
      }

    }

    init();

    return () => {
      destroyed = true;
      viewRef.current?.destroy();
    };
  }, []);

  // Draw ETA route + alternatives for selected incident.
  useEffect(() => {
    const view = viewRef.current;
    const map = view?.map;
    const routeLayer = etaRouteLayerRef.current;
    const altLayer = etaAltRouteLayerRef.current;
    if (!view || !map || !routeLayer || !altLayer) return;

    const draw = async () => {
      const [{ default: Graphic }, { default: Polyline }, { default: SimpleLineSymbol }] = await Promise.all([
        import('@arcgis/core/Graphic'),
        import('@arcgis/core/geometry/Polyline'),
        import('@arcgis/core/symbols/SimpleLineSymbol'),
      ]);
      routeLayer.removeAll();
      altLayer.removeAll();

      if (Array.isArray(etaAltRoutePolylines)) {
        etaAltRoutePolylines.forEach((encoded) => {
          if (!encoded || typeof encoded !== 'string') return;
          try {
            const pts = decodePolylineGoogle(encoded);
            if (pts.length < 2) return;
            const paths = [pts.map((p) => [p.lng, p.lat])];
            altLayer.add(
              new Graphic({
                geometry: new Polyline({ paths, spatialReference: { wkid: 4326 } }),
                symbol: new SimpleLineSymbol({
                  color: [100, 116, 139, 0.75],
                  width: 3,
                  style: 'dash',
                }),
              }),
            );
          } catch {
            // ignore bad alt polyline
          }
        });
      }

      if (etaRoutePolyline && typeof etaRoutePolyline === 'string') {
        try {
          const pts = decodePolylineGoogle(etaRoutePolyline);
          if (pts.length >= 2) {
            const paths = [pts.map((p) => [p.lng, p.lat])];
            routeLayer.add(
              new Graphic({
                geometry: new Polyline({ paths, spatialReference: { wkid: 4326 } }),
                symbol: new SimpleLineSymbol({
                  color: [37, 99, 235, 0.95],
                  width: 4,
                }),
              }),
            );
          }
        } catch {
          // ignore bad route polyline
        }
      }
    };

    void draw();
  }, [etaRoutePolyline, etaAltRoutePolylines, selectedIncidentId]);

  useEffect(() => {
    if (!useIframeFallback) return;
    if (iframeReloadCount >= 3) return;

    const timer = window.setTimeout(() => {
      setIframeReloadTick((t) => t + 1);
      setIframeReloadCount((c) => c + 1);
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [useIframeFallback, iframeReloadCount]);

  // Handle map click for pick mode / selection
  useEffect(() => {
    if (!viewRef.current) return;
    const view = viewRef.current;

    const handler = view.on('click', (event: any) => {
      if (pickMode && onMapClick) {
        const point =
          event?.mapPoint ??
          (typeof event?.x === 'number' && typeof event?.y === 'number' && view?.toMap
            ? view.toMap({ x: event.x, y: event.y })
            : null);
        const lat = point?.latitude;
        const lon = point?.longitude;
        if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) {
          onMapClick(lat, lon);
        }
      } else {
        view.hitTest(event).then((response: any) => {
          const results = response.results ?? [];
          const responderHit = results.find((r: any) => r.graphic?.attributes?.responderId);
          if (responderHit) return;
          const incidentHit = results.find((r: any) => r.graphic?.attributes?.incidentId);
          if (incidentHit) onSelectIncident(incidentHit.graphic.attributes.incidentId);
        });
      }
    });

    return () => handler.remove();
  }, [pickMode, onMapClick, onSelectIncident]);

  // Update markers
  useEffect(() => {
    const gl = graphicsLayerRef.current;
    const view = viewRef.current;
    const map = view?.map;
    if (!gl || !map) return;

    const updateMarkers = async () => {
      const [
        { default: Graphic },
        { default: Point },
        { default: SimpleMarkerSymbol },
        { default: PictureMarkerSymbol },
        { default: Polygon },
      ] = await Promise.all([
        import('@arcgis/core/Graphic'),
        import('@arcgis/core/geometry/Point'),
        import('@arcgis/core/symbols/SimpleMarkerSymbol'),
        import('@arcgis/core/symbols/PictureMarkerSymbol'),
        import('@arcgis/core/geometry/Polygon'),
      ]);

      const responderCarIconUrl = (bodyColor: string) =>
        `data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
            <defs>
              <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#111827" flood-opacity="0.35"/>
              </filter>
            </defs>
            <g filter="url(#s)">
              <rect x="10" y="26" width="44" height="17" rx="6" fill="${bodyColor}" stroke="#ffffff" stroke-width="2"/>
              <path d="M18 26 L25 18 H40 L48 26 Z" fill="${bodyColor}" stroke="#ffffff" stroke-width="2"/>
              <rect x="26" y="16.8" width="12" height="3.8" rx="1.7" fill="#e5e7eb" stroke="#ffffff" stroke-width="1"/>
              <rect x="26.4" y="17.2" width="5.2" height="3" rx="1.2" fill="#2563eb"/>
              <rect x="32.4" y="17.2" width="5.2" height="3" rx="1.2" fill="#38bdf8"/>
              <rect x="22.5" y="30.2" width="4.2" height="2.1" rx="0.9" fill="#ffffff"/>
              <rect x="37.2" y="30.2" width="4.2" height="2.1" rx="0.9" fill="#ffffff"/>
              <circle cx="22" cy="44" r="6" fill="#111827" stroke="#ffffff" stroke-width="2"/>
              <circle cx="42" cy="44" r="6" fill="#111827" stroke="#ffffff" stroke-width="2"/>
              <rect x="27" y="21" width="12" height="5" rx="2" fill="#bfdbfe"/>
            </g>
          </svg>`,
        )}`;

      // Remove existing incident cluster layer and revoke blob URL
      const existing = incidentLayerRef.current;
      if (existing) {
        map.remove(existing);
        incidentLayerRef.current = null;
      }
  
      incidentBlobUrlRef.current = null;

      // Show every incident point directly on the map.
      const visibleIncidents = incidents;

      if (visibleIncidents.length > 0) {
        try {
          const { default: GeoJSONLayer } = await import('@arcgis/core/layers/GeoJSONLayer');
          const geojson = {
            type: 'FeatureCollection' as const,
            features: visibleIncidents.map((inc) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [inc.location.lon, inc.location.lat] },
              properties: {
                incidentId: inc.id,
                title: inc.title,
                status: inc.status,
                statusLabel: incidentStatusDisplayLabel(inc.status),
                priority: inc.priority,
                priorityLabel: incidentPriorityDisplayLabel(inc.priority),
                category: inc.category,
                categoryLabel: incidentCategoryDisplayLabel(inc.category),
              },
            })),
          };
          const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          incidentBlobUrlRef.current = url;
          const incidentLayer = new GeoJSONLayer({
            url,
            id: 'incident-cluster-layer',
            title: 'Incidents',
            labelsVisible: false,
            renderer: {
              type: 'unique-value',
              field: 'status',
              symbol: {
                type: 'simple-marker',
                size: 11,
                color: '#ef4444',
                outline: { color: 'rgba(0,0,0,0.25)', width: 1 },
              } as any,
              uniqueValueInfos: Object.entries(STATUS_COLORS).map(([status, color]) => ({
                value: status,
                symbol: {
                  type: 'simple-marker',
                  size: 11,
                  color,
                  outline: { color: 'rgba(0,0,0,0.25)', width: 1 },
                } as any,
              })),
            } as any,
            popupTemplate: {
              title: '{title}',
              content:
                '<b>Status:</b> {statusLabel}<br/><b>Priority:</b> {priorityLabel}<br/><b>Category:</b> {categoryLabel}',
            } as any,
            featureReduction: undefined,
          } as any);
          incidentLayerRef.current = incidentLayer;
          const glIndex = map.layers.indexOf(gl);
          map.add(incidentLayer, glIndex >= 0 ? glIndex : 0);
        } catch (e) {
          console.warn('Incident clustering failed, using graphics', e);
        }
      }

      gl.removeAll();

      // Selected incident highlight (draw on top of cluster layer)
      const selectedInc = visibleIncidents.find((inc) => inc.id === selectedIncidentId);
      if (selectedInc) {
        gl.add(
          new Graphic({
            geometry: new Point({ longitude: selectedInc.location.lon, latitude: selectedInc.location.lat }),
            symbol: new SimpleMarkerSymbol({
              color: STATUS_COLORS[selectedInc.status],
              size: 18,
              outline: { color: '#ffffff', width: 3 },
            }),
            attributes: { incidentId: selectedInc.id },
          }),
        );
      }

      // Geofences
      geofences.forEach((gf) => {
        const g = gf.geometry as { type?: string; lat?: number; lon?: number; radiusMeters?: number };
        if (g?.type === 'circle' && typeof g.lat === 'number' && typeof g.lon === 'number' && typeof g.radiusMeters === 'number') {
          const polygon = new Polygon({
            rings: circleToRing(g.lon, g.lat, g.radiusMeters),
            spatialReference: { wkid: 4326 },
          } as any);
          gl.add(
            new Graphic({
              geometry: polygon,
              symbol: {
                type: 'simple-fill',
                color: [128, 128, 255, 0.2],
                outline: { color: [64, 64, 200, 0.8], width: 2 },
              } as any,
              attributes: { type: 'geofence', geofenceId: gf.id },
            }),
          );
        }
      });

      // User location
      if (userLocation) {
        gl.add(
          new Graphic({
            geometry: new Point({ longitude: userLocation.lon, latitude: userLocation.lat }),
            symbol: new SimpleMarkerSymbol({
              color: '#22c55e',
              size: 14,
              outline: { color: '#ffffff', width: 2 },
            }),
          }),
        );
      }

      // POIs
      pointsOfInterest.forEach((poi) => {
        gl.add(
          new Graphic({
            geometry: new Point({ longitude: poi.lon, latitude: poi.lat }),
            symbol: new SimpleMarkerSymbol({
              color: POI_COLORS[poi.type] ?? '#6b7280',
              size: 10,
              outline: { color: '#ffffff', width: 1 },
            }),
            attributes: { type: 'poi', poiId: poi.id },
            popupTemplate: {
              title: poi.type === 'AED' ? 'AED' : poi.type === 'hydrant' ? 'Fire hydrant' : 'First aid',
              content: poi.label ?? poi.type,
            },
          }),
        );
      });

      // Responders
      responders.forEach((r) => {
        const isSuggested = !!suggestedResponderId && r.id === suggestedResponderId;
        const markerColor = r.available === false ? '#2563eb' : '#1d4ed8';
        gl.add(
          new Graphic({
            geometry: new Point({ longitude: r.lon, latitude: r.lat }),
            symbol: new PictureMarkerSymbol({
              url: responderCarIconUrl(markerColor),
              width: isSuggested ? 36 : 31,
              height: isSuggested ? 36 : 31,
              yoffset: 2,
            }),
            attributes: { responderId: r.id },
            popupTemplate: {
              title: "Responder",
              content: isSuggested
                ? 'Suggested nearest responder'
                : r.available === false
                  ? 'Busy responder'
                  : 'Available responder',
            },
          }),
        );
      });
    };

    updateMarkers();

    return () => {
      incidentBlobUrlRef.current = null;
      const existing = incidentLayerRef.current;
      if (existing && view?.map) {
        view.map.remove(existing);
        incidentLayerRef.current = null;
      }
    };
  }, [incidents, selectedIncidentId, userLocation, responders, suggestedResponderId, pointsOfInterest, geofences]);

  // Zoom to user live location when available
  useEffect(() => {
    if (!userLocation || !viewRef.current) return;
    const view = viewRef.current;
    if (!view?.ready || !view?.spatialReference) return;
    view.goTo({ center: [userLocation.lon, userLocation.lat], zoom: 15 }).catch(() => {
      // ignore
    });
  }, [userLocation]);

  // Zoom to selected incident
  useEffect(() => {
    if (!selectedIncidentId || !viewRef.current) return;
    const inc = incidents.find((i) => i.id === selectedIncidentId);
    if (!inc) return;
    const view = viewRef.current;
    if (!view?.ready || !view?.spatialReference) return;
    view.goTo({ center: [inc.location.lon, inc.location.lat], zoom: 15 }).catch(() => {
      // ignore
    });
  }, [selectedIncidentId, incidents]);

  if (useIframeFallback) {
    return (
      <div className="relative w-full h-full rounded-none overflow-hidden bg-slate-950/5">
        <iframe
          key={`map-viewer-${iframeReloadTick}`}
          src={MAP_VIEWER_IFRAME_SRC}
          title="Rwanda Map"
          className="w-full h-full border-0"
          allowFullScreen
        />
        {mapLoadError && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-3">
            <div className="pointer-events-auto max-w-[min(95%,42rem)] rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 shadow-[0_12px_40px_rgba(15,23,42,0.12)] backdrop-blur-md ring-1 ring-amber-400/20">
              {mapLoadError}
            </div>
          </div>
        )}
        <div className="absolute bottom-4 left-4 z-20">
          {ESRI_SHOW_OPEN_IN_NEW_TAB ? (
            <button
              type="button"
              onClick={() => window.open(MAP_VIEWER_URL, "_blank", "noopener,noreferrer")}
              className="rounded-xl border border-white/60 bg-white/90 px-4 py-2.5 text-xs font-semibold text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,0.14)] backdrop-blur-md transition hover:bg-white hover:shadow-[0_12px_36px_rgba(15,23,42,0.18)] active:scale-[0.99]"
            >
              Open map in new tab
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full rounded-none overflow-hidden bg-slate-950/5">
      <div ref={containerRef} className="w-full h-full" style={{ cursor: pickMode ? 'crosshair' : undefined }} />
      {mapLoadError && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-3">
          <div className="pointer-events-auto max-w-[min(95%,42rem)] rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 shadow-[0_12px_40px_rgba(15,23,42,0.12)] backdrop-blur-md ring-1 ring-amber-400/20">
            {mapLoadError}
          </div>
        </div>
      )}
    </div>
  );
}

