import type { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../audit";
import { getGeofencesContainingPoint } from "./geofences";
import type { Incident, ChatMessage } from "../types";
import { distanceMetersHaversine } from "../lib/geo";
import { dedupeIncidentsByIdPreferNewest } from "../lib/incidentsDedupe";

const responderGeofenceIds = new Map<string, Set<string>>();

function encodePolyline(points: Array<{ lat: number; lon: number }>, precision = 5): string {
  const factor = 10 ** precision;
  let output = "";
  let prevLat = 0;
  let prevLon = 0;

  const encodeSigned = (num: number) => {
    let s = num < 0 ? ~(num << 1) : num << 1;
    while (s >= 0x20) {
      output += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    output += String.fromCharCode(s + 63);
  };

  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    encodeSigned(lat - prevLat);
    encodeSigned(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }

  return output;
}

export function registerResponderRoutes(router: Router, io: Server) {
  router.get("/responder/incidents", requireAuth, requireRole("responder"), async (req, res, next) => {
    try {
      const userId = req.authUser!.id;
      // Assignment and status updates run on `incidents`; `crimes` may lag. Responders must see their queue from `incidents`.
      const { rows } = await query<any>(
        `SELECT
           id::text AS id,
           title,
           description,
           status::text AS status,
           priority::text AS priority,
           category,
           location_lat AS "locationLat",
           location_lon AS "locationLon",
           location_address AS "locationAddress",
           caller_phone AS "callerPhone",
           details AS details,
           assigned_responder_id::text AS "assignedResponderId",
           assigned_responder_name AS "assignedResponderName",
           created_by_id AS "createdById",
           created_by_name AS "createdByName",
           created_by_role AS "createdByRole",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM incidents
         WHERE assigned_responder_id = $1
         ORDER BY updated_at DESC`,
        [userId]
      );
      const toIso = (v: unknown) =>
        v instanceof Date ? v.toISOString() : typeof v === "string" ? v : String(v ?? "");
      const normalized: Incident[] = rows.map((row: any) => ({
        ...row,
        id: String(row.id ?? "").trim(),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      }));
      res.json(dedupeIncidentsByIdPreferNewest(normalized));
    } catch (err) {
      next(err);
    }
  });

  router.get("/incidents/:id/messages", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const authUser = req.authUser!;
      if (authUser.role === "responder") {
        const { rows: inc } = await query<{
          assigned_responder_id: string | null;
          created_by_id: string | null;
          created_by_role: string | null;
        }>(`SELECT assigned_responder_id, created_by_id, created_by_role FROM incidents WHERE id = $1`, [id]);
        const canView =
          inc[0]?.assigned_responder_id === authUser.id ||
          (String(inc[0]?.created_by_id) === authUser.id &&
            inc[0]?.created_by_role === "responder" &&
            inc[0]?.assigned_responder_id == null);
        if (!inc[0] || !canView) {
          res.status(403).json({ error: "Only the assigned responder can view this incident's messages" });
          return;
        }
      }
      const { rows } = await query<ChatMessage>(
        `SELECT
           id,
           incident_id AS "incidentId",
           sender_id   AS "senderId",
           sender_name AS "senderName",
           sender_role AS "senderRole",
           content,
           attachment_url AS "attachmentUrl",
           attachment_type AS "attachmentType",
           created_at  AS "timestamp"
         FROM chat_messages
         WHERE incident_id = $1
         ORDER BY created_at ASC`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  const sendMessageSchema = z.object({
    content: z.string().optional().default(""),
    attachmentUrl: z.string().min(1).optional(),
    attachmentType: z.enum(["image", "video"]).optional(),
    role: z.enum(["dispatcher", "responder"]).optional(),
    senderId: z.string().optional(),
    senderName: z.string().optional(),
  }).refine(d => (d.content?.trim()?.length ?? 0) > 0 || (d.attachmentUrl && d.attachmentType), { message: "Message must have content or attachment" });

  router.post("/incidents/:id/messages", requireAuth, async (req, res, next) => {
    try {
      const parsed = sendMessageSchema.parse(req.body);
      const { id } = req.params;
      const authUser = req.authUser!;

      if (authUser.role === "responder") {
        const { rows: inc } = await query<{
          assigned_responder_id: string | null;
          created_by_id: string | null;
          created_by_role: string | null;
        }>(`SELECT assigned_responder_id, created_by_id, created_by_role FROM incidents WHERE id = $1`, [id]);
        const canSend =
          inc[0]?.assigned_responder_id === authUser.id ||
          (String(inc[0]?.created_by_id) === authUser.id &&
            inc[0]?.created_by_role === "responder" &&
            inc[0]?.assigned_responder_id == null);
        if (!inc[0] || !canSend) {
          res.status(403).json({ error: "Only the assigned responder can send messages to this incident" });
          return;
        }
      }
      let senderId = authUser.id;
      let senderName = authUser.name;
      const role = authUser.role as "dispatcher" | "responder";

      const content = (parsed.content ?? "").trim() || (parsed.attachmentUrl ? "[Attachment]" : "");
      const attachmentUrl = parsed.attachmentUrl ?? null;
      const attachmentType = parsed.attachmentType ?? null;

      const { rows } = await query<ChatMessage>(
        `INSERT INTO chat_messages
           (incident_id, sender_id, sender_name, sender_role, content, attachment_url, attachment_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id,
           incident_id AS "incidentId",
           sender_id   AS "senderId",
           sender_name AS "senderName",
           sender_role AS "senderRole",
           content,
           attachment_url AS "attachmentUrl",
           attachment_type AS "attachmentType",
           created_at  AS "timestamp"`,
        [id, senderId, senderName, role, content, attachmentUrl, attachmentType]
      );

      const msg = rows[0];
      await logAudit({
        action: "chat:message_sent",
        userId: authUser.id,
        userName: authUser.name,
        entityType: "incident",
        entityId: id,
        details: { messageId: msg.id },
      });

      const chatPayload = {
        id: msg.id,
        incidentId: id,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderRole: msg.senderRole,
        content: msg.content,
        text: msg.content,
        attachmentUrl: msg.attachmentUrl ?? undefined,
        attachmentType: msg.attachmentType ?? undefined,
        timestamp: msg.timestamp,
      };

      // Emit only to listeners scoped to this incident and to directly-related
      // users (assigned responder / creator) instead of broadcasting globally.
      io.to(`incident:${id}`).emit("chat:newMessage", chatPayload);
      const { rows: incidentAudience } = await query<{
        assigned_responder_id: string | null;
        created_by_id: string | null;
      }>(
        `SELECT assigned_responder_id, created_by_id
         FROM incidents
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      const assignedResponderId = incidentAudience[0]?.assigned_responder_id ?? null;
      const createdById = incidentAudience[0]?.created_by_id ?? null;
      if (assignedResponderId) io.to(`user:${assignedResponderId}`).emit("chat:newMessage", chatPayload);
      if (createdById) io.to(`user:${createdById}`).emit("chat:newMessage", chatPayload);
      io.to(`user:${authUser.id}`).emit("chat:newMessage", chatPayload);

      res.status(201).json(msg);
    } catch (err) {
      next(err);
    }
  });

  const locationSchema = z.object({
    lat: z.number(),
    lon: z.number(),
  });
  const navigationUpdateSchema = z.object({
    incidentId: z.string().uuid(),
    origin: z.object({ lat: z.number(), lon: z.number() }).optional(),
    path: z.array(z.object({ lat: z.number(), lon: z.number() })).optional().default([]),
    distanceMeters: z.number().nonnegative().optional(),
    etaMinutes: z.number().nonnegative().optional(),
    routeUnavailable: z.boolean().optional(),
    routingEngine: z.string().optional(),
  });

  // Suggested / closest responders. Routing/ETA was retired and will be
  // rebuilt on ArcGIS Enterprise; for now the dispatcher gets a haversine
  // ordering of fresh responder pings so suggestions still work.
  router.get("/responders/closest", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const limitRaw = Number(req.query.limit ?? 3);
      const limit = Math.max(1, Math.min(10, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 3));
      const unitParam = typeof req.query.unit === "string" ? req.query.unit : null;

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ error: "lat and lon query parameters are required numbers" });
        return;
      }

      // Candidates: available responders with a fresh location ping and (optionally)
      // a matching unit. Cross-unit override is handled by the assignment endpoint.
      const params: any[] = [];
      let whereUnit = "";
      if (unitParam && ["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"].includes(unitParam)) {
        params.push(unitParam);
        whereUnit = `AND u.unit = $${params.length}`;
      }
      const { rows: candidates } = await query<{
        id: string;
        name: string;
        unit: string | null;
        lat: number;
        lon: number;
        updatedAt: Date;
      }>(
        // NOTE: `responder_locations.responder_id` is a TEXT column in this deployment
        // (see schema.sql migration around line 307 that loosens it from UUID -> TEXT
        // so non-UUID identifiers are allowed for demo/seed data). `users.id` is UUID.
        // Casting both sides to TEXT works regardless of which variant the target DB
        // happens to have, and avoids the 42883 "text = uuid" operator error we hit
        // when casting only one side with `::uuid`.
        `SELECT u.id, u.name, u.unit,
                rl.lat, rl.lon, rl.updated_at AS "updatedAt"
           FROM users u
           JOIN responder_locations rl ON rl.responder_id::text = u.id::text
           JOIN responder_availability ra ON ra.responder_id = u.id::text
          WHERE u.role = 'responder'
            AND ra.available = TRUE
            AND rl.updated_at > NOW() - INTERVAL '15 minutes'
            ${whereUnit}`,
        params,
      );

      if (candidates.length === 0) {
        res.json({ engine: "none", results: [] });
        return;
      }

      const results = candidates
        .map((c) => ({
          responderId: c.id,
          name: c.name,
          unit: c.unit,
          distanceKm: Number((distanceMetersHaversine(lat, lon, c.lat, c.lon) / 1000).toFixed(3)),
          travelTimeMinutes: null as number | null,
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);

      res.json({ engine: "haversine", results });
    } catch (err) {
      next(err);
    }
  });

  router.post("/responder/location", requireAuth, requireRole("responder"), async (req, res, next) => {
    try {
      const { lat, lon } = locationSchema.parse(req.body);
      const effectiveResponderId = req.authUser!.id;

      await query(
        `INSERT INTO responder_locations (responder_id, lat, lon, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (responder_id)
         DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, updated_at = EXCLUDED.updated_at`,
        [effectiveResponderId, lat, lon]
      );
      io.emit("responder:location", { responderId: effectiveResponderId, lat, lon });

      const current = await getGeofencesContainingPoint(lat, lon);
      const currentIds = new Set(current.map((c) => c.id));
      const previous = responderGeofenceIds.get(effectiveResponderId) ?? new Set<string>();
      for (const { id, name } of current) {
        if (!previous.has(id)) {
          io.emit("geofence:entered", { responderId: effectiveResponderId, geofenceId: id, geofenceName: name, lat, lon });
        }
      }
      for (const id of previous) {
        if (!currentIds.has(id)) {
          io.emit("geofence:left", { responderId: effectiveResponderId, geofenceId: id, lat, lon });
        }
      }
      responderGeofenceIds.set(effectiveResponderId, currentIds);

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/responder/navigation-update", requireAuth, requireRole("responder"), async (req, res, next) => {
    try {
      const authUser = req.authUser!;
      const payload = navigationUpdateSchema.parse(req.body ?? {});

      const { rows: incidentRows } = await query<{
        id: string;
        status: string;
        assigned_responder_id: string | null;
      }>(
        `SELECT id, status, assigned_responder_id
         FROM incidents
         WHERE id = $1
         LIMIT 1`,
        [payload.incidentId],
      );

      const incident = incidentRows[0];
      if (!incident) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }
      if (incident.assigned_responder_id !== authUser.id) {
        res.status(403).json({ error: "Only assigned responder can publish navigation updates" });
        return;
      }
      if (String(incident.status) !== "IN_PROGRESS") {
        res.status(409).json({ error: "Incident is not in an active navigation state" });
        return;
      }

      const validPath = (payload.path ?? []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
      );
      const hasRoute = validPath.length >= 2 && !payload.routeUnavailable;
      const encodedRoute = hasRoute ? encodePolyline(validPath) : null;
      const distanceMeters = Math.max(0, Number(payload.distanceMeters ?? 0));
      const etaMinutes = Math.max(0, Number(payload.etaMinutes ?? 0));

      io.emit("incident:etaUpdate", {
        incidentId: payload.incidentId,
        eta_seconds: Math.round(etaMinutes * 60),
        eta_minutes: etaMinutes,
        distance_meters: distanceMeters,
        route: encodedRoute,
        alt_routes: [],
        alt_route_summaries: null,
        active_route_index: null,
        route_unavailable: !hasRoute,
        routing_engine: payload.routingEngine ?? "arcgis",
        responder_lat: payload.origin?.lat,
        responder_lon: payload.origin?.lon,
        updated_at: new Date().toISOString(),
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}

