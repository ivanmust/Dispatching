import dotenv from "dotenv";
import path from "node:path";
import express from "express";
import cors from "cors";
import http from "http";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";
import { registerIncidentRoutes } from "./routes/incidents";
import { registerResponderRoutes } from "./routes/responder";
import { registerAuthRoutes } from "./routes/auth";
import { registerAuditRoutes } from "./routes/audit";
import { registerEmailRoutes } from "./routes/email";
import { registerTwilioRoutes } from "./routes/twilio";
import { registerUploadRoutes } from "./routes/upload";
import { registerPoiRoutes } from "./routes/poi";
import { registerWitnessRoutes } from "./routes/witnesses";
import { registerDrawingRoutes } from "./routes/drawings";
import { registerDocumentRoutes } from "./routes/documents";
import { registerGeofenceRoutes } from "./routes/geofences";
import { registerMediaRoutes } from "./routes/media";
import { registerStatsRoutes } from "./routes/stats";
import { registerDirectMessageRoutes } from "./routes/dm";
import { registerUserRoutes } from "./routes/users";
import { registerLivekitRoutes } from "./routes/livekit";
import { registerNotificationRoutes } from "./routes/notifications";
import { createSocketServer } from "./socket";
import { ensureRecordingsDir, ensureUploadsDir } from "./storage";
import { query } from "./db";
import { logIncidentStatusChange } from "./incidentHistory";
import { registerArcgisRoutes } from "./routes/arcgis";
import { registerAdminRoutes } from "./routes/admin";
import { ensureAdminSettingsTable } from "./adminSettings";
import { ensureRolePermissionsSeeded } from "./rolePermissions";
import { isCorsOriginAllowed } from "./corsOrigins";

dotenv.config({ path: path.join(__dirname, "../.env") });
ensureUploadsDir();
ensureRecordingsDir();

const isProd = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET;
if (isProd && (!jwtSecret || jwtSecret === "dev-insecure-secret" || jwtSecret === "change-me")) {
  throw new Error("JWT_SECRET must be set to a strong non-default value in production.");
}

const app = express();
const server = http.createServer(app);
const io = createSocketServer(server);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err?.code === "EADDRINUSE") {
    console.warn("[server] Port is already in use. Backend is likely already running on this port.");
    process.exit(0);
  }
  throw err;
});

/** True when the failure is likely transient / environmental (DB down, DNS, firewall), not bad SQL. */
function isConnectionError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; cause?: unknown; syscall?: string };
    const code = String(e.code ?? "").toUpperCase();
    if (
      code === "ENOTFOUND" ||
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "EAI_AGAIN" ||
      code === "57P01" ||
      code === "57P02"
    ) {
      return true;
    }
    if (String(e.syscall ?? "").toLowerCase() === "getaddrinfo") return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && "cause" in err ? String((err as Error & { cause?: unknown }).cause) : "";
  const combined = (msg + " " + cause).toLowerCase();
  return (
    combined.includes("connection terminated") ||
    combined.includes("connection timeout") ||
    combined.includes("econnreset") ||
    combined.includes("econnrefused") ||
    combined.includes("connection refused") ||
    combined.includes("getaddrinfo") ||
    combined.includes("enotfound") ||
    combined.includes("etimedout") ||
    combined.includes("ehostunreach") ||
    combined.includes("enetunreach") ||
    combined.includes("eai_again")
  );
}

let autoCloseInProgress = false;
let autoCloseLastConnErrorLogAt = 0;
let apiLastConnErrorLogAt = 0;
const AUTO_CLOSE_CONN_ERROR_LOG_COOLDOWN_MS = Number(
  process.env.AUTO_CLOSE_CONN_ERROR_LOG_COOLDOWN_MS ?? 10 * 60 * 1000
);
const API_CONN_ERROR_LOG_COOLDOWN_MS = Number(process.env.API_CONN_ERROR_LOG_COOLDOWN_MS ?? 60 * 1000);

function summarizeConnectionError(err: unknown): { code: string; message: string; hostname?: string } {
  const e =
    err && typeof err === "object"
      ? (err as { code?: unknown; message?: unknown; hostname?: unknown })
      : null;
  return {
    code: e?.code != null ? String(e.code) : "UNKNOWN",
    message: e?.message != null ? String(e.message) : "Database connection error",
    hostname: e?.hostname != null ? String(e.hostname) : undefined,
  };
}

function logApiConnErrorThrottled(err: unknown) {
  const now = Date.now();
  if (apiLastConnErrorLogAt && now - apiLastConnErrorLogAt < API_CONN_ERROR_LOG_COOLDOWN_MS) return;
  apiLastConnErrorLogAt = now;
  const { code, message, hostname } = summarizeConnectionError(err);
  console.warn(
    `[api] Database unreachable (${code}: ${message}${hostname ? `; host=${hostname}` : ""}). ` +
      `Returning 503 and suppressing repeated connection logs for ${Math.round(API_CONN_ERROR_LOG_COOLDOWN_MS / 1000)}s.`
  );
}

function logAutoCloseConnErrorThrottled(context: string, err: unknown) {
  const now = Date.now();
  const shouldLog =
    autoCloseLastConnErrorLogAt === 0 ||
    now - autoCloseLastConnErrorLogAt >= AUTO_CLOSE_CONN_ERROR_LOG_COOLDOWN_MS;

  if (!shouldLog) return;
  autoCloseLastConnErrorLogAt = now;
  const { code, message } = summarizeConnectionError(err);
  console.warn(
    `[auto-close] ${context}; database unreachable (${code}: ${message}). ` +
      `Suppressing repeated connection logs for ${Math.round(
        AUTO_CLOSE_CONN_ERROR_LOG_COOLDOWN_MS / 1000
      )}s.`
  );
}

async function ensureRwandaAdminBoundariesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS rwanda_admin_boundaries (
      id BIGSERIAL PRIMARY KEY,
      source_id TEXT,
      province TEXT,
      district TEXT,
      sector TEXT,
      cell TEXT,
      village TEXT,
      geometry JSONB NOT NULL,
      min_lat DOUBLE PRECISION NOT NULL,
      min_lon DOUBLE PRECISION NOT NULL,
      max_lat DOUBLE PRECISION NOT NULL,
      max_lon DOUBLE PRECISION NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rwanda_admin_boundaries_bbox_idx
      ON rwanda_admin_boundaries (min_lat, min_lon, max_lat, max_lon);
  `);
}

async function pingDatabaseOnStartup() {
  const maxAttempts = Number(process.env.DB_STARTUP_PING_ATTEMPTS ?? 5);
  const baseDelayMs = Number(process.env.DB_STARTUP_PING_BACKOFF_MS ?? 1000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await query("SELECT 1");
      if (attempt > 1) {
        console.log(`[startup] Database reachable after ${attempt} attempts.`);
      } else {
        console.log("[startup] Database reachable.");
      }
      return;
    } catch (err) {
      const isConn = isConnectionError(err);
      if (!isConn) {
        console.error("[startup] Database ping failed with non-connection error.", err);
        return;
      }
      if (attempt >= maxAttempts) {
        console.error("[startup] Database not reachable after startup retries.", err);
        return;
      }
      const delayMs = baseDelayMs * attempt;
      console.warn(`[startup] Database ping failed (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function autoCloseCompletedIncidents() {
  if (autoCloseInProgress) return;
  autoCloseInProgress = true;
  try {
    const maxAttempts = Number(process.env.AUTO_CLOSE_INCIDENTS_MAX_ATTEMPTS ?? 3);
    const baseDelayMs = Number(process.env.AUTO_CLOSE_INCIDENTS_BACKOFF_MS ?? 1500);

    const run = async () => {
      const { rows } = await query<{ id: string; assigned_responder_id: string | null }>(
        `UPDATE incidents
         SET status = 'CLOSED',
             details = jsonb_set(
               COALESCE(details, '{}'::jsonb),
               '{timeline,closedAt}',
               to_jsonb(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
               true
             ),
             updated_at = NOW()
         WHERE status = 'RESOLVED'
           AND updated_at <= NOW() - INTERVAL '1 hour'
         RETURNING id, assigned_responder_id`
      );

      if (!rows.length) return;

      for (const row of rows) {
        await logIncidentStatusChange({
          incidentId: row.id,
          fromStatus: "RESOLVED",
          toStatus: "CLOSED",
          userId: null,
          userName: null,
          metadata: { source: "auto-close" },
        });
        io.emit("incident:statusUpdate", { incidentId: row.id, status: "CLOSED" });
        io.emit("incident:statusChange", { incidentId: row.id, status: "CLOSED" });
        if (row.assigned_responder_id) {
          io.to(`user:${row.assigned_responder_id}`).emit("responder:nowAvailable");
        }
      }
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await run();
        return;
      } catch (err) {
        const isConn = isConnectionError(err);
        if (!isConn) {
          console.error("Failed to auto-close completed incidents", err);
          return;
        }
        if (attempt >= maxAttempts) {
          logAutoCloseConnErrorThrottled(
            "Failed to auto-close completed incidents (connection retries exhausted)",
            err
          );
          return;
        }
        const delay = baseDelayMs * attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  } finally {
    autoCloseInProgress = false;
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      cb(null, isCorsOriginAllowed(origin, isProd));
    },
    credentials: true,
  })
);
// Navigation/route sync POSTs can include thousands of path vertices (> default 100kb json limit).
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "5mb" }));

const apiRouter = express.Router();
registerAuthRoutes(apiRouter);
registerIncidentRoutes(apiRouter, io);
registerResponderRoutes(apiRouter, io);
registerAuditRoutes(apiRouter);
registerEmailRoutes(apiRouter);
registerTwilioRoutes(apiRouter, io);
registerUploadRoutes(apiRouter);
registerPoiRoutes(apiRouter);
registerWitnessRoutes(apiRouter);
registerDrawingRoutes(apiRouter, io);
registerDocumentRoutes(apiRouter);
registerGeofenceRoutes(apiRouter);
registerMediaRoutes(apiRouter);
registerStatsRoutes(apiRouter);
registerUserRoutes(apiRouter);
registerDirectMessageRoutes(apiRouter, io);
registerLivekitRoutes(apiRouter);
registerNotificationRoutes(apiRouter);
registerAdminRoutes(apiRouter);
registerArcgisRoutes(apiRouter);

app.use("/api", apiRouter);

// Serve uploaded files (must be after api router so /api/upload is handled first)
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
app.use("/api/uploads", express.static(uploadsDir));

// Health check (liveness - quick)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness (DB connectivity)
app.get("/health/ready", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(503).json({ status: "degraded", db: "disconnected", error: String((err as Error).message) });
  }
});

// ArcGIS readiness: routing/ETA was retired so this only reports whether the
// reverse-geocode dependencies are configured. Routing/live-navigation will be
// rebuilt on ArcGIS Enterprise; until then this endpoint exists so existing
// monitoring scrapers keep getting a 200 when the basics are in place.
app.get("/health/arcgis", (_req, res) => {
  const adminBoundaryUrl = process.env.ESRI_ADMIN_BOUNDARY_URL?.trim() || null;
  const reverseGeocodeUrl = process.env.ESRI_REVERSE_GEOCODE_URL?.trim() || null;
  res.json({
    status: "ok",
    provider: "arcgis",
    routing: { available: false, reason: "deprecated_pending_arcgis_enterprise" },
    reverseGeocode: {
      adminBoundaryUrl,
      reverseGeocodeUrl,
      configured: !!(adminBoundaryUrl || reverseGeocodeUrl),
    },
  });
});

// Backwards-compatible alias for the old /health/osm endpoint so existing
// monitoring scrapers keep working.
app.get("/health/osm", (_req, res) => {
  res.redirect(307, "/health/arcgis");
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    const field = Array.isArray(firstIssue?.path) && firstIssue.path.length ? `${firstIssue.path.join(".")}: ` : "";
    // Return a 400 for validation errors instead of a 500 and avoid noisy stack traces
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: firstIssue?.message ? `${field}${firstIssue.message}` : "Invalid request payload",
      details: err.issues,
    });
  }

  if (isConnectionError(err)) {
    logApiConnErrorThrottled(err);
    return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
      error: "Database temporarily unavailable",
      code: "DB_UNAVAILABLE",
    });
  }

  console.error(err);
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 3001;
const navServiceUrl =
  process.env.NAV_ARCGIS_ROUTE_URL?.trim() ||
  process.env.ETA_ARCGIS_ROUTE_URL?.trim() ||
  process.env.NAV_ARCGIS_CLOSEST_FACILITY_URL?.trim() ||
  process.env.ETA_ARCGIS_CLOSEST_FACILITY_URL?.trim() ||
  null;
const navMode = navServiceUrl
  ? /\/NAServer\/Route\/?$/i.test(navServiceUrl)
    ? "route-solve"
    : "legacy-submitJob"
  : "unconfigured";
void (async () => {
  try {
    await pingDatabaseOnStartup();
    await ensureRwandaAdminBoundariesTable();
    await ensureAdminSettingsTable();
    await ensureRolePermissionsSeeded();
  } catch (err) {
    console.error("Backend startup initialization failed (schema)", err);
  } finally {
    server.listen(port, "0.0.0.0", () => {
      console.log(`CAD backend listening on http://0.0.0.0:${port} (LAN: http://<your-ip>:${port})`);
      console.log(`[navigation] mode=${navMode} url=${navServiceUrl ?? "not-set"}`);
    });
    void autoCloseCompletedIncidents();
    setInterval(() => {
      void autoCloseCompletedIncidents();
    }, 60_000);
  }
})();

