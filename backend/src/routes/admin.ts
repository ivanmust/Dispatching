import type { Router } from "express";
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../db";
import { ensureCrimesOperationalColumns } from "../crimesSchema";
import { requireAdminAccess } from "../middleware/auth";
import { getOnlineUsers } from "../presence";
import { bumpAuthSessionVersion, getAdminSettings, setAdminSettings } from "../adminSettings";
import { logAudit } from "../audit";
import { ALL_PERMISSIONS, type Permission } from "../rbac";
import { getRolePermissions, setRolePermissions } from "../rolePermissions";
import { signAdminPortalToken, verifyAdminPortalCredentials } from "../adminPortalAuth";

const firstQueryValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const emptyToUndefined = (value: unknown) => {
  const normalized = firstQueryValue(value);
  if (typeof normalized !== "string") return normalized;
  const trimmed = normalized.trim();
  return trimmed === "" ? undefined : trimmed;
};

const emptyOrAllToUndefined = (value: unknown) => {
  const normalized = emptyToUndefined(value);
  if (typeof normalized !== "string") return normalized;
  return normalized.toLowerCase() === "all" ? undefined : normalized;
};

const trimmedRequiredString = (minLength = 1) =>
  z.preprocess(
    firstQueryValue,
    z.string().trim().min(minLength)
  );
const optionalTrimmedString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const optionalBoundedInt = (min: number, max?: number) =>
  z.preprocess((value) => {
    const normalized = emptyOrAllToUndefined(value);
    if (normalized === undefined) return undefined;
    if (typeof normalized === "number") return Number.isFinite(normalized) ? normalized : undefined;
    if (typeof normalized !== "string") return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, max === undefined ? z.number().int().min(min).optional() : z.number().int().min(min).max(max).optional());

/** Title / category search: only plain strings (ignore nested qs objects). */
const optionalStringQueryParam = z.preprocess((value) => {
  const normalized = firstQueryValue(value);
  if (normalized === undefined || normalized === null) return undefined;
  if (typeof normalized !== "string") return undefined;
  const trimmed = normalized.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().optional());

const updateSettingsSchema = z.object({
  allow_user_registration: z.boolean().optional(),
  messaging_enabled: z.boolean().optional(),
  video_streaming_enabled: z.boolean().optional(),
  allow_dispatcher_incident_creation: z.boolean().optional(),
  allow_responder_incident_creation: z.boolean().optional(),
  maintenance_mode_enabled: z.boolean().optional(),
});

const updateRolePermissionsSchema = z.object({
  role: z.enum(["dispatcher", "responder"]),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])),
});

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const adminUsersQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().optional()),
  role: z.preprocess(emptyOrAllToUndefined, z.enum(["dispatcher", "responder"]).optional()),
  status: z.preprocess(emptyOrAllToUndefined, z.enum(["active", "inactive"]).optional()),
  limit: optionalBoundedInt(1, 500),
  offset: optionalBoundedInt(0),
});

const adminAuditQuerySchema = z.object({
  action: z.preprocess(emptyToUndefined, z.string().optional()),
  limit: z.coerce.number().min(1).max(500).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const adminTrendQuerySchema = z.object({
  days: z.coerce.number().min(7).max(30).optional(),
});

const adminStatusHourlyQuerySchema = z.object({
  hours: z.coerce.number().min(1).max(720).optional(),
});

const adminStatusDurationQuerySchema = z.object({
  days: z.coerce.number().min(1).max(90).optional(),
});

const adminOverviewQuerySchema = z.object({
  statusMetrics: z.preprocess((value) => {
    const v = firstQueryValue(value);
    if (v === undefined || v === null || v === "") return false;
    const s = String(v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }, z.boolean()),
  statusHours: optionalBoundedInt(1, 720),
  statusDurationDays: optionalBoundedInt(1, 90),
});

const adminIncidentStatusPatchSchema = z.object({
  status: z.enum(["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
});

const adminIncidentListStatusSchema = z.enum(["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

const adminIncidentsQuerySchema = z.object({
  q: optionalStringQueryParam,
  status: z.preprocess((value) => {
    const v = emptyToUndefined(value);
    if (v === undefined) return undefined;
    return String(v).toUpperCase();
  }, adminIncidentListStatusSchema.optional()),
  priority: z.preprocess(
    emptyToUndefined,
    z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional()
  ),
  category: optionalStringQueryParam,
  /** Same safe int parsing as /admin/users (firstQueryValue); supports large pages for dashboards. */
  limit: optionalBoundedInt(1, 20_000),
  offset: optionalBoundedInt(0),
});

const adminUserStatusSchema = z.object({
  isActive: z.boolean(),
});

const adminBulkUserStatusSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(1000),
  isActive: z.boolean(),
});

const adminBulkUserRoleSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(1000),
    role: z.enum(["dispatcher", "responder"]),
    unit: z.enum(["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"]).optional().nullable(),
  })
  .refine((data) => (data.role === "responder" ? Boolean(data.unit) : true), {
    message: "Responder role requires a department unit.",
    path: ["unit"],
  });

const adminBulkResetPasswordSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(500),
});

const adminResetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers."),
});

const adminCreateUserSchema = z
  .object({
    username: trimmedRequiredString(3),
    password: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .min(8)
        .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers.")
        .optional()
    ),
    name: trimmedRequiredString(1),
    role: z.enum(["dispatcher", "responder"]),
    callsign: optionalTrimmedString,
    unit: z.preprocess(emptyToUndefined, z.enum(["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"]).optional()),
    phone: optionalTrimmedString,
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => (data.role === "responder" ? Boolean(data.unit) : true),
    { message: "Responders must select a department.", path: ["unit"] }
  );

const adminUpdateUserRoleSchema = z.object({
  role: z.enum(["dispatcher", "responder"]),
  unit: z.enum(["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"]).optional().nullable(),
});

type StatusMetricsSource = "history" | "crimes";

function mapHourlyRows(
  rows: Array<{ hour_start: Date; by_status: Record<string, number> | null }>
): Array<{ hour: string; byStatus: Record<string, number> }> {
  return rows.map((r) => ({
    hour: new Date(r.hour_start).toISOString(),
    byStatus: (r.by_status && typeof r.by_status === "object" ? r.by_status : {}) as Record<string, number>,
  }));
}

async function queryStatusHourlyFromHistory(rangeHours: number) {
  const { rows } = await query<{ hour_start: Date; by_status: Record<string, number> | null }>(
    `WITH hour_slots AS (
       SELECT generate_series(
         date_trunc('hour', NOW()) - ($1::int - 1) * INTERVAL '1 hour',
         date_trunc('hour', NOW()),
         INTERVAL '1 hour'
       ) AS hour_start
     ),
     counts AS (
       SELECT
         date_trunc('hour', created_at) AS hour_start,
         to_status,
         COUNT(*)::int AS cnt
       FROM incident_status_history
       WHERE created_at >= (SELECT MIN(hour_start) FROM hour_slots)
       GROUP BY 1, 2
     )
     SELECT
       hs.hour_start,
       COALESCE(
         json_object_agg(c.to_status, c.cnt) FILTER (WHERE c.to_status IS NOT NULL),
         '{}'::json
       ) AS by_status
     FROM hour_slots hs
     LEFT JOIN counts c ON c.hour_start = hs.hour_start
     GROUP BY hs.hour_start
     ORDER BY hs.hour_start ASC`,
    [rangeHours]
  );
  return mapHourlyRows(rows);
}

/** When audit log is empty for the window: creations → NEW, last updates → current status (approximate activity). */
async function queryStatusHourlyIncidentFallback(rangeHours: number) {
  const { rows } = await query<{ hour_start: Date; by_status: Record<string, number> | null }>(
    `WITH hour_slots AS (
       SELECT generate_series(
         date_trunc('hour', NOW()) - ($1::int - 1) * INTERVAL '1 hour',
         date_trunc('hour', NOW()),
         INTERVAL '1 hour'
       ) AS hour_start
     ),
     min_h AS (SELECT MIN(hour_start) AS mh FROM hour_slots),
     creations AS (
       SELECT date_trunc('hour', to_timestamp((COALESCE(i.createdat, i.updatedat, 0) / 1000.0))) AS hour_start, 'NEW'::text AS to_status, COUNT(*)::int AS cnt
       FROM crimes i, min_h
       WHERE to_timestamp((COALESCE(i.createdat, i.updatedat, 0) / 1000.0)) >= min_h.mh
       GROUP BY 1
     ),
     updates AS (
       SELECT date_trunc('hour', to_timestamp((COALESCE(i.updatedat, i.createdat, 0) / 1000.0))) AS hour_start, COALESCE(i.status, 'NEW')::text AS to_status, COUNT(*)::int AS cnt
       FROM crimes i, min_h
       WHERE to_timestamp((COALESCE(i.updatedat, i.createdat, 0) / 1000.0)) >= min_h.mh
       GROUP BY 1, 2
     ),
     combined AS (
       SELECT hour_start, to_status, SUM(cnt)::int AS cnt
       FROM (
         SELECT hour_start, to_status, cnt FROM creations
         UNION ALL
         SELECT hour_start, to_status, cnt FROM updates
       ) u
       GROUP BY hour_start, to_status
     )
     SELECT
       hs.hour_start,
       COALESCE(
         json_object_agg(c.to_status, c.cnt) FILTER (WHERE c.to_status IS NOT NULL),
         '{}'::json
       ) AS by_status
     FROM hour_slots hs
     LEFT JOIN combined c ON c.hour_start = hs.hour_start
     GROUP BY hs.hour_start
     ORDER BY hs.hour_start ASC`,
    [rangeHours]
  );
  return mapHourlyRows(rows);
}

async function queryStatusHourlySeries(
  rangeHours: number
): Promise<{
  points: Array<{ hour: string; byStatus: Record<string, number> }>;
  source: StatusMetricsSource;
}> {
  const { rows: cntRows } = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c
     FROM incident_status_history
     WHERE created_at >= date_trunc('hour', NOW()) - ($1::int - 1) * INTERVAL '1 hour'`,
    [rangeHours]
  );
  const historyCount = cntRows[0]?.c ?? 0;
  if (historyCount > 0) {
    const points = await queryStatusHourlyFromHistory(rangeHours);
    return { points, source: "history" };
  }
  const points = await queryStatusHourlyIncidentFallback(rangeHours);
  return { points, source: "crimes" };
}

async function queryStatusDurationFromHistory(rangeDays: number) {
  const { rows } = await query<{ from_status: string; avg_hours: number | null; sample_count: number }>(
    `WITH ordered AS (
       SELECT
         incident_id,
         from_status,
         created_at,
         LAG(created_at) OVER (PARTITION BY incident_id ORDER BY created_at) AS prev_at
       FROM incident_status_history
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
     )
     SELECT
       from_status,
       ROUND(AVG(EXTRACT(EPOCH FROM (created_at - prev_at)) / 3600.0)::numeric, 2)::float8 AS avg_hours,
       COUNT(*)::int AS sample_count
     FROM ordered
     WHERE prev_at IS NOT NULL
       AND from_status IS NOT NULL
     GROUP BY from_status
     ORDER BY from_status ASC`,
    [rangeDays]
  );
  return rows.map((r) => ({
    status: r.from_status,
    avgHours: r.avg_hours ?? 0,
    sampleCount: r.sample_count,
  }));
}

/** Mean hours from created_at → updated_at, grouped by current status (when audit log has no transitions in range). */
async function queryStatusDurationIncidentFallback(rangeDays: number) {
  const { rows } = await query<{ from_status: string; avg_hours: number | null; sample_count: number }>(
    `SELECT
       COALESCE(i.status, 'NEW')::text AS from_status,
       ROUND(
         AVG(
           GREATEST(
             (COALESCE(i.updatedat, i.createdat, 0) - COALESCE(i.createdat, i.updatedat, 0)) / 3600000.0,
             0
           )
         )::numeric,
         2
       )::float8 AS avg_hours,
       COUNT(*)::int AS sample_count
     FROM crimes i
     WHERE to_timestamp((COALESCE(i.updatedat, i.createdat, 0) / 1000.0)) >= NOW() - ($1::int * INTERVAL '1 day')
     GROUP BY COALESCE(i.status, 'NEW')
     ORDER BY COALESCE(i.status, 'NEW') ASC`,
    [rangeDays]
  );
  return rows.map((r) => ({
    status: r.from_status,
    avgHours: r.avg_hours ?? 0,
    sampleCount: r.sample_count,
  }));
}

async function queryStatusDurationAverages(
  rangeDays: number
): Promise<{
  statuses: Array<{ status: string; avgHours: number; sampleCount: number }>;
  source: StatusMetricsSource;
}> {
  const { rows: cntRows } = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c
     FROM incident_status_history
     WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    [rangeDays]
  );
  if ((cntRows[0]?.c ?? 0) > 0) {
    const statuses = await queryStatusDurationFromHistory(rangeDays);
    return { statuses, source: "history" };
  }
  const statuses = await queryStatusDurationIncidentFallback(rangeDays);
  return { statuses, source: "crimes" };
}

function getActor(req: Request) {
  return {
    actorId: req.adminPrincipal?.id ?? req.authUser?.id ?? "unknown",
    actorName: req.adminPrincipal?.name ?? req.authUser?.name ?? "Administrator",
  };
}

export function registerAdminRoutes(router: Router) {
  router.post("/admin/auth/login", async (req, res, next) => {
    try {
      const { username, password } = adminLoginSchema.parse(req.body);
      const ok = verifyAdminPortalCredentials(username, password);
      if (!ok) {
        res.status(401).json({ error: "Invalid admin credentials" });
        return;
      }
      const token = signAdminPortalToken("Administrator");
      res.json({
        token,
        user: {
          id: "admin-portal",
          username,
          name: "Administrator",
          role: "admin",
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/settings", requireAdminAccess(), async (_req, res, next) => {
    try {
      const settings = await getAdminSettings();
      res.json(settings);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/settings", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const patch = updateSettingsSchema.parse(req.body);
      await setAdminSettings(patch);
      const settings = await getAdminSettings();
      await logAudit({
        action: "admin:settings_updated",
        userId: actorId,
        userName: actorName,
        entityType: "admin_settings",
        entityId: "global",
        details: patch as Record<string, unknown>,
      });
      res.json(settings);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/overview", requireAdminAccess(), async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const overviewQuery = adminOverviewQuerySchema.safeParse(req.query);
      const wantStatusMetrics = overviewQuery.success && overviewQuery.data.statusMetrics;
      const statusHoursParam = overviewQuery.success ? overviewQuery.data.statusHours : undefined;
      const statusDurationDaysParam = overviewQuery.success ? overviewQuery.data.statusDurationDays : undefined;

      const settings = await getAdminSettings();

      const [
        usersCount,
        activeUsersCount,
        dispatcherCount,
        responderCount,
        incidentsActiveCount,
        incidentsClosedCount,
        avgResolutionMinutesRow,
        avgDispatchDelayMinutesRow,
        longOpenCountRow,
        closedLast7dRow,
      ] = await Promise.all([
        query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users`),
        query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users WHERE COALESCE(is_active, TRUE) = TRUE`),
        query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'dispatcher'`),
        query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'responder'`),
        query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM crimes
           WHERE COALESCE(status, 'NEW') NOT IN ('RESOLVED', 'CLOSED')`
        ),
        query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM crimes
           WHERE COALESCE(status, 'NEW') IN ('RESOLVED', 'CLOSED')`
        ),
        query<{ avg_minutes: number | null }>(
          `SELECT ROUND(
             AVG(
               GREATEST(
                 (COALESCE(updatedat, createdat, 0) - COALESCE(createdat, updatedat, 0)) / 60000.0,
                 0
               )
             )::numeric,
             1
           )::float8 AS avg_minutes
           FROM crimes
           WHERE COALESCE(status, 'NEW') IN ('RESOLVED', 'CLOSED')`
        ),
        query<{ avg_minutes: number | null }>(
          `SELECT 0::float8 AS avg_minutes`
        ),
        query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM crimes
           WHERE COALESCE(status, 'NEW') NOT IN ('RESOLVED', 'CLOSED')
             AND to_timestamp((COALESCE(createdat, updatedat, 0) / 1000.0)) <= NOW() - INTERVAL '60 minutes'`
        ),
        query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM crimes
           WHERE COALESCE(status, 'NEW') IN ('RESOLVED', 'CLOSED')
             AND to_timestamp((COALESCE(updatedat, createdat, 0) / 1000.0)) >= NOW() - INTERVAL '7 days'`
        ),
      ]);

      const online = getOnlineUsers();
      const { rows: onlineResponderRows } = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM users
         WHERE role = 'responder'
           AND id::text = ANY($1::text[])`,
        [Array.from(online)]
      );

      let statusHourly:
        | {
            hours: number;
            points: Array<{ hour: string; byStatus: Record<string, number> }>;
            source: StatusMetricsSource;
          }
        | undefined;
      let statusDurations:
        | {
            days: number;
            statuses: Array<{ status: string; avgHours: number; sampleCount: number }>;
            source: StatusMetricsSource;
          }
        | undefined;
      if (wantStatusMetrics) {
        const rangeHours = statusHoursParam ?? 168;
        const rangeDurationDays = statusDurationDaysParam ?? 30;
        const [hourlyResult, durationResult] = await Promise.all([
          queryStatusHourlySeries(rangeHours),
          queryStatusDurationAverages(rangeDurationDays),
        ]);
        statusHourly = {
          hours: rangeHours,
          points: hourlyResult.points,
          source: hourlyResult.source,
        };
        statusDurations = {
          days: rangeDurationDays,
          statuses: durationResult.statuses,
          source: durationResult.source,
        };
      }

      res.json({
        users: {
          total: usersCount.rows[0]?.count ?? 0,
          active: activeUsersCount.rows[0]?.count ?? 0,
          dispatchers: dispatcherCount.rows[0]?.count ?? 0,
          responders: responderCount.rows[0]?.count ?? 0,
          onlineTotal: online.size,
          onlineResponders: onlineResponderRows[0]?.count ?? 0,
        },
        incidents: {
          active: incidentsActiveCount.rows[0]?.count ?? 0,
          closed: incidentsClosedCount.rows[0]?.count ?? 0,
          closedLast7d: closedLast7dRow.rows[0]?.count ?? 0,
          avgResolutionMinutes: avgResolutionMinutesRow.rows[0]?.avg_minutes ?? 0,
          avgDispatchDelayMinutes: avgDispatchDelayMinutesRow.rows[0]?.avg_minutes ?? 0,
          openLongerThan60m: longOpenCountRow.rows[0]?.count ?? 0,
        },
        settings,
        ...(statusHourly ? { statusHourly } : {}),
        ...(statusDurations ? { statusDurations } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/overview/trends", requireAdminAccess(), async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const { days } = adminTrendQuerySchema.parse(req.query);
      const rangeDays = days ?? 7;
      const { rows } = await query<{
        day: string;
        incidents_created: number;
        incidents_closed: number;
        avg_resolution_minutes: number | null;
      }>(
        `WITH days AS (
           SELECT generate_series(
             date_trunc('day', NOW()) - ($1::int - 1) * INTERVAL '1 day',
             date_trunc('day', NOW()),
             INTERVAL '1 day'
           ) AS day
         ),
         created AS (
           SELECT date_trunc('day', to_timestamp((COALESCE(createdat, updatedat, 0) / 1000.0))) AS day, COUNT(*)::int AS incidents_created
           FROM crimes
           WHERE to_timestamp((COALESCE(createdat, updatedat, 0) / 1000.0)) >= date_trunc('day', NOW()) - ($1::int - 1) * INTERVAL '1 day'
           GROUP BY 1
         ),
         closed AS (
           SELECT
             date_trunc('day', to_timestamp((COALESCE(updatedat, createdat, 0) / 1000.0))) AS day,
             COUNT(*)::int AS incidents_closed,
             ROUND(
               AVG(
                 GREATEST(
                   (COALESCE(updatedat, createdat, 0) - COALESCE(createdat, updatedat, 0)) / 60000.0,
                   0
                 )
               )::numeric,
               1
             )::float8 AS avg_resolution_minutes
           FROM crimes
           WHERE COALESCE(status, 'NEW') IN ('RESOLVED', 'CLOSED')
             AND to_timestamp((COALESCE(updatedat, createdat, 0) / 1000.0)) >= date_trunc('day', NOW()) - ($1::int - 1) * INTERVAL '1 day'
           GROUP BY 1
         )
         SELECT
           to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(c.incidents_created, 0)::int AS incidents_created,
           COALESCE(cl.incidents_closed, 0)::int AS incidents_closed,
           cl.avg_resolution_minutes
         FROM days d
         LEFT JOIN created c ON c.day = d.day
         LEFT JOIN closed cl ON cl.day = d.day
         ORDER BY d.day ASC`,
        [rangeDays]
      );
      const points = rows.map((r) => {
        const closureRatePercent =
          r.incidents_created > 0 ? Math.round((r.incidents_closed / r.incidents_created) * 1000) / 10 : 0;
        return {
          day: r.day,
          incidentsCreated: r.incidents_created,
          incidentsClosed: r.incidents_closed,
          closureRatePercent,
          avgResolutionMinutes: r.avg_resolution_minutes ?? 0,
        };
      });
      res.json({ days: rangeDays, points });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/overview/status-hourly", requireAdminAccess(), async (req, res, next) => {
    try {
      const { hours } = adminStatusHourlyQuerySchema.parse(req.query);
      const rangeHours = hours ?? 168;
      const hourly = await queryStatusHourlySeries(rangeHours);
      res.json({ hours: rangeHours, points: hourly.points, source: hourly.source });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/overview/status-durations", requireAdminAccess(), async (req, res, next) => {
    try {
      const { days } = adminStatusDurationQuerySchema.parse(req.query);
      const rangeDays = days ?? 30;
      const dur = await queryStatusDurationAverages(rangeDays);
      res.json({ days: rangeDays, statuses: dur.statuses, source: dur.source });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/force-logout-all", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const sv = await bumpAuthSessionVersion();
      await logAudit({
        action: "admin:force_logout_all",
        userId: actorId,
        userName: actorName,
        entityType: "admin_sessions",
        entityId: "global",
        details: { authSessionVersion: sv },
      });
      res.status(200).json({ success: true, authSessionVersion: sv });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/permissions", requireAdminAccess(), async (_req, res, next) => {
    try {
      const [dispatcherPermissions, responderPermissions] = await Promise.all([
        getRolePermissions("dispatcher"),
        getRolePermissions("responder"),
      ]);
      res.json({
        availablePermissions: ALL_PERMISSIONS,
        matrix: {
          dispatcher: dispatcherPermissions,
          responder: responderPermissions,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/permissions", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { role, permissions } = updateRolePermissionsSchema.parse(req.body);
      await setRolePermissions(role, permissions);
      await logAudit({
        action: "admin:permissions_updated",
        userId: actorId,
        userName: actorName,
        entityType: "role_permissions",
        entityId: role,
        details: { permissions },
      });
      const updated = await getRolePermissions(role);
      res.json({ role, permissions: updated });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/users", requireAdminAccess(), async (req, res, next) => {
    try {
      const params = adminUsersQuerySchema.parse(req.query);
      const values: unknown[] = [];
      const where: string[] = [];
      if (params.q) {
        values.push(`%${params.q}%`);
        where.push(`(username ILIKE $${values.length} OR name ILIKE $${values.length} OR phone ILIKE $${values.length})`);
      }
      if (params.role) {
        values.push(params.role);
        where.push(`role = $${values.length}`);
      }
      if (params.status) {
        values.push(params.status === "active");
        where.push(`is_active = $${values.length}`);
      }
      const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
      values.push(params.limit ?? 100);
      const limIdx = values.length;
      values.push(params.offset ?? 0);
      const offIdx = values.length;
      const { rows: countRows } = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM users ${sqlWhere}`,
        values.slice(0, values.length - 2)
      );
      const { rows: pagedRows } = await query(
        `SELECT id, username, name, role, callsign, unit, phone, is_active AS "isActive", last_seen_at AS "lastSeenAt"
         FROM users
         ${sqlWhere}
         ORDER BY name ASC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        values
      );
      res.json({ items: pagedRows, total: countRows[0]?.count ?? 0, limit: params.limit ?? 100, offset: params.offset ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/users", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const data = adminCreateUserSchema.parse(req.body);
      const { rows: existing } = await query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [data.username]);
      if (existing[0]) {
        res.status(400).json({ error: "Username already exists" });
        return;
      }
      const password =
        data.password ??
        Math.random().toString(36).slice(2, 10) + Math.random().toString(10).slice(2, 4);
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (username, name, role, callsign, unit, phone, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))
         RETURNING id, username, name, role, callsign, unit, phone, is_active AS "isActive"`,
        [data.username, data.name, data.role, data.callsign ?? null, data.unit ?? null, data.phone ?? null, passwordHash, data.isActive ?? true]
      );
      await logAudit({
        action: "user:created",
        userId: actorId,
        userName: actorName,
        entityType: "user",
        entityId: rows[0].id,
        details: { role: rows[0].role, source: "admin_portal" },
      });
      res.status(201).json({ ...rows[0], temporaryPassword: data.password ? undefined : password });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/users/:id/role", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { id } = req.params;
      const { role, unit } = adminUpdateUserRoleSchema.parse(req.body);
      if (role === "responder" && !unit) {
        res.status(400).json({ error: "Responder role requires a department unit" });
        return;
      }
      const nextUnit = role === "responder" ? unit : null;
      const { rows } = await query(
        `UPDATE users
         SET role = $1, unit = $2
         WHERE id = $3
         RETURNING id, username, role, unit`,
        [role, nextUnit, id]
      );
      const user = rows[0];
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      await logAudit({
        action: "user:updated",
        userId: actorId,
        userName: actorName,
        entityType: "user",
        entityId: id,
        details: { role, unit: nextUnit, source: "admin_portal" },
      });
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/users/:id/status", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { id } = req.params;
      const { isActive } = adminUserStatusSchema.parse(req.body);
      const { rows } = await query<{ id: string; username: string; is_active: boolean }>(
        `UPDATE users
         SET is_active = $1
         WHERE id = $2
         RETURNING id, username, is_active`,
        [isActive, id]
      );
      const user = rows[0];
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      await logAudit({
        action: isActive ? "user:activated" : "user:deactivated",
        userId: actorId,
        userName: actorName,
        entityType: "user",
        entityId: id,
        details: { username: user.username, source: "admin_portal" },
      });
      res.json({ id: user.id, isActive: user.is_active });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/users/status/bulk", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { userIds, isActive } = adminBulkUserStatusSchema.parse(req.body);
      const { rows } = await query<{ id: string; username: string }>(
        `UPDATE users
         SET is_active = $1
         WHERE id::text = ANY($2::text[])
         RETURNING id, username`,
        [isActive, userIds]
      );
      await logAudit({
        action: isActive ? "user:activated" : "user:deactivated",
        userId: actorId,
        userName: actorName,
        entityType: "user_bulk",
        entityId: "many",
        details: {
          affectedCount: rows.length,
          source: "admin_portal",
          mode: "bulk",
        },
      });
      res.json({ updatedCount: rows.length, isActive });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/users/role/bulk", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { userIds, role, unit } = adminBulkUserRoleSchema.parse(req.body);
      const nextUnit = role === "responder" ? unit : null;
      const { rows } = await query<{ id: string; username: string }>(
        `UPDATE users
         SET role = $1, unit = $2
         WHERE id::text = ANY($3::text[])
         RETURNING id, username`,
        [role, nextUnit, userIds]
      );
      await logAudit({
        action: "user:updated",
        userId: actorId,
        userName: actorName,
        entityType: "user_bulk",
        entityId: "many",
        details: {
          affectedCount: rows.length,
          role,
          unit: nextUnit,
          source: "admin_portal",
          mode: "bulk",
        },
      });
      res.json({ updatedCount: rows.length, role, unit: nextUnit });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/users/:id/reset-password", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { id } = req.params;
      const { newPassword } = adminResetPasswordSchema.parse(req.body);
      const passwordHash = await bcrypt.hash(newPassword, 10);
      const { rows } = await query<{ id: string; username: string }>(
        `UPDATE users
         SET password_hash = $1
         WHERE id = $2
         RETURNING id, username`,
        [passwordHash, id]
      );
      const user = rows[0];
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      await logAudit({
        action: "user:password_reset",
        userId: actorId,
        userName: actorName,
        entityType: "user",
        entityId: id,
        details: { username: user.username, source: "admin_portal" },
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/users/reset-password/bulk", requireAdminAccess(), async (req, res, next) => {
    try {
      const { actorId, actorName } = getActor(req);
      const { userIds } = adminBulkResetPasswordSchema.parse(req.body);
      const { rows: users } = await query<{ id: string; username: string }>(
        `SELECT id, username
         FROM users
         WHERE id::text = ANY($1::text[])
         ORDER BY username ASC`,
        [userIds]
      );
      const passwordResults = await Promise.all(
        users.map(async (user) => {
          const temporaryPassword =
            Math.random().toString(36).slice(2, 10) + Math.random().toString(10).slice(2, 4);
          const passwordHash = await bcrypt.hash(temporaryPassword, 10);
          await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, user.id]);
          return { id: user.id, username: user.username, temporaryPassword };
        })
      );
      const authSessionVersion = await bumpAuthSessionVersion();
      await logAudit({
        action: "user:password_reset",
        userId: actorId,
        userName: actorName,
        entityType: "user_bulk",
        entityId: "many",
        details: {
          affectedCount: passwordResults.length,
          source: "admin_portal",
          mode: "bulk",
          authSessionVersion,
        },
      });
      res.json({ updatedCount: passwordResults.length, credentials: passwordResults, authSessionVersion });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/incidents", requireAdminAccess(), async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const params = adminIncidentsQuerySchema.parse(req.query);
      const values: unknown[] = [];
      const where: string[] = [];
      if (params.q) {
        values.push(`%${params.q}%`);
        where.push(`COALESCE(i.title, i.crime_type_l1, i.crime_type, 'Incident') ILIKE $${values.length}`);
      }
      if (params.status) {
        values.push(params.status);
        where.push(`COALESCE(i.status, 'NEW') = $${values.length}`);
      }
      if (params.priority) {
        values.push(params.priority);
        where.push(`COALESCE(i.priority, 'MEDIUM') = $${values.length}`);
      }
      if (params.category) {
        values.push(params.category);
        where.push(`COALESCE(i.crime_type_l1, i.crime_type, 'OTHER') = $${values.length}`);
      }
      const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const countValues = [...values];
      values.push(params.limit ?? 100);
      const limIdx = values.length;
      values.push(params.offset ?? 0);
      const offIdx = values.length;
      const { rows: totalRows } = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM crimes i ${sqlWhere}`,
        countValues
      );
      const { rows } = await query(
        `SELECT
           i.crime_id AS id,
           COALESCE(i.title, i.crime_type_l1, i.crime_type, 'Incident') AS title,
           COALESCE(i.status, 'NEW') AS status,
           COALESCE(i.priority, 'MEDIUM') AS priority,
           COALESCE(i.crime_type_l1, i.crime_type, 'OTHER') AS category,
           i.assigned_responder_name AS "assignedResponderName",
           to_timestamp((COALESCE(i.createdat, i.updatedat, 0) / 1000.0)) AS "createdAt",
           to_timestamp((COALESCE(i.updatedat, i.createdat, 0) / 1000.0)) AS "updatedAt",
           COALESCE(inv.details, i.details) AS "details"
         FROM crimes i
         LEFT JOIN incidents inv ON inv.id::text = i.crime_id::text
         ${sqlWhere}
         ORDER BY COALESCE(i.createdat, i.updatedat, 0) DESC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        values
      );
      res.json({ items: rows, total: totalRows[0]?.count ?? 0, limit: params.limit ?? 100, offset: params.offset ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/admin/incidents/:id", requireAdminAccess(), async (req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const { actorId, actorName } = getActor(req);
      const { id } = req.params;
      const { status } = adminIncidentStatusPatchSchema.parse(req.body);
      const nowMs = Date.now();
      const { rows } = await query(
        `UPDATE crimes
         SET status = $1,
             updatedat = $2,
             resolved = $3,
             resolved2 = $4
         WHERE crime_id = $5
         RETURNING
           crime_id AS id,
           COALESCE(title, crime_type_l1, crime_type, 'Incident') AS title,
           COALESCE(status, 'NEW') AS status,
           COALESCE(priority, 'MEDIUM') AS priority,
           assigned_responder_name AS "assignedResponderName",
           to_timestamp((COALESCE(updatedat, createdat, 0) / 1000.0)) AS "updatedAt"`,
        [status, nowMs, status === "RESOLVED" || status === "CLOSED" ? "true" : "false", status === "RESOLVED" || status === "CLOSED", id]
      );
      if (!rows[0]) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }
      await logAudit({
        action: "incident:status_updated",
        userId: actorId,
        userName: actorName,
        entityType: "incident",
        entityId: id,
        details: { status, source: "admin_portal" },
      });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/audit", requireAdminAccess(), async (req, res, next) => {
    try {
      const { action, limit, offset } = adminAuditQuerySchema.parse(req.query);
      const values: unknown[] = [];
      let where = "";
      if (action) {
        values.push(action);
        where = `WHERE action = $${values.length}`;
      }
      values.push(limit ?? 100);
      const limIdx = values.length;
      values.push(offset ?? 0);
      const offIdx = values.length;
      const { rows } = await query(
        `SELECT
           id,
           action,
           user_id AS "userId",
           user_name AS "userName",
           entity_type AS "entityType",
           entity_id AS "entityId",
           details,
           created_at AS "createdAt"
         FROM audit_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        values
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/stats/summary", requireAdminAccess(), async (_req, res, next) => {
    try {
      await ensureCrimesOperationalColumns();
      const [incidents, openIncidents, users, onlineUsers] = await Promise.all([
        query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM crimes`),
        query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM crimes WHERE COALESCE(status, 'NEW') NOT IN ('RESOLVED','CLOSED')`
        ),
        query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users`),
        Promise.resolve(getOnlineUsers().size),
      ]);
      res.json({
        incidentsTotal: incidents.rows[0]?.count ?? 0,
        incidentsOpen: openIncidents.rows[0]?.count ?? 0,
        usersTotal: users.rows[0]?.count ?? 0,
        onlineUsers,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/health", requireAdminAccess(), async (_req, res, next) => {
    try {
      await query(`SELECT 1`);
      res.json({ api: "ok", db: "connected" });
    } catch (err) {
      next(err);
    }
  });
}

