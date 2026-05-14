/** ArcGIS JSAPI MapView HTML shared by responder mobile (WebView) and dispatcher web (iframe). */

export type ControlledMapLayerEnv = {
  poiItemId?: string;
  villageBoundaryItemId?: string;
  rwAdminBoundaryUrl?: string;
  busLinesUrl?: string;
  busStopsUrl?: string;
  roadNetworkItemId?: string;
  roadNetworkLayerId?: string;
  /** ArcGIS Portal OAuth app id — register redirect URI to your app; reduces repeat sign-in prompts. */
  portalOAuthAppId?: string;
};

export function parseWebMapId(url: string): string {
  try {
    const u = new URL(url);
    const fromQuery = u.searchParams.get("webmap");
    if (fromQuery) return fromQuery;
  } catch {
    // ignore
  }
  const match = url.match(/webmap=([a-fA-F0-9]{32})/);
  if (match?.[1]) return match[1];
  return "3e190cfba7fd4d1f8c9600cc072a6d15";
}

function parsePortalWebMapConfig(mapViewerUrl: string): { webMapId: string; portalUrl: string } {
  const webMapId = parseWebMapId(mapViewerUrl);
  let portalUrl = "https://www.arcgis.com";
  try {
    const u = new URL(mapViewerUrl);
    const idx = u.pathname.indexOf("/portal");
    if (idx >= 0) {
      portalUrl = `${u.origin}${u.pathname.slice(0, idx + "/portal".length)}`;
    }
  } catch {
    // keep ArcGIS Online default
  }
  return { webMapId, portalUrl };
}

function portalHostIsArcgisOnline(portalUrl: string): boolean {
  try {
    const h = new URL(portalUrl).hostname.toLowerCase();
    return h === "www.arcgis.com" || h === "arcgis.com" || h.endsWith(".arcgis.com");
  } catch {
    return false;
  }
}

export function buildControlledMapHtml(
  mapViewerUrl: string,
  options: {
    pickMode?: boolean;
    navigationMinimal?: boolean;
    embedMapControls?: boolean;
    floatingZoomControls?: boolean;
  } = {},
  chrome: { pageBg: string; widgetBg: string; widgetBorder: string } = {
    pageBg: "#ffffff",
    widgetBg: "#ffffff",
    widgetBorder: "#cbd5e1",
  },
  layerEnv?: ControlledMapLayerEnv,
): string {
  const { webMapId, portalUrl } = parsePortalWebMapConfig(mapViewerUrl);
  /** `about:srcdoc` iframes have no real document URL; ArcGIS needs a stable base + portal for REST URLs. */
  let mapDocumentBaseHref = "https://esrirw.rw/";
  try {
    mapDocumentBaseHref = `${new URL(mapViewerUrl).origin}/`;
  } catch {
    /* keep fallback */
  }
  const mapDocumentBaseHrefJson = JSON.stringify(mapDocumentBaseHref);
  const webMapIdJson = JSON.stringify(webMapId);
  const portalUrlJson = JSON.stringify(portalUrl);
  const pickModeLiteral = options.pickMode ? "true" : "false";
  const navigationMinimal = options.navigationMinimal !== false;
  const embedMapControls = options.embedMapControls !== false;
  const embedMapControlsLiteral = embedMapControls ? "true" : "false";
  const floatingZoomControlsLiteral = options.floatingZoomControls !== false ? "true" : "false";
  const poiItemIdJson = JSON.stringify(
    layerEnv?.poiItemId ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_POI_ITEM_ID) ??
      "2bdce68231634e0598c206a4447e5b61"
  );
  const villageBoundaryItemIdJson = JSON.stringify(
    layerEnv?.villageBoundaryItemId ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_VILLAGE_BOUNDARY_ITEM_ID) ??
      "6358416b7aa64469ad5a3d3c421d80a9"
  );
  const rwAdminBoundaryUrlJson = JSON.stringify(
    layerEnv?.rwAdminBoundaryUrl ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_RW_ADMIN_BOUNDARY_URL) ??
      "https://esrirw.rw/server/rest/services/Hosted/Rwanda_Administrative_Boundaries1/FeatureServer/5"
  );
  // Kigali bus network on esrirw.rw GIS Server: sublayer 0 = bus line polylines, 1 = bus stop points.
  const busLinesUrlJson = JSON.stringify(
    layerEnv?.busLinesUrl ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_BUS_LINES_URL) ??
      "https://esrirw.rw/server/rest/services/Hosted/Kigali_Bus_Lines_and_Stops_Network/FeatureServer/0"
  );
  const busStopsUrlJson = JSON.stringify(
    layerEnv?.busStopsUrl ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_BUS_STOPS_URL) ??
      "https://esrirw.rw/server/rest/services/Hosted/Kigali_Bus_Lines_and_Stops_Network/FeatureServer/1"
  );
  // Optional road-network portal item (Feature Layer) to render the authoritative
  // in-country road graph directly on top of the basemap.
  const roadNetworkItemIdJson = JSON.stringify(
    layerEnv?.roadNetworkItemId ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_ROAD_NETWORK_ITEM_ID) ??
      "a4e0e43871a2458f8b7c3c3c8815ec22"
  );
  const roadNetworkLayerIdLiteral = String(
    layerEnv?.roadNetworkLayerId ??
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_ROAD_NETWORK_LAYER_ID) ??
      "0"
  );
  const portalOAuthAppIdJson = JSON.stringify(
    layerEnv?.portalOAuthAppId?.trim() ||
      (typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ARCGIS_PORTAL_APP_ID?.trim()) ||
      "",
  );

  const arcgisOnlinePortal = portalHostIsArcgisOnline(portalUrl);
  const explicitRoadPortalItem =
    !!(layerEnv?.roadNetworkItemId && String(layerEnv.roadNetworkItemId).trim()) ||
    !!(typeof process !== "undefined" && String(process.env?.EXPO_PUBLIC_ESRI_ROAD_NETWORK_ITEM_ID ?? "").trim());
  const explicitPoiPortalItem =
    !!(layerEnv?.poiItemId && String(layerEnv.poiItemId).trim()) ||
    !!(typeof process !== "undefined" && String(process.env?.EXPO_PUBLIC_ESRI_POI_ITEM_ID ?? "").trim());
  const explicitVillagePortalItem =
    !!(layerEnv?.villageBoundaryItemId && String(layerEnv.villageBoundaryItemId).trim()) ||
    !!(typeof process !== "undefined" && String(process.env?.EXPO_PUBLIC_ESRI_VILLAGE_BOUNDARY_ITEM_ID ?? "").trim());
  /** Default portal item IDs are ArcGIS-Online-era; on enterprise portals they 404 and spam the console. */
  const includeRoadPortalOverlayLiteral = (arcgisOnlinePortal || explicitRoadPortalItem) ? "true" : "false";
  const includePoiPortalOverlayLiteral = (arcgisOnlinePortal || explicitPoiPortalItem) ? "true" : "false";
  const includeVillagePortalOverlayLiteral = (arcgisOnlinePortal || explicitVillagePortalItem) ? "true" : "false";

  const pickCursorStyle = options.pickMode
    ? "html, body, #viewDiv, #viewDiv * { cursor: crosshair !important; }"
    : "";
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <base href=${mapDocumentBaseHrefJson} />
    <title>Responder Map</title>
    <link rel="stylesheet" href="https://js.arcgis.com/4.34/esri/themes/light/main.css" />
    <style>
      html, body, #viewDiv { padding: 0; margin: 0; height: 100%; width: 100%; overflow: hidden; background: ${chrome.pageBg}; }
      ${pickCursorStyle}
      .esri-ui-top-right {
        padding-top: max(10px, env(safe-area-inset-top, 0px));
        padding-right: max(10px, env(safe-area-inset-right, 0px));
      }
      .esri-ui-corner-container .esri-widget { margin-bottom: 6px; }

      /* Search widget "filled" styling (matches the look prior to the positioning changes). */
      .esri-search {
        width: 280px;
        max-width: calc(100vw - 24px);
      }
      .esri-search__input {
        background-color: ${chrome.widgetBg} !important;
        border: 1px solid ${chrome.widgetBorder} !important;
        border-radius: 12px !important;
        height: 40px !important;
        padding: 0 12px !important;
        box-shadow: none !important;
      }

      /* Keep the expanded Search panel visible above bottom overlays (navigation card). */
      .esri-expand__content,
      .esri-widget--expand .esri-expand__content,
      .esri-widget--expand .esri-expand__container,
      .esri-expand .esri-expand__content {
        left: 0 !important;
        right: auto !important;
        bottom: 56px !important; /* open upward relative to the icon */
        top: auto !important;
        z-index: 9999 !important;
        max-width: calc(100vw - 24px) !important;
      }
    </style>
    <script>
      (function () {
        function __dispatchMapConsoleJoin(args) {
          var s = "";
          for (var i = 0; i < args.length; i++) {
            try {
              s += args[i] != null ? String(args[i]) : "";
            } catch (eJ) {}
            s += " ";
          }
          return s;
        }
        function __dispatchMapConsoleSuppressLogWarn(args) {
          var s = __dispatchMapConsoleJoin(args);
          if (s.indexOf("Using ArcGIS Maps SDK for JavaScript") >= 0) return true;
          if (s.indexOf("Using Calcite Components") >= 0) return true;
          if (s.indexOf("DEPRECATED") >= 0 && (s.indexOf("[esri.") >= 0 || s.indexOf("esri.") >= 0)) return true;
          return false;
        }
        function __dispatchMapConsoleSuppressError(args) {
          var s = __dispatchMapConsoleJoin(args);
          if (s.indexOf("[esri.layers.FeatureLayer]") >= 0 && s.indexOf("Failed to load layer") >= 0) return true;
          return false;
        }
        var _w = console.warn;
        console.warn = function () {
          if (__dispatchMapConsoleSuppressLogWarn(arguments)) return;
          return _w.apply(console, arguments);
        };
        var _l = console.log;
        console.log = function () {
          if (__dispatchMapConsoleSuppressLogWarn(arguments)) return;
          return _l.apply(console, arguments);
        };
        var _e = console.error;
        console.error = function () {
          if (__dispatchMapConsoleSuppressError(arguments)) return;
          return _e.apply(console, arguments);
        };
      })();
    </script>
    <script src="https://js.arcgis.com/4.34/"></script>
    <script>
      (function() {
        const post = (m) => {
          var s = String(m);
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(s);
          } else {
            try { window.parent && window.parent.postMessage({ __dispatchMap: true, msg: s }, "*"); } catch (e0) {}
          }
        };
        post("map-loading");
        var __dispatchAuthPromptVisible = false;
        function __dispatchCheckAuthPrompt() {
          try {
            var bodyText = document.body ? String(document.body.innerText || "").toLowerCase() : "";
            var passwordInput = !!document.querySelector('input[type="password"]');
            var authCopy =
              bodyText.indexOf("please sign in to access") >= 0 ||
              (bodyText.indexOf("username") >= 0 && bodyText.indexOf("password") >= 0 && bodyText.indexOf("sign in") >= 0);
            var visible = !!(passwordInput || authCopy);
            if (visible !== __dispatchAuthPromptVisible) {
              __dispatchAuthPromptVisible = visible;
              post(visible ? "map-auth-prompt-visible" : "map-auth-prompt-hidden");
            }
          } catch (__authCheckErr) {}
        }
        try {
          var __authObserverStarted = false;
          var __startAuthObserver = function () {
            if (__authObserverStarted || !document.body || typeof MutationObserver === "undefined") return;
            __authObserverStarted = true;
            new MutationObserver(__dispatchCheckAuthPrompt).observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ["style", "class", "hidden", "aria-hidden"],
            });
            __dispatchCheckAuthPrompt();
          };
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", __startAuthObserver);
          } else {
            __startAuthObserver();
          }
          setInterval(function () {
            __startAuthObserver();
            __dispatchCheckAuthPrompt();
          }, 700);
        } catch (__authObserverErr) {}
        window.addEventListener("message", function (__hostEv) {
          try {
            var __d = __hostEv.data;
            if (!__d || __d.__dispatchMapFromHost !== true) return;
            var __c = __d.cmd;
            var __p = __d.payload;
            if (__c === "incidentPins") {
              window.__dispatchIncidentPinsPayload = __p;
              if (typeof window.__dispatchSetIncidentPins === "function") window.__dispatchSetIncidentPins(__p);
            } else if (__c === "selectedIncident") {
              window.__dispatchSelectedIncidentPayload = __p;
              if (typeof window.__dispatchSetSelectedIncident === "function") window.__dispatchSetSelectedIncident(__p);
            } else if (__c === "responders") {
              window.__dispatchRespondersPayload = __p;
              if (typeof window.__dispatchSetResponders === "function") window.__dispatchSetResponders(__p);
            } else if (__c === "pointsOfInterest") {
              window.__dispatchPoiPayload = __p;
              if (typeof window.__dispatchSetPointsOfInterest === "function") window.__dispatchSetPointsOfInterest(__p);
            } else if (__c === "geofences") {
              window.__dispatchGeofencesPayload = __p;
              if (typeof window.__dispatchSetGeofences === "function") window.__dispatchSetGeofences(__p);
            } else if (__c === "routePath") {
              window.__dispatchRoutePayload = __p;
              if (typeof window.__dispatchSetRoutePath === "function") window.__dispatchSetRoutePath(__p);
            } else if (__c === "routeStepPath") {
              window.__dispatchRouteStepPayload = __p;
              if (typeof window.__dispatchSetRouteStepPath === "function") window.__dispatchSetRouteStepPath(__p);
            } else if (__c === "maneuvers") {
              window.__dispatchManeuversPayload = __p;
              if (typeof window.__dispatchSetManeuvers === "function") window.__dispatchSetManeuvers(__p);
            } else if (__c === "liveLocation" && typeof window.__dispatchSetLiveLocation === "function") {
              var __loc = __p || {};
              if (typeof __loc.lon === "number" && typeof __loc.lat === "number") {
                window.__dispatchSetLiveLocation(__loc.lon, __loc.lat);
              }
            } else if (__c === "zoomDelta" && typeof window.__dispatchZoomDelta === "function") {
              window.__dispatchZoomDelta(__p && typeof __p.delta === "number" ? __p.delta : 0);
            }
          } catch (__eMsg) {}
        });
        require(["esri/config"], function (esriConfig) {
          try {
            esriConfig.portalUrl = ${portalUrlJson};
          } catch (ePortal) {}
          try {
            if (esriConfig.log && esriConfig.log.level !== undefined) {
              esriConfig.log.level = "none";
            }
          } catch (eLog) {}
          function startMainMap() {
          require([
          "esri/Map",
          "esri/WebMap",
          "esri/views/MapView",
          "esri/layers/GraphicsLayer",
          "esri/layers/FeatureLayer",
          "esri/layers/GeoJSONLayer",
          "esri/Graphic",
          "esri/geometry/Polyline",
          "esri/geometry/Point",
          "esri/geometry/Polygon",
          "esri/symbols/SimpleMarkerSymbol",
          "esri/symbols/PictureMarkerSymbol",
          "esri/widgets/Expand",
          "esri/widgets/LayerList",
          "esri/widgets/BasemapGallery",
          "esri/widgets/Search",
          "esri/widgets/Zoom",
          "esri/widgets/Locate",
          "esri/widgets/Home"
        ], function(Map, WebMap, MapView, GraphicsLayer, FeatureLayer, GeoJSONLayer, Graphic, Polyline, Point, Polygon, SimpleMarkerSymbol, PictureMarkerSymbol, Expand, LayerList, BasemapGallery, Search, Zoom, Locate, Home) {
          var navigationMinimal = ${navigationMinimal};
          var embedMapControls = ${embedMapControlsLiteral};
          var floatingZoomControls = ${floatingZoomControlsLiteral};
          const webmap = new WebMap({
            portalItem: {
              id: ${webMapIdJson},
              portal: { url: ${portalUrlJson} }
            }
          });
          const view = new MapView({
            container: "viewDiv",
            map: webmap,
            center: [30.06, -1.95],
            zoom: 9,
            qualityProfile: "low",
            constraints: {
              rotationEnabled: false,
              minZoom: 3,
              maxZoom: 20
            }
          });
          var __dispatchProgrammaticMove = false;
          var __dispatchProgrammaticMoveReset = null;
          var __dispatchPerspectiveMode = "default";
          function __dispatchFlagProgrammaticMove() {
            __dispatchProgrammaticMove = true;
            if (__dispatchProgrammaticMoveReset) clearTimeout(__dispatchProgrammaticMoveReset);
            __dispatchProgrammaticMoveReset = setTimeout(function() {
              __dispatchProgrammaticMove = false;
              __dispatchProgrammaticMoveReset = null;
            }, 900);
          }

          const liveLayer = new GraphicsLayer({ id: "dispatch-live-layer" });
          const routeLayer = new GraphicsLayer({ id: "dispatch-route-layer" });
          const routeStepLayer = new GraphicsLayer({ id: "dispatch-route-step-layer" });
          const routeEndpointsLayer = new GraphicsLayer({ id: "dispatch-route-endpoints-layer" });
          const routeManeuverLayer = new GraphicsLayer({ id: "dispatch-route-maneuver-layer" });
          const incidentLayer = new GraphicsLayer({ id: "dispatch-incident-layer" });
          const selectedIncidentLayer = new GraphicsLayer({ id: "dispatch-selected-incident-layer" });
          const fleetLayer = new GraphicsLayer({ id: "dispatch-fleet-layer" });
          const poiGraphicsLayer = new GraphicsLayer({
            id: "dispatch-poi-layer",
            title: "Points of interest (app)",
            visible: false
          });
          const geofenceLayer = new GraphicsLayer({ id: "dispatch-geofence-layer" });
          view.map.add(geofenceLayer);
          view.map.add(routeLayer);
          view.map.add(routeStepLayer);
          view.map.add(routeEndpointsLayer);
          view.map.add(routeManeuverLayer);
          view.map.add(poiGraphicsLayer);
          view.map.add(fleetLayer);
          view.map.add(incidentLayer);
          view.map.add(selectedIncidentLayer);
          view.map.add(liveLayer);

          // Status colors MUST match dispatcher/src/types/incident.ts STATUS_COLORS for parity.
          var STATUS_COLORS = {
            NEW: "#ef4444",
            ASSIGNED: "#f59e0b",
            IN_PROGRESS: "#3b82f6",
            EN_ROUTE: "#f97316",
            ON_SCENE: "#f97316",
            RESOLVED: "#22c55e",
            CLOSED: "#22c55e"
          };
          // POI marker color by type, matches dispatcher EsriMap POI_COLORS.
          var POI_COLORS = { AED: "#dc2626", hydrant: "#2563eb", first_aid: "#16a34a" };

          var __dispatchGeoJsonBlobUrl = null;
          var __dispatchGeoJsonLayer = null;
          var __dispatchSelectedIncidentId = null;
          var __dispatchLastIncidentsById = {};

          function __dispatchNormalizeIncidentId(id) {
            try {
              return String(id == null ? "" : id).trim().toLowerCase();
            } catch (eN) {
              return "";
            }
          }

          function __dispatchHexToRgb(hex) {
            try {
              var h = String(hex || "").replace("#", "");
              if (h.length !== 6) return [239, 68, 68];
              return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
            } catch (e) {
              return [239, 68, 68];
            }
          }

          function __dispatchCircleToRing(lon, lat, radiusMeters, numPoints) {
            var n = numPoints || 32;
            var radiusDeg = radiusMeters / 111320;
            var ring = [];
            for (var i = 0; i <= n; i++) {
              var angle = (i / n) * 2 * Math.PI;
              ring.push([lon + radiusDeg * Math.cos(angle), lat + radiusDeg * Math.sin(angle)]);
            }
            return [ring];
          }

          function __dispatchCarIconUrl(colorHex) {
            return "data:image/svg+xml," + encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
                "<defs>" +
                '<filter id="s" x="-20%" y="-20%" width="140%" height="140%">' +
                '<feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#111827" flood-opacity="0.35"/>' +
                "</filter>" +
                "</defs>" +
                '<g filter="url(#s)">' +
                '<rect x="10" y="26" width="44" height="17" rx="6" fill="' + colorHex + '" stroke="#ffffff" stroke-width="2"/>' +
                '<path d="M18 26 L25 18 H40 L48 26 Z" fill="' + colorHex + '" stroke="#ffffff" stroke-width="2"/>' +
                '<rect x="26" y="16.8" width="12" height="3.8" rx="1.7" fill="#e5e7eb" stroke="#ffffff" stroke-width="1"/>' +
                '<rect x="26.4" y="17.2" width="5.2" height="3" rx="1.2" fill="#2563eb"/>' +
                '<rect x="32.4" y="17.2" width="5.2" height="3" rx="1.2" fill="#ef4444"/>' +
                '<rect x="22.5" y="30.2" width="4.2" height="2.1" rx="0.9" fill="#ffffff"/>' +
                '<rect x="37.2" y="30.2" width="4.2" height="2.1" rx="0.9" fill="#ffffff"/>' +
                '<circle cx="22" cy="44" r="6" fill="#111827" stroke="#ffffff" stroke-width="2"/>' +
                '<circle cx="42" cy="44" r="6" fill="#111827" stroke="#ffffff" stroke-width="2"/>' +
                '<rect x="27" y="21" width="12" height="5" rx="2" fill="#bfdbfe"/>' +
                "</g>" +
              "</svg>"
            );
          }

          view.ui.empty("top-left");
          view.ui.empty("top-right");
          view.ui.empty("bottom-left");
          view.ui.empty("bottom-right");

          // Mirror dispatcher EsriMap Search widget: Rwanda-restricted geocode + POI source if the POI layer loads.
          const searchWidget = new Search({
            view: view,
            includeDefaultSources: false,
            allPlaceholder: "Search place or address",
            sources: [
              {
                url: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer",
                singleLineFieldName: "SingleLine",
                name: "Address",
                placeholder: "Search address",
                countryCode: "RWA",
                maxResults: 8,
                maxSuggestions: 8,
                suggestionsEnabled: true,
                minSuggestCharacters: 2
              }
            ],
            popupEnabled: true
          });
          if (embedMapControls) {
            const locateWidget = new Locate({ view: view });
            const homeWidget = new Home({ view: view });
            view.ui.add(homeWidget, "top-right");
            view.ui.add(locateWidget, "top-right");
            if (!floatingZoomControls) {
              const zoomWidget = new Zoom({ view: view });
              view.ui.add(zoomWidget, "top-right");
            }

            const layerListExpand = new Expand({
              view: view,
              content: new LayerList({ view: view }),
              expanded: false,
              autoCollapse: false,
              expandTooltip: "Layer list",
              collapseTooltip: "Close",
              expandIcon: "layers",
            });
            view.ui.add(layerListExpand, "top-left");

            const basemapExpand = new Expand({
              view: view,
              content: new BasemapGallery({ view: view }),
              expanded: false,
              autoCollapse: false,
              expandTooltip: "Basemap gallery",
              collapseTooltip: "Close",
              expandIcon: "basemap",
            });
            view.ui.add(basemapExpand, "top-left");

            // Search adds clutter during turn-by-turn; hide in navigation-minimal mode.
            if (!navigationMinimal) {
              const searchExpand = new Expand({
                view: view,
                content: searchWidget,
                expanded: false,
                autoCollapse: false,
                expandTooltip: "Search",
                collapseTooltip: "Close",
                expandIcon: "search",
              });
              view.ui.add(searchExpand, "top-left");
            }
          }

          window.__dispatchSetFocus = function(lon, lat, zoom) {
            __dispatchFlagProgrammaticMove();
            try {
              view.constraints.rotationEnabled = false;
            } catch (eR0) {}
            view.goTo({ center: [lon, lat], zoom: zoom || 16, rotation: 0 }, { animate: true, duration: 700 }).catch(() => {});
          };

          window.__dispatchClearNavigationFollow = function() {
            try {
              view.constraints.rotationEnabled = false;
            } catch (eR1) {}
            __dispatchFlagProgrammaticMove();
            view.goTo({ rotation: 0 }, { animate: true, duration: 450 }).catch(function() {});
          };

          var __dispatchNavFollowLastMs = 0;
          window.__dispatchSetNavigationFollow = function(lon, lat, headingDeg, rotateWithHeading) {
            var now = Date.now();
            if (now - __dispatchNavFollowLastMs < 380) return;
            __dispatchNavFollowLastMs = now;
            __dispatchFlagProgrammaticMove();
            var z = typeof view.zoom === "number" && isFinite(view.zoom) ? view.zoom : 16;
            z = Math.max(15.5, Math.min(19, z));
            var go = { center: [lon, lat], zoom: z };
            if (rotateWithHeading && headingDeg != null && isFinite(headingDeg)) {
              try {
                view.constraints.rotationEnabled = true;
              } catch (eR2) {}
              go.rotation = -headingDeg;
            } else {
              try {
                view.constraints.rotationEnabled = false;
              } catch (eR3) {}
              go.rotation = 0;
            }
            view.goTo(go, { animate: true, duration: rotateWithHeading ? 240 : 420, easing: "ease-in-out" }).catch(function() {});
          };

          window.__dispatchZoomDelta = function(delta) {
            __dispatchFlagProgrammaticMove();
            var cur = typeof view.zoom === "number" ? view.zoom : 9;
            var z = cur + (delta || 0);
            z = Math.max(3, Math.min(20, z));
            view.goTo({ zoom: z }, { animate: true, duration: 220 }).catch(function() {});
          };
          window.__dispatchSetPerspectiveMode = function(mode) {
            __dispatchPerspectiveMode = mode === "satellite" ? "satellite" : "default";
            try {
              if (__dispatchPerspectiveMode === "satellite") {
                view.map.basemap = "satellite";
              } else {
                view.map.basemap = "streets-navigation-vector";
              }
            } catch (e) {}
          };

          window.__dispatchSetLiveLocation = function(lon, lat) {
            liveLayer.removeAll();
            const pt = new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } });
            liveLayer.add(new Graphic({
              geometry: pt,
              symbol: new SimpleMarkerSymbol({
                style: "circle",
                color: [10, 132, 255, 0.18],
                size: 58,
                outline: { color: [10, 132, 255, 0.32], width: 1.5 }
              })
            }));
            liveLayer.add(new Graphic({
              geometry: pt,
              symbol: new SimpleMarkerSymbol({
                style: "circle",
                color: [255, 255, 255, 1],
                size: 26,
                outline: { color: [15, 23, 42, 0.28], width: 1.2 }
              })
            }));
            liveLayer.add(new Graphic({
              geometry: pt,
              symbol: new SimpleMarkerSymbol({
                style: "circle",
                color: [10, 132, 255, 1],
                size: 18,
                outline: { color: [255, 255, 255, 1], width: 1.5 }
              })
            }));
          };

          window.__dispatchSetRoutePath = function(payload) {
            routeLayer.removeAll();
            routeStepLayer.removeAll();
            routeEndpointsLayer.removeAll();
            var pts = (payload && Array.isArray(payload.path) ? payload.path : []).filter(function(p) {
              return p && typeof p.lat === "number" && typeof p.lon === "number";
            });
            if (pts.length < 2) return;
            routeLayer.add(new Graphic({
              geometry: new Polyline({
                paths: [pts.map(function(p) { return [p.lon, p.lat]; })],
                spatialReference: { wkid: 4326 }
              }),
              symbol: {
                type: "simple-line",
                color: [37, 99, 235, 235],
                width: 4.5,
                cap: "round",
                join: "round"
              }
            }));

            var start = pts[0];
            var end = pts[pts.length - 1];
            routeEndpointsLayer.add(new Graphic({
              geometry: new Point({ longitude: start.lon, latitude: start.lat, spatialReference: { wkid: 4326 } }),
              symbol: {
                type: "text",
                text: "A",
                color: "#ffffff",
                haloColor: [22, 163, 74, 255],
                haloSize: 14,
                font: { family: "Noto Sans", size: 12, weight: "bold" },
                yoffset: 2
              }
            }));
            routeEndpointsLayer.add(new Graphic({
              geometry: new Point({ longitude: end.lon, latitude: end.lat, spatialReference: { wkid: 4326 } }),
              symbol: {
                type: "text",
                text: "B",
                color: "#ffffff",
                haloColor: [220, 38, 38, 255],
                haloSize: 14,
                font: { family: "Noto Sans", size: 12, weight: "bold" },
                yoffset: 2
              }
            }));

            try {
              var routeLine = new Polyline({
                paths: [pts.map(function(p) { return [p.lon, p.lat]; })],
                spatialReference: { wkid: 4326 }
              });
              var ext = routeLine.extent;
              if (ext && isFinite(ext.width) && isFinite(ext.height) && ext.width > 0 && ext.height > 0) {
                __dispatchFlagProgrammaticMove();
                view
                  .goTo(
                    { target: ext.expand(1.14) },
                    {
                      padding: { top: 118, bottom: 248, left: 32, right: 40 },
                      animate: true,
                      duration: 920,
                      easing: "ease-in-out",
                    }
                  )
                  .catch(function() {});
              }
            } catch (eFit) {}
          };

          window.__dispatchSetRouteStepPath = function(payload) {
            routeStepLayer.removeAll();
            var pts = (payload && Array.isArray(payload.path) ? payload.path : []).filter(function(p) {
              return p && typeof p.lat === "number" && typeof p.lon === "number";
            });
            if (pts.length < 2) return;
            routeStepLayer.add(new Graphic({
              geometry: new Polyline({
                paths: [pts.map(function(p) { return [p.lon, p.lat]; })],
                spatialReference: { wkid: 4326 }
              }),
              symbol: {
                type: "simple-line",
                color: [14, 165, 233, 240],
                width: 7,
                cap: "round",
                join: "round"
              }
            }));
          };

          function __dispatchTone(meters) {
            var m = typeof meters === "number" && isFinite(meters) ? Math.max(0, meters) : 0;
            if (m >= 1000) return { fill: "#2563eb", halo: "rgba(37,99,235,0.25)" };
            if (m >= 250) return { fill: "#16a34a", halo: "rgba(22,163,74,0.22)" };
            return { fill: "#f97316", halo: "rgba(249,115,22,0.22)" };
          }

          function __dispatchArrowFromText(text) {
            var t = String(text || "").toLowerCase();
            if (!t) return "↑";
            if (t.indexOf("u-turn") >= 0) return "↺";
            if (t.indexOf("slight right") >= 0) return "↗";
            if (t.indexOf("right") >= 0) return "→";
            if (t.indexOf("slight left") >= 0) return "↖";
            if (t.indexOf("left") >= 0) return "←";
            if (t.indexOf("roundabout") >= 0) return "⟳";
            if (t.indexOf("arrive") >= 0) return "✓";
            return "↑";
          }

          function __dispatchArrowSvg(fill, glyph) {
            return "data:image/svg+xml," + encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
                '<circle cx="32" cy="32" r="22" fill="#ffffff" stroke="' + fill + '" stroke-width="4"/>' +
                '<text x="32" y="40" text-anchor="middle" font-size="24" font-family="Arial, sans-serif" font-weight="700" fill="#111827">' + glyph + '</text>' +
              "</svg>"
            );
          }

          window.__dispatchSetManeuvers = function(payload) {
            routeManeuverLayer.removeAll();
            var list = (payload && Array.isArray(payload.maneuvers) ? payload.maneuvers : []);
            var currentIndex = payload && typeof payload.currentIndex === "number" ? payload.currentIndex : 0;
            for (var i = 0; i < list.length; i++) {
              var m = list[i];
              var path = m && Array.isArray(m.path) ? m.path : null;
              if (!path || path.length < 2) continue;

              var markerPt = path[0];
              if (!markerPt || typeof markerPt.lat !== "number" || typeof markerPt.lon !== "number") continue;
              var tone = __dispatchTone(m.lengthMeters);
              var active = i === currentIndex;
              var size = active ? 30 : 24;
              var glyph = __dispatchArrowFromText(m.text);
              var pt = new Point({ longitude: markerPt.lon, latitude: markerPt.lat, spatialReference: { wkid: 4326 } });

              routeManeuverLayer.add(new Graphic({
                geometry: pt,
                symbol: new PictureMarkerSymbol({
                  url: __dispatchArrowSvg(tone.fill, glyph),
                  width: size,
                  height: size,
                  yoffset: 0
                }),
                attributes: { type: "maneuver", index: i }
              }));

              routeManeuverLayer.add(new Graphic({
                geometry: pt,
                symbol: {
                  type: "text",
                  text: String(i + 1),
                  color: "#ffffff",
                  haloColor: active ? tone.fill : "rgba(17,24,39,0.8)",
                  haloSize: active ? 10 : 8,
                  font: { family: "Noto Sans", size: 10, weight: "bold" },
                  yoffset: -2
                },
                attributes: { type: "maneuver-label", index: i }
              }));
            }
          };

          view.on("drag", function() {
            if (__dispatchProgrammaticMove) return;
            post("map-user-gesture");
          });
          view.on("mouse-wheel", function() {
            if (__dispatchProgrammaticMove) return;
            post("map-user-gesture");
          });
          view.on("double-click", function() {
            if (__dispatchProgrammaticMove) return;
            post("map-user-gesture");
          });

          // Fallback orange pin (used when a pin lacks a status value and therefore can't be
          // rendered through the dispatcher-style status-colored renderer).
          var incidentPinSvg =
            "data:image/svg+xml," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 72" width="56" height="72">' +
                "<defs>" +
                '<linearGradient id="incPinGrad" x1="0%" y1="0%" x2="0%" y2="100%">' +
                '<stop offset="0%" stop-color="#fb923c"/>' +
                '<stop offset="100%" stop-color="#c2410c"/>' +
                "</linearGradient>" +
                '<filter id="incPinSh" x="-35%" y="-30%" width="170%" height="170%">' +
                '<feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#0f172a" flood-opacity="0.35"/>' +
                "</filter>" +
                "</defs>" +
                '<ellipse cx="28" cy="67" rx="16" ry="5" fill="rgba(194,65,12,0.25)"/>' +
                '<g filter="url(#incPinSh)">' +
                '<path fill="url(#incPinGrad)" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round" d="' +
                "M28 7c-6.75 0-12.25 5.5-12.25 12.25 0 8.2 12.25 27.75 12.25 27.75s12.25-19.55 12.25-27.75C40.25 12.5 34.75 7 28 7z" +
                '"/>' +
                '<circle cx="28" cy="19.5" r="6.2" fill="#ffffff"/>' +
                '<circle cx="28" cy="19.5" r="3" fill="#9a3412"/>' +
                "</g>" +
                "</svg>"
            );

          function __dispatchRemoveGeoJsonIncidentLayer() {
            if (__dispatchGeoJsonLayer) {
              try { view.map.remove(__dispatchGeoJsonLayer); } catch (e) {}
              __dispatchGeoJsonLayer = null;
            }
            if (__dispatchGeoJsonBlobUrl) {
              try { URL.revokeObjectURL(__dispatchGeoJsonBlobUrl); } catch (e) {}
              __dispatchGeoJsonBlobUrl = null;
            }
          }

          function __dispatchBuildGeoJsonIncidentLayer(pins) {
            __dispatchRemoveGeoJsonIncidentLayer();
            var statusStops = Object.keys(STATUS_COLORS).map(function(key) {
              var rgb = __dispatchHexToRgb(STATUS_COLORS[key]);
              return { value: key, color: [rgb[0], rgb[1], rgb[2], 255] };
            });
            var features = pins.map(function(p) {
              return {
                type: "Feature",
                geometry: { type: "Point", coordinates: [p.lon, p.lat] },
                properties: {
                  incidentId: __dispatchNormalizeIncidentId(p.id),
                  title: p.title || "Incident",
                  status: p.status || "NEW",
                  priority: p.priority || "",
                  category: p.category || ""
                }
              };
            });
            var geojson = { type: "FeatureCollection", features: features };
            try {
              var blob = new Blob([JSON.stringify(geojson)], { type: "application/json" });
              var url = URL.createObjectURL(blob);
              __dispatchGeoJsonBlobUrl = url;
              var layer = new GeoJSONLayer({
                url: url,
                id: "dispatch-incident-cluster-layer",
                title: "Incidents",
                renderer: {
                  type: "simple",
                  symbol: {
                    type: "simple-marker",
                    size: 11,
                    color: "#ef4444",
                    outline: { color: "rgba(0,0,0,0.25)", width: 1 }
                  },
                  visualVariables: [{
                    type: "color",
                    field: "status",
                    stops: statusStops
                  }]
                },
                popupTemplate: {
                  title: "{title}",
                  content: "<b>Status:</b> {status}<br/><b>Priority:</b> {priority}<br/><b>Category:</b> {category}"
                },
                featureReduction: pins.length >= 3 ? {
                  type: "cluster",
                  clusterRadius: "80px",
                  clusterMinSize: "24px",
                  clusterMaxSize: "60px",
                  popupTemplate: {
                    title: "Incident cluster",
                    content: "This cluster contains {cluster_count} incidents. Zoom in to see individual incidents.",
                    fieldInfos: [{ fieldName: "cluster_count", format: { places: 0, digitSeparator: true } }]
                  },
                  labelingInfo: [{
                    deconflictionStrategy: "none",
                    labelExpressionInfo: {
                      expression: "Text($feature.cluster_count, '#,###')"
                    },
                    symbol: { type: "text", color: "#fff", font: { weight: "bold", family: "Noto Sans", size: "12px" } },
                    labelPlacement: "center-center"
                  }]
                } : undefined
              });
              __dispatchGeoJsonLayer = layer;
              var insertIndex = view.map.layers.indexOf(incidentLayer);
              if (insertIndex >= 0) {
                view.map.add(layer, insertIndex);
              } else {
                view.map.add(layer);
              }
            } catch (e) {
              // Fall back to plain graphics if GeoJSONLayer fails for any reason.
              __dispatchGeoJsonLayer = null;
            }
          }

          function __dispatchRenderGraphicsIncidentPins(pins) {
            incidentLayer.removeAll();
            pins.forEach(function(p) {
              var pt = new Point({ longitude: p.lon, latitude: p.lat, spatialReference: { wkid: 4326 } });
              var fill = STATUS_COLORS[p.status || ""] || null;
              var symbol;
              if (fill) {
                symbol = new SimpleMarkerSymbol({
                  color: fill,
                  size: 12,
                  outline: { color: "#ffffff", width: 2 }
                });
              } else {
                symbol = {
                  type: "picture-marker",
                  url: incidentPinSvg,
                  width: 40,
                  height: 52,
                  yoffset: 30
                };
              }
              incidentLayer.add(new Graphic({
                geometry: pt,
                attributes: {
                  incidentId: __dispatchNormalizeIncidentId(p.id),
                  title: p.title || "Incident",
                  status: p.status || "",
                  priority: p.priority || "",
                  category: p.category || ""
                },
                symbol: symbol,
                popupTemplate: {
                  title: p.title || "Incident",
                  content: "<b>Status:</b> {status}<br/><b>Priority:</b> {priority}<br/><b>Category:</b> {category}"
                }
              }));
            });
          }

          function __dispatchRedrawSelectedIncident() {
            selectedIncidentLayer.removeAll();
            if (!__dispatchSelectedIncidentId) return;
            var sel = __dispatchLastIncidentsById[__dispatchSelectedIncidentId];
            if (!sel) return;
            var statusColor = STATUS_COLORS[sel.status || ""] || "#ef4444";
            selectedIncidentLayer.add(new Graphic({
              geometry: new Point({ longitude: sel.lon, latitude: sel.lat, spatialReference: { wkid: 4326 } }),
              attributes: { incidentId: String(sel.id) },
              symbol: new SimpleMarkerSymbol({
                color: statusColor,
                size: 18,
                outline: { color: "#ffffff", width: 3 }
              })
            }));
          }

          window.__dispatchSetIncidentPins = function(payload) {
            var pins = (payload && Array.isArray(payload.pins) ? payload.pins : []).filter(function(p) {
              if (!p) return false;
              if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
              var nid = __dispatchNormalizeIncidentId(p.id);
              return nid.length > 0;
            }).map(function(p) {
              return {
                id: __dispatchNormalizeIncidentId(p.id),
                lat: p.lat,
                lon: p.lon,
                status: p.status,
                priority: p.priority,
                category: p.category,
                title: p.title
              };
            });

            // Keep a lookup for selection highlighting even when we render via GeoJSONLayer
            // (the GeoJSONLayer has no direct graphic handle for a given id).
            __dispatchLastIncidentsById = {};
            pins.forEach(function(p) {
              var nid = __dispatchNormalizeIncidentId(p.id);
              __dispatchLastIncidentsById[nid] = {
                id: nid,
                lat: p.lat,
                lon: p.lon,
                status: p.status || "",
                title: p.title || "",
                priority: p.priority || "",
                category: p.category || ""
              };
            });

            var hasStatusInfo = pins.some(function(p) { return !!p.status; });
            if (hasStatusInfo) {
              // Dispatcher parity path: GeoJSONLayer with status-color renderer + clustering + popups.
              incidentLayer.removeAll();
              __dispatchBuildGeoJsonIncidentLayer(pins);
            } else {
              // Backward-compat path for callers that only send {id,lat,lon} (e.g. legacy pick modal).
              __dispatchRemoveGeoJsonIncidentLayer();
              __dispatchRenderGraphicsIncidentPins(pins);
            }
            __dispatchRedrawSelectedIncident();
          };

          window.__dispatchSetSelectedIncident = function(payload) {
            __dispatchSelectedIncidentId = (payload && payload.id != null)
              ? __dispatchNormalizeIncidentId(payload.id)
              : null;
            __dispatchRedrawSelectedIncident();
            // Auto-pan to the selected incident when we know its coordinates (matches dispatcher behavior).
            if (__dispatchSelectedIncidentId) {
              var sel = __dispatchLastIncidentsById[__dispatchSelectedIncidentId];
              if (sel && typeof sel.lat === "number" && typeof sel.lon === "number") {
                __dispatchFlagProgrammaticMove();
                try {
                  view.goTo({ center: [sel.lon, sel.lat], zoom: 15 }, { animate: true, duration: 600 }).catch(function() {});
                } catch (e) {}
              }
            }
          };

          window.__dispatchSetResponders = function(payload) {
            fleetLayer.removeAll();
            var responders = (payload && Array.isArray(payload.responders) ? payload.responders : []);
            var suggestedId = (payload && payload.suggestedResponderId) ? String(payload.suggestedResponderId) : null;
            responders.forEach(function(r) {
              if (!r || typeof r.lat !== "number" || typeof r.lon !== "number" || !r.id) return;
              var isSuggested = suggestedId != null && String(r.id) === suggestedId;
              var color = isSuggested ? "#facc15" : (r.available === false ? "#f97316" : "#22c55e");
              var size = isSuggested ? 36 : 31;
              fleetLayer.add(new Graphic({
                geometry: new Point({ longitude: r.lon, latitude: r.lat, spatialReference: { wkid: 4326 } }),
                attributes: { responderId: String(r.id), responderName: r.name || "Responder" },
                symbol: new PictureMarkerSymbol({
                  url: __dispatchCarIconUrl(color),
                  width: size,
                  height: size,
                  yoffset: 2
                }),
                popupTemplate: {
                  title: "Responder",
                  content: isSuggested
                    ? "Suggested nearest responder"
                    : (r.available === false ? "Busy responder" : "Available responder")
                }
              }));
            });
          };

          window.__dispatchSetPointsOfInterest = function(payload) {
            poiGraphicsLayer.removeAll();
            var pois = (payload && Array.isArray(payload.pois) ? payload.pois : []);
            pois.forEach(function(poi) {
              if (!poi || typeof poi.lat !== "number" || typeof poi.lon !== "number") return;
              var color = POI_COLORS[poi.type] || "#6b7280";
              poiGraphicsLayer.add(new Graphic({
                geometry: new Point({ longitude: poi.lon, latitude: poi.lat, spatialReference: { wkid: 4326 } }),
                attributes: { type: "poi", poiId: String(poi.id) },
                symbol: new SimpleMarkerSymbol({
                  color: color,
                  size: 10,
                  outline: { color: "#ffffff", width: 1 }
                }),
                popupTemplate: {
                  title: poi.type === "AED" ? "AED" : (poi.type === "hydrant" ? "Fire hydrant" : (poi.type === "first_aid" ? "First aid" : "Point of interest")),
                  content: poi.label || poi.type || ""
                }
              }));
            });
          };

          window.__dispatchSetGeofences = function(payload) {
            geofenceLayer.removeAll();
            var fences = (payload && Array.isArray(payload.geofences) ? payload.geofences : []);
            fences.forEach(function(gf) {
              var g = gf && gf.geometry;
              if (!g || g.type !== "circle") return;
              if (typeof g.lat !== "number" || typeof g.lon !== "number" || typeof g.radiusMeters !== "number") return;
              var polygon = new Polygon({
                rings: __dispatchCircleToRing(g.lon, g.lat, g.radiusMeters),
                spatialReference: { wkid: 4326 }
              });
              geofenceLayer.add(new Graphic({
                geometry: polygon,
                attributes: { type: "geofence", geofenceId: String(gf.id || "") },
                symbol: {
                  type: "simple-fill",
                  color: [128, 128, 255, 0.2],
                  outline: { color: [64, 64, 200, 0.8], width: 2 }
                },
                popupTemplate: {
                  title: gf.name || "Geofence",
                  content: "Dispatcher geofence"
                }
              }));
            });
          };

          // If React injected payloads before we finished initializing, replay them now.
          try {
            if (window.__dispatchIncidentPinsPayload) window.__dispatchSetIncidentPins(window.__dispatchIncidentPinsPayload);
            if (window.__dispatchSelectedIncidentPayload) window.__dispatchSetSelectedIncident(window.__dispatchSelectedIncidentPayload);
            if (window.__dispatchRespondersPayload) window.__dispatchSetResponders(window.__dispatchRespondersPayload);
            if (window.__dispatchPoiPayload) window.__dispatchSetPointsOfInterest(window.__dispatchPoiPayload);
            if (window.__dispatchGeofencesPayload) window.__dispatchSetGeofences(window.__dispatchGeofencesPayload);
            if (window.__dispatchRoutePayload) window.__dispatchSetRoutePath(window.__dispatchRoutePayload);
            if (window.__dispatchRouteStepPayload) window.__dispatchSetRouteStepPath(window.__dispatchRouteStepPayload);
            if (window.__dispatchManeuversPayload) window.__dispatchSetManeuvers(window.__dispatchManeuversPayload);
          } catch (e) {}

          function removeGeohubLayers(map) {
            var removeList = [];
            function collect(layers) {
              if (!layers || typeof layers.forEach !== "function") return;
              layers.forEach(function(layer) {
                var t = (layer.title || "").toLowerCase();
                var id = (layer.id || "").toLowerCase();
                if (t.indexOf("geohub") >= 0 || id.indexOf("geohub") >= 0) removeList.push(layer);
                if (layer.layers) collect(layer.layers);
              });
            }
            collect(map.layers);
            removeList.forEach(function(layer) {
              try {
                if (layer.parent && layer.parent.remove && layer.parent !== map) {
                  layer.parent.remove(layer);
                } else {
                  map.remove(layer);
                }
              } catch (e) {}
            });
          }

          function wireViewInteractions() {
            view.on("click", function(evt) {
              if (${pickModeLiteral}) {
                try {
                  var p = view.toMap(evt);
                  if (p && typeof p.longitude === "number" && typeof p.latitude === "number") {
                    post("pick:" + p.longitude + "," + p.latitude);
                  }
                } catch (e2) {}
                return;
              }
              view.hitTest(evt).then(function(response) {
                if (!response || !response.results || !response.results.length) return;
                // Mirror dispatcher behavior: ignore taps on responders, POIs, and geofences for selection purposes.
                var skipLayerIds = {
                  "dispatch-fleet-layer": true,
                  "dispatch-poi-layer": true,
                  "dispatch-geofence-layer": true
                };
                for (var i = 0; i < response.results.length; i++) {
                  var g = response.results[i].graphic;
                  if (!g || !g.layer) continue;
                  if (skipLayerIds[g.layer.id]) return;
                  var isIncidentGraphicLayer = g.layer.id === "dispatch-incident-layer"
                    || g.layer.id === "dispatch-selected-incident-layer"
                    || g.layer.id === "dispatch-incident-cluster-layer";
                  if (isIncidentGraphicLayer && g.attributes && g.attributes.incidentId) {
                    post("incidentTap:" + encodeURIComponent(String(g.attributes.incidentId)));
                    return;
                  }
                }
              }).catch(function() {});
            });
            post("map-ready");
          }

          var webmapLoadTimeoutMs = 4500;
          function loadWebmapWithTimeout() {
            return Promise.race([
              webmap.load(),
              new Promise(function(_, reject) {
                setTimeout(function() {
                  reject(new Error("webmap_load_timeout"));
                }, webmapLoadTimeoutMs);
              })
            ]);
          }

          function addFeatureLayerIfLoads(targetMap, layer) {
            return layer
              .load()
              .then(function() {
                targetMap.add(layer);
                return layer;
              })
              .catch(function() {
                try {
                  if (layer && typeof layer.destroy === "function") layer.destroy();
                } catch (e0) {}
                return null;
              });
          }

          function createRoadNetworkLayer() {
            return new FeatureLayer({
              portalItem: { id: ${roadNetworkItemIdJson}, portal: { url: ${portalUrlJson} } },
              layerId: Number(${JSON.stringify(roadNetworkLayerIdLiteral)}),
              title: "Road network",
              opacity: 0.72,
              renderer: {
                type: "simple",
                symbol: {
                  type: "simple-line",
                  color: [37, 99, 235, 210],
                  width: 1.6,
                  style: "solid",
                  cap: "round",
                  join: "round"
                }
              }
            });
          }

          loadWebmapWithTimeout()
            .then(function() {
              try {
                webmap.basemap = navigationMinimal ? "arcgis-navigation" : "satellite";
              } catch (e) {}

              var overlayPromises = [];
              if (${includeRoadPortalOverlayLiteral}) {
                overlayPromises.push(
                  addFeatureLayerIfLoads(
                    webmap,
                    createRoadNetworkLayer()
                  )
                );
              }
              if (!navigationMinimal) {
                if (${includePoiPortalOverlayLiteral}) {
                overlayPromises.push(
                  addFeatureLayerIfLoads(
                    webmap,
                    new FeatureLayer({
                      portalItem: { id: ${poiItemIdJson}, portal: { url: ${portalUrlJson} } },
                      layerId: 0,
                      title: "Points of interest",
                      opacity: 1,
                      visible: false
                    })
                  )
                );
                }
                if (${includeVillagePortalOverlayLiteral}) {
                overlayPromises.push(
                  addFeatureLayerIfLoads(
                    webmap,
                    new FeatureLayer({
                      portalItem: { id: ${villageBoundaryItemIdJson}, portal: { url: ${portalUrlJson} } },
                      title: "Village boundaries",
                      opacity: 0.6,
                      visible: false
                    })
                  )
                );
                }
                overlayPromises.push(
                  addFeatureLayerIfLoads(
                    webmap,
                    new FeatureLayer({
                      url: ${rwAdminBoundaryUrlJson},
                      title: "Rwanda administrative boundaries",
                      opacity: 0.55,
                      visible: false
                    })
                  )
                );
                overlayPromises.push(
                  addFeatureLayerIfLoads(
                    webmap,
                    new FeatureLayer({
                      url: ${busLinesUrlJson},
                      title: "Bus lines",
                      opacity: 0.9,
                      renderer: {
                        type: "simple",
                        symbol: {
                          type: "simple-line",
                          color: [29, 78, 216, 230],
                          width: 2.5,
                          style: "dash",
                          cap: "round",
                          join: "round"
                        }
                      }
                    })
                  )
                );
                overlayPromises.push(
                  addFeatureLayerIfLoads(
                    webmap,
                    new FeatureLayer({
                      url: ${busStopsUrlJson},
                      title: "Bus stops",
                      opacity: 0.95,
                      visible: false,
                      renderer: {
                        type: "simple",
                        symbol: {
                          type: "simple-marker",
                          style: "square",
                          color: [255, 255, 255, 240],
                          size: 8,
                          outline: { color: [220, 38, 38, 240], width: 1.8 }
                        }
                      }
                    })
                  )
                );
              }
              return Promise.all(overlayPromises);
            })
            .then(function() {
              removeGeohubLayers(webmap);
              return view.when();
            })
            .then(function() {
              if (!navigationMinimal) {
                try {
                  var poiLayer =
                    (view.map.layers && view.map.layers.find && view.map.layers.find(function(l) {
                      return (l && l.title && String(l.title) === "Points of interest");
                    })) ||
                    null;

                  if (poiLayer && searchWidget && searchWidget.sources && typeof searchWidget.sources.add === "function") {
                    searchWidget.sources.add({
                      layer: poiLayer,
                      name: "POI",
                      placeholder: "Search POIs",
                      searchFields: ["name", "label", "type", "title"],
                      displayField: "name",
                      outFields: ["*"],
                      maxResults: 8,
                      maxSuggestions: 8,
                      suggestionTemplate: "{name}",
                      exactMatch: false
                    });
                  }
                } catch (e) {}
              }

              wireViewInteractions();
            })
            .catch(function() {
              // Portal item failed: fall back to a standard Esri basemap so map still renders.
              try {
                var fallbackMap = new Map({ basemap: "satellite" });
                fallbackMap.add(geofenceLayer);
                fallbackMap.add(routeLayer);
                fallbackMap.add(poiGraphicsLayer);
                fallbackMap.add(fleetLayer);
                fallbackMap.add(incidentLayer);
                fallbackMap.add(selectedIncidentLayer);
                fallbackMap.add(liveLayer);
                var fbOverlays = [];
                if (${includeRoadPortalOverlayLiteral}) {
                  fbOverlays.push(
                    addFeatureLayerIfLoads(
                      fallbackMap,
                      createRoadNetworkLayer()
                    )
                  );
                }
                if (${includePoiPortalOverlayLiteral}) {
                  fbOverlays.push(
                    addFeatureLayerIfLoads(
                      fallbackMap,
                      new FeatureLayer({
                        portalItem: { id: ${poiItemIdJson}, portal: { url: ${portalUrlJson} } },
                        layerId: 0,
                        title: "Points of interest",
                        opacity: 1,
                        visible: false
                      })
                    )
                  );
                }
                if (${includeVillagePortalOverlayLiteral}) {
                  fbOverlays.push(
                    addFeatureLayerIfLoads(
                      fallbackMap,
                      new FeatureLayer({
                        portalItem: { id: ${villageBoundaryItemIdJson}, portal: { url: ${portalUrlJson} } },
                        title: "Village boundaries",
                        opacity: 0.6,
                        visible: false
                      })
                    )
                  );
                }
                fbOverlays.push(
                      addFeatureLayerIfLoads(
                        fallbackMap,
                        new FeatureLayer({
                          url: ${rwAdminBoundaryUrlJson},
                          title: "Rwanda administrative boundaries",
                          opacity: 0.55,
                          visible: false
                        })
                      )
                    );
                fbOverlays.push(
                      addFeatureLayerIfLoads(
                        fallbackMap,
                        new FeatureLayer({
                          url: ${busLinesUrlJson},
                          title: "Bus lines",
                          opacity: 0.9,
                          renderer: {
                            type: "simple",
                            symbol: {
                              type: "simple-line",
                              color: [29, 78, 216, 230],
                              width: 2.5,
                              style: "dash",
                              cap: "round",
                              join: "round"
                            }
                          }
                        })
                      )
                    );
                fbOverlays.push(
                      addFeatureLayerIfLoads(
                        fallbackMap,
                        new FeatureLayer({
                          url: ${busStopsUrlJson},
                          title: "Bus stops",
                          opacity: 0.95,
                          visible: false,
                          renderer: {
                            type: "simple",
                            symbol: {
                              type: "simple-marker",
                              style: "square",
                              color: [255, 255, 255, 240],
                              size: 8,
                              outline: { color: [220, 38, 38, 240], width: 1.8 }
                            }
                          }
                        })
                      )
                    );
                Promise.all(fbOverlays).then(function() {
                  view.map = fallbackMap;
                  return view.when();
                }).then(function() {
                  wireViewInteractions();
                }).catch(function() {
                  post("map-error:webmap-and-fallback-load-failed");
                });
              } catch (e) {
                post("map-error:" + (e && e.message ? e.message : "webmap-and-fallback-load-failed"));
              }
            });
        });
          }
          var __oauthAppId = ${portalOAuthAppIdJson};
          if (__oauthAppId) {
            require(["esri/identity/OAuthInfo", "esri/identity/IdentityManager"], function (OAuthInfo, idMgr) {
              try {
                idMgr.registerOAuthInfos([
                  new OAuthInfo({
                    appId: __oauthAppId,
                    portalUrl: esriConfig.portalUrl,
                    popup: true,
                  }),
                ]);
                idMgr.checkSignInStatus(esriConfig.portalUrl + "/sharing").catch(function () {});
              } catch (eOAuth) {}
              startMainMap();
            });
          } else {
            startMainMap();
          }
        });
      })();
    </script>
  </head>
  <body>
    <div id="viewDiv"></div>
  </body>
</html>`;
}
