export type ControlledMapLayerEnv = {
  poiItemId?: string;
  villageBoundaryItemId?: string;
  rwAdminBoundaryUrl?: string;
  busLinesUrl?: string;
  busStopsUrl?: string;
  roadNetworkItemId?: string;
  roadNetworkLayerId?: string;
  portalOAuthAppId?: string;
};

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
  const webMapId = parseWebMapId(mapViewerUrl);
  const portalUrl = parsePortalUrl(mapViewerUrl);
  const baseHref = parseBaseHref(mapViewerUrl);
  const pickMode = !!options.pickMode;
  const navigationMinimal = options.navigationMinimal !== false;
  const initialZoom = navigationMinimal ? 13 : 12;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no" />
  <base href="${escapeHtml(baseHref)}" />
  <link rel="stylesheet" href="https://js.arcgis.com/4.29/esri/themes/light/main.css" />
  <script src="https://js.arcgis.com/4.29/"></script>
  <style>
    html, body, #viewDiv { padding: 0; margin: 0; height: 100%; width: 100%; overflow: hidden; background: ${escapeHtml(chrome.pageBg)}; }
    .esri-ui-top-left, .esri-ui-top-right { display: ${options.embedMapControls === false ? "none" : "block"}; }
  </style>
</head>
<body>
  <div id="viewDiv"></div>
  <script>
    (function () {
      const post = (msg) => {
        try { window.parent.postMessage({ __dispatchMap: true, msg }, "*"); } catch (_) {}
      };

      const webMapId = ${JSON.stringify(webMapId)};
      const portalUrl = ${JSON.stringify(portalUrl)};
      const layerEnv = ${JSON.stringify(layerEnv ?? {})};
      const pickMode = ${pickMode ? "true" : "false"};
      const initialZoom = ${initialZoom};

      require([
        "esri/WebMap",
        "esri/Map",
        "esri/views/MapView",
        "esri/Graphic",
        "esri/layers/GraphicsLayer",
        "esri/layers/FeatureLayer",
        "esri/layers/TileLayer",
        "esri/geometry/Point",
        "esri/geometry/Polyline",
        "esri/geometry/Polygon",
        "esri/portal/Portal",
        "esri/widgets/BasemapGallery",
        "esri/widgets/LayerList"
      ], function (
        WebMap,
        Map,
        MapView,
        Graphic,
        GraphicsLayer,
        FeatureLayer,
        TileLayer,
        Point,
        Polyline,
        Polygon,
        Portal,
        BasemapGallery,
        LayerList
      ) {
        const incidentLayer = new GraphicsLayer({ title: "Incidents" });
        const responderLayer = new GraphicsLayer({ title: "Responders" });
        const poiLayer = new GraphicsLayer({ title: "Points of Interest" });
        const geofenceLayer = new GraphicsLayer({ title: "Geofences" });
        const routeLayer = new GraphicsLayer({ title: "Responder route" });
        const liveLayer = new GraphicsLayer({ title: "Current location" });

        let view;
        let selectedIncidentId = null;
        let latestPins = [];

        function point(lon, lat) {
          return new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } });
        }

        function colorForStatus(status) {
          const s = String(status || "").toUpperCase();
          if (s === "ASSIGNED") return [245, 158, 11, 0.95];
          if (s === "IN_PROGRESS") return [59, 130, 246, 0.95];
          if (s === "RESOLVED" || s === "CLOSED") return [34, 197, 94, 0.95];
          return [239, 68, 68, 0.95];
        }

        function incidentSymbol(pin) {
          const selected = String(pin.id) === String(selectedIncidentId || "");
          return {
            type: "simple-marker",
            style: "circle",
            color: colorForStatus(pin.status),
            size: selected ? 18 : 13,
            outline: { color: selected ? [15, 23, 42, 1] : [255, 255, 255, 0.95], width: selected ? 3 : 2 }
          };
        }

        function renderIncidents(pins) {
          latestPins = Array.isArray(pins) ? pins : [];
          incidentLayer.removeAll();
          latestPins.forEach(function (pin) {
            if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lon)) return;
            incidentLayer.add(new Graphic({
              geometry: point(pin.lon, pin.lat),
              attributes: { id: pin.id, title: pin.title || "Incident" },
              symbol: incidentSymbol(pin),
              popupTemplate: {
                title: pin.title || "Incident",
                content: [
                  "Status: " + (pin.status || "Unknown"),
                  "Priority: " + (pin.priority || "Unknown"),
                  "Category: " + (pin.category || "Unknown")
                ].join("<br/>")
              }
            }));
          });
        }

        function renderResponders(payload) {
          const responders = Array.isArray(payload && payload.responders) ? payload.responders : [];
          const suggested = payload && payload.suggestedResponderId;
          responderLayer.removeAll();
          responders.forEach(function (responder) {
            if (!Number.isFinite(responder.lat) || !Number.isFinite(responder.lon)) return;
            const isSuggested = String(responder.id) === String(suggested || "");
            responderLayer.add(new Graphic({
              geometry: point(responder.lon, responder.lat),
              symbol: {
                type: "simple-marker",
                style: "triangle",
                color: responder.available === false ? [100, 116, 139, 0.9] : [16, 185, 129, 0.95],
                size: isSuggested ? 18 : 13,
                outline: { color: isSuggested ? [250, 204, 21, 1] : [255, 255, 255, 0.95], width: isSuggested ? 3 : 2 }
              },
              popupTemplate: { title: responder.name || "Responder", content: responder.available === false ? "Unavailable" : "Available" }
            }));
          });
        }

        function renderPois(payload) {
          const pois = Array.isArray(payload && payload.pois) ? payload.pois : [];
          poiLayer.removeAll();
          pois.forEach(function (poi) {
            if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lon)) return;
            poiLayer.add(new Graphic({
              geometry: point(poi.lon, poi.lat),
              symbol: {
                type: "simple-marker",
                style: "diamond",
                color: [99, 102, 241, 0.85],
                size: 9,
                outline: { color: [255, 255, 255, 0.95], width: 1 }
              },
              popupTemplate: { title: poi.label || poi.type || "Point of interest" }
            }));
          });
        }

        function renderRoute(payload) {
          const path = Array.isArray(payload && payload.path) ? payload.path : [];
          routeLayer.removeAll();
          if (path.length < 2) return;
          routeLayer.add(new Graphic({
            geometry: new Polyline({
              paths: [path.map(function (p) { return [p.lon, p.lat]; })],
              spatialReference: { wkid: 4326 }
            }),
            symbol: {
              type: "simple-line",
              color: [37, 99, 235, 0.9],
              width: 5,
              cap: "round",
              join: "round"
            }
          }));
        }

        function renderLiveLocation(payload) {
          if (!payload || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lon)) return;
          liveLayer.removeAll();
          const pt = point(payload.lon, payload.lat);
          liveLayer.add(new Graphic({
            geometry: pt,
            symbol: { type: "simple-marker", style: "circle", color: [59, 130, 246, 0.22], size: 30, outline: { color: [59, 130, 246, 0.18], width: 1 } }
          }));
          liveLayer.add(new Graphic({
            geometry: pt,
            symbol: { type: "simple-marker", style: "circle", color: [255, 255, 255, 1], size: 16, outline: { color: [255, 255, 255, 1], width: 1 } }
          }));
          liveLayer.add(new Graphic({
            geometry: pt,
            symbol: { type: "simple-marker", style: "circle", color: [37, 99, 235, 1], size: 10, outline: { color: [29, 78, 216, 1], width: 1 } }
          }));
        }

        function addConfiguredLayers(map) {
          try {
            if (layerEnv.rwAdminBoundaryUrl) map.add(new FeatureLayer({ url: layerEnv.rwAdminBoundaryUrl, title: "Admin boundaries" }));
            if (layerEnv.busLinesUrl) map.add(new FeatureLayer({ url: layerEnv.busLinesUrl, title: "Bus lines" }));
            if (layerEnv.busStopsUrl) map.add(new FeatureLayer({ url: layerEnv.busStopsUrl, title: "Bus stops" }));
            if (layerEnv.roadNetworkItemId) map.add(new TileLayer({ portalItem: { id: layerEnv.roadNetworkItemId }, title: "Road network" }));
          } catch (err) {
            console.warn("Optional layer failed", err);
          }
        }

        function createMap() {
          try {
            const portal = new Portal({ url: portalUrl });
            const map = new WebMap({ portalItem: { id: webMapId, portal: portal } });
            addConfiguredLayers(map);
            map.addMany([geofenceLayer, routeLayer, poiLayer, responderLayer, incidentLayer, liveLayer]);
            return map;
          } catch (err) {
            console.warn("WebMap failed; falling back to hybrid map", err);
            const map = new Map({ basemap: "hybrid" });
            addConfiguredLayers(map);
            map.addMany([geofenceLayer, routeLayer, poiLayer, responderLayer, incidentLayer, liveLayer]);
            return map;
          }
        }

        const map = createMap();
        view = new MapView({
          container: "viewDiv",
          map: map,
          center: [30.0619, -1.9441],
          zoom: initialZoom,
          constraints: { snapToZoom: false }
        });

        view.when(function () {
          if (${options.embedMapControls === false ? "false" : "true"}) {
            view.ui.add(new BasemapGallery({ view: view }), "top-right");
            view.ui.add(new LayerList({ view: view }), "bottom-right");
          }
          post("map-ready");
        }).catch(function (err) {
          post("map-error:" + (err && err.message ? err.message : "unknown"));
        });

        view.on("click", function (event) {
          view.hitTest(event).then(function (hit) {
            const incidentHit = hit.results.find(function (r) {
              return r.graphic && r.graphic.layer === incidentLayer;
            });
            if (incidentHit && incidentHit.graphic && incidentHit.graphic.attributes && incidentHit.graphic.attributes.id) {
              post("incidentTap:" + encodeURIComponent(incidentHit.graphic.attributes.id));
              return;
            }
            if (pickMode && event.mapPoint) {
              post("pick:" + event.mapPoint.longitude + "," + event.mapPoint.latitude);
            }
          });
        });

        window.addEventListener("message", function (ev) {
          const data = ev.data;
          if (!data || data.__dispatchMapFromHost !== true) return;
          const payload = data.payload || {};
          switch (data.cmd) {
            case "incidentPins":
              renderIncidents(payload.pins || []);
              break;
            case "selectedIncident":
              selectedIncidentId = payload.id || null;
              renderIncidents(latestPins);
              break;
            case "responders":
              renderResponders(payload);
              break;
            case "pointsOfInterest":
              renderPois(payload);
              break;
            case "routePath":
              renderRoute(payload);
              break;
            case "liveLocation":
              renderLiveLocation(payload);
              break;
            case "zoomDelta":
              if (view && Number.isFinite(payload.delta)) view.goTo({ zoom: view.zoom + payload.delta }).catch(function () {});
              break;
          }
        });

        post("map-loading");
      });
    })();
  </script>
</body>
</html>`;
}

function parseWebMapId(url: string): string {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("webmap");
    if (fromQuery) return fromQuery;
  } catch {
    // keep fallback
  }
  return url.match(/webmap=([a-fA-F0-9]{32})/)?.[1] ?? "3e190cfba7fd4d1f8c9600cc072a6d15";
}

function parsePortalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const portalIndex = parsed.pathname.indexOf("/portal");
    if (portalIndex >= 0) return `${parsed.origin}${parsed.pathname.slice(0, portalIndex + "/portal".length)}`;
  } catch {
    // keep fallback
  }
  return "https://www.arcgis.com";
}

function parseBaseHref(url: string): string {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return "https://esrirw.rw/";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
