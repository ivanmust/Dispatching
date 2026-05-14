import type { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db";
import { ensureCrimesOperationalColumns } from "../crimesSchema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../audit";
import { logIncidentStatusChange } from "../incidentHistory";
import { sendSms, isTwilioConfigured } from "../twilio";
import type { Incident, IncidentStatus, User } from "../types";
import { notifyRole, notifyUser } from "../notifications";
import { getAdminSetting } from "../adminSettings";
import { createRateLimiter } from "../middleware/rateLimit";
import { dedupeIncidentsByIdPreferNewest } from "../lib/incidentsDedupe";

const incidentStatusSchema = z.enum(["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
const incidentPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

// Rwanda approximate bounds: lat -2.84 to -1.05, lon 28.86 to 30.90 (slightly wider for edge cases)
const RWANDA_LAT_MIN = -3;
const RWANDA_LAT_MAX = -1;
const RWANDA_LON_MIN = 28.5;
const RWANDA_LON_MAX = 31;

function isInRwanda(lat: number, lon: number): boolean {
  return lat >= RWANDA_LAT_MIN && lat <= RWANDA_LAT_MAX && lon >= RWANDA_LON_MIN && lon <= RWANDA_LON_MAX;
}

const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    address: z.string().optional(),
  })
  .refine((loc) => isInRwanda(loc.lat, loc.lon), { message: "Coordinates must be within Rwanda" });

const patchLocationSchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    address: z.string().optional(),
  })
  .refine(
    (loc) => {
      if (typeof loc.lat === "number" && typeof loc.lon === "number") {
        return isInRwanda(loc.lat, loc.lon);
      }
      return true;
    },
    { message: "Coordinates must be within Rwanda" }
  );

const createIncidentSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().min(5, "Description must be at least 5 characters"),
  status: incidentStatusSchema,
  priority: incidentPrioritySchema,
  category: z.string().min(1),
  location: locationSchema,
  callerPhone: z.string().optional().nullable(),
   // Arbitrary structured call-taking details (per-category questionnaire answers)
  details: z.record(z.unknown()).optional(),
  assignedResponderId: z.string().uuid().optional(),
  assignedResponderName: z.string().optional(),
});

const updateIncidentSchema = createIncidentSchema.partial().extend({
  location: patchLocationSchema.optional(),
});

function withTimeline(
  details: Record<string, unknown> | null | undefined,
  patch: Partial<{ assignedAt: string; completedAt: string; closedAt: string; inProgressAt: string }>
): Record<string, unknown> {
  const base = (details ?? {}) as Record<string, unknown>;
  const currentTimeline =
    base.timeline && typeof base.timeline === "object"
      ? (base.timeline as Record<string, unknown>)
      : {};
  return {
    ...base,
    timeline: {
      ...currentTimeline,
      ...patch,
    },
  };
}

type CrimeRow = {
  crimeId: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  priority: string | null;
  crimeType: string | null;
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  district: string | null;
  sector: string | null;
  cell: string | null;
  village: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  details: Record<string, unknown> | null;
  assignedResponderId: string | null;
  assignedResponderName: string | null;
  locationAddress: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdByRole: string | null;
  createdUser: string | null;
};

function normalizeCrimeStatus(status: string | null | undefined): IncidentStatus {
  const s = String(status ?? "").trim().toUpperCase();
  if (s === "ASSIGNED") return "ASSIGNED";
  if (s === "IN_PROGRESS" || s === "IN PROGRESS") return "IN_PROGRESS";
  if (s === "RESOLVED" || s === "COMPLETED") return "RESOLVED";
  if (s === "CLOSED") return "CLOSED";
  return "NEW";
}

function normalizeCrimePriority(priority: string | null | undefined): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const p = String(priority ?? "").trim().toUpperCase();
  if (p === "LOW" || p === "MEDIUM" || p === "HIGH" || p === "CRITICAL") return p;
  return "MEDIUM";
}

function normalizeCrimeCategory(category: string | null | undefined): string {
  const c = String(category ?? "").trim().toUpperCase();
  if (!c) return "OTHER";
  return c;
}

/** `crimes.createdat` / `updatedat` may be epoch-ms (large) or epoch-seconds (smaller). */
function crimeEpochMsFromDb(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n > 100_000_000_000 ? n : n * 1000;
}

function crimeRowToIncident(row: CrimeRow): Incident {
  const createdIso = new Date(crimeEpochMsFromDb(row.createdAt)).toISOString();
  const updatedIso = new Date(crimeEpochMsFromDb(row.updatedAt ?? row.createdAt)).toISOString();
  const derivedAddr = [row.village, row.cell, row.sector, row.district, row.province].filter(Boolean).join(", ") || null;
  return {
    id: String(row.crimeId ?? ""),
    title: row.title?.trim() || row.crimeType?.trim() || "Incident",
    description: row.description ?? "",
    status: normalizeCrimeStatus(row.status),
    priority: normalizeCrimePriority(row.priority),
    category: normalizeCrimeCategory(row.crimeType),
    locationLat: Number(row.latitude ?? 0),
    locationLon: Number(row.longitude ?? 0),
    locationAddress: row.locationAddress ?? derivedAddr,
    callerPhone: null,
    details: row.details ?? null,
    assignedResponderId: row.assignedResponderId ?? null,
    assignedResponderName: row.assignedResponderName ?? null,
    createdById: row.createdById ?? row.createdUser ?? null,
    createdByName: row.createdByName ?? row.createdUser ?? null,
    createdByRole: row.createdByRole === "dispatcher" || row.createdByRole === "responder" ? row.createdByRole : null,
    createdAt: createdIso,
    updatedAt: updatedIso,
  };
}

type IncidentPgListRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  locationLat: number;
  locationLon: number;
  locationAddress: string | null;
  callerPhone: string | null;
  details: Record<string, unknown> | null;
  assignedResponderId: string | null;
  assignedResponderName: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdByRole: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function uuidOrNull(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

/**
 * Legacy CAD rows may exist only in `crimes`. GET /incidents/:id merges them for reads, but
 * assignment and history still query `incidents`. Mirror a crime row into `incidents` when missing.
 */
async function ensureIncidentMirrorFromCrime(id: string): Promise<boolean> {
  const { rows: existing } = await query<{ id: string }>(`SELECT id::text AS id FROM incidents WHERE id::text = $1`, [id]);
  if (existing[0]?.id) return true;

  const { rows: crimeRows } = await query<CrimeRow>(
    `SELECT
       crime_id AS "crimeId",
       title,
       description,
       status,
       priority,
       COALESCE(crime_type_l1, crime_type, 'OTHER') AS "crimeType",
       latitude,
       longitude,
       province,
       district,
       sector,
       cell,
       village,
       createdat AS "createdAt",
       updatedat AS "updatedAt",
       details,
       assigned_responder_id AS "assignedResponderId",
       assigned_responder_name AS "assignedResponderName",
       location_address AS "locationAddress",
       created_by_id AS "createdById",
       created_by_name AS "createdByName",
       created_by_role AS "createdByRole",
       created_user AS "createdUser"
     FROM crimes
     WHERE crime_id::text = $1
     LIMIT 1`,
    [id]
  );
  if (!crimeRows[0]) return false;

  const inc = crimeRowToIncident(crimeRows[0]);
  const assignedId = uuidOrNull(inc.assignedResponderId ?? undefined);

  try {
    await query(
      `INSERT INTO incidents (
         id, title, description, status, priority, category,
         location_lat, location_lon, location_address,
         caller_phone, details,
         assigned_responder_id, assigned_responder_name,
         created_by_id, created_by_name, created_by_role,
         created_at, updated_at
       ) VALUES (
         $1::uuid, $2, $3, $4::incident_status, $5::incident_priority, $6,
         $7, $8, $9,
         $10, $11::jsonb,
         $12::uuid, $13,
         $14, $15, $16,
         $17::timestamptz, $18::timestamptz
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        inc.id,
        inc.title,
        inc.description,
        inc.status,
        inc.priority,
        inc.category,
        inc.locationLat,
        inc.locationLon,
        inc.locationAddress,
        inc.callerPhone,
        inc.details ?? null,
        assignedId,
        inc.assignedResponderName,
        inc.createdById,
        inc.createdByName,
        inc.createdByRole,
        inc.createdAt,
        inc.updatedAt,
      ]
    );
  } catch (err) {
    console.warn("[incidents] ensureIncidentMirrorFromCrime insert failed:", (err as Error)?.message ?? err);
    return false;
  }
  return true;
}

function incidentPgRowToIncident(row: IncidentPgListRow): Incident {
  const toIso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();
  return {
    id: String(row.id),
    title: row.title?.trim() || "Incident",
    description: row.description ?? "",
    status: normalizeCrimeStatus(row.status),
    priority: normalizeCrimePriority(row.priority),
    category: normalizeCrimeCategory(row.category),
    locationLat: Number(row.locationLat),
    locationLon: Number(row.locationLon),
    locationAddress: row.locationAddress ?? null,
    callerPhone: row.callerPhone ?? null,
    details: row.details ?? null,
    assignedResponderId: row.assignedResponderId ?? null,
    assignedResponderName: row.assignedResponderName ?? null,
    createdById: row.createdById ?? null,
    createdByName: row.createdByName ?? null,
    createdByRole: row.createdByRole === "dispatcher" || row.createdByRole === "responder" ? row.createdByRole : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function syncCrimeStatus(crimeId: string, status: IncidentStatus): Promise<void> {
  await query(
    `UPDATE crimes
     SET status = $1, updatedat = $2, resolved = $3, resolved2 = $4
     WHERE crime_id::text = $5`,
    [
      status,
      Date.now(),
      status === "RESOLVED" || status === "CLOSED" ? "true" : "false",
      status === "RESOLVED" || status === "CLOSED",
      crimeId,
    ]
  );
}

/** Keep `crimes` assignment columns aligned with `incidents` (responder list historically read `crimes`). */
async function syncCrimeResponder(
  crimeId: string,
  responderId: string | null,
  responderName: string | null
): Promise<void> {
  await query(
    `UPDATE crimes
     SET assigned_responder_id = $1,
         assigned_responder_name = $2,
         updatedat = $3
     WHERE crime_id::text = $4`,
    [responderId, responderName, Date.now(), crimeId]
  );
}

export function registerIncidentRoutes(router: Router, io: Server) {
  const incidentMutationLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 40,
    keyPrefix: "incidents:mutation",
    message: "Too many incident update requests. Please wait and try again.",
  });
  const incidentAssignmentLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    keyPrefix: "incidents:assignment",
    message: "Too many assignment requests. Please wait and try again.",
  });

  router.get("/incidents/mine", requireAuth, async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const userId = req.authUser!.id;
      const { rows } = await query<CrimeRow>(
        `SELECT DISTINCT ON (crime_id)
           crime_id AS "crimeId",
           title,
           description,
           status,
           priority,
           COALESCE(crime_type_l1, crime_type, 'OTHER') AS "crimeType",
           latitude,
           longitude,
           province,
           district,
           sector,
           cell,
           village,
           createdat AS "createdAt",
           updatedat AS "updatedAt",
           details,
           assigned_responder_id AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           location_address AS "locationAddress",
           created_by_id AS "createdById",
           created_by_name AS "createdByName",
           created_by_role AS "createdByRole",
           created_user AS "createdUser"
         FROM crimes
         WHERE crime_id IS NOT NULL
           AND (created_by_id = $1 OR created_user = $1 OR created_user = (SELECT name FROM users WHERE id = $1))
         ORDER BY crime_id, (
           CASE
             WHEN COALESCE(createdat, updatedat, 0) > 100000000000
             THEN COALESCE(createdat, updatedat, 0)
             ELSE COALESCE(createdat, updatedat, 0) * 1000
           END
         ) DESC`,
        [userId]
      );
      res.json(dedupeIncidentsByIdPreferNewest(rows.map(crimeRowToIncident)));
    } catch (err) {
      next(err);
    }
  });

  router.get("/incidents", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const statusParam = req.query.status;
      const statuses: string[] | null =
        typeof statusParam === "string" && statusParam
          ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
          : null;
      const { rows } = await query<CrimeRow>(
        `SELECT DISTINCT ON (crime_id)
           crime_id AS "crimeId",
           title,
           description,
           status,
           priority,
           COALESCE(crime_type_l1, crime_type, 'OTHER') AS "crimeType",
           latitude,
           longitude,
           province,
           district,
           sector,
           cell,
           village,
           createdat AS "createdAt",
           updatedat AS "updatedAt",
           details,
           assigned_responder_id AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           location_address AS "locationAddress",
           created_by_id AS "createdById",
           created_by_name AS "createdByName",
           created_by_role AS "createdByRole",
           created_user AS "createdUser"
         FROM crimes
         WHERE crime_id IS NOT NULL
         ORDER BY crime_id, (
           CASE
             WHEN COALESCE(createdat, updatedat, 0) > 100000000000
             THEN COALESCE(createdat, updatedat, 0)
             ELSE COALESCE(createdat, updatedat, 0) * 1000
           END
         ) DESC`
      );

      const crimeIds = rows.map((r) => String(r.crimeId ?? "")).filter(Boolean);
      if (crimeIds.length > 0) {
        const { rows: invOverlayRows } = await query<{
          id: string;
          status: string;
          assignedResponderId: string | null;
          assignedResponderName: string | null;
          details: Record<string, unknown> | null;
          updatedAt: Date;
        }>(
          `SELECT id::text,
                  status::text,
                  assigned_responder_id::text AS "assignedResponderId",
                  assigned_responder_name AS "assignedResponderName",
                  details,
                  updated_at AS "updatedAt"
           FROM incidents
           WHERE id::text = ANY($1::text[])`,
          [crimeIds]
        );
        const invById = new Map(invOverlayRows.map((r) => [r.id, r]));
        for (const row of rows) {
          const inv = invById.get(String(row.crimeId ?? ""));
          if (!inv) continue;
          row.status = inv.status;
          if (inv.assignedResponderId != null) row.assignedResponderId = inv.assignedResponderId;
          if (inv.assignedResponderName != null) row.assignedResponderName = inv.assignedResponderName;
          if (inv.details && typeof inv.details === "object") {
            const base =
              row.details && typeof row.details === "object" && !Array.isArray(row.details)
                ? (row.details as Record<string, unknown>)
                : {};
            row.details = { ...base, ...(inv.details as Record<string, unknown>) };
          }
          const incMs = new Date(inv.updatedAt).getTime();
          const crimeMs = crimeEpochMsFromDb(row.updatedAt ?? row.createdAt);
          row.updatedAt = Math.max(crimeMs, incMs);
        }
      }

      const { rows: legacyIncidentRows } = await query<IncidentPgListRow>(
        `SELECT DISTINCT ON (id)
           id,
           title,
           description,
           status::text,
           priority::text,
           category,
           location_lat AS "locationLat",
           location_lon AS "locationLon",
           location_address AS "locationAddress",
           caller_phone AS "callerPhone",
           details,
           assigned_responder_id::text AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id AS "createdById",
           created_by_name AS "createdByName",
           created_by_role AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
        WHERE NOT EXISTS (
             SELECT 1 FROM crimes c
             WHERE c.crime_id IS NOT NULL AND c.crime_id::text = incidents.id::text
           )
         ORDER BY id, GREATEST(created_at, updated_at) DESC`
      );
      let mapped = dedupeIncidentsByIdPreferNewest([
        ...rows.map(crimeRowToIncident),
        ...legacyIncidentRows.map(incidentPgRowToIncident),
      ]);
      if (statuses?.length) {
        const allowed = new Set(statuses.map((s) => s.toUpperCase()));
        mapped = mapped.filter((r) => allowed.has(String(r.status).toUpperCase()));
      }
      const user = req.authUser!;
      if (user.role === "responder") {
        mapped = mapped.filter((r) => {
          const assignedToMe = String(r.assignedResponderId ?? "") === user.id;
          const selfCreatedUnassigned =
            String(r.createdById ?? "") === user.id &&
            String(r.createdByRole ?? "").toLowerCase() === "responder" &&
            !r.assignedResponderId;
          return assignedToMe || selfCreatedUnassigned;
        });
      }
      res.json(mapped);
    } catch (err) {
      next(err);
    }
  });

  // Call log: previous incidents from same caller number (GINA: abuse detection)
  router.get("/call-log", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const phone = req.query.phone;
      if (typeof phone !== "string" || !phone.trim()) {
        res.status(400).json({ error: "Query parameter 'phone' is required" });
        return;
      }
      const normalized = phone.trim().replace(/\D/g, "").slice(-10);
      if (!normalized) {
        res.json([]);
        return;
      }
      const { rows } = await query<Incident>(
        `SELECT
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id           AS "createdById",
           created_by_name         AS "createdByName",
           created_by_role         AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
         WHERE caller_phone IS NOT NULL AND regexp_replace(COALESCE(caller_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [normalized]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get("/incidents/:id", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const { id } = req.params;
      const user = req.authUser!;
      const { rows } = await query<Incident>(
        `SELECT
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id           AS "createdById",
           created_by_name         AS "createdByName",
           created_by_role         AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
         WHERE id = $1`,
        [id]
      );
      if (!rows[0]) {
        const { rows: crimeRows } = await query<CrimeRow>(
          `SELECT
             crime_id AS "crimeId",
             title,
             description,
             status,
             priority,
             COALESCE(crime_type_l1, crime_type, 'OTHER') AS "crimeType",
             latitude,
             longitude,
             province,
             district,
             sector,
             cell,
             village,
             createdat AS "createdAt",
             updatedat AS "updatedAt",
             details,
             assigned_responder_id AS "assignedResponderId",
             assigned_responder_name AS "assignedResponderName",
             location_address AS "locationAddress",
             created_by_id AS "createdById",
             created_by_name AS "createdByName",
             created_by_role AS "createdByRole",
             created_user AS "createdUser"
           FROM crimes
           WHERE crime_id = $1
           LIMIT 1`,
          [id]
        );
        if (!crimeRows[0]) {
          res.status(404).json({ error: "Incident not found" });
          return;
        }
        res.json(crimeRowToIncident(crimeRows[0]));
        return;
      }
      if (user.role === "responder") {
        const r = rows[0];
        const mayView =
          r.assignedResponderId === user.id ||
          (String(r.createdById ?? "") === user.id && r.createdByRole === "responder");
        if (!mayView) {
          res.status(403).json({ error: "Only the assigned responder can view this incident" });
          return;
        }
      }
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  router.get("/incidents/:id/history", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      const { id } = req.params;
      const user = req.authUser!;

      await ensureIncidentMirrorFromCrime(id);

      const { rows: incRows } = await query<{
        assigned_responder_id: string | null;
        created_by_id: string | null;
        created_by_role: string | null;
      }>(`SELECT assigned_responder_id, created_by_id, created_by_role FROM incidents WHERE id = $1`, [id]);
      if (!incRows[0]) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }
      if (user.role === "responder") {
        const ir = incRows[0];
        const mayView =
          ir.assigned_responder_id === user.id ||
          (String(ir.created_by_id ?? "") === user.id && ir.created_by_role === "responder");
        if (!mayView) {
          res.status(403).json({ error: "Only the assigned responder can view this incident" });
          return;
        }
      }

      const { rows } = await query<{
        id: string;
        incidentId: string;
        fromStatus: string | null;
        toStatus: string;
        changedById: string | null;
        changedByName: string | null;
        metadata: Record<string, unknown> | null;
        createdAt: string;
      }>(
        `SELECT
           id,
           incident_id AS "incidentId",
           from_status AS "fromStatus",
           to_status AS "toStatus",
           changed_by_id AS "changedById",
           changed_by_name AS "changedByName",
           metadata,
           created_at AS "createdAt"
         FROM incident_status_history
         WHERE incident_id = $1
         ORDER BY created_at ASC`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/incidents",
    incidentMutationLimiter,
    requireAuth,
    requireRole("dispatcher", "responder"),
    async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const rawBody = req.body as Record<string, unknown> | undefined;
      if (
        rawBody &&
        ("createdById" in rawBody || "createdByName" in rawBody || "createdByRole" in rawBody)
      ) {
        res.status(400).json({ error: "Creator fields are server-managed and cannot be provided." });
        return;
      }
      const data = createIncidentSchema.parse(req.body);
      const user = req.authUser!;
      const {
        title,
        description,
        priority,
        category,
        location,
        details,
      } = data;
      const createdById = user.id;
      const createdByName = user.name ?? null;
      const createdByRole =
        user.role === "dispatcher" || user.role === "responder"
          ? (user.role as "dispatcher" | "responder")
          : null;

      if (createdByRole === "dispatcher") {
        const enabled = await getAdminSetting("allow_dispatcher_incident_creation");
        if (!enabled) {
          res.status(403).json({ error: "Dispatcher incident creation is disabled by admin." });
          return;
        }
      }
      if (createdByRole === "responder") {
        const enabled = await getAdminSetting("allow_responder_incident_creation");
        if (!enabled) {
          res.status(403).json({ error: "Responder incident creation is disabled by admin." });
          return;
        }
      }
      const nowMs = Date.now();
      const crimeId = randomUUID();
      const crimeType = String(category ?? "").trim() || "OTHER";
      const status: IncidentStatus = "NEW";
      const detailsJson = (details ?? null) as Record<string, unknown> | null;
      const descriptionText = [String(title ?? "").trim(), String(description ?? "").trim()]
        .filter(Boolean)
        .join(" - ")
        .slice(0, 4000);

      await query(
        `INSERT INTO crimes (
           crime_id, crime_time, description, status, priority,
           province, district, sector, cell, village,
           latitude, longitude,
           crime_type_l1, crime_type,
           created_user, createdat, updatedat, action_taken, resolved2, resolved,
           title, location_address, details, assigned_responder_id, assigned_responder_name,
           created_by_id, created_by_name, created_by_role
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12,
           $13, $14,
           $15, $16, $17, $18, $19, $20,
           $21, $22, $23, $24, $25, $26, $27, $28
         )`,
        [
          crimeId,
          nowMs,
          descriptionText,
          status,
          priority,
          null,
          null,
          null,
          null,
          null,
          location.lat,
          location.lon,
          crimeType,
          crimeType,
          createdByName ?? createdById,
          nowMs,
          nowMs,
          null,
          false,
          "false",
          title,
          location.address ?? null,
          detailsJson ?? null,
          null,
          null,
          createdById ?? null,
          createdByName ?? null,
          createdByRole ?? null,
        ]
      );

      // Legacy mirror table: keep best-effort only so `crimes` remains source of truth.
      // A mirror failure must NOT block incident creation in `crimes`.
      try {
        await query(
          `INSERT INTO incidents
             (id, title, description, status, priority, category, location_lat, location_lon, location_address,
              caller_phone, details, assigned_responder_id, assigned_responder_name, created_by_id, created_by_name, created_by_role)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (id) DO NOTHING`,
          [
            crimeId,
            title,
            description,
            status,
            priority,
            crimeType,
            location.lat,
            location.lon,
            location.address ?? null,
            null,
            detailsJson ?? null,
            null,
            null,
            createdById ?? null,
            createdByName ?? null,
            createdByRole ?? null,
          ]
        );
      } catch (mirrorErr) {
        console.warn("[incidents] non-blocking mirror insert failed:", (mirrorErr as Error)?.message ?? mirrorErr);
      }

      const incident: Incident = {
        id: crimeId,
        title,
        description,
        status,
        priority,
        category: crimeType,
        locationLat: location.lat,
        locationLon: location.lon,
        locationAddress: location.address ?? null,
        callerPhone: null,
        details: detailsJson,
        assignedResponderId: null,
        assignedResponderName: null,
        createdById: createdById ?? null,
        createdByName: createdByName ?? null,
        createdByRole: createdByRole ?? null,
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      };
      await logAudit({
        action: "incident:created",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        entityType: "incident",
        entityId: incident.id,
        details: { title: incident.title, status: incident.status },
      });

      // Notify dispatchers when a responder creates a new incident
      if (incident.createdByRole === "responder") {
        await notifyRole(io, "dispatcher", {
          type: "incident:new",
          title: "New incident reported by responder",
          body: incident.title,
          metadata: { incidentId: incident.id },
        });
      }
      io.emit("incident:created", { incidentId: incident.id, status: incident.status });
      io.emit("incident:statusChange", { incidentId: incident.id, status: incident.status });

      res.status(201).json(incident);
    } catch (err) {
      next(err);
    }
    }
  );

  router.patch(
    "/incidents/:id",
    incidentMutationLimiter,
    requireAuth,
    requireRole("dispatcher", "responder"),
    async (req, res, next) => {
    try {
      const rawBody = req.body as Record<string, unknown> | undefined;
      if (
        rawBody &&
        ("createdById" in rawBody || "createdByName" in rawBody || "createdByRole" in rawBody)
      ) {
        res.status(400).json({ error: "Creator fields are immutable and cannot be updated." });
        return;
      }
      if (rawBody && ("assignedResponderId" in rawBody || "assignedResponderName" in rawBody)) {
        res.status(400).json({
          error: "Assignment fields are managed by /incidents/:id/assign and /incidents/:id/reassign.",
        });
        return;
      }
      const updates = updateIncidentSchema.parse(req.body);
      const { id } = req.params;
      const user = req.authUser!;

      if (user.role === "responder") {
        // Responders may only update incidents assigned to them, and only limited fields.
        const { rows: incRows } = await query<{ assigned_responder_id: string | null }>(
          `SELECT assigned_responder_id FROM incidents WHERE id = $1`,
          [id]
        );
        if (!incRows[0] || incRows[0].assigned_responder_id !== user.id) {
          res.status(403).json({ error: "Only the assigned responder can edit this incident" });
          return;
        }
        // Responders may only add/update responder notes, not core incident fields.
        const allowed: any = {};
        if (updates.details !== undefined && typeof updates.details === "object") {
          const existing = (await query<{ details: any }>(`SELECT details FROM incidents WHERE id = $1`, [id])).rows[0]?.details ?? {};
          const responderNotes = (updates.details as any).responderNotes;
          allowed.details = { ...existing, responderNotes: responderNotes !== undefined ? responderNotes : existing?.responderNotes };
        }
        if (Object.keys(allowed).length === 0) {
          res.status(400).json({ error: "No editable fields provided" });
          return;
        }
        // Replace updates with allowed subset only.
        (Object as any).assign(updates, allowed);
        (updates as any).title = undefined;
        (updates as any).description = undefined;
        (updates as any).location = undefined;
        (updates as any).status = undefined;
        (updates as any).priority = undefined;
        (updates as any).category = undefined;
        (updates as any).callerPhone = undefined;
      }

      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (updates.title !== undefined) {
        fields.push(`title = $${idx++}`);
        values.push(updates.title);
      }
      if (updates.description !== undefined) {
        fields.push(`description = $${idx++}`);
        values.push(updates.description);
      }
      if (updates.status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(updates.status);
      }
      if (updates.priority !== undefined) {
        fields.push(`priority = $${idx++}`);
        values.push(updates.priority);
      }
      if (updates.category !== undefined) {
        fields.push(`category = $${idx++}`);
        values.push(updates.category);
      }
      if (updates.location) {
        if (updates.location.lat !== undefined) {
          fields.push(`location_lat = $${idx++}`);
          values.push(updates.location.lat);
        }
        if (updates.location.lon !== undefined) {
          fields.push(`location_lon = $${idx++}`);
          values.push(updates.location.lon);
        }
        if (updates.location.address !== undefined) {
          fields.push(`location_address = $${idx++}`);
          values.push(updates.location.address ?? null);
        }
      }
      if (updates.details !== undefined) {
        fields.push(`details = $${idx++}`);
        values.push(updates.details ?? null);
      }
      if (updates.callerPhone !== undefined) {
        fields.push(`caller_phone = $${idx++}`);
        values.push(updates.callerPhone?.trim() || null);
      }
      if (fields.length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }

      values.push(id);
      const setClause = fields.join(", ");

      const { rows } = await query<Incident>(
        `UPDATE incidents
         SET ${setClause}, updated_at = NOW()
         WHERE id = $${idx}
         RETURNING
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        values
      );

      if (!rows[0]) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      const incident = rows[0];
      await syncCrimeStatus(incident.id, incident.status);

      await logAudit({
        action: "incident:updated",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        entityType: "incident",
        entityId: id,
        details: updates,
      });

      if (user.role === "dispatcher" && incident.assignedResponderId) {
        io.to(`user:${incident.assignedResponderId}`).emit("incident:updated", incident);
      }

      res.json(incident);
    } catch (err) {
      next(err);
    }
    }
  );

  const updateStatusSchema = z.object({
    status: incidentStatusSchema,
  });

  router.patch("/incidents/:id/status", incidentMutationLimiter, requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser!;
      const rawStatus = (req.body as { status?: unknown } | undefined)?.status;
      if (rawStatus === "ASSIGNED") {
        res.status(400).json({ error: "Use /incidents/:id/assign to assign a responder." });
        return;
      }
      if (user.role !== "dispatcher") {
        if (user.role !== "responder") {
          return res.status(403).json({ error: "Forbidden" });
        }
        const { rows: incRows } = await query<{ assigned_responder_id: string | null }>(
          `SELECT assigned_responder_id FROM incidents WHERE id = $1`,
          [req.params.id]
        );
        if (!incRows[0] || incRows[0].assigned_responder_id !== user.id) {
          return res.status(403).json({ error: "Only the assigned responder or dispatcher can update status" });
        }
      }

      const parsed = updateStatusSchema.parse(req.body);
      const { id } = req.params;
      const { rows: detailRows } = await query<{ details: Record<string, unknown> | null; status: IncidentStatus }>(
        `SELECT details, status FROM incidents WHERE id = $1`,
        [id]
      );
      if (!detailRows[0]) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }
      const nowIso = new Date().toISOString();
      const timelinePatch: Partial<{
        assignedAt: string;
        completedAt: string;
        closedAt: string;
        inProgressAt: string;
      }> = {};
      if (parsed.status === "ASSIGNED") timelinePatch.assignedAt = nowIso;
      if (parsed.status === "RESOLVED") timelinePatch.completedAt = nowIso;
      if (parsed.status === "CLOSED") timelinePatch.closedAt = nowIso;
      if (parsed.status === "IN_PROGRESS" && detailRows[0].status !== "IN_PROGRESS") {
        timelinePatch.inProgressAt = nowIso;
      }
      const detailsWithTimeline =
        Object.keys(timelinePatch).length > 0 ? withTimeline(detailRows[0].details, timelinePatch) : detailRows[0].details;

      const { rows } = await query<Incident>(
        `UPDATE incidents
         SET status = $1, details = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [parsed.status, detailsWithTimeline ?? null, id]
      );

      if (!rows[0]) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: detailRows[0]?.status ?? null,
        toStatus: parsed.status,
        userId: req.authUser?.id,
        userName: req.authUser?.name,
      });
      await logAudit({
        action: "incident:status_updated",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        entityType: "incident",
        entityId: id,
        details: { status: parsed.status },
      });

      const incident = rows[0];
      await syncCrimeStatus(incident.id, incident.status);
      if (incident.assignedResponderId) {
        io.to(`user:${incident.assignedResponderId}`).emit("incident:updated", incident);
      }

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  const incidentRejectionSchema = z.object({
    reason: z.string().min(1),
  });

  router.post(
    "/incidents/:id/reject",
    incidentMutationLimiter,
    requireAuth,
    requireRole("dispatcher"),
    async (req, res, next) => {
    try {
      const { id } = req.params;
      const { reason } = incidentRejectionSchema.parse(req.body);

      const { rows: existingRows } = await query<Incident & { details: any; status: IncidentStatus }>(
        `SELECT id,
                title,
                details,
                status,
                created_by_id   AS "createdById",
                created_by_name AS "createdByName"
           FROM incidents
           WHERE id = $1`,
        [id]
      );

      const existing = existingRows[0];
      if (!existing) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      if (!existing.createdById) {
        res.status(400).json({ error: "Incident creator not set; cannot return incident" });
        return;
      }

      const mergedDetails = withTimeline(existing.details, {
        closedAt: new Date().toISOString(),
      });
      const updatedDetails = {
        ...mergedDetails,
        dispatcherDecision: {
          status: "rejected" as const,
          reason,
          rejectedAt: new Date().toISOString(),
        },
      };

      const { rows: updatedRows } = await query<Incident>(
        `UPDATE incidents
         SET details = $1,
             status = 'CLOSED',
             updated_at = NOW()
         WHERE id = $2
         RETURNING
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id           AS "createdById",
           created_by_name         AS "createdByName",
           created_by_role         AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [updatedDetails, id]
      );

      const incident = updatedRows[0];
      await syncCrimeStatus(incident.id, incident.status);

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: existing.status,
        toStatus: "CLOSED",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        metadata: { reason },
      });
      await logAudit({
        action: "incident:rejected",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        entityType: "incident",
        entityId: id,
        details: { reason },
      });

      await notifyUser(io, existing.createdById!, {
        type: "incident:rejected",
        title: "Incident rejected by dispatch",
        body: reason,
        metadata: { incidentId: incident.id, reason },
      });

      // Notify assigned responder so their UI updates immediately
      if (incident.assignedResponderId) {
        io.emit("incident:statusUpdate", { incidentId: incident.id, status: "CLOSED" });
        io.to(`user:${incident.assignedResponderId}`).emit("incident:updated", incident);
      }

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  // Responder accepts an assigned incident: ASSIGNED -> IN_PROGRESS
  router.post(
    "/incidents/:id/accept",
    incidentMutationLimiter,
    requireAuth,
    requireRole("responder"),
    async (req, res, next) => {
    try {
      const authUser = req.authUser!;
      const { id } = req.params;

      const { rows } = await query<Incident & { details: any }>(
        `SELECT
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id    AS "createdById",
           created_by_name  AS "createdByName",
           created_by_role  AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
         WHERE id = $1`,
        [id]
      );

      const existing = rows[0];
      if (!existing) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }
      if (existing.assignedResponderId !== authUser.id || existing.status !== "ASSIGNED") {
        res.status(403).json({ error: "Incident is not awaiting acceptance for you" });
        return;
      }

      const acceptIso = new Date().toISOString();
      const mergedDetails = withTimeline(
        {
          ...(existing.details ?? {}),
          responderDecision: {
            status: "accepted",
            acceptedAt: acceptIso,
          },
        },
        { inProgressAt: acceptIso }
      );

      const newStatus: IncidentStatus = "IN_PROGRESS";
      const { rows: updatedRows } = await query<Incident>(
        `UPDATE incidents
         SET status = $1,
             details = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id           AS "createdById",
           created_by_name         AS "createdByName",
           created_by_role         AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [newStatus, mergedDetails, id]
      );

      const incident = updatedRows[0];
      await syncCrimeStatus(incident.id, incident.status);

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: "ASSIGNED",
        toStatus: newStatus,
        userId: authUser.id,
        userName: authUser.name,
      });
      await logAudit({
        action: "incident:accepted",
        userId: authUser.id,
        userName: authUser.name,
        entityType: "incident",
        entityId: id,
        details: { status: newStatus },
      });

      if (incident.createdById) {
        await notifyUser(io, incident.createdById, {
          type: "incident:accepted",
          title: "Incident accepted",
          body: `Responder accepted: ${incident.title}`,
          metadata: { incidentId: incident.id },
        });
      }

      io.emit("incident:statusUpdate", { incidentId: incident.id, status: incident.status });
      io.emit("incident:statusChange", { incidentId: incident.id, status: incident.status });

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  const responderRejectSchema = z.object({
    reason: z.string().min(1).optional().default("Rejected by responder"),
  });

  // Responder rejects the request:
  // ASSIGNED -> NEW and unassign responder, and store the rejection decision.
  router.post(
    "/incidents/:id/reject-responder",
    incidentMutationLimiter,
    requireAuth,
    requireRole("responder"),
    async (req, res, next) => {
    try {
      const authUser = req.authUser!;
      const { id } = req.params;
      const { reason } = responderRejectSchema.parse(req.body ?? {});

      const { rows } = await query<Incident & { details: any }>(
        `SELECT
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id    AS "createdById",
           created_by_name  AS "createdByName",
           created_by_role  AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
         WHERE id = $1`,
        [id]
      );

      const existing = rows[0];
      if (!existing) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      if (existing.assignedResponderId !== authUser.id || existing.status !== "ASSIGNED") {
        res.status(403).json({ error: "Incident is not awaiting rejection for you" });
        return;
      }

      const mergedDetails = {
        ...(existing.details ?? {}),
        responderDecision: {
          status: "rejected",
          reason,
          rejectedAt: new Date().toISOString(),
        },
      };

      const newStatus: IncidentStatus = "NEW";
      const { rows: updatedRows } = await query<Incident>(
        `UPDATE incidents
         SET status = $1,
             assigned_responder_id = NULL,
             assigned_responder_name = NULL,
             details = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id           AS "createdById",
           created_by_name         AS "createdByName",
           created_by_role         AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [newStatus, mergedDetails, id]
      );

      const incident = updatedRows[0];
      await syncCrimeResponder(id, null, null);
      await syncCrimeStatus(incident.id, incident.status);

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: "ASSIGNED",
        toStatus: newStatus,
        userId: authUser.id,
        userName: authUser.name,
        metadata: { reason },
      });
      await logAudit({
        action: "incident:rejected_by_responder",
        userId: authUser.id,
        userName: authUser.name,
        entityType: "incident",
        entityId: id,
        details: { reason },
      });

      if (incident.createdById) {
        await notifyUser(io, incident.createdById, {
          type: "incident:rejected",
          title: "Incident rejected by responder",
          body: reason,
          metadata: { incidentId: incident.id, reason },
        });
      }

      io.emit("incident:statusUpdate", { incidentId: incident.id, status: incident.status });
      io.emit("incident:statusChange", { incidentId: incident.id, status: incident.status });
      io.to(`user:${authUser.id}`).emit("responder:nowAvailable");

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  const responderCompleteSchema = z.object({
    summary: z.string().min(1).optional(),
  });

  // Responder marks incident as completed: IN_PROGRESS -> RESOLVED
  router.post(
    "/incidents/:id/complete",
    incidentMutationLimiter,
    requireAuth,
    requireRole("responder"),
    async (req, res, next) => {
    try {
      const authUser = req.authUser!;
      const { id } = req.params;
      const { summary } = responderCompleteSchema.parse(req.body ?? {});

      const { rows } = await query<Incident & { details: any }>(
        `SELECT
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id    AS "createdById",
           created_by_name  AS "createdByName",
           created_by_role  AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
         WHERE id = $1`,
        [id]
      );

      const existing = rows[0];
      if (!existing) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      if (existing.assignedResponderId !== authUser.id) {
        res.status(403).json({ error: "Only the assigned responder can complete this incident" });
        return;
      }

      if (existing.status !== "IN_PROGRESS" && existing.status !== "RESOLVED") {
        res.status(400).json({ error: "Incident is not in a progress state" });
        return;
      }

      const mergedDetails = withTimeline(existing.details, {
        completedAt: new Date().toISOString(),
      });
      const updatedDetails = {
        ...mergedDetails,
        responderDecision: {
          ...(existing.details?.responderDecision ?? {}),
          status: "completed",
          completedAt: new Date().toISOString(),
          summary: summary?.trim() || undefined,
        },
      };

      const newStatus: IncidentStatus = "RESOLVED";
      const { rows: updatedRows } = await query<Incident>(
        `UPDATE incidents
         SET status = $1,
             details = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING
           id,
           title,
           description,
           status,
           priority,
           category,
           location_lat    AS "locationLat",
           location_lon    AS "locationLon",
           location_address AS "locationAddress",
           caller_phone    AS "callerPhone",
           details         AS "details",
           assigned_responder_id   AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id           AS "createdById",
           created_by_name         AS "createdByName",
           created_by_role         AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [newStatus, updatedDetails, id]
      );

      const incident = updatedRows[0];

      await syncCrimeStatus(id, newStatus);

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: existing.status,
        toStatus: newStatus,
        userId: authUser.id,
        userName: authUser.name,
        metadata: summary?.trim() ? { summary: summary.trim() } : undefined,
      });
      await logAudit({
        action: "incident:completed_by_responder",
        userId: authUser.id,
        userName: authUser.name,
        entityType: "incident",
        entityId: id,
        details: { summary: summary?.trim() || null },
      });

      io.emit("incident:statusUpdate", { incidentId: incident.id, status: incident.status });
      io.emit("incident:statusChange", { incidentId: incident.id, status: incident.status });
      if (incident.assignedResponderId) {
        io.to(`user:${incident.assignedResponderId}`).emit("responder:nowAvailable");
      }

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  function normalizeResponderUnit(unit: string | null | undefined): "EMS" | "TRAFFIC_POLICE" | "CRIME_POLICE" {
    const u = String(unit ?? "").trim();
    if (u === "CRIME_POLICE") return "CRIME_POLICE";
    if (u === "TRAFFIC_POLICE") return "TRAFFIC_POLICE";
    return "EMS";
  }

  function targetUnitForCategory(category: string): "EMS" | "TRAFFIC_POLICE" | "CRIME_POLICE" {
    const c = String(category ?? "").trim();
    if (c === "CRIME") return "CRIME_POLICE";
    if (c === "TRAFFIC") return "TRAFFIC_POLICE";
    return "EMS";
  }

  const assignSchema = z.object({
    responderId: z.string().uuid(),
    unitOverride: z.boolean().optional(),
    reason: z.string().min(3).optional(),
  });

  router.post(
    "/incidents/:id/assign",
    incidentAssignmentLimiter,
    requireAuth,
    requireRole("dispatcher"),
    async (req, res, next) => {
    try {
      const { responderId, unitOverride, reason } = assignSchema.parse(req.body);
      const { id } = req.params;

      const mirrored = await ensureIncidentMirrorFromCrime(id);
      if (!mirrored) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      const { rows: responders } = await query<User & { phone?: string | null; available?: boolean | null }>(
        `SELECT u.id, u.username, u.name, u.role, u.callsign, u.unit, u.phone,
                COALESCE(ra.available, FALSE) AS available
         FROM users u
         LEFT JOIN responder_availability ra ON ra.responder_id = u.id::text
         WHERE u.id = $1 AND u.role = 'responder'`,
        [responderId]
      );
      const responder = responders[0];
      if (!responder) {
        res.status(400).json({ error: "Responder not found" });
        return;
      }
      if (!responder.available) {
        res.status(400).json({ error: "Responder is not available" });
        return;
      }

      const incident = await withTransaction(async (client) => {
        // Lock incident row to prevent concurrent assignment (race condition)
        const incidentRes = await client.query<{
          status: IncidentStatus;
          assigned_responder_id: string | null;
          details: Record<string, unknown> | null;
          category: string;
        }>(
          `SELECT status, assigned_responder_id, details, category
           FROM incidents
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        const incidentRow = incidentRes.rows[0];
        if (!incidentRow) {
          throw new Error("INCIDENT_NOT_FOUND");
        }
        if (incidentRow.assigned_responder_id !== null || incidentRow.status !== "NEW") {
          throw new Error("INCIDENT_ALREADY_ASSIGNED");
        }

        // Enforce unit matching by incident category unless explicitly overridden.
        const targetUnit = targetUnitForCategory(incidentRow.category);
        const responderUnit = normalizeResponderUnit(responder.unit);
        const isUnitMismatch = responderUnit !== targetUnit;
        if (isUnitMismatch && !unitOverride) {
          throw new Error("UNIT_MISMATCH_NOT_ALLOWED");
        }
        if (isUnitMismatch && unitOverride && (!reason || reason.trim().length < 3)) {
          throw new Error("UNIT_OVERRIDE_REASON_REQUIRED");
        }
        if (isUnitMismatch && unitOverride) {
          const sameUnitAvailable = await client.query<{ id: string }>(
            `SELECT u.id
             FROM users u
             JOIN responder_availability ra ON ra.responder_id = u.id::text AND ra.available = TRUE
             WHERE u.role = 'responder'
               AND (
                 CASE
                   WHEN u.unit IN ('EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE') THEN u.unit
                   ELSE 'EMS'
                 END
               ) = $1
               AND NOT EXISTS (
                 SELECT 1 FROM incidents active
                 WHERE active.assigned_responder_id::text = u.id::text
                   AND active.status NOT IN ('RESOLVED', 'CLOSED')
               )
             LIMIT 1`,
            [targetUnit]
          );
          if (sameUnitAvailable.rows[0]) {
            throw new Error("TARGET_UNIT_RESPONDER_AVAILABLE");
          }
        }

        // Responder can only have one active incident
        const activeRes = await client.query<{ id: string }>(
          `SELECT id FROM incidents
           WHERE assigned_responder_id = $1 AND status NOT IN ('RESOLVED', 'CLOSED')
           LIMIT 1`,
          [responder.id]
        );
        if (activeRes.rows[0]) {
          throw new Error("RESPONDER_BUSY");
        }

        const assignedAt = new Date().toISOString();
        const detailsWithTimeline = withTimeline(incidentRow.details, {
          assignedAt,
        });
        const detailsWithAssignment = {
          ...detailsWithTimeline,
          dispatchAssignment: {
            targetUnit,
            assignedUnit: responderUnit,
            unitOverride: isUnitMismatch,
            overrideReason: isUnitMismatch ? reason?.trim() ?? null : null,
            originalUnitUnavailable: isUnitMismatch,
            assignedAt,
            assignedById: req.authUser?.id ?? null,
            assignedByName: req.authUser?.name ?? null,
          },
        };

        const updateRes = await client.query<Incident>(
          `UPDATE incidents
           SET assigned_responder_id = $1,
               assigned_responder_name = $2,
               status = 'ASSIGNED',
               details = $3,
               updated_at = NOW()
           WHERE id = $4
           RETURNING
             id,
             title,
             description,
             status,
             priority,
             category,
             location_lat    AS "locationLat",
             location_lon    AS "locationLon",
             location_address AS "locationAddress",
             caller_phone    AS "callerPhone",
             details         AS "details",
             assigned_responder_id   AS "assignedResponderId",
             assigned_responder_name AS "assignedResponderName",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [responder.id, responder.name, detailsWithAssignment, id]
        );
        return updateRes.rows[0];
      }).catch((err: Error) => {
        if (err.message === "INCIDENT_NOT_FOUND") {
          res.status(404).json({ error: "Incident not found" });
          return null;
        }
        if (err.message === "INCIDENT_ALREADY_ASSIGNED") {
          res.status(400).json({ error: "Incident cannot be assigned again or after it has been closed" });
          return null;
        }
        if (err.message === "RESPONDER_BUSY") {
          res.status(400).json({ error: "Responder already has an active incident" });
          return null;
        }
        if (err.message === "UNIT_MISMATCH_NOT_ALLOWED") {
          res.status(400).json({ error: "Unit mismatch not allowed for this incident type" });
          return null;
        }
        if (err.message === "UNIT_OVERRIDE_REASON_REQUIRED") {
          res.status(400).json({ error: "Override reason is required for cross-unit assignment" });
          return null;
        }
        if (err.message === "TARGET_UNIT_RESPONDER_AVAILABLE") {
          res.status(400).json({ error: "A responder from the incident unit is still available; assign that unit first." });
          return null;
        }
        throw err;
      });

      if (!incident) return;

      await syncCrimeResponder(id, responder.id, responder.name);
      await syncCrimeStatus(id, "ASSIGNED");

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: "NEW",
        toStatus: "ASSIGNED",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        metadata: { responderId: responder.id, responderName: responder.name },
      });
      if (isTwilioConfigured() && responder.phone) {
        const phone = String(responder.phone).replace(/\s/g, "");
        const fromNumber = (process.env.TWILIO_PHONE_NUMBER ?? "").replace(/\s/g, "");
        if (phone.length >= 10 && phone !== fromNumber) {
          try {
            await sendSms(
              phone,
              `CAD: New incident assigned - ${incident.title}. Status: ASSIGNED. Please respond.`
            );
          } catch (err) {
            console.error("[CAD] SMS notification failed:", err);
          }
        }
      }

      await logAudit({
        action: "incident:assigned",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        entityType: "incident",
        entityId: id,
        details: {
          responderId,
          responderName: responder.name,
          ...(unitOverride ? { unitOverride: true, reason: reason?.trim() ?? null } : {}),
        },
      });

      // Only emit to the assigned responder's socket room (responder-level access control)
      const assignedId = incident.assignedResponderId ?? null;
      if (assignedId) {
        io.to(`user:${assignedId}`).emit("incident:assigned", incident);
      }

      // Notify the assigned responder
      await notifyUser(io, responder.id, {
        type: "incident:assigned",
        title: "Incident assigned to you",
        body: incident.title,
        metadata: { incidentId: incident.id },
      });

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  const reassignSchema = z.object({
    responderId: z.string().uuid(),
    unitOverride: z.boolean().optional(),
    reason: z.string().optional(),
  });

  router.post(
    "/incidents/:id/reassign",
    incidentAssignmentLimiter,
    requireAuth,
    requireRole("dispatcher"),
    async (req, res, next) => {
    try {
      const { responderId, unitOverride, reason } = reassignSchema.parse(req.body);
      const { id } = req.params;

      const mirroredReassign = await ensureIncidentMirrorFromCrime(id);
      if (!mirroredReassign) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      const { rows: responders } = await query<User & { phone?: string | null; available?: boolean | null }>(
        `SELECT u.id, u.username, u.name, u.role, u.callsign, u.unit, u.phone,
                COALESCE(ra.available, FALSE) AS available
         FROM users u
         LEFT JOIN responder_availability ra ON ra.responder_id = u.id::text
         WHERE u.id = $1 AND u.role = 'responder'`,
        [responderId]
      );
      const responder = responders[0];
      if (!responder) {
        res.status(400).json({ error: "Responder not found" });
        return;
      }
      if (!responder.available) {
        res.status(400).json({ error: "Responder is not available" });
        return;
      }

      const incident = await withTransaction(async (client) => {
        const incidentRes = await client.query<{
          status: IncidentStatus;
          assigned_responder_id: string | null;
          details: Record<string, unknown> | null;
          category: string;
        }>(
          `SELECT status, assigned_responder_id, details, category
           FROM incidents
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );
        const incidentRow = incidentRes.rows[0];
        if (!incidentRow) {
          throw new Error("INCIDENT_NOT_FOUND");
        }
        if (incidentRow.assigned_responder_id === null) {
          throw new Error("INCIDENT_NOT_ASSIGNED");
        }
        if (incidentRow.status === "CLOSED" || incidentRow.status === "RESOLVED") {
          throw new Error("INCIDENT_ALREADY_COMPLETE");
        }
        if (incidentRow.assigned_responder_id === responder.id) {
          throw new Error("SAME_RESPONDER");
        }

        // Enforce unit matching by incident category unless explicitly overridden.
        const targetUnit = targetUnitForCategory(incidentRow.category);
        const responderUnit = normalizeResponderUnit(responder.unit);
        const isUnitMismatch = responderUnit !== targetUnit;
        if (isUnitMismatch && !unitOverride) {
          throw new Error("UNIT_MISMATCH_NOT_ALLOWED");
        }
        if (isUnitMismatch && unitOverride && (!reason || reason.trim().length < 3)) {
          throw new Error("UNIT_OVERRIDE_REASON_REQUIRED");
        }
        if (isUnitMismatch && unitOverride) {
          const sameUnitAvailable = await client.query<{ id: string }>(
            `SELECT u.id
             FROM users u
             JOIN responder_availability ra ON ra.responder_id = u.id::text AND ra.available = TRUE
             WHERE u.role = 'responder'
               AND u.id::text <> $2
               AND (
                 CASE
                   WHEN u.unit IN ('EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE') THEN u.unit
                   ELSE 'EMS'
                 END
               ) = $1
               AND NOT EXISTS (
                 SELECT 1 FROM incidents active
                 WHERE active.assigned_responder_id::text = u.id::text
                   AND active.status NOT IN ('RESOLVED', 'CLOSED')
                   AND active.id::text <> $3
               )
             LIMIT 1`,
            [targetUnit, responder.id, id]
          );
          if (sameUnitAvailable.rows[0]) {
            throw new Error("TARGET_UNIT_RESPONDER_AVAILABLE");
          }
        }

        const activeRes = await client.query<{ id: string }>(
          `SELECT id FROM incidents
           WHERE assigned_responder_id = $1 AND status NOT IN ('RESOLVED', 'CLOSED') AND id != $2
           LIMIT 1`,
          [responder.id, id]
        );
        if (activeRes.rows[0]) {
          throw new Error("RESPONDER_BUSY");
        }

        const assignedAt = new Date().toISOString();
        const detailsWithTimeline = withTimeline(incidentRow.details, {
          assignedAt,
        });
        const detailsWithAssignment = {
          ...detailsWithTimeline,
          dispatchAssignment: {
            targetUnit,
            assignedUnit: responderUnit,
            unitOverride: isUnitMismatch,
            overrideReason: isUnitMismatch ? reason?.trim() ?? null : null,
            originalUnitUnavailable: isUnitMismatch,
            assignedAt,
            assignedById: req.authUser?.id ?? null,
            assignedByName: req.authUser?.name ?? null,
            reassignedFrom: incidentRow.assigned_responder_id,
          },
        };

        const updateRes = await client.query<Incident>(
          `UPDATE incidents
           SET assigned_responder_id = $1,
               assigned_responder_name = $2,
               status = 'ASSIGNED',
               details = $3,
               updated_at = NOW()
           WHERE id = $4
           RETURNING
             id,
             title,
             description,
             status,
             priority,
             category,
             location_lat    AS "locationLat",
             location_lon    AS "locationLon",
             location_address AS "locationAddress",
             caller_phone    AS "callerPhone",
             details         AS "details",
             assigned_responder_id   AS "assignedResponderId",
             assigned_responder_name AS "assignedResponderName",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [responder.id, responder.name, detailsWithAssignment, id]
        );
        return { incident: updateRes.rows[0], previousResponderId: incidentRow.assigned_responder_id };
      }).catch((err: Error) => {
        if (err.message === "INCIDENT_NOT_FOUND") {
          res.status(404).json({ error: "Incident not found" });
          return null;
        }
        if (err.message === "INCIDENT_NOT_ASSIGNED") {
          res.status(400).json({ error: "Incident is not assigned; use assign instead" });
          return null;
        }
        if (err.message === "INCIDENT_ALREADY_COMPLETE") {
          res.status(400).json({ error: "Cannot reassign a resolved or closed incident" });
          return null;
        }
        if (err.message === "SAME_RESPONDER") {
          res.status(400).json({ error: "Incident is already assigned to this responder" });
          return null;
        }
        if (err.message === "RESPONDER_BUSY") {
          res.status(400).json({ error: "Responder already has an active incident" });
          return null;
        }
        if (err.message === "UNIT_MISMATCH_NOT_ALLOWED") {
          res.status(400).json({ error: "Unit mismatch not allowed for this incident type" });
          return null;
        }
        if (err.message === "UNIT_OVERRIDE_REASON_REQUIRED") {
          res.status(400).json({ error: "Override reason is required for cross-unit assignment" });
          return null;
        }
        if (err.message === "TARGET_UNIT_RESPONDER_AVAILABLE") {
          res.status(400).json({ error: "A responder from the incident unit is still available; assign that unit first." });
          return null;
        }
        throw err;
      });

      if (!incident) return;

      const { incident: updatedIncident, previousResponderId } = incident;
      await syncCrimeResponder(updatedIncident.id, responder.id, responder.name);
      await syncCrimeStatus(updatedIncident.id, updatedIncident.status);

      await logIncidentStatusChange({
        incidentId: id,
        fromStatus: "ASSIGNED",
        toStatus: "ASSIGNED",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        metadata: {
          reassignedFrom: previousResponderId,
          reassignedTo: responder.id,
          newResponderName: responder.name,
        },
      });

      if (isTwilioConfigured() && responder.phone) {
        const phone = String(responder.phone).replace(/\s/g, "");
        const fromNumber = (process.env.TWILIO_PHONE_NUMBER ?? "").replace(/\s/g, "");
        if (phone.length >= 10 && phone !== fromNumber) {
          try {
            await sendSms(
              phone,
              `CAD: Incident reassigned to you - ${updatedIncident.title}. Please respond.`
            );
          } catch (err) {
            console.error("[CAD] SMS notification failed:", err);
          }
        }
      }

      await logAudit({
        action: "incident:reassigned",
        userId: req.authUser?.id,
        userName: req.authUser?.name,
        entityType: "incident",
        entityId: id,
        details: {
          previousResponderId,
          newResponderId: responder.id,
          newResponderName: responder.name,
          reason: reason ?? null,
          ...(unitOverride ? { unitOverride: true } : {}),
        },
      });

      if (previousResponderId) {
        io.to(`user:${previousResponderId}`).emit("incident:unassigned", { incidentId: id });
        io.to(`user:${previousResponderId}`).emit("responder:nowAvailable");
      }
      io.to(`user:${responder.id}`).emit("incident:assigned", updatedIncident);
      await notifyUser(io, responder.id, {
        type: "incident:assigned",
        title: "Incident reassigned to you",
        body: updatedIncident.title,
        metadata: { incidentId: updatedIncident.id },
      });

      res.json(updatedIncident);
    } catch (err) {
      next(err);
    }
  });

  const responderUnits = ["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"] as const;

  // List all responders for dispatcher assignment. Optional ?unit= filter (EMS | TRAFFIC_POLICE | CRIME_POLICE).
  router.get("/responders", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      const unitParam = req.query.unit;
      const unitFilter =
        typeof unitParam === "string" && responderUnits.includes(unitParam as (typeof responderUnits)[number])
          ? (unitParam as (typeof responderUnits)[number])
          : null;

      const { rows } = await query<User & { available?: boolean | null }>(
        unitFilter
          ? `SELECT u.id, u.username, u.name, u.role, u.callsign, u.unit, u.phone,
                    COALESCE(ra.available, FALSE) AS available
             FROM users u
             LEFT JOIN responder_availability ra ON ra.responder_id = u.id::text
             WHERE u.role = 'responder' AND (u.unit = $1 OR (u.unit IS NULL AND $1 = 'EMS'))`
          : `SELECT u.id, u.username, u.name, u.role, u.callsign, u.unit, u.phone,
                    COALESCE(ra.available, FALSE) AS available
             FROM users u
             LEFT JOIN responder_availability ra ON ra.responder_id = u.id::text
             WHERE u.role = 'responder'`,
        unitFilter ? [unitFilter] : []
      );

      const responders = [...new Map(rows.map((u) => [u.id, u])).values()].map((u) => ({
        id: u.id,
        name: u.name,
        status: u.available ? ("AVAILABLE" as const) : ("OFF_DUTY" as const),
        unit: u.unit ?? "",
        phone: u.phone ?? undefined,
      }));

      res.json(responders);
    } catch (err) {
      next(err);
    }
  });
}

