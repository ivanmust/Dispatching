import type { Server as HTTPServer } from "http"; 
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { query } from "./db";
import { logIncidentStatusChange } from "./incidentHistory";
import type { IncidentStatus } from "./types";
import { startRoomRecording, stopRoomRecording } from "./livekit";
import { setUserOnline, setUserOffline } from "./presence";
import { isCorsOriginAllowed } from "./corsOrigins";

export function createSocketServer(httpServer: HTTPServer) {
  const isProd = process.env.NODE_ENV === "production";
  const livekitRecordingEnabled =
    process.env.LIVEKIT_RECORDING_ENABLED === "true" || process.env.LIVEKIT_RECORDING_ENABLED === "1";
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isCorsOriginAllowed(origin, isProd)) return callback(null, true);
        return callback(new Error(`Socket.IO CORS blocked origin: ${origin}`));
      },
      methods: ["GET", "POST", "PATCH"],
      credentials: true,
    },
  });

  const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret";

  // Track generic user sockets for presence
  const userIdBySocket = new Map<string, string>(); // socketId -> userId

  // Track responder sockets so we can route video only to the
  // responder assigned to a given incident.
  const responderSocketById = new Map<string, string>(); // responderId -> socketId
  const responderIdBySocket = new Map<string, string>(); // socketId -> responderId

  // Video session tracking: incidentId -> { requesterSocketId, responderSocketId? }
  const videoSessions = new Map<string, { requesterSocketId: string; responderSocketId?: string }>();
  // LiveKit recording tracking: incidentId -> egressId
  const recordingByIncident = new Map<string, string>();
  const eventBuckets = new Map<string, { count: number; resetAt: number }>();
  const eventRateLimits: Record<string, { windowMs: number; max: number }> = {
    "dm:typing": { windowMs: 10_000, max: 20 },
    "responder:location": { windowMs: 10_000, max: 30 },
    "incident:updateStatus": { windowMs: 60_000, max: 20 },
    "video:request": { windowMs: 60_000, max: 10 },
    "video:accept": { windowMs: 60_000, max: 20 },
    "video:reject": { windowMs: 60_000, max: 20 },
    "video:end": { windowMs: 60_000, max: 20 },
  };

  const isEventRateLimited = (socketId: string, event: string): { limited: boolean; retryAfterMs: number } => {
    const limit = eventRateLimits[event];
    if (!limit) return { limited: false, retryAfterMs: 0 };
    const now = Date.now();
    const key = `${socketId}:${event}`;
    const bucket = eventBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      eventBuckets.set(key, { count: 1, resetAt: now + limit.windowMs });
      return { limited: false, retryAfterMs: 0 };
    }
    bucket.count += 1;
    if (bucket.count > limit.max) {
      return { limited: true, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }
    return { limited: false, retryAfterMs: 0 };
  };

  const getOtherParty = (incidentId: string, fromSocketId: string): string | null => {
    const s = videoSessions.get(incidentId);
    if (!s) return null;
    if (s.requesterSocketId === fromSocketId) return s.responderSocketId ?? null;
    if (s.responderSocketId === fromSocketId) return s.requesterSocketId;
    return null;
  };

  const cleanupSession = (incidentId: string) => {
    videoSessions.delete(incidentId);
  };

  const canJoinDmConversation = async (uid: string, conversationId: string): Promise<boolean> => {
    if (!uid || !conversationId) return false;
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM dm_participants
         WHERE conversation_id = $1 AND user_id = $2
       ) AS exists`,
      [conversationId, uid]
    );
    return !!rows[0]?.exists;
  };

  io.use(async (socket, next) => {
    try {
      const token =
        (typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null) ??
        (typeof socket.handshake.headers.authorization === "string"
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, "")
          : null);

      if (!token) {
        next(new Error("Unauthorized: missing socket token"));
        return;
      }

      const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string };
      const userId = String(decoded.sub ?? decoded.userId ?? "");
      if (!userId) {
        next(new Error("Unauthorized: invalid socket token"));
        return;
      }

      const { rows } = await query<{ id: string }>(
        `SELECT id
         FROM users
         WHERE id = $1 AND COALESCE(is_active, TRUE) = TRUE`,
        [userId]
      );

      if (!rows[0]) {
        next(new Error("Unauthorized: inactive or unknown user"));
        return;
      }

      socket.data.userId = userId;
      next();
    } catch {
      next(new Error("Unauthorized: invalid socket token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.data.userId ?? "");
    if (!userId) {
      socket.disconnect(true);
      return;
    }
    socket.join(`user:${userId}`);
    userIdBySocket.set(socket.id, userId);
    setUserOnline(userId);
    io.emit("user:presence", { userId, online: true, lastSeen: null });

    const getIncidentVideoAccess = async (incidentId: string) => {
      const { rows: incidentRows } = await query<{
        assigned_responder_id: string | null;
        created_by_id: string | null;
        created_by_role: string | null;
      }>(
        `SELECT assigned_responder_id, created_by_id, created_by_role
         FROM incidents
         WHERE id = $1
         LIMIT 1`,
        [incidentId]
      );
      const incident = incidentRows[0] ?? null;
      if (!incident) return { exists: false as const };

      const { rows: userRows } = await query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1`,
        [userId]
      );
      const role = String(userRows[0]?.role ?? "").toLowerCase();
      const isDispatchSide = role === "dispatcher" || role === "operator" || role === "supervisor" || role === "admin";
      const isAssignedResponder = role === "responder" && incident.assigned_responder_id === userId;
      const isSelfReportedUnassigned =
        role === "responder" &&
        String(incident.created_by_role ?? "").toLowerCase() === "responder" &&
        String(incident.created_by_id ?? "") === userId &&
        !incident.assigned_responder_id;

      return {
        exists: true as const,
        role,
        assignedResponderId: incident.assigned_responder_id,
        isDispatchSide,
        isAssignedResponder,
        isSelfReportedUnassigned,
      };
    };

    socket.on("dm:join", async (data: { conversationId: string }) => {
      if (!data?.conversationId) return;
      try {
        const allowed = await canJoinDmConversation(userId, data.conversationId);
        if (!allowed) {
          socket.emit("dm:error", { code: "FORBIDDEN", message: "Not allowed to join this conversation" });
          return;
        }
        socket.join(`dm:${data.conversationId}`);
      } catch {
        socket.emit("dm:error", { code: "INTERNAL_ERROR", message: "Unable to join conversation right now" });
      }
    });

    socket.on("dm:leave", (data: { conversationId: string }) => {
      if (data?.conversationId) {
        socket.leave(`dm:${data.conversationId}`);
      }
    });

    // Typing indicators for DM conversations (WhatsApp-like "X is typing…")
    socket.on("dm:typing", async (data: { conversationId: string; isTyping: boolean }) => {
      const throttled = isEventRateLimited(socket.id, "dm:typing");
      if (throttled.limited) return;
      const userId = userIdBySocket.get(socket.id);
      if (!data?.conversationId || !userId) return;
      const allowed = await canJoinDmConversation(userId, data.conversationId).catch(() => false);
      if (!allowed) return;
      io.to(`dm:${data.conversationId}`).emit("dm:typing", {
        conversationId: data.conversationId,
        userId,
        isTyping: !!data.isTyping,
      });
    });
    // Responder sends location updates (use authenticated userId, never client-supplied responderId).
    // Routing/ETA push was retired pending the ArcGIS Enterprise rebuild, so this
    // handler now just persists the latest ping and broadcasts it to the dispatcher map.
    socket.on(
      "responder:location",
      async (data: { responderId?: string; lat: number; lon: number }) => {
      try {
        const throttled = isEventRateLimited(socket.id, "responder:location");
        if (throttled.limited) return;
        const effectiveResponderId = userId;
        const { rows } = await query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1`,
          [effectiveResponderId]
        );
        if (!rows[0] || rows[0].role !== "responder") {
          return; // Silently ignore; only responders may report location
        }
        const lat = Number(data?.lat);
        const lon = Number(data?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        await query(
          `INSERT INTO responder_locations (responder_id, lat, lon, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (responder_id)
           DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, updated_at = EXCLUDED.updated_at`,
          [effectiveResponderId, lat, lon]
        );
        io.emit("responder:location", { responderId: effectiveResponderId, lat, lon });
      } catch (err) {
        console.error("Error saving responder location", err);
      }
    });

    // Responder availability (use authenticated userId, never client-supplied responderId)
    socket.on("responder:availability", async (data: { responderId?: string; available: boolean }) => {
      try {
        const effectiveResponderId = userId;
        const { rows } = await query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1`,
          [effectiveResponderId]
        );
        if (!rows[0] || rows[0].role !== "responder") {
          return; // Silently ignore; only responders may set availability
        }
        const available = !!data?.available;

        await query(
          `INSERT INTO responder_availability (responder_id, available, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (responder_id)
           DO UPDATE SET available = EXCLUDED.available, updated_at = EXCLUDED.updated_at`,
          [effectiveResponderId, available]
        );

        if (available) {
          responderSocketById.set(effectiveResponderId, socket.id);
          responderIdBySocket.set(socket.id, effectiveResponderId);
          socket.join(`responder:${effectiveResponderId}`);
        } else {
          socket.leave(`responder:${effectiveResponderId}`);
          const current = responderSocketById.get(effectiveResponderId);
          if (current === socket.id) {
            responderSocketById.delete(effectiveResponderId);
          }
          responderIdBySocket.delete(socket.id);
        }

        io.emit("responder:availability", { responderId: effectiveResponderId, available });
      } catch (err) {
        console.error("Error handling responder:availability", err);
      }
    });

    // Subscribe to incident room for real-time drawings/chat with access control.
    socket.on("incident:subscribe", async (data: { incidentId: string }) => {
      const incidentId = String(data?.incidentId ?? "").trim();
      if (!incidentId) return;
      try {
        const access = await getIncidentVideoAccess(incidentId);
        if (!access.exists || !(access.isDispatchSide || access.isAssignedResponder || access.isSelfReportedUnassigned)) {
          socket.emit("incident:subscribe:error", { incidentId, error: "Forbidden" });
          return;
        }
        socket.join(`incident:${incidentId}`);
      } catch (err) {
        console.error("Error subscribing to incident room", err);
        socket.emit("incident:subscribe:error", { incidentId, error: "Unable to subscribe" });
      }
    });
    socket.on("incident:unsubscribe", (data: { incidentId: string }) => {
      if (data?.incidentId) socket.leave(`incident:${data.incidentId}`);
    });

    // Responder or dispatcher updates incident status (authorization required)
    socket.on("incident:updateStatus", async (data: { incidentId: string; status: IncidentStatus }) => {
      try {
        const throttled = isEventRateLimited(socket.id, "incident:updateStatus");
        if (throttled.limited) {
          socket.emit("incident:updateStatus:error", {
            incidentId: data?.incidentId,
            error: "Too many status updates. Please wait and retry.",
          });
          return;
        }
        const incidentId = data?.incidentId;
        const status = data?.status;
        const validStatuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
        if (!incidentId || !status || !validStatuses.includes(status)) {
          socket.emit("incident:updateStatus:error", { incidentId, error: "Invalid payload" });
          return;
        }

        const { rows: userRows } = await query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1`,
          [userId]
        );
        const userRole = userRows[0]?.role;

        const { rows } = await query<{ assigned_responder_id: string | null; status: IncidentStatus }>(
          `SELECT assigned_responder_id, status FROM incidents WHERE id = $1`,
          [incidentId]
        );
        const assignedResponderId = rows[0]?.assigned_responder_id ?? null;
        const fromStatus = rows[0]?.status ?? null;

        // Only assigned responder or dispatcher may update status
        const isAssignedResponder = assignedResponderId === userId;
        const isDispatcher = userRole === "dispatcher";
        if (!isAssignedResponder && !isDispatcher) {
          socket.emit("incident:updateStatus:error", { incidentId, error: "Forbidden" });
          return;
        }

        const { rows: updated } = await query<{ id: string }>(
          `UPDATE incidents SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
          [status, incidentId]
        );
        if (!updated.length) {
          socket.emit("incident:updateStatus:error", { incidentId, error: "Incident not found" });
          return;
        }

        await logIncidentStatusChange({
          incidentId,
          fromStatus,
          toStatus: status,
          userId,
          userName: null,
        });
        io.emit("incident:statusUpdate", { incidentId, status });
        io.emit("incident:statusChange", { incidentId, status });
        if ((status === "RESOLVED" || status === "CLOSED") && assignedResponderId) {
          io.to(`user:${assignedResponderId}`).emit("responder:nowAvailable");
        }
      } catch (err) {
        console.error("Error updating status from socket", err);
        socket.emit("incident:updateStatus:error", {
          incidentId: data?.incidentId,
          error: "Internal error",
        });
      }
    });

    // Dispatcher requests live video for an incident
    socket.on("video:request", async (data: { incidentId: string; incidentTitle?: string }) => {
      try {
        const throttled = isEventRateLimited(socket.id, "video:request");
        if (throttled.limited) {
          socket.emit("video:error", {
            incidentId: data?.incidentId,
            code: "RATE_LIMITED",
            message: "Too many video requests. Please wait and retry.",
          });
          return;
        }
        const incidentId = String(data?.incidentId ?? "");
        if (!incidentId) {
          socket.emit("video:error", {
            incidentId,
            code: "INVALID_PAYLOAD",
            message: "incidentId is required.",
          });
          return;
        }
        const access = await getIncidentVideoAccess(incidentId);
        if (!access.exists) {
          socket.emit("video:error", {
            incidentId,
            code: "INCIDENT_NOT_FOUND",
            message: "Incident not found.",
          });
          return;
        }
        if (!access.isDispatchSide) {
          socket.emit("video:error", {
            incidentId,
            code: "FORBIDDEN",
            message: "Only dispatch-side roles can request live video.",
          });
          return;
        }

        // Look up the incident and its assigned responder
        const result = await query(
          `SELECT assigned_responder_id FROM incidents WHERE id = $1`,
          [incidentId]
        );

        if (result.rows.length === 0) {
          socket.emit("video:error", {
            incidentId,
            code: "INCIDENT_NOT_FOUND",
            message: "Incident not found.",
          });
          return;
        }

        const assignedResponderId: string | null = result.rows[0].assigned_responder_id;

        if (!assignedResponderId) {
          socket.emit("video:error", {
            incidentId,
            code: "NO_RESPONDER_ASSIGNED",
            message: "No responder is assigned to this incident.",
          });
          return;
        }

        const responderSocketId = responderSocketById.get(assignedResponderId);
        if (!responderSocketId) {
          socket.emit("video:error", {
            incidentId,
            code: "RESPONDER_OFFLINE",
            message: "Assigned responder is offline or unavailable.",
          });
          return;
        }

        // Create a video session tying this dispatcher socket to the assigned responder's socket
        videoSessions.set(incidentId, {
          requesterSocketId: socket.id,
          responderSocketId,
        });

        io.to(responderSocketId).emit("video:requested", {
          incidentId,
          incidentTitle: data.incidentTitle ?? "Incident",
        });
      } catch (err) {
        console.error("Error handling video:request", err);
        socket.emit("video:error", {
          incidentId: data?.incidentId,
          code: "INTERNAL_ERROR",
          message: "Unable to start video stream.",
        });
      }
    });

    // Responder rejects the request
    socket.on("video:reject", async (data: { incidentId: string }) => {
      const throttled = isEventRateLimited(socket.id, "video:reject");
      if (throttled.limited) {
        socket.emit("video:error", { incidentId: data?.incidentId, code: "RATE_LIMITED", message: "Please wait and retry." });
        return;
      }
      const incidentId = String(data?.incidentId ?? "");
      if (!incidentId) return;
      const access = await getIncidentVideoAccess(incidentId).catch(() => ({ exists: false as const }));
      if (!("exists" in access) || !access.exists || !access.isAssignedResponder) {
        socket.emit("video:error", { incidentId, code: "FORBIDDEN", message: "Only assigned responder can reject." });
        return;
      }
      const s = videoSessions.get(incidentId);
      if (!s || s.responderSocketId !== socket.id) return;
      if (s.requesterSocketId) {
        io.to(s.requesterSocketId).emit("video:rejected", { incidentId });
      }
      cleanupSession(incidentId);
    });

    // Responder accepts and will start streaming (camera activates, creates offer)
    socket.on("video:accept", async (data: { incidentId: string }) => {
      const throttled = isEventRateLimited(socket.id, "video:accept");
      if (throttled.limited) {
        socket.emit("video:error", { incidentId: data?.incidentId, code: "RATE_LIMITED", message: "Please wait and retry." });
        return;
      }
      const incidentId = String(data?.incidentId ?? "");
      if (!incidentId) return;
      const access = await getIncidentVideoAccess(incidentId).catch(() => ({ exists: false as const }));
      if (!("exists" in access) || !access.exists || !access.isAssignedResponder) {
        socket.emit("video:error", { incidentId, code: "FORBIDDEN", message: "Only assigned responder can accept." });
        return;
      }
      const s = videoSessions.get(incidentId);
      if (!s || s.responderSocketId !== socket.id) {
        socket.emit("video:error", { incidentId, code: "NO_ACTIVE_REQUEST", message: "No active video request for this incident." });
        return;
      }
      if (s?.requesterSocketId) {
        videoSessions.set(incidentId, { ...s, responderSocketId: socket.id });
        io.to(s.requesterSocketId).emit("video:accepted", { incidentId });
      }

      // Start LiveKit composite recording only when explicitly enabled.
      // (Current video flow is direct P2P WebRTC, so LiveKit rooms usually do not exist.)
      if (livekitRecordingEnabled) {
        try {
          const result = await startRoomRecording(incidentId);
          if (result?.egressId) {
            recordingByIncident.set(incidentId, result.egressId);
            // Store recording metadata for media archive playback
            try {
              await query(
                `INSERT INTO incident_recordings (incident_id, egress_id, file_url, file_path, status)
                 VALUES ($1, $2, $3, $4, 'RECORDING')`,
                [incidentId, result.egressId, result.fileUrl, result.filePath ?? null]
              );
            } catch (err) {
              const e = err as any;
              const isMissingTable =
                e?.code === "42P01" ||
                (String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_recordings"));
              if (!isMissingTable) throw err;
              // If the schema omits incident recordings, we still want the video flow to work.
            }
          }
        } catch (err) {
          // Avoid noisy logs when the DB schema doesn't include incident recordings.
          const e = err as any;
          const isMissingTable =
            e?.code === "42P01" ||
            (String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_recordings"));
          if (!isMissingTable) console.error("Error starting LiveKit recording for incident", incidentId, err);
        }
      }
    });

    // WebRTC signaling: offer (responder -> dispatcher)
    socket.on("video:offer", (data: { incidentId: string; sdp: any }) => {
      const other = getOtherParty(data.incidentId, socket.id);
      if (other) io.to(other).emit("video:offer", data);
    });

    // WebRTC signaling: answer (dispatcher -> responder)
    socket.on("video:answer", (data: { incidentId: string; sdp: any }) => {
      const other = getOtherParty(data.incidentId, socket.id);
      if (other) io.to(other).emit("video:answer", data);
    });

    // WebRTC signaling: ICE candidate (bidirectional)
    socket.on("video:ice-candidate", (data: { incidentId: string; candidate: any }) => {
      const other = getOtherParty(data.incidentId, socket.id);
      if (other) io.to(other).emit("video:ice-candidate", data);
    });

    // Stream ended (responder stops or dispatcher ends)
    socket.on("video:end", async (data: { incidentId: string }) => {
      const throttled = isEventRateLimited(socket.id, "video:end");
      if (throttled.limited) {
        socket.emit("video:error", { incidentId: data?.incidentId, code: "RATE_LIMITED", message: "Please wait and retry." });
        return;
      }
      const incidentId = String(data?.incidentId ?? "");
      if (!incidentId) return;
      const access = await getIncidentVideoAccess(incidentId).catch(() => ({ exists: false as const }));
      if (!("exists" in access) || !access.exists || (!access.isDispatchSide && !access.isAssignedResponder)) {
        socket.emit("video:error", { incidentId, code: "FORBIDDEN", message: "Not allowed to end this video." });
        return;
      }
      const s = videoSessions.get(incidentId);
      if (s?.requesterSocketId) io.to(s.requesterSocketId).emit("video:ended", { incidentId });
      if (s?.responderSocketId) io.to(s.responderSocketId).emit("video:ended", { incidentId });

      const egressId = recordingByIncident.get(incidentId);
      if (egressId) {
        try {
          await stopRoomRecording(egressId);
          try {
            await query(
              `UPDATE incident_recordings
               SET status = 'COMPLETED', ended_at = NOW()
               WHERE egress_id = $1 AND status = 'RECORDING'`,
              [egressId]
            );
          } catch (err) {
            const e = err as any;
            const isMissingTable =
              e?.code === "42P01" ||
              (String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_recordings"));
            if (!isMissingTable) throw err;
          }
        } catch (err) {
          const e = err as any;
          const isMissingTable =
            e?.code === "42P01" ||
            (String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("incident_recordings"));
          if (!isMissingTable) console.error("Error stopping LiveKit recording for incident", incidentId, err);
          await query(
            `UPDATE incident_recordings
             SET status = 'FAILED', ended_at = NOW()
             WHERE egress_id = $1 AND status = 'RECORDING'`,
            [egressId]
          ).catch(() => {});
        } finally {
          recordingByIncident.delete(data.incidentId);
        }
      }

      cleanupSession(incidentId);
    });

    socket.on("disconnect", async () => {
      const userId = userIdBySocket.get(socket.id);
      if (userId) {
        userIdBySocket.delete(socket.id);
        setUserOffline(userId);
        // Best-effort; don't block disconnect or spam noisy errors if DB is briefly unavailable.
        query(
          `UPDATE users
           SET last_seen_at = NOW()
           WHERE id = $1`,
          [userId]
        ).catch(() => {});
        io.emit("user:presence", {
          userId,
          online: false,
          lastSeen: new Date().toISOString(),
        });
      }

      // Clean up responder availability mapping
      const responderId = responderIdBySocket.get(socket.id);
      if (responderId) {
        responderIdBySocket.delete(socket.id);
        const current = responderSocketById.get(responderId);
        if (current === socket.id) {
          responderSocketById.delete(responderId);
          await query(
            `INSERT INTO responder_availability (responder_id, available, updated_at)
             VALUES ($1, FALSE, NOW())
             ON CONFLICT (responder_id)
             DO UPDATE SET available = FALSE, updated_at = EXCLUDED.updated_at`,
            [responderId]
          ).catch((err) => console.error("Error persisting responder disconnect availability", err));
          io.emit("responder:availability", { responderId, available: false });
        }
      }

      // End any active video sessions involving this socket
      for (const [incidentId, s] of videoSessions) {
        if (s.requesterSocketId === socket.id || s.responderSocketId === socket.id) {
          const other =
            s.requesterSocketId === socket.id ? s.responderSocketId : s.requesterSocketId;
          if (other) io.to(other).emit("video:ended", { incidentId });

          const egressId = recordingByIncident.get(incidentId);
          if (egressId) {
            stopRoomRecording(egressId).catch((err) => {
              console.error("Error stopping LiveKit recording on disconnect for incident", incidentId, err);
            });
            recordingByIncident.delete(incidentId);
          }

          cleanupSession(incidentId);
        }
      }

      for (const key of eventBuckets.keys()) {
        if (key.startsWith(`${socket.id}:`)) {
          eventBuckets.delete(key);
        }
      }
    });
  });

  return io;
}

