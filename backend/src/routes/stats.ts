import type { Router } from "express";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

type SummaryRow = {
  status: string;
  count: number;
};

type CategoryRow = {
  category: string | null;
  count: number;
};

type TimeseriesRow = {
  bucket: string;
  count: number;
};

export function registerStatsRoutes(router: Router) {
  // High-level summary for dispatcher dashboards
  router.get("/stats/summary", requireAuth, requireRole("dispatcher"), async (_req, res, next) => {
    try {
      const { rows: statusRows } = await query<SummaryRow>(
        `SELECT status::text AS status, COUNT(*)::int AS count
         FROM incidents
         GROUP BY status`
      );

      const { rows: categoryRows } = await query<CategoryRow>(
        `SELECT category, COUNT(*)::int AS count
         FROM incidents
         GROUP BY category`
      );

      const { rows: avgRows } = await query<{ avg_minutes: number | null }>(
        `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0)::float AS avg_minutes
         FROM incidents
         WHERE status IN ('RESOLVED', 'CLOSED')`
      );

      const { rows: unitRows } = await query<{ unit: string; count: number }>(
        `WITH effective_unit AS (
           SELECT i.id,
             CASE
               WHEN NULLIF(TRIM(u.unit), '') IN ('EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE')
               THEN NULLIF(TRIM(u.unit), '')
               ELSE 'EMS'
             END AS u
           FROM incidents i
           JOIN users u ON u.id = i.assigned_responder_id
           WHERE i.assigned_responder_id IS NOT NULL
         )
         SELECT COALESCE(u, 'EMS') AS unit, COUNT(*)::int AS count
         FROM effective_unit
         GROUP BY COALESCE(u, 'EMS')`
      );

      const { rows: unassignedRow } = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM incidents WHERE assigned_responder_id IS NULL`
      );

      const countsByStatus: Record<string, number> = {};
      statusRows.forEach((r) => {
        countsByStatus[r.status] = r.count;
      });

      const countsByCategory: Record<string, number> = {};
      categoryRows.forEach((r) => {
        if (r.category) countsByCategory[r.category] = r.count;
      });

      const countsByUnit: Record<string, number> = {
        EMS: 0,
        TRAFFIC_POLICE: 0,
        CRIME_POLICE: 0,
        Unassigned: unassignedRow[0]?.count ?? 0,
      };
      unitRows.forEach((r) => {
        if (['EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE'].includes(r.unit)) {
          countsByUnit[r.unit] = r.count;
        }
      });

      const avgResolutionMinutes = avgRows[0]?.avg_minutes ?? null;

      res.json({
        countsByStatus,
        countsByCategory,
        countsByUnit,
        avgResolutionMinutes,
      });
    } catch (err) {
      next(err);
    }
  });

  // Incidents created over time (for charts)
  router.get("/stats/timeseries", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const bucketParam = (req.query.bucket as string) || "day";
      const daysParam = Number(req.query.days) || 7;
      const bucket = bucketParam === "hour" ? "hour" : "day";
      const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

      const { rows } = await query<TimeseriesRow>(
        `SELECT
           to_char(date_trunc($1, created_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
           COUNT(*)::int AS count
         FROM incidents
         WHERE created_at >= NOW() - ($2::int || ' days')::interval
         GROUP BY date_trunc($1, created_at)
         ORDER BY date_trunc($1, created_at)`,
        [bucket, days]
      );

      res.json({
        bucket,
        points: rows,
      });
    } catch (err) {
      next(err);
    }
  });
}

