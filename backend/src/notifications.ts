import type { Server } from "socket.io";
import { query } from "./db";

export type NotificationPayload = {
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
};

export type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
};

export async function createNotification(userId: string, payload: NotificationPayload): Promise<NotificationRecord> {
  const { rows } = await query<{
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    metadata: Record<string, unknown> | null;
    isRead: boolean;
    createdAt: string;
  }>(
    `INSERT INTO notifications (user_id, type, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING
       id,
       user_id AS "userId",
       type,
       title,
       body,
       metadata,
       is_read AS "isRead",
       created_at AS "createdAt"`,
    [userId, payload.type, payload.title, payload.body, payload.metadata ?? null]
  );
  return rows[0];
}

export async function notifyUser(io: Server, userId: string, payload: NotificationPayload): Promise<void> {
  const record = await createNotification(userId, payload);
  io.to(`user:${userId}`).emit("notification:new", record);
}

export async function notifyRole(io: Server, role: string, payload: NotificationPayload): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE role = $1 AND COALESCE(is_active, TRUE) = TRUE`,
    [role]
  );
  await Promise.all(rows.map((u) => notifyUser(io, u.id, payload)));
}

