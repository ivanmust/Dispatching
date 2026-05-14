import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIncidents, useResponders } from '@/hooks/useIncidents';
import { useQuery } from '@tanstack/react-query';
import { api, incidentDedupeKey } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useQueryClient } from '@tanstack/react-query';
import { IncidentList } from '@/components/IncidentList';
import { IncidentDetailsPanel } from '@/components/IncidentDetailsPanel';
import { DispatcherControlledMapIframe } from '@/components/DispatcherControlledMapIframe';
import { CreateIncidentModal } from '@/components/CreateIncidentModal';
import type { Incident, IncidentCategory } from '@/types/incident';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

const CATEGORY_TO_UNIT: Record<IncidentCategory, string> = {
  CRIME: 'CRIME_POLICE',
  TRAFFIC: 'TRAFFIC_POLICE',
  FIRE: 'EMS',
  MEDICAL: 'EMS',
  HAZMAT: 'EMS',
  OTHER: 'EMS',
};
import { MessageSquare, History, Bell, ArrowLeft, Plus } from 'lucide-react';
import { findNearestResponder } from '@/lib/geo';
import { NavLink } from '@/components/NavLink';
import { toast } from '@/hooks/use-toast';
import { queryRwandaAddress } from '@/lib/rwandaAddress';
// (tooltips no longer used here; labels are inline)

type DispatcherRoutePanel = {
  title: string;
  onBack: () => void;
  content: ReactNode;
};

function encodePolyline(points: Array<{ lat: number; lon: number }>, precision = 5): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLon = 0;
  const encodeSigned = (num: number) => {
    let s = num < 0 ? ~(num << 1) : num << 1;
    while (s >= 0x20) {
      out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    out += String.fromCharCode(s + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    encodeSigned(lat - prevLat);
    encodeSigned(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

export default function DispatcherDashboard({ routePanel }: { routePanel?: DispatcherRoutePanel | null }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [unitFilter, setUnitFilter] = useState<string>('ALL');
  const { data: incidents = [] } = useIncidents();
  const { data: responders = [] } = useResponders();
  const { data: pointsOfInterest = [] } = useQuery({
    queryKey: ['points-of-interest'],
    queryFn: () => api.getPointsOfInterest(),
  });
  const { data: geofences = [] } = useQuery({
    queryKey: ['geofences'],
    queryFn: () => api.getGeofences(),
  });
  const { data: dmContactsForBadge = [] } = useQuery({
    queryKey: ['dm-contacts'],
    queryFn: () => api.listDmContacts(),
    staleTime: 5000,
    refetchInterval: 10000,
  });
  const { onStatusChange, onNewMessage, onResponderLocation, onResponderAvailability, onIncidentAssigned, onIncidentCreated, socket } = useSocket();
  const queryClient = useQueryClient();

  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editIncident, setEditIncident] = useState<Incident | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<{
    lat: number;
    lon: number;
    address?: string;
    province?: string;
    district?: string;
    sector?: string;
    cell?: string;
    village?: string;
  } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [responderLocations, setResponderLocations] = useState<Record<string, { lat: number; lon: number }>>({});
  const [responderAvailability, setResponderAvailability] = useState<Record<string, boolean>>({});
  const [etaByIncidentId, setEtaByIncidentId] = useState<
    Record<
      string,
      {
        eta_seconds: number;
        eta_minutes: number;
        distance_meters: number;
        route?: string | null;
        alt_routes?: string[];
        alt_route_summaries?: Array<{
          index: number;
          label: "faster" | "shorter" | "balanced";
          distanceMeters: number;
          etaSeconds: number;
          etaMinutes: number;
        }> | null;
        /** null = main route; 0..n = alt_routes index (responder-selected). */
        active_route_index?: number | null;
        route_unavailable?: boolean;
        routing_engine?: string;
      }
    >
  >({});
  const [fallbackRouteInfo, setFallbackRouteInfo] = useState<{
    incidentId: string;
    route: string | null;
    eta_seconds: number;
    eta_minutes: number;
    distance_meters: number;
    route_unavailable: boolean;
    routing_engine: 'fallback';
  } | null>(null);
  const [fallbackRouteLoading, setFallbackRouteLoading] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!responders.length) return;
    setResponderAvailability((prev) => {
      const next = { ...prev };
      responders.forEach((responder) => {
        next[responder.id] = responder.status === 'AVAILABLE';
      });
      return next;
    });
  }, [responders]);

  const unreadDmCount = useMemo(
    () => dmContactsForBadge.reduce((sum, c) => sum + Number(c.unreadCount ?? 0), 0),
    [dmContactsForBadge]
  );

  const responderListForMap = useMemo(
    () =>
      Object.entries(responderLocations).map(([id, loc]) => ({
        id,
        lat: loc.lat,
        lon: loc.lon,
        // If availability is unknown, treat as not available to avoid suggesting offline responders.
        available: responderAvailability[id] ?? false,
      })),
    [responderLocations, responderAvailability]
  );

  // Category -> target unit + the set of responder ids whose unit matches the incident.
  const matchingUnitIds = useMemo(() => {
    if (!selectedIncident) return new Set<string>();
    const targetUnit = CATEGORY_TO_UNIT[selectedIncident.category];
    const VALID_UNITS = new Set(['EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE']);
    return new Set(
      responders
        .filter(r => {
          const u = (r.unit ?? '').trim();
          const effectiveUnit = VALID_UNITS.has(u) ? u : 'EMS';
          return effectiveUnit === targetUnit;
        })
        .map(r => r.id)
    );
  }, [selectedIncident?.category, responders]);

  // Synchronous haversine suggestion so the UI has something to render instantly.
  const haversineSuggested = useMemo(() => {
    if (!selectedIncident) return null;
    const respondersForAlgo = Object.entries(responderLocations)
      .filter(([id]) => matchingUnitIds.has(id))
      .map(([id, pos]) => ({
        id,
        position: { lat: pos.lat, lon: pos.lon },
        available: responderAvailability[id] ?? false,
      }));
    if (respondersForAlgo.length === 0) return null;
    return findNearestResponder(
      { lat: selectedIncident.location.lat, lon: selectedIncident.location.lon },
      respondersForAlgo
    );
  }, [
    selectedIncident?.id,
    selectedIncident?.location?.lat,
    selectedIncident?.location?.lon,
    matchingUnitIds,
    responderLocations,
    responderAvailability,
  ]);

  // Road-aware suggestion from the in-country ArcGIS Server closest-facility tool.
  // Overrides the haversine pick once the server responds. Kept per incident so a
  // stale result for a different incident never leaks through.
  const [serverSuggested, setServerSuggested] = useState<{
    incidentId: string;
    responderId: string;
    distanceKm: number;
    travelTimeMinutes: number | null;
    engine: 'arcgis' | 'haversine' | 'none';
  } | null>(null);

  useEffect(() => {
    if (!selectedIncident) {
      setServerSuggested(null);
      return;
    }
    let cancelled = false;
    const targetUnit = CATEGORY_TO_UNIT[selectedIncident.category];
    const validUnits = new Set(['EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE']);
    const unitParam = validUnits.has(targetUnit) ? (targetUnit as 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE') : undefined;

    api
      .getClosestResponders({
        lat: selectedIncident.location.lat,
        lon: selectedIncident.location.lon,
        limit: 5,
        unit: unitParam,
      })
      .then(resp => {
        if (cancelled) return;
        // Prefer the first result that is currently available and has a known unit match.
        const pick =
          resp.results.find(
            r =>
              matchingUnitIds.has(r.responderId) &&
              (responderAvailability[r.responderId] ?? false)
          ) ?? resp.results.find(r => matchingUnitIds.has(r.responderId));
        if (!pick) {
          setServerSuggested(null);
          return;
        }
        setServerSuggested({
          incidentId: selectedIncident.id,
          responderId: pick.responderId,
          distanceKm: pick.distanceKm,
          travelTimeMinutes: pick.travelTimeMinutes,
          engine: resp.engine,
        });
      })
      .catch(() => {
        if (!cancelled) setServerSuggested(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedIncident?.id,
    selectedIncident?.location?.lat,
    selectedIncident?.location?.lon,
    selectedIncident?.category,
    matchingUnitIds,
    responderAvailability,
  ]);

  // Final suggestion consumed by the rest of the UI: road-aware result from the
  // ArcGIS service wins when available, otherwise the instant haversine pick.
  const suggestedResponder = useMemo(() => {
    if (serverSuggested && serverSuggested.incidentId === selectedIncident?.id) {
      return { responderId: serverSuggested.responderId, distanceKm: serverSuggested.distanceKm };
    }
    return haversineSuggested;
  }, [serverSuggested, selectedIncident?.id, haversineSuggested]);

  // Keep selected incident in sync with data
  useEffect(() => {
    if (selectedIncident) {
      const updated = incidents.find(i => i.id === selectedIncident.id);
      if (updated) setSelectedIncident(updated);
    }
  }, [incidents]);

  // Select incident when navigating from Notifications page
  const selectIncidentId = (location.state as { selectIncidentId?: string })?.selectIncidentId;
  useEffect(() => {
    if (selectIncidentId) {
      const inc = incidents.find(i => i.id === selectIncidentId);
      if (inc) {
        setSelectedIncident(inc);
      }
    }
  }, [selectIncidentId, incidents]);

  // Socket event handlers
  useEffect(() => {
    const unsub1 = onStatusChange(() => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-history'] });
    });
    const unsub2 = onNewMessage(msg => {
      queryClient.invalidateQueries({ queryKey: ['chat', msg.incidentId] });
    });
    const unsub3 = onIncidentAssigned(() => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-history'] });
    });
    const unsub4 = onIncidentCreated(() => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-history'] });
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [onStatusChange, onNewMessage, onIncidentAssigned, onIncidentCreated, queryClient]);

  // Realtime ETA updates for responder progress.
  useEffect(() => {
    if (!socket) return;
    const handler = (data: {
      incidentId: string;
      eta_seconds: number;
      eta_minutes: number;
      distance_meters: number;
      route?: string | null;
      alt_routes?: string[];
      alt_route_summaries?: Array<{
        index: number;
        label: "faster" | "shorter" | "balanced";
        distanceMeters: number;
        etaSeconds: number;
        etaMinutes: number;
      }> | null;
      active_route_index?: number | null;
      route_unavailable?: boolean;
      routing_engine?: string;
    }) => {
      if (!data?.incidentId) return;
      setEtaByIncidentId((prev) => ({
        ...prev,
        [data.incidentId]: data,
      }));
    };
    socket.on('incident:etaUpdate', handler);
    return () => {
      socket.off('incident:etaUpdate', handler);
    };
  }, [socket]);

  useEffect(() => {
    const allowed = new Set(["IN_PROGRESS"]);
    setEtaByIncidentId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        const incident = incidents.find((i) => i.id === id);
        if (!incident || !allowed.has(incident.status)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [incidents]);

  // Track responder live locations
  useEffect(() => {
    const unsub = onResponderLocation(({ responderId, lat, lon }) => {
      setResponderLocations(prev => ({
        ...prev,
        [responderId]: { lat, lon },
      }));
    });
    return unsub;
  }, [onResponderLocation]);

  // Track responder availability (online/available)
  useEffect(() => {
    const unsub = onResponderAvailability(({ responderId, available }) => {
      setResponderAvailability(prev => ({
        ...prev,
        [responderId]: available,
      }));
    });
    return unsub;
  }, [onResponderAvailability]);

  const handleSelectIncident = useCallback(
    (inc: Incident) => {
      setSelectedIncident(inc);
      if (isMobile) setMobileDetailsOpen(true);
    },
    [isMobile]
  );

  const selectedIncidentAllowsRoute =
    !!selectedIncident && selectedIncident.status === "IN_PROGRESS";
  const selectedEtaFromSocket =
    selectedIncident && selectedIncidentAllowsRoute ? etaByIncidentId[selectedIncident.id] ?? null : null;
  const selectedEta =
    selectedEtaFromSocket ??
    (selectedIncident &&
    selectedIncidentAllowsRoute &&
    fallbackRouteInfo &&
    fallbackRouteInfo.incidentId === selectedIncident.id
      ? fallbackRouteInfo
      : null);
  const activeRouteIndex = selectedEtaFromSocket?.active_route_index ?? null;
  const selectedIncidentActivePolyline =
    selectedEtaFromSocket &&
    activeRouteIndex != null &&
    activeRouteIndex >= 0 &&
    Array.isArray(selectedEtaFromSocket.alt_routes) &&
    activeRouteIndex < selectedEtaFromSocket.alt_routes.length
      ? selectedEtaFromSocket.alt_routes[activeRouteIndex] ?? selectedEtaFromSocket.route ?? null
      : selectedEta?.route ?? null;
  const selectedIncidentRouteUnavailable = !!selectedEta?.route_unavailable;
  const selectedIncidentHasRoadRoute =
    !!selectedEta &&
    !selectedIncidentRouteUnavailable &&
    selectedEta.routing_engine !== "fallback" &&
    typeof selectedIncidentActivePolyline === "string" &&
    selectedIncidentActivePolyline.length > 0;
  const selectedResponderPosition = useMemo(() => {
    if (!selectedIncident?.assignedResponderId) return null;
    return responderLocations[selectedIncident.assignedResponderId] ?? null;
  }, [selectedIncident?.assignedResponderId, responderLocations]);
  const routeStatsLabel = useMemo(() => {
    if (!selectedIncident) return null;
    if (fallbackRouteLoading && !selectedEta) return 'Computing route...';
    if (!selectedEta) return 'Waiting for route...';
    if (selectedIncidentRouteUnavailable || !selectedEta.distance_meters) return 'Route unavailable';
    const eta = Math.max(1, Math.round(selectedEta.eta_minutes ?? 0));
    const meters = Math.max(0, Number(selectedEta.distance_meters ?? 0));
    const dist = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
    return `ETA ${eta} min · ${dist}`;
  }, [selectedIncident?.id, selectedEta?.eta_minutes, selectedEta?.distance_meters, selectedIncidentRouteUnavailable, fallbackRouteLoading]);
  const routeSourceLabel = useMemo(() => {
    if (!selectedIncident) return null;
    if (selectedIncidentHasRoadRoute) return 'Live route';
    if (fallbackRouteInfo?.route && !fallbackRouteInfo.route_unavailable) return 'Estimated fallback route';
    if (fallbackRouteLoading) return 'Computing fallback route...';
    if (selectedIncidentRouteUnavailable) return 'Route unavailable';
    return null;
  }, [selectedIncident?.id, selectedIncidentHasRoadRoute, fallbackRouteInfo?.route, fallbackRouteInfo?.route_unavailable, fallbackRouteLoading, selectedIncidentRouteUnavailable]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedIncident) {
      setFallbackRouteInfo(null);
      setFallbackRouteLoading(false);
      return;
    }
    if (selectedIncidentHasRoadRoute) {
      setFallbackRouteInfo(null);
      setFallbackRouteLoading(false);
      return;
    }
    if (!selectedResponderPosition) {
      setFallbackRouteInfo(null);
      setFallbackRouteLoading(false);
      return;
    }
    const run = () => {
      setFallbackRouteLoading(true);
      void api
        .getNavigationRoute(
          { lat: selectedResponderPosition.lat, lon: selectedResponderPosition.lon },
          { lat: selectedIncident.location.lat, lon: selectedIncident.location.lon },
        )
        .then((route) => {
          if (cancelled) return;
          if (!Array.isArray(route.path) || route.path.length < 2) {
            setFallbackRouteInfo({
              incidentId: selectedIncident.id,
              route: null,
              eta_seconds: 0,
              eta_minutes: 0,
              distance_meters: 0,
              route_unavailable: true,
              routing_engine: 'fallback',
            });
            return;
          }
          const etaMin = Math.max(1, Math.round(route.etaMinutes));
          const distM = Math.max(0, Math.round(route.distanceMeters));
          setFallbackRouteInfo({
            incidentId: selectedIncident.id,
            route: encodePolyline(route.path),
            eta_seconds: Math.max(1, Math.round(etaMin * 60)),
            eta_minutes: etaMin,
            distance_meters: distM,
            route_unavailable: false,
            routing_engine: 'fallback',
          });
        })
        .catch(() => {
          if (!cancelled) {
            setFallbackRouteInfo({
              incidentId: selectedIncident.id,
              route: null,
              eta_seconds: 0,
              eta_minutes: 0,
              distance_meters: 0,
              route_unavailable: true,
              routing_engine: 'fallback',
            });
          }
        })
        .finally(() => {
          if (!cancelled) setFallbackRouteLoading(false);
        });
    };

    run();
    const intervalId = window.setInterval(run, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    selectedIncident?.id,
    selectedIncident?.location?.lat,
    selectedIncident?.location?.lon,
    selectedResponderPosition?.lat,
    selectedResponderPosition?.lon,
    selectedIncidentHasRoadRoute,
  ]);
  const handleMapClick = useCallback(async (lat: number, lon: number) => {
    if (!pickMode) return;

    // Local reverse geocode from backend (PostgreSQL OSM data).
    let rwanda: {
      province?: string;
      district?: string;
      sector?: string;
      cell?: string;
      village?: string;
      addressLine?: string;
    } = {};
    try {
      rwanda = await queryRwandaAddress(lat, lon);
    } catch {
      // Non-blocking; form can still be filled manually
    }

    const adminAddress = [rwanda.village, rwanda.cell, rwanda.sector, rwanda.district, rwanda.province]
      .filter(Boolean)
      .join(', ');
    let address: string | undefined = rwanda.addressLine;
    // Prefer a combined label so "Address" includes both nearby road context and admin hierarchy.
    if (address && adminAddress) {
      address = `${address} — ${adminAddress}`;
    } else if (!address && adminAddress) {
      address = adminAddress;
    }
    if (!address) {
      // Always provide a human-readable fallback so "Pull Address" is never just coordinates.
      address = 'Selected map point, Rwanda';
      toast({
        title: 'Using fallback address',
        description: 'A nearby road name was not found, so a generic location label was used.',
      });
    }

    setPickedLocation({
      lat,
      lon,
      address,
      province: rwanda.province,
      district: rwanda.district,
      sector: rwanda.sector,
      cell: rwanda.cell,
      village: rwanda.village,
    });
    setPickMode(false);
  }, [pickMode]);

  const handleEnableLiveLocation = useCallback(() => {
    if (!navigator.geolocation) {
      // Graceful no-op if geolocation is not available
      return;
    }
    if (watchIdRef.current != null) {
      // Already watching
      return;
    }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setUserLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      err => {
        console.error('Geolocation error', err);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    watchIdRef.current = id;
  }, []);

  const handleCreateClick = useCallback(() => {
    setCreateModalOpen(true);
    setEditIncident(null);
    setPickedLocation(null);
  }, []);

  const handleEditClick = useCallback((inc: Incident) => {
    setEditIncident(inc);
    setPickedLocation(null);
    setCreateModalOpen(true);
  }, []);

  const handleIncidentSaved = useCallback((inc: Incident) => {
    // After saving, automatically open the incident "page" (right panel) for assignment/next actions.
    setSelectedIncident(inc);
  }, []);

  const handleEnablePickMode = useCallback(() => {
    setCreateModalOpen(false);
    setPickMode(true);
  }, []);

  // Re-open modal after picking location
  useEffect(() => {
    if (pickedLocation && !pickMode) {
      setCreateModalOpen(true);
    }
  }, [pickedLocation, pickMode]);

  // Clean up live location watcher on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  if (!isAuthenticated) return null;
  const isOverviewPanel = routePanel?.title === "OVERVIEW";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Main 3-panel layout */}
        <div className="flex-1 flex overflow-hidden">
              {/* Left icon rail (GINA-style) */}
              <aside className="hidden md:flex w-14 shrink-0 bg-primary text-primary-foreground flex-col items-center py-3 gap-2">
                <NavLink
                  to="/dispatcher/chats"
                  className="relative w-full rounded-lg hover:bg-white/10 transition-colors flex flex-col items-center justify-center px-1 py-2 text-[10px]"
                >
                  <MessageSquare className="h-5 w-5 mb-0.5" />
                  <span className="leading-tight">Chats</span>
                  {unreadDmCount > 0 ? (
                    <span className="absolute right-1 top-1 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1">
                      {unreadDmCount > 99 ? '99+' : unreadDmCount}
                    </span>
                  ) : null}
                </NavLink>
                <NavLink
                  to="/dispatcher/notifications"
                  className="w-full rounded-lg hover:bg-white/10 transition-colors flex flex-col items-center justify-center px-1 py-2 text-[10px]"
                >
                  <Bell className="h-5 w-5 mb-0.5" />
                  <span className="leading-tight">Alerts</span>
                </NavLink>
                <NavLink
                  to="/dispatcher/history"
                  className="w-full rounded-lg hover:bg-white/10 transition-colors flex flex-col items-center justify-center px-1 py-2 text-[10px]"
                >
                  <History className="h-5 w-5 mb-0.5" />
                  <span className="leading-tight text-center">History</span>
                </NavLink>
                <button
                  type="button"
                  className="w-full rounded-lg hover:bg-white/10 transition-colors flex flex-col items-center justify-center px-1 py-2 text-[10px]"
                  onClick={handleCreateClick}
                >
                  <Plus className="h-5 w-5 mb-0.5" />
                  <span className="leading-tight text-center">Create</span>
                </button>
                <div className="mt-auto flex flex-col items-center gap-2 pb-1">
                  <div className="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-xs font-semibold">
                    {user?.name?.slice(0, 1)?.toUpperCase() ?? 'U'}
                  </div>
                </div>
              </aside>

              {/* Left sidebar (desktop/tablet) */}
              <aside
                className={`hidden lg:flex shrink-0 border-r overflow-hidden flex-col bg-card ${
                  isOverviewPanel ? "flex-1 w-auto" : "w-[28rem]"
                }`}
              >
                {routePanel ? (
                  <>
                    <div className="h-12 border-b px-3 flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="h-8 px-2 inline-flex items-center rounded-md hover:bg-muted text-sm"
                        onClick={routePanel.onBack}
                      >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back
                      </button>
                      <div className="text-xs text-muted-foreground truncate">{routePanel.title}</div>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      {routePanel.content}
                    </div>
                  </>
                ) : selectedIncident ? (
                  <IncidentDetailsPanel
                    incident={selectedIncident}
                    onClose={() => setSelectedIncident(null)}
                    suggestedResponderId={suggestedResponder?.responderId ?? null}
                    suggestedResponderDistanceKm={suggestedResponder?.distanceKm ?? null}
                    responderLocations={responderLocations}
                    responderAvailability={responderAvailability}
                    etaUpdate={selectedEta}
                    readOnly={false}
                    onEditRequest={handleEditClick}
                  />
                ) : (
                  <IncidentList
                    selectedId={selectedIncident?.id ?? null}
                    onSelect={handleSelectIncident}
                    onCreateClick={handleCreateClick}
                    showCreateButton={false}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    unitFilter={unitFilter}
                    onUnitFilterChange={setUnitFilter}
                  />
                )}
              </aside>

              {/* Center map */}
              {isOverviewPanel ? (
                <div className="flex-1 lg:hidden bg-card overflow-auto">
                  {routePanel?.content}
                </div>
              ) : (
                <div className="flex-1 relative bg-muted/20">
                {/* Mobile controls */}
                <div className="lg:hidden absolute top-3 left-3 z-20 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 px-3 rounded-full shadow"
                    onClick={() => setMobileListOpen(true)}
                  >
                    Incidents
                  </Button>
                  {selectedIncident ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-9 px-3 rounded-full shadow"
                      onClick={() => setMobileDetailsOpen(true)}
                    >
                      Details
                    </Button>
                  ) : null}
                </div>
                {pickMode && (
                  <div className="absolute top-3 left-1/2 z-10 flex max-w-[min(96%,28rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/25 bg-primary/95 px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_12px_40px_rgba(15,23,42,0.22)] backdrop-blur-md ring-2 ring-primary-foreground/15">
                    Click the map to set location — 
                    <button type="button" className="ml-0.5 underline underline-offset-2 transition hover:text-primary-foreground/90" onClick={() => { setPickMode(false); setCreateModalOpen(true); }}>Cancel</button>
                  </div>
                )}
                {selectedIncident && selectedIncidentRouteUnavailable ? (
                  <div className="absolute top-3 right-3 z-10 max-w-[min(92vw,20rem)] rounded-xl border border-amber-200/90 bg-amber-50/95 px-3.5 py-2 text-xs font-semibold text-amber-950 shadow-[0_10px_30px_rgba(15,23,42,0.1)] backdrop-blur-md ring-1 ring-amber-400/25">
                    ETA available, route unavailable right now.
                  </div>
                ) : null}
                {selectedIncident ? (
                  <div className="absolute top-[3.25rem] right-3 z-10 flex flex-col items-end gap-1.5">
                    {routeStatsLabel ? (
                      <div className="rounded-xl border border-slate-200/90 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.1)] backdrop-blur-sm">
                        {routeStatsLabel}
                      </div>
                    ) : null}
                    {routeSourceLabel ? (
                      <div className="rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-[0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                        {routeSourceLabel}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <DispatcherControlledMapIframe
                  incidents={incidents}
                  selectedIncidentId={selectedIncident?.id ?? null}
                  onSelectIncident={(id) => {
                    const key = incidentDedupeKey(id);
                    const inc = incidents.find((i) => incidentDedupeKey(i.id) === key);
                    if (inc) handleSelectIncident(inc);
                  }}
                  pickMode={pickMode}
                  onMapClick={handleMapClick}
                  userLocation={userLocation}
                  responders={responderListForMap}
                  suggestedResponderId={suggestedResponder?.responderId ?? null}
                  pointsOfInterest={pointsOfInterest}
                  geofences={geofences}
                  etaRoutePolyline={selectedIncidentHasRoadRoute ? selectedIncidentActivePolyline : fallbackRouteInfo?.route ?? null}
                  etaAltRoutePolylines={null}
                />
                </div>
              )}

              {/* Right panel removed: incident details now open in left panel */}
        </div>

        {/* Mobile incident list sheet */}
        <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
          <SheetContent side="left" className="p-0 w-[92vw] sm:w-[28rem]">
            <div className="p-4 border-b">
              <SheetHeader>
                <SheetTitle>Incidents</SheetTitle>
              </SheetHeader>
            </div>
            <div className="h-[calc(100vh-64px)]">
              {routePanel ? (
                <div className="h-full flex flex-col">
                  <div className="h-12 border-b px-3 flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="h-8 px-2 inline-flex items-center rounded-md hover:bg-muted text-sm"
                      onClick={() => {
                        routePanel.onBack();
                        setMobileListOpen(false);
                      }}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back
                    </button>
                    <div className="text-xs text-muted-foreground truncate">{routePanel.title}</div>
                  </div>
                  <div className="flex-1 overflow-hidden">{routePanel.content}</div>
                </div>
              ) : (
                <IncidentList
                  selectedId={selectedIncident?.id ?? null}
                  onSelect={(inc) => {
                    handleSelectIncident(inc);
                    setMobileListOpen(false);
                  }}
                  onCreateClick={() => {
                    setMobileListOpen(false);
                    handleCreateClick();
                  }}
                  showCreateButton={true}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  unitFilter={unitFilter}
                  onUnitFilterChange={setUnitFilter}
                />
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Mobile incident details sheet */}
        <Sheet
          open={mobileDetailsOpen && !!selectedIncident}
          onOpenChange={(open) => {
            setMobileDetailsOpen(open);
            if (!open) setSelectedIncident((prev) => prev);
          }}
        >
          <SheetContent side="right" className="p-0 w-[92vw] sm:w-[30rem]">
            {selectedIncident ? (
              <IncidentDetailsPanel
                incident={selectedIncident}
                onClose={() => {
                  setMobileDetailsOpen(false);
                  setSelectedIncident(null);
                }}
                suggestedResponderId={suggestedResponder?.responderId ?? null}
                suggestedResponderDistanceKm={suggestedResponder?.distanceKm ?? null}
                responderLocations={responderLocations}
                responderAvailability={responderAvailability}
                etaUpdate={selectedEta}
                readOnly={false}
                onEditRequest={handleEditClick}
              />
            ) : null}
          </SheetContent>
        </Sheet>

        <CreateIncidentModal
          open={createModalOpen}
          onOpenChange={(open) => {
            setCreateModalOpen(open);
            if (!open) setEditIncident(null);
          }}
          onEnablePickMode={handleEnablePickMode}
          pickedLocation={pickedLocation}
          incidentToEdit={editIncident}
          onSaved={handleIncidentSaved}
        />
      </main>
    </div>
  );
}
