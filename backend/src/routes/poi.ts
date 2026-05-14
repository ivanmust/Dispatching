import type { Router } from "express";
import { query } from "../db";
import { requireAuth, requirePermission } from "../middleware/auth";

export interface PointOfInterest {
  id: string;
  type: "AED" | "hydrant" | "first_aid";
  lat: number;
  lon: number;
  label: string | null;
}

export function registerPoiRoutes(router: Router) {
  router.get("/points-of-interest", requireAuth, requirePermission("poi:read"), async (_req, res, next) => {
    try {
      const { rows } = await query<PointOfInterest>(
        `SELECT id, type, lat, lon, label FROM points_of_interest ORDER BY type, label`
      );
      res.json(rows);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("points_of_interest");
      if (isMissingTable) {
        res.json([]);
        return;
      }
      next(err);
    }
  });
}
