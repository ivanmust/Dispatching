/**
 * Backfill missing incident timeline fields in details.timeline.
 *
 * Run:
 *   npm run backfill:incident-timeline
 *   npm run backfill:incident-timeline -- --dry-run
 */
import { pool, query } from "../src/db";

type IncidentStatus = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

type IncidentRow = {
  id: string;
  status: IncidentStatus;
  updatedAt: string;
  details: Record<string, unknown> | null;
};

type Timeline = {
  assignedAt?: string;
  completedAt?: string;
  closedAt?: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function inferTimeline(row: IncidentRow): Timeline | null {
  const details = asObject(row.details);
  const timeline = asObject(details.timeline);
  const dispatchAssignment = asObject(details.dispatchAssignment);
  const responderDecision = asObject(details.responderDecision);
  const dispatcherDecision = asObject(details.dispatcherDecision);

  const assignedAt =
    asString(timeline.assignedAt) ??
    asString(dispatchAssignment.assignedAt) ??
    asString(responderDecision.acceptedAt) ??
    // Best-effort fallback for already-progressed incidents.
    (row.status === "ASSIGNED" || row.status === "IN_PROGRESS" || row.status === "RESOLVED" || row.status === "CLOSED"
      ? row.updatedAt
      : undefined);

  const completedAt =
    asString(timeline.completedAt) ??
    asString(responderDecision.completedAt) ??
    // If currently resolved/closed, completion happened in the past.
    (row.status === "RESOLVED" || row.status === "CLOSED" ? row.updatedAt : undefined);

  const closedAt =
    asString(timeline.closedAt) ??
    asString(dispatcherDecision.closedAt) ??
    asString(dispatcherDecision.rejectedAt) ??
    (row.status === "CLOSED" ? row.updatedAt : undefined);

  const next: Timeline = {};
  if (assignedAt) next.assignedAt = assignedAt;
  if (completedAt) next.completedAt = completedAt;
  if (closedAt) next.closedAt = closedAt;

  return Object.keys(next).length ? next : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { rows } = await query<IncidentRow>(
    `SELECT
       id,
       status,
       updated_at AS "updatedAt",
       details
     FROM incidents`
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    scanned += 1;
    const timeline = inferTimeline(row);
    if (!timeline) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await query(
        `UPDATE incidents
         SET details = jsonb_set(
               COALESCE(details, '{}'::jsonb),
               '{timeline}',
               $1::jsonb,
               true
             ),
             updated_at = updated_at
         WHERE id = $2`,
        [JSON.stringify(timeline), row.id]
      );
    }
    updated += 1;
  }

  console.log(
    `[backfill-incident-timeline] ${dryRun ? "DRY RUN" : "APPLIED"} | scanned=${scanned} updated=${updated} skipped=${skipped}`
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error("[backfill-incident-timeline] failed:", err);
  await pool.end();
  process.exit(1);
});

