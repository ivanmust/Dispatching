import type { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import type { Geofence } from "../types";

const circleSchema = z.object({
  type: z.literal("circle"),
  lat: z.number(),
  lon: z.number(),
  radiusMeters: z.number().positive(),
});

const createGeofenceSchema = z.object({
  name: z.string().min(1),
  type: z.string().default("zone"),
  geometry: circleSchema,
});

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function registerGeofenceRoutes(router: Router) {
  router.get("/geofences", requireAuth, requireRole("dispatcher", "responder"), async (_req, res, next) => {
    try {
      const { rows } = await query<Geofence>(
        `SELECT id, name, type, geometry, created_at AS "createdAt" FROM geofences ORDER BY name`
      );
      res.json(rows);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("geofences");
      if (isMissingTable) {
        res.json([]);
        return;
      }
      next(err);
    }
  });

  router.post("/geofences", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const data = createGeofenceSchema.parse(req.body);
      const { rows } = await query<Geofence>(
        `INSERT INTO geofences (name, type, geometry) VALUES ($1, $2, $3::jsonb)
         RETURNING id, name, type, geometry, created_at AS "createdAt"`,
        [data.name, data.type, JSON.stringify(data.geometry)]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("geofences");
      if (isMissingTable) {
        res.status(501).json({ error: "Geofences not enabled in this schema" });
        return;
      }
      next(err);
    }
  });

  router.delete("/geofences/:id", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const { id } = req.params;
      const { rows } = await query<{ id: string }>(`DELETE FROM geofences WHERE id = $1 RETURNING id`, [id]);
      if (!rows[0]) {
        res.status(404).json({ error: "Geofence not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("geofences");
      if (isMissingTable) {
        res.status(501).json({ error: "Geofences not enabled in this schema" });
        return;
      }
      next(err);
    }
  });
}

/**
 * Check which geofences contain the point (lat, lon). Returns id and name.
 * Supports circle geometry only.
 */
export async function getGeofencesContainingPoint(
  lat: number,
  lon: number
): Promise<{ id: string; name: string }[]> {
  let rows: { id: string; name: string; geometry: Record<string, unknown> }[] = [];
  try {
    const r = await query<{ id: string; name: string; geometry: Record<string, unknown> }>(
      `SELECT id, name, geometry FROM geofences`
    );
    rows = r.rows;
  } catch (err) {
    const e = err as any;
    const isMissingTable =
      e?.code === "42P01" ||
      (String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("geofences"));
    if (isMissingTable) return [];
    throw err;
  }
  const result: { id: string; name: string }[] = [];
  for (const row of rows) {
    const g = row.geometry;
    if (
      g &&
      typeof g === "object" &&
      (g as any).type === "circle" &&
      typeof (g as any).lat === "number" &&
      typeof (g as any).lon === "number" &&
      typeof (g as any).radiusMeters === "number"
    ) {
      const dist = haversineMeters(lat, lon, (g as any).lat, (g as any).lon);
      if (dist <= (g as any).radiusMeters) result.push({ id: row.id, name: row.name });
    }
  }
  return result;
}
