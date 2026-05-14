import type { Router } from "express";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export function registerAuditRoutes(router: Router) {
  router.get("/audit", requireAuth, requireRole("dispatcher"), async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const action = typeof req.query.action === "string" ? req.query.action : null;

      let sql: string;
      let params: unknown[];
      if (action) {
        sql = `SELECT id, action, user_id AS "userId", user_name AS "userName",
                      entity_type AS "entityType", entity_id AS "entityId",
                      details, created_at AS "createdAt"
               FROM audit_logs WHERE action = $1
               ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
        params = [action, limit, offset];
      } else {
        sql = `SELECT id, action, user_id AS "userId", user_name AS "userName",
                      entity_type AS "entityType", entity_id AS "entityId",
                      details, created_at AS "createdAt"
               FROM audit_logs
               ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
        params = [limit, offset];
      }

      const { rows } = await query(sql, params);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });
}
