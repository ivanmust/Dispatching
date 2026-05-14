import type { Router } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/auth";
import { getAdminSetting } from "../adminSettings";
import { query } from "../db";

export function registerLivekitRoutes(router: Router) {
  router.post("/livekit/token", requireAuth, async (req, res, next) => {
    try {
    const videoEnabled = await getAdminSetting("video_streaming_enabled");
    if (!videoEnabled) {
      res.status(403).json({ error: "Video streaming is disabled by admin." });
      return;
    }
    // Read env at request-time so changes in .env are picked up after restart
    // and we don't cache stale values from module initialization.
    const livekitApiKey = process.env.LIVEKIT_API_KEY?.trim();
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    const livekitUrl = (process.env.LIVEKIT_URL || process.env.LIVEKIT_HOST || "ws://localhost:7880").trim();

    if (!livekitApiKey || !livekitApiSecret) {
      res.status(503).json({ error: "LiveKit is not configured" });
      return;
    }

    const user = req.authUser!;
    const { incidentId } = (req.body ?? {}) as { incidentId?: string };

    if (!incidentId || typeof incidentId !== "string") {
      res.status(400).json({ error: "incidentId is required" });
      return;
    }

    const { rows: incidentRows } = await query<{
      id: string;
      assigned_responder_id: string | null;
      created_by_id: string | null;
      created_by_role: string | null;
    }>(
      `SELECT id, assigned_responder_id, created_by_id, created_by_role
       FROM incidents
       WHERE id = $1
       LIMIT 1`,
      [incidentId]
    );
    const incident = incidentRows[0];
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    const role = String(user.role ?? "").toLowerCase();
    const isDispatchSide = role === "dispatcher" || role === "operator" || role === "supervisor" || role === "admin";
    const isAssignedResponder = role === "responder" && incident.assigned_responder_id === user.id;
    const isSelfReportedUnassigned =
      role === "responder" &&
      String(incident.created_by_role ?? "").toLowerCase() === "responder" &&
      String(incident.created_by_id ?? "") === user.id &&
      !incident.assigned_responder_id;
    if (!isDispatchSide && !isAssignedResponder && !isSelfReportedUnassigned) {
      res.status(403).json({ error: "You are not allowed to access this incident video room" });
      return;
    }

    const roomName = `incident-${incidentId}`;
    const now = Math.floor(Date.now() / 1000);

    const payload: any = {
      iss: livekitApiKey,
      sub: user.id,
      nbf: now,
      exp: now + 60 * 60, // 1 hour
      name: user.name,
      video: {
        roomJoin: true,
        room: roomName,
        canPublish: user.role === "responder",
        canSubscribe: true,
      },
    };

    const token = jwt.sign(payload, livekitApiSecret);

    res.json({
      token,
      url: livekitUrl,
      roomName,
    });
    } catch (err) {
      next(err);
    }
  });
}

