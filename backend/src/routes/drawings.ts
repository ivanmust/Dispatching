import type { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import type { IncidentDrawing } from "../types";

const geometrySchema = z.record(z.unknown());
const createDrawingSchema = z.object({
  type: z.enum(["point", "polyline", "polygon"]),
  geometry: geometrySchema,
  style: z.record(z.unknown()).optional(),
});

async function canAccessIncident(req: { authUser?: { id: string; role: string } }, incidentId: string): Promise<boolean> {
  const user = req.authUser!;
  if (user.role === "dispatcher") return true;
  if (user.role !== "responder") return false;
  const { rows } = await query<{ assigned_responder_id: string | null }>(
    `SELECT assigned_responder_id FROM incidents WHERE id = $1`,
    [incidentId]
  );
  return rows[0]?.assigned_responder_id === user.id;
}

export function registerDrawingRoutes(router: Router, io: Server) {
  router.get("/incidents/:id/drawings", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await canAccessIncident(req, id))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const { rows } = await query<IncidentDrawing>(
        `SELECT id, incident_id AS "incidentId", type, geometry, style, created_by_id AS "createdById", created_at AS "createdAt"
         FROM incident_drawings WHERE incident_id = $1 ORDER BY created_at`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_drawings");
      if (isMissingTable) {
        res.json([]);
        return;
      }
      next(err);
    }
  });

  router.post("/incidents/:id/drawings", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await canAccessIncident(req, id))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const data = createDrawingSchema.parse(req.body);
      const userId = req.authUser!.id;
      const { rows } = await query<IncidentDrawing>(
        `INSERT INTO incident_drawings (incident_id, type, geometry, style, created_by_id)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
         RETURNING id, incident_id AS "incidentId", type, geometry, style, created_by_id AS "createdById", created_at AS "createdAt"`,
        [id, data.type, JSON.stringify(data.geometry), data.style ? JSON.stringify(data.style) : null, userId]
      );
      const drawing = rows[0];
      io.to(`incident:${id}`).emit("drawing:created", drawing);
      res.status(201).json(drawing);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_drawings");
      if (isMissingTable) {
        res.status(501).json({ error: "Drawings not enabled in this schema" });
        return;
      }
      next(err);
    }
  });

  router.delete("/incidents/:incidentId/drawings/:drawingId", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      const { incidentId, drawingId } = req.params;
      if (!(await canAccessIncident(req, incidentId))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const { rows } = await query<{ id: string }>(
        `DELETE FROM incident_drawings WHERE id = $1 AND incident_id = $2 RETURNING id`,
        [drawingId, incidentId]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "Drawing not found" });
        return;
      }
      io.to(`incident:${incidentId}`).emit("drawing:deleted", { drawingId });
      res.status(204).end();
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_drawings");
      if (isMissingTable) {
        res.status(501).json({ error: "Drawings not enabled in this schema" });
        return;
      }
      next(err);
    }
  });
}
