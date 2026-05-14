import type { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requirePermission } from "../middleware/auth";
import { notifyUser } from "../notifications";
import { isUserOnline } from "../presence";
import { getAdminSetting } from "../adminSettings";

const listContactsSchema = z.object({
  q: z.string().optional(),
});

const openConversationSchema = z.object({
  userId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1),
  priority: z.enum(["normal", "urgent", "emergency"]).default("normal"),
  attachmentUrl: z.string().url().optional(),
  attachmentType: z.enum(["image", "video", "document"]).optional(),
  attachmentName: z.string().optional(),
  attachmentMimeType: z.string().optional(),
  clientMessageId: z.string().optional(),
});

const historySchema = z.object({
  conversationId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(200).optional(),
  before: z.string().optional(),
});

const receiptSchema = z.object({
  messageId: z.string().uuid(),
  status: z.enum(["delivered", "read"]),
});

const reactionTypeSchema = z.enum(["like", "love", "laugh", "wow", "sad", "angry"]);

const reactDmMessageSchema = z.object({
  messageId: z.string().uuid(),
  reactionType: reactionTypeSchema,
});

const editDmMessageSchema = z.object({
  messageId: z.string().uuid(),
  content: z.string().min(1),
});

const deleteDmMessageSchema = z.object({
  messageId: z.string().uuid(),
});

const forwardDmMessageSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  clientMessageId: z.string().optional(),
});

export function registerDirectMessageRoutes(router: Router, io: Server) {
  // Contacts the current user can message
  router.get(
    "/dm/contacts",
    requireAuth,
    requirePermission("messages:read"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { q } = listContactsSchema.parse(req.query);

        const values: unknown[] = [authUser.id];
        let where = "u.id <> $1 AND u.is_active = TRUE";
        if (q) {
          values.push(`%${q}%`);
          const idx = values.length;
          where += ` AND (name ILIKE $${idx} OR username ILIKE $${idx} OR phone ILIKE $${idx})`;
        }

        const { rows } = await query(
          `SELECT
             u.id,
             u.username,
             u.name,
             u.role,
             u.callsign,
             u.unit,
             u.phone,
             u.is_active,
             u.last_seen_at,
             COALESCE(unread.unread_count, 0) AS unread_count,
             COALESCE(tot.total_messages, 0) AS total_messages
           FROM users u
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS unread_count
             FROM dm_conversations c
             JOIN dm_participants p_self
               ON p_self.conversation_id = c.id
              AND p_self.user_id = $1
             JOIN dm_participants p_other
               ON p_other.conversation_id = c.id
              AND p_other.user_id = u.id
             JOIN dm_messages m
               ON m.conversation_id = c.id
             JOIN dm_message_receipts r
               ON r.message_id = m.id
              AND r.user_id = $1
             WHERE r.read_at IS NULL
           ) unread ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(m.id)::int AS total_messages
             FROM dm_messages m
             WHERE m.conversation_id IN (
               SELECT c.id
               FROM dm_conversations c
               JOIN dm_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
               JOIN dm_participants p2 ON p2.conversation_id = c.id AND p2.user_id = u.id
             )
           ) tot ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(m.id)::int AS my_sent_messages
             FROM dm_messages m
             WHERE m.sender_id = $1
               AND m.conversation_id IN (
                 SELECT c.id
                 FROM dm_conversations c
                 JOIN dm_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
                 JOIN dm_participants p2 ON p2.conversation_id = c.id AND p2.user_id = u.id
               )
           ) my_sent ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(m.id)::int AS their_sent_messages
             FROM dm_messages m
             WHERE m.sender_id = u.id
               AND m.conversation_id IN (
                 SELECT c.id
                 FROM dm_conversations c
                 JOIN dm_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
                 JOIN dm_participants p2 ON p2.conversation_id = c.id AND p2.user_id = u.id
               )
           ) their_sent ON TRUE
           LEFT JOIN LATERAL (
             SELECT
               m.sender_id AS last_sender_id,
               m.content AS last_content,
               m.deleted_at AS last_deleted_at,
               m.attachment_url AS last_attachment_url,
               m.created_at AS last_created_at
             FROM dm_messages m
             WHERE m.conversation_id IN (
               SELECT c.id
               FROM dm_conversations c
               JOIN dm_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
               JOIN dm_participants p2 ON p2.conversation_id = c.id AND p2.user_id = u.id
             )
             ORDER BY m.created_at DESC
             LIMIT 1
           ) last_msg ON TRUE
           WHERE ${where}
           ORDER BY u.name ASC`,
          values
        );

        res.json(
          rows.map((u) => ({
            id: u.id,
            username: u.username,
            name: u.name,
            role: u.role,
            callsign: u.callsign,
            unit: u.unit,
            phone: u.phone,
            isActive: u.is_active,
            online: isUserOnline(String(u.id)),
            lastSeen: u.last_seen_at ?? null,
            unreadCount: Number(u.unread_count ?? 0),
            totalMessageCount: Number(u.total_messages ?? 0),
            mySentCount: Number(u.my_sent_messages ?? 0),
            theirSentCount: Number(u.their_sent_messages ?? 0),
            lastMessagePreview: u.last_deleted_at
              ? "Message deleted"
              : u.last_attachment_url
                ? "Attachment"
                : (u.last_content as string | null) ?? null,
            lastMessageAt: u.last_created_at ?? null,
            lastMessageFromMe: String(u.last_sender_id ?? "") === authUser.id,
          }))
        );
      } catch (err) {
        next(err);
      }
    }
  );

  // Create or reuse a direct conversation between two users
  router.post(
    "/dm/open",
    requireAuth,
    requirePermission("messages:send"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { userId } = openConversationSchema.parse(req.body);

        if (userId === authUser.id) {
          res.status(400).json({ error: "Cannot open a conversation with yourself" });
          return;
        }

        const { rows: partnerRows } = await query<{ id: string; is_active: boolean | null }>(
          `SELECT id, is_active FROM users WHERE id = $1`,
          [userId]
        );
        const partner = partnerRows[0];
        if (!partner || partner.is_active === false) {
          res.status(404).json({ error: "Target user not found or inactive" });
          return;
        }

        // Reuse existing two-party conversation if it exists
        const { rows: existing } = await query<{ id: string }>(
          `SELECT c.id
           FROM dm_conversations c
           JOIN dm_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
           JOIN dm_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
           GROUP BY c.id`,
          [authUser.id, userId]
        );

        let conversationId: string;
        if (existing[0]) {
          conversationId = existing[0].id;
        } else {
          const { rows: created } = await query<{ id: string }>(
            `INSERT INTO dm_conversations DEFAULT VALUES RETURNING id`,
            []
          );
          conversationId = created[0].id;
          await query(
            `INSERT INTO dm_participants (conversation_id, user_id)
             VALUES ($1, $2), ($1, $3)`,
            [conversationId, authUser.id, userId]
          );
        }

        res.status(201).json({ conversationId });
      } catch (err) {
        next(err);
      }
    }
  );

  // Conversation history
  router.get(
    "/dm/history",
    requireAuth,
    requirePermission("messages:read"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { conversationId, limit, before } = historySchema.parse(req.query);

        const { rows: participantRows } = await query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM dm_participants
             WHERE conversation_id = $1 AND user_id = $2
           ) AS exists`,
          [conversationId, authUser.id]
        );
        if (!participantRows[0]?.exists) {
          res.status(403).json({ error: "You are not a participant in this conversation" });
          return;
        }

        const params: unknown[] = [conversationId];
        let sql = `SELECT m.id,
                          m.conversation_id AS "conversationId",
                          m.sender_id AS "senderId",
                          m.client_message_id AS "clientMessageId",
                          u.name AS "senderName",
                          m.content,
                          m.priority,
                          m.created_at AS "createdAt",
                          m.edited_at AS "editedAt",
                          m.deleted_at AS "deletedAt",
                          m.forwarded_from_message_id AS "forwardedFromMessageId",
                          m.attachment_url AS "attachmentUrl",
                          m.attachment_type AS "attachmentType",
                          m.attachment_name AS "attachmentName",
                          m.attachment_mime_type AS "attachmentMimeType",
                          (
                            SELECT r_my.reaction_type
                            FROM dm_message_reactions r_my
                            WHERE r_my.message_id = m.id AND r_my.user_id = $1
                            LIMIT 1
                          ) AS "myReaction",
                          (
                            SELECT COALESCE(jsonb_object_agg(x.reaction_type, x.count), '{}'::jsonb)
                            FROM (
                              SELECT r_cnt.reaction_type, COUNT(*)::int AS count
                              FROM dm_message_reactions r_cnt
                              WHERE r_cnt.message_id = m.id
                              GROUP BY r_cnt.reaction_type
                            ) x
                          ) AS "reactionCounts",
                          r.delivered_at AS "deliveredAt",
                          r.read_at AS "readAt"
                   FROM dm_messages m
                   JOIN users u ON u.id = m.sender_id
                   LEFT JOIN dm_message_receipts r
                     ON r.message_id = m.id AND r.user_id = $1
                   WHERE m.conversation_id = $2`;
        params.unshift(authUser.id);

        if (before) {
          params.push(before);
          sql += ` AND m.created_at < $${params.length}`;
        }

        params.push(limit ?? 100);
        sql += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;

        const { rows } = await query(sql, params);
        // Return newest last for UI
        res.json(rows.reverse());
      } catch (err) {
        next(err);
      }
    }
  );

  // Send message
  router.post(
    "/dm/send",
    requireAuth,
    requirePermission("messages:send"),
    async (req, res, next) => {
      try {
        const messagingEnabled = await getAdminSetting("messaging_enabled");
        if (!messagingEnabled) {
          res.status(403).json({ error: "Messaging is disabled by admin." });
          return;
        }
        const authUser = req.authUser!;
        const {
          conversationId,
          content,
          priority,
          attachmentUrl,
          attachmentType,
          attachmentName,
          attachmentMimeType,
          clientMessageId,
        } = sendMessageSchema.parse(req.body);

        const { rows: participantRows } = await query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM dm_participants
             WHERE conversation_id = $1 AND user_id = $2
           ) AS exists`,
          [conversationId, authUser.id]
        );
        if (!participantRows[0]?.exists) {
          res.status(403).json({ error: "You are not a participant in this conversation" });
          return;
        }

        // Idempotency: if the same clientMessageId was already persisted, reuse it.
        let msg:
          | {
              id: string;
              created_at: string;
              sender_id: string;
              content: string;
              priority: "normal" | "urgent" | "emergency";
              attachment_url: string | null;
              attachment_type: string | null;
              attachment_name: string | null;
              attachment_mime_type: string | null;
            }
          | null = null;
        if (clientMessageId) {
          const { rows: existing } = await query<{
            id: string;
            created_at: string;
            sender_id: string;
            content: string;
            priority: "normal" | "urgent" | "emergency";
            attachment_url: string | null;
            attachment_type: string | null;
            attachment_name: string | null;
            attachment_mime_type: string | null;
          }>(
            `SELECT id, created_at, sender_id
                    ,content, priority,
                    attachment_url, attachment_type, attachment_name, attachment_mime_type
             FROM dm_messages
             WHERE conversation_id = $1 AND client_message_id = $2
             LIMIT 1`,
            [conversationId, clientMessageId]
          );
          msg = existing[0] ?? null;
        }

        if (!msg) {
          const { rows: msgRows } = await query<{
            id: string;
            created_at: string;
            sender_id: string;
            content: string;
            priority: "normal" | "urgent" | "emergency";
            attachment_url: string | null;
            attachment_type: string | null;
            attachment_name: string | null;
            attachment_mime_type: string | null;
          }>(
            `INSERT INTO dm_messages
              (conversation_id, sender_id, content, priority, attachment_url, attachment_type, attachment_name, attachment_mime_type, client_message_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, created_at, sender_id, content, priority,
                       attachment_url, attachment_type, attachment_name, attachment_mime_type`,
            [
              conversationId,
              authUser.id,
              content.trim(),
              priority,
              attachmentUrl ?? null,
              attachmentType ?? null,
              attachmentName ?? null,
              attachmentMimeType ?? null,
              clientMessageId ?? null,
            ]
          );
          msg = msgRows[0];

          if (!msg) {
            throw new Error("Failed to persist DM message for idempotent send");
          }

          // Create receipts rows for all participants:
          // - sender: delivered + read immediately
          // - others: delivered now, read remains NULL until they open the chat
          await query(
            `INSERT INTO dm_message_receipts (message_id, user_id, delivered_at, read_at)
             SELECT
               $1,
               p.user_id,
               NOW(),
               CASE WHEN p.user_id = $3 THEN NOW() ELSE NULL END
             FROM dm_participants p
             WHERE p.conversation_id = $2
             `,
            [msg.id, conversationId, authUser.id]
          );
        } else {
          if (!msg) {
            throw new Error("Idempotent DM send invariant violated");
          }

          // Ensure receipts exist/are up to date for all participants.
          await query(
            `UPDATE dm_message_receipts
             SET
               delivered_at = COALESCE(delivered_at, NOW()),
               read_at = CASE
                 WHEN user_id = $3 THEN COALESCE(read_at, NOW())
                 ELSE read_at
               END
             WHERE message_id = $1
               AND user_id IN (
                 SELECT user_id FROM dm_participants WHERE conversation_id = $2
               )`,
            [msg.id, conversationId, authUser.id]
          );

          await query(
            `INSERT INTO dm_message_receipts (message_id, user_id, delivered_at, read_at)
             SELECT
               $1,
               p.user_id,
               NOW(),
               CASE WHEN p.user_id = $3 THEN NOW() ELSE NULL END
             FROM dm_participants p
             WHERE p.conversation_id = $2
             ON CONFLICT (message_id, user_id) DO NOTHING`,
            [msg.id, conversationId, authUser.id]
          );
        }

        if (!msg) {
          throw new Error("Idempotent DM send invariant violated");
        }

        const payload = {
          id: msg.id,
          conversationId,
          clientMessageId: clientMessageId ?? null,
          senderId: msg.sender_id,
          senderName: authUser.name,
          content: msg.content,
          priority: msg.priority,
          createdAt: msg.created_at,
          attachmentUrl: msg.attachment_url ?? null,
          attachmentType: msg.attachment_type ?? null,
          attachmentName: msg.attachment_name ?? null,
          attachmentMimeType: msg.attachment_mime_type ?? null,
        };

        io.to(`dm:${conversationId}`).emit("dm:newMessage", payload);

        // Notify other participants
        const { rows: recipients } = await query<{ user_id: string }>(
          `SELECT user_id
           FROM dm_participants
           WHERE conversation_id = $1 AND user_id <> $2`,
          [conversationId, authUser.id]
        );
        await Promise.all(
          recipients.map((r) =>
            notifyUser(io, r.user_id, {
              type: "dm:new",
              title: "New direct message",
              body: `${authUser.name}: ${content.trim().slice(0, 80)}`,
              metadata: { conversationId },
            })
          )
        );

        res.status(201).json(payload);
      } catch (err) {
        next(err);
      }
    }
  );

  // Toggle a reaction on a DM message
  router.post(
    "/dm/react",
    requireAuth,
    requirePermission("messages:send"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { messageId, reactionType } = reactDmMessageSchema.parse(req.body);

        const { rows: msgRows } = await query<{
          id: string;
          conversation_id: string;
        }>(
          `SELECT id, conversation_id
           FROM dm_messages
           WHERE id = $1`,
          [messageId]
        );

        const msg = msgRows[0];
        if (!msg) {
          res.status(404).json({ error: "Message not found" });
          return;
        }

        const conversationId = msg.conversation_id;
        const { rows: participantRows } = await query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM dm_participants
             WHERE conversation_id = $1 AND user_id = $2
           ) AS exists`,
          [conversationId, authUser.id]
        );
        if (!participantRows[0]?.exists) {
          res.status(403).json({ error: "You are not a participant in this conversation" });
          return;
        }

        const { rows: currentRows } = await query<{ reaction_type: string | null }>(
          `SELECT reaction_type
           FROM dm_message_reactions
           WHERE message_id = $1 AND user_id = $2
           LIMIT 1`,
          [messageId, authUser.id]
        );

        const currentReaction = currentRows[0]?.reaction_type ?? null;

        if (currentReaction === reactionType) {
          await query(`DELETE FROM dm_message_reactions WHERE message_id = $1 AND user_id = $2`, [messageId, authUser.id]);
        } else {
          await query(
            `INSERT INTO dm_message_reactions (message_id, user_id, reaction_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (message_id, user_id) DO UPDATE
               SET reaction_type = EXCLUDED.reaction_type`,
            [messageId, authUser.id, reactionType]
          );
        }

        const nextMyReaction = currentReaction === reactionType ? null : reactionType;

        const { rows: countsRows } = await query<{ reactionCounts: any }>(
          `SELECT COALESCE(jsonb_object_agg(x.reaction_type, x.count), '{}'::jsonb) AS "reactionCounts"
           FROM (
             SELECT r_cnt.reaction_type, COUNT(*)::int AS count
             FROM dm_message_reactions r_cnt
             WHERE r_cnt.message_id = $1
             GROUP BY r_cnt.reaction_type
           ) x`,
          [messageId]
        );

        io.to(`dm:${conversationId}`).emit("dm:reactionUpdated", {
          conversationId,
          messageId,
          changedByUserId: authUser.id,
          myReaction: nextMyReaction,
          reactionCounts: countsRows[0]?.reactionCounts ?? {},
        });

        res.status(200).json({
          messageId,
          myReaction: nextMyReaction,
          reactionCounts: countsRows[0]?.reactionCounts ?? {},
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Edit DM message content (sender-only, text-only for now)
  router.post(
    "/dm/edit",
    requireAuth,
    requirePermission("messages:send"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { messageId, content } = editDmMessageSchema.parse(req.body);

        const { rows } = await query<{
          id: string;
          conversation_id: string;
          sender_id: string;
          deleted_at: string | null;
          attachment_url: string | null;
        }>(
          `SELECT id, conversation_id, sender_id, deleted_at, attachment_url
           FROM dm_messages
           WHERE id = $1`,
          [messageId]
        );

        const msg = rows[0];
        if (!msg) {
          res.status(404).json({ error: "Message not found" });
          return;
        }

        const conversationId = msg.conversation_id;
        const { rows: participantRows } = await query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM dm_participants
             WHERE conversation_id = $1 AND user_id = $2
           ) AS exists`,
          [conversationId, authUser.id]
        );
        if (!participantRows[0]?.exists) {
          res.status(403).json({ error: "You are not a participant in this conversation" });
          return;
        }

        if (msg.sender_id !== authUser.id) {
          res.status(403).json({ error: "Only the sender can edit this message" });
          return;
        }

        if (msg.deleted_at) {
          res.status(400).json({ error: "Cannot edit a deleted message" });
          return;
        }

        if (msg.attachment_url) {
          res.status(400).json({ error: "Editing messages with attachments is not supported yet" });
          return;
        }

        await query(
          `UPDATE dm_messages
           SET content = $1, edited_at = NOW()
           WHERE id = $2`,
          [content.trim(), messageId]
        );

        io.to(`dm:${conversationId}`).emit("dm:messageEdited", {
          conversationId,
          messageId,
          content: content.trim(),
          editedAt: new Date().toISOString(),
          deletedAt: null,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // Soft-delete a DM message (sender-only)
  router.post(
    "/dm/delete",
    requireAuth,
    requirePermission("messages:send"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { messageId } = deleteDmMessageSchema.parse(req.body);

        const { rows } = await query<{
          id: string;
          conversation_id: string;
          sender_id: string;
          deleted_at: string | null;
        }>(
          `SELECT id, conversation_id, sender_id, deleted_at
           FROM dm_messages
           WHERE id = $1`,
          [messageId]
        );

        const msg = rows[0];
        if (!msg) {
          res.status(404).json({ error: "Message not found" });
          return;
        }

        const conversationId = msg.conversation_id;
        const { rows: participantRows } = await query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM dm_participants
             WHERE conversation_id = $1 AND user_id = $2
           ) AS exists`,
          [conversationId, authUser.id]
        );
        if (!participantRows[0]?.exists) {
          res.status(403).json({ error: "You are not a participant in this conversation" });
          return;
        }

        if (msg.sender_id !== authUser.id) {
          res.status(403).json({ error: "Only the sender can delete this message" });
          return;
        }

        await query(`UPDATE dm_messages SET deleted_at = NOW() WHERE id = $1`, [messageId]);

        io.to(`dm:${conversationId}`).emit("dm:messageDeleted", {
          conversationId,
          messageId,
          deletedAt: new Date().toISOString(),
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // Forward a DM message (copies content + attachments into the same conversation)
  router.post(
    "/dm/forward",
    requireAuth,
    requirePermission("messages:send"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { conversationId, messageId, clientMessageId } = forwardDmMessageSchema.parse(req.body);

        // Ensure requester is a participant
        const { rows: participantRows } = await query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM dm_participants
             WHERE conversation_id = $1 AND user_id = $2
           ) AS exists`,
          [conversationId, authUser.id]
        );
        if (!participantRows[0]?.exists) {
          res.status(403).json({ error: "You are not a participant in this conversation" });
          return;
        }

        const { rows: origRows } = await query<{
          sender_id: string;
          content: string;
          priority: string;
          attachment_url: string | null;
          attachment_type: string | null;
          attachment_name: string | null;
          attachment_mime_type: string | null;
        }>(
          `SELECT sender_id, content, priority,
                  attachment_url, attachment_type, attachment_name, attachment_mime_type
           FROM dm_messages
           WHERE id = $1 AND conversation_id = $2`,
          [messageId, conversationId]
        );

        const orig = origRows[0];
        if (!orig) {
          res.status(404).json({ error: "Message not found in this conversation" });
          return;
        }

        const { rows: newRows } = await query<{
          id: string;
          created_at: string;
        }>(
          `INSERT INTO dm_messages
             (conversation_id, sender_id, content, priority,
              attachment_url, attachment_type, attachment_name, attachment_mime_type,
              forwarded_from_message_id, client_message_id)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, created_at`,
          [
            conversationId,
            authUser.id,
            orig.content,
            orig.priority,
            orig.attachment_url,
            orig.attachment_type,
            orig.attachment_name,
            orig.attachment_mime_type,
            messageId,
            clientMessageId ?? null,
          ]
        );

        const newMsg = newRows[0];

        await query(
          `INSERT INTO dm_message_receipts (message_id, user_id, delivered_at, read_at)
           SELECT
             $1,
             p.user_id,
             NOW(),
             CASE WHEN p.user_id = $3 THEN NOW() ELSE NULL END
           FROM dm_participants p
           WHERE p.conversation_id = $2`,
          [newMsg.id, conversationId, authUser.id]
        );

        const payload = {
          id: newMsg.id,
          conversationId,
          clientMessageId: clientMessageId ?? null,
          senderId: authUser.id,
          senderName: authUser.name,
          content: orig.content,
          priority: orig.priority,
          createdAt: newMsg.created_at,
          attachmentUrl: orig.attachment_url ?? null,
          attachmentType: orig.attachment_type ?? null,
          attachmentName: orig.attachment_name ?? null,
          attachmentMimeType: orig.attachment_mime_type ?? null,
          forwardedFromMessageId: messageId,
        };

        io.to(`dm:${conversationId}`).emit("dm:newMessage", payload);

        res.status(201).json(payload);
      } catch (err) {
        next(err);
      }
    }
  );

  // Mark message delivered/read
  router.post(
    "/dm/receipt",
    requireAuth,
    requirePermission("messages:read"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { messageId, status } = receiptSchema.parse(req.body);

        const column = status === "read" ? "read_at" : "delivered_at";
        await query(
          `UPDATE dm_message_receipts
           SET ${column} = COALESCE(${column}, NOW())
           WHERE message_id = $1 AND user_id = $2`,
          [messageId, authUser.id]
        );

        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );
}

