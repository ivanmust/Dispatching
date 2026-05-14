import type { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { requireAuth } from "../middleware/auth";

const listSchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

export function registerNotificationRoutes(router: Router) {
  router.get("/notifications", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser!.id;
      const { limit, offset } = listSchema.parse(req.query);
      const lim = limit ?? 100;
      const off = offset ?? 0;

      const { rows } = await query(
        `SELECT
           id,
           user_id AS "userId",
           type,
           title,
           body,
           metadata,
           is_read AS "isRead",
           created_at AS "createdAt"
         FROM notifications
         WHERE user_id = $1
           AND type <> 'dm:new'
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, lim, off]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get("/notifications/unread-count", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser!.id;
      const { rows } = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE user_id = $1
           AND is_read = FALSE
           AND type <> 'dm:new'`,
        [userId]
      );
      res.json({ count: rows[0]?.count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/notifications/:id/read", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser!.id;
      const id = req.params.id;
      await query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.patch("/notifications/read-all", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser!.id;
      await query(
        `UPDATE notifications
         SET is_read = TRUE
         WHERE user_id = $1 AND is_read = FALSE`,
        [userId]
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}

