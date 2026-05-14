import type { Router } from "express";
import { query } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";

export function registerMediaRoutes(router: Router) {
  router.get("/media/attachments", requireAuth, requireRole("dispatcher"), async (_req, res, next) => {
    try {
      const { rows } = await query<{
        incidentId: string;
        incidentTitle: string;
        messageId: string;
        attachmentUrl: string;
        attachmentType: string | null;
        createdAt: Date;
      }>(
        `SELECT
           i.id AS "incidentId",
           i.title AS "incidentTitle",
           c.id AS "messageId",
           c.attachment_url AS "attachmentUrl",
           c.attachment_type AS "attachmentType",
           c.created_at AS "createdAt"
         FROM chat_messages c
         JOIN incidents i ON i.id = c.incident_id
         WHERE c.attachment_url IS NOT NULL AND c.attachment_url != ''
         ORDER BY c.created_at DESC`
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // Incident video recordings (media archive)
  router.get("/media/recordings", requireAuth, requireRole("dispatcher"), async (_req, res, next) => {
    try {
      const { rows } = await query<{
        id: string;
        incidentId: string;
        incidentTitle: string;
        fileUrl: string;
        status: string;
        startedAt: Date;
        endedAt: Date | null;
      }>(
        `SELECT
           r.id,
           r.incident_id AS "incidentId",
           i.title AS "incidentTitle",
           r.file_url AS "fileUrl",
           r.status,
           r.started_at AS "startedAt",
           r.ended_at AS "endedAt"
         FROM incident_recordings r
         JOIN incidents i ON i.id = r.incident_id
         ORDER BY r.started_at DESC`
      );
      res.json(rows);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_recordings");
      if (isMissingTable) {
        res.json([]);
        return;
      }
      next(err);
    }
  });

  router.get(
    "/incidents/:id/recordings",
    requireAuth,
    requireRole("dispatcher", "responder"),
    async (req, res, next) => {
      try {
        const incidentId = req.params.id;
        const user = req.authUser!;

        if (user.role === "responder") {
          const { rows: inc } = await query<{ assigned_responder_id: string | null }>(
            `SELECT assigned_responder_id FROM incidents WHERE id = $1`,
            [incidentId]
          );
          if (!inc[0]) return res.status(404).json({ error: "Incident not found" });
          if (inc[0].assigned_responder_id !== user.id) {
            return res.status(403).json({ error: "Only the assigned responder can view recordings" });
          }
        }

        const { rows } = await query<{
          id: string;
          fileUrl: string;
          status: string;
          startedAt: Date;
          endedAt: Date | null;
        }>(
          `SELECT
             id,
             file_url AS "fileUrl",
             status,
             started_at AS "startedAt",
             ended_at AS "endedAt"
           FROM incident_recordings
           WHERE incident_id = $1
           ORDER BY started_at DESC`,
          [incidentId]
        );
        res.json(rows);
      } catch (err) {
        const e = err as any;
        const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_recordings");
        if (isMissingTable) {
          res.json([]);
          return;
        }
        next(err);
      }
    }
  );
}
