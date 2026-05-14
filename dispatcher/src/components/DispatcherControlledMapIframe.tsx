import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildControlledMapHtml, type ControlledMapLayerEnv } from '@/map/controlledMapHtml';
import type { Incident } from '@/types/incident';
import {
  incidentCategoryDisplayLabel,
  incidentPriorityDisplayLabel,
  incidentStatusDisplayLabel,
} from '@/types/incident';
import type { PointOfInterest } from '@/lib/pointsOfInterest';
import { incidentDedupeKey } from '@/lib/api';

const MAP_VIEWER_URL =
  import.meta.env.VITE_ESRI_MAP_VIEWER_URL ??
  'https://esrirw.rw/portal/apps/mapviewer/index.html?webmap=3e190cfba7fd4d1f8c9600cc072a6d15';

const NAVIGATION_MINIMAL =
  String(import.meta.env.VITE_ESRI_MAP_NAVIGATION_MINIMAL ?? 'true').toLowerCase() !== 'false';

const LAYER_ENV: ControlledMapLayerEnv = {
  poiItemId:
    (import.meta.env.VITE_ESRI_POI_ITEM_ID as string | undefined)?.trim() ||
    undefined,
  villageBoundaryItemId:
    (import.meta.env.VITE_ESRI_VILLAGE_BOUNDARY_ITEM_ID as string | undefined)?.trim() || undefined,
  rwAdminBoundaryUrl:
    (import.meta.env.VITE_ESRI_RW_ADMIN_BOUNDARY_URL as string | undefined)?.trim() || undefined,
  busLinesUrl: (import.meta.env.VITE_ESRI_KIGALI_BUS_LINES_URL as string | undefined)?.trim() || undefined,
  busStopsUrl: (import.meta.env.VITE_ESRI_KIGALI_BUS_STOPS_URL as string | undefined)?.trim() || undefined,
  roadNetworkItemId: (import.meta.env.VITE_ESRI_ROAD_NETWORK_ITEM_ID as string | undefined)?.trim() || undefined,
  roadNetworkLayerId: (import.meta.env.VITE_ESRI_ROAD_NETWORK_LAYER_ID as string | undefined)?.trim() || undefined,
  portalOAuthAppId: (import.meta.env.VITE_ARCGIS_PORTAL_APP_ID as string | undefined)?.trim() || undefined,
};

interface DispatcherControlledMapIframeProps {
  incidents: Incident[];
  selectedIncidentId: string | null;
  onSelectIncident: (id: string) => void;
  pickMode?: boolean;
  onMapClick?: (lat: number, lon: number) => void;
  userLocation?: { lat: number; lon: number } | null;
  responders?: { id: string; lat: number; lon: number; available?: boolean; name?: string }[];
  suggestedResponderId?: string | null;
  pointsOfInterest?: PointOfInterest[];
  geofences?: Array<{ id: string; name: string; geometry: Record<string, unknown> }>;
  etaRoutePolyline?: string | null;
  etaAltRoutePolylines?: string[] | null;
}

function decodePolylineGoogle(polyline: string, precision = 5): Array<{ lat: number; lon: number }> {
  const factor = 10 ** precision;
  const points: Array<{ lat: number; lon: number }> = [];
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
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    result = 0;
    shift = 0;
    do {
      b = polyline.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < polyline.length);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push({ lat: lat / factor, lon: lng / factor });
  }
  return points;
}

function incidentsToPins(incidents: Incident[]) {
  return incidents
    .map((i) => {
      const loc = i.location as { lat?: number; lon?: number; lng?: number } | undefined;
      const lat = loc?.lat;
      const lon = loc?.lon ?? loc?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const key = incidentDedupeKey(i.id);
      if (!key) return null;
      return {
        id: key,
        lat: lat as number,
        lon: lon as number,
        status: i.status,
        priority: incidentPriorityDisplayLabel(i.priority),
        category: incidentCategoryDisplayLabel(i.category),
        title: i.title,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);
}

type MapHostCmd =
  | 'incidentPins'
  | 'selectedIncident'
  | 'responders'
  | 'pointsOfInterest'
  | 'geofences'
  | 'routePath'
  | 'routeStepPath'
  | 'maneuvers'
  | 'liveLocation'
  | 'zoomDelta';

export function DispatcherControlledMapIframe({
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
  etaAltRoutePolylines: _etaAltRoutePolylines,
}: DispatcherControlledMapIframeProps) {
  void _etaAltRoutePolylines;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mapStatus, setMapStatus] = useState('Loading map…');
  const [mapError, setMapError] = useState<string | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapHtml = useMemo(
    () =>
      buildControlledMapHtml(
        MAP_VIEWER_URL,
        {
          pickMode: !!pickMode,
          navigationMinimal: NAVIGATION_MINIMAL,
          embedMapControls: true,
          floatingZoomControls: true,
        },
        {
          pageBg: '#f8fafc',
          widgetBg: '#ffffff',
          widgetBorder: '#cbd5e1',
        },
        LAYER_ENV,
      ),
    [pickMode],
  );

  /** `blob:` document URL avoids `about:srcdoc`, which breaks ArcGIS portal REST URL resolution. */
  const mapFrameSrc = useMemo(() => {
    const blob = new Blob([mapHtml], { type: 'text/html;charset=UTF-8' });
    return URL.createObjectURL(blob);
  }, [mapHtml]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(mapFrameSrc);
    };
  }, [mapFrameSrc]);

  const pins = useMemo(() => incidentsToPins(incidents), [incidents]);

  const poiPayload = useMemo(
    () =>
      (pointsOfInterest ?? []).map((p) => ({
        id: p.id,
        type: p.type,
        lat: p.lat,
        lon: p.lon,
        label: p.label ?? null,
      })),
    [pointsOfInterest],
  );

  const routePath = useMemo(() => {
    if (!etaRoutePolyline) return [] as Array<{ lat: number; lon: number }>;
    try {
      return decodePolylineGoogle(etaRoutePolyline);
    } catch {
      return [];
    }
  }, [etaRoutePolyline]);

  const postToMap = useCallback((cmd: MapHostCmd, payload: unknown) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    try {
      w.postMessage({ __dispatchMapFromHost: true, cmd, payload }, '*');
    } catch {
      /* ignore */
    }
  }, []);

  /** Latest map payloads for flush after `map-ready` (blob iframe must not rely on `eval`). */
  const mapDataRef = useRef({
    pins,
    selectedKey: selectedIncidentId ? incidentDedupeKey(selectedIncidentId) : null,
    responders,
    suggestedResponderId,
    poiPayload,
    geofences,
    routePath,
    routeStepPath: [] as Array<{ lat: number; lon: number }>,
    maneuvers: [] as unknown[],
    currentManeuverIndex: 0,
    userLocation: null as { lat: number; lon: number } | null,
  });

  mapDataRef.current = {
    pins,
    selectedKey: selectedIncidentId ? incidentDedupeKey(selectedIncidentId) : null,
    responders,
    suggestedResponderId,
    poiPayload,
    geofences,
    routePath,
    routeStepPath: [],
    maneuvers: [],
    currentManeuverIndex: 0,
    userLocation: userLocation ?? null,
  };

  const flushMapData = useCallback(() => {
    const d = mapDataRef.current;
    postToMap('incidentPins', { pins: d.pins });
    postToMap('selectedIncident', { id: d.selectedKey });
    postToMap('responders', { responders: d.responders, suggestedResponderId: d.suggestedResponderId ?? null });
    postToMap('pointsOfInterest', { pois: d.poiPayload ?? [] });
    postToMap('geofences', { geofences: d.geofences ?? [] });
    postToMap('routePath', { path: d.routePath ?? [] });
    postToMap('routeStepPath', { path: d.routeStepPath ?? [] });
    postToMap('maneuvers', { maneuvers: d.maneuvers ?? [], currentIndex: d.currentManeuverIndex ?? 0 });
    if (d.userLocation && Number.isFinite(d.userLocation.lat) && Number.isFinite(d.userLocation.lon)) {
      postToMap('liveLocation', { lat: d.userLocation.lat, lon: d.userLocation.lon });
    }
  }, [postToMap]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== 'object' || (d as { __dispatchMap?: boolean }).__dispatchMap !== true) return;
      const msg = String((d as { msg?: string }).msg ?? '');
      if (msg === 'map-ready') {
        if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
        setMapStatus('Map ready');
        setMapError(null);
        flushMapData();
        return;
      }
      if (msg.startsWith('map-error:')) {
        if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
        setMapError(`Map failed to load: ${msg.slice('map-error:'.length) || 'unknown error'}`);
        return;
      }
      if (msg === 'map-loading') {
        setMapStatus('Loading map layers…');
        return;
      }
      if (msg.startsWith('pick:')) {
        const rest = msg.slice(5);
        const [lonStr, latStr] = rest.split(',');
        const lon = parseFloat(lonStr);
        const lat = parseFloat(latStr);
        if (Number.isFinite(lat) && Number.isFinite(lon)) onMapClick?.(lat, lon);
        return;
      }
      if (msg.startsWith('incidentTap:')) {
        const id = decodeURIComponent(msg.slice('incidentTap:'.length).trim());
        if (id) onSelectIncident(id);
        return;
      }
      void msg;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onMapClick, onSelectIncident, flushMapData]);

  useEffect(() => {
    postToMap('incidentPins', { pins });
  }, [postToMap, pins]);

  useEffect(() => {
    postToMap('selectedIncident', { id: selectedIncidentId ? incidentDedupeKey(selectedIncidentId) : null });
  }, [postToMap, selectedIncidentId]);

  useEffect(() => {
    postToMap('responders', {
      responders: responders ?? [],
      suggestedResponderId: suggestedResponderId ?? null,
    });
  }, [postToMap, responders, suggestedResponderId]);

  useEffect(() => {
    postToMap('pointsOfInterest', { pois: poiPayload ?? [] });
  }, [postToMap, poiPayload]);

  useEffect(() => {
    postToMap('geofences', { geofences: geofences ?? [] });
  }, [postToMap, geofences]);

  useEffect(() => {
    postToMap('routePath', { path: routePath ?? [] });
  }, [postToMap, routePath]);

  useEffect(() => {
    if (!userLocation) return;
    mapDataRef.current.userLocation = userLocation;
    postToMap('liveLocation', { lat: userLocation.lat, lon: userLocation.lon });
  }, [postToMap, userLocation?.lat, userLocation?.lon]);

  const injectZoomDelta = useCallback(
    (delta: number) => {
      postToMap('zoomDelta', { delta });
    },
    [postToMap],
  );

  const onIframeLoad = useCallback(() => {
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    loadingTimeoutRef.current = setTimeout(() => {
      setMapStatus('Map loaded (layers may still be loading)');
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    };
  }, []);

  return (
    <div className="relative h-full w-full min-h-[200px] bg-slate-50">
      <iframe
        key={pickMode ? 'map-pick' : 'map-main'}
        title="Operations map"
        ref={iframeRef}
        src={mapFrameSrc}
        className="h-full w-full border-0"
        referrerPolicy="no-referrer-when-downgrade"
        onLoad={onIframeLoad}
      />
      <div className="pointer-events-none absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
        <button
          type="button"
          className="pointer-events-auto h-11 w-11 text-lg font-normal text-slate-800 hover:bg-slate-50"
          aria-label="Zoom in"
          onClick={() => injectZoomDelta(1)}
        >
          +
        </button>
        <div className="h-px bg-slate-200" />
        <button
          type="button"
          className="pointer-events-auto h-11 w-11 text-lg font-normal text-slate-800 hover:bg-slate-50"
          aria-label="Zoom out"
          onClick={() => injectZoomDelta(-1)}
        >
          −
        </button>
      </div>
      {mapError ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-md rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 shadow">
          {mapError}
        </div>
      ) : mapStatus !== 'Map ready' ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow backdrop-blur-sm">
          {mapStatus}
        </div>
      ) : null}
    </div>
  );
}
