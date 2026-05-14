import { query } from "./db";

export type AuditAction =
  | "incident:created"
  | "incident:assigned"
  | "incident:reassigned"
  | "incident:rejected"
  | "incident:accepted"
  | "incident:rejected_by_responder"
  | "incident:completed_by_responder"
  | "incident:status_updated"
  | "incident:updated"
  | "chat:message_sent"
  | "user:created"
  | "user:updated"
  | "user:activated"
  | "user:deactivated"
  | "user:password_reset"
  | "admin:settings_updated"
  | "admin:force_logout_all"
  | "admin:permissions_updated";

interface AuditParams {
  action: AuditAction;
  userId?: string | null;
  userName?: string | null;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

export async function logAudit(params: AuditParams) {
  try {
    await query(
      `INSERT INTO audit_logs (action, user_id, user_name, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.action,
        params.userId ?? null,
        params.userName ?? null,
        params.entityType ?? null,
        params.entityId ?? null,
        params.details ? JSON.stringify(params.details) : null,
      ]
    );
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}
