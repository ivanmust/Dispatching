import type { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import type { Witness } from "../types";

const createWitnessSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
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

export function registerWitnessRoutes(router: Router) {
  router.get("/incidents/:id/witnesses", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await canAccessIncident(req, id))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const { rows } = await query<Witness>(
        `SELECT id, incident_id AS "incidentId", name, phone, email, notes, created_at AS "createdAt"
         FROM incident_witnesses WHERE incident_id = $1 ORDER BY created_at`,
        [id]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.post("/incidents/:id/witnesses", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!(await canAccessIncident(req, id))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const data = createWitnessSchema.parse(req.body);
      const { rows } = await query<Witness>(
        `INSERT INTO incident_witnesses (incident_id, name, phone, email, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, incident_id AS "incidentId", name, phone, email, notes, created_at AS "createdAt"`,
        [id, data.name, data.phone ?? null, data.email || null, data.notes ?? null]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/incidents/:incidentId/witnesses/:witnessId", requireAuth, requireRole("dispatcher", "responder"), async (req, res, next) => {
    try {
      const { incidentId, witnessId } = req.params;
      if (!(await canAccessIncident(req, incidentId))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const { rows } = await query<{ id: string }>(
        `DELETE FROM incident_witnesses WHERE id = $1 AND incident_id = $2 RETURNING id`,
        [witnessId, incidentId]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "Witness not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
