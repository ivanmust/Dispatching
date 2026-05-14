import { query } from "./db";
import type { IncidentStatus } from "./types";

export interface LogStatusChangeParams {
  incidentId: string;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus;
  userId?: string | null;
  userName?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logIncidentStatusChange(params: LogStatusChangeParams): Promise<void> {
  try {
    await query(
      `INSERT INTO incident_status_history
       (incident_id, from_status, to_status, changed_by_id, changed_by_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.incidentId,
        params.fromStatus ?? null,
        params.toStatus,
        params.userId ?? null,
        params.userName ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ]
    );
  } catch (err) {
    console.error("Failed to log incident status change:", err);
  }
}
