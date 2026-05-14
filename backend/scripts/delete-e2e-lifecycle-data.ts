import { pool } from "../src/db";

/**
 * Deletes incidents whose title is exactly "E2E Lifecycle" or starts with "E2E Lifecycle"
 * (Playwright: `E2E Lifecycle ${timestamp}`). Does not match "E2E Seed Lifecycle".
 *
 * Deletes users whose username matches the lifecycle e2e accounts (`e2e.lifecycle%` per e2e/incident-lifecycle.spec.ts).
 */
async function main() {
  const client = await pool.connect();
  const sentinel = ["00000000-0000-0000-0000-000000000000"];

  try {
    await client.query("BEGIN");

    const { rows: lifecycleUsers } = await client.query<{ id: string; username: string }>(
      `SELECT id::text AS id, username FROM users WHERE username ILIKE 'e2e.lifecycle%'`,
    );
    const lifecycleUserIds = lifecycleUsers.map((u) => u.id);
    const lifecycleUserIdsText = lifecycleUserIds.length ? lifecycleUserIds : sentinel;

    const { rows: lifecycleIncidents } = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM incidents
       WHERE trim(title) ILIKE 'E2E Lifecycle%'`,
    );
    const lifecycleIncidentIds = lifecycleIncidents.map((r) => r.id);
    const lifecycleIncidentIdsText = lifecycleIncidentIds.length ? lifecycleIncidentIds : sentinel;

    await client.query(`DELETE FROM crimes WHERE crime_id::text = ANY($1::text[])`, [lifecycleIncidentIdsText]);
    await client.query(`DELETE FROM crimes WHERE trim(title) ILIKE 'E2E Lifecycle%'`);

    const delWitness = await client.query(
      `DELETE FROM incident_witnesses WHERE incident_id::text = ANY($1::text[])`,
      [lifecycleIncidentIdsText],
    );
    const delHistory = await client.query(
      `DELETE FROM incident_status_history WHERE incident_id::text = ANY($1::text[])`,
      [lifecycleIncidentIdsText],
    );
    const delChatByIncident = await client.query(
      `DELETE FROM chat_messages WHERE incident_id::text = ANY($1::text[])`,
      [lifecycleIncidentIdsText],
    );

    const delIncidents = await client.query(`DELETE FROM incidents WHERE id::text = ANY($1::text[])`, [
      lifecycleIncidentIdsText,
    ]);

    const delChatBySender = await client.query(
      `DELETE FROM chat_messages WHERE sender_id::text = ANY($1::text[])`,
      [lifecycleUserIdsText],
    );

    const delNotif = await client.query(`DELETE FROM notifications WHERE user_id::text = ANY($1::text[])`, [
      lifecycleUserIdsText,
    ]);

    const delAudit = await client.query(`DELETE FROM audit_logs WHERE user_id::text = ANY($1::text[])`, [
      lifecycleUserIdsText,
    ]);

    const delDmReactions = await client.query(
      `DELETE FROM dm_message_reactions WHERE user_id::text = ANY($1::text[])`,
      [lifecycleUserIdsText],
    );
    const delDmReceipts = await client.query(
      `DELETE FROM dm_message_receipts WHERE user_id::text = ANY($1::text[])`,
      [lifecycleUserIdsText],
    );
    const delDmParticipants = await client.query(
      `DELETE FROM dm_participants WHERE user_id::text = ANY($1::text[])`,
      [lifecycleUserIdsText],
    );
    const delDmMessages = await client.query(`DELETE FROM dm_messages WHERE sender_id::text = ANY($1::text[])`, [
      lifecycleUserIdsText,
    ]);

    const delResponderLoc = await client.query(
      `DELETE FROM responder_locations WHERE responder_id::text = ANY($1::text[])`,
      [lifecycleUserIdsText],
    );

    const unassign = await client.query(
      `UPDATE incidents
       SET assigned_responder_id = NULL,
           assigned_responder_name = NULL,
           updated_at = NOW()
       WHERE assigned_responder_id::text = ANY($1::text[])`,
      [lifecycleUserIdsText],
    );

    const delUsers = await client.query(`DELETE FROM users WHERE id::text = ANY($1::text[])`, [
      lifecycleUserIdsText,
    ]);

    const delEmptyDmConvos = await client.query(
      `DELETE FROM dm_conversations c
       WHERE NOT EXISTS (SELECT 1 FROM dm_participants p WHERE p.conversation_id = c.id)`,
    );

    await client.query("COMMIT");

    console.log("[e2e-lifecycle] users matched (username ILIKE e2e.lifecycle%):", lifecycleUsers.length);
    for (const u of lifecycleUsers) {
      console.log("  -", u.username);
    }
    console.log("[e2e-lifecycle] incidents matched (title ILIKE E2E Lifecycle%):", lifecycleIncidents.length);
    console.log("[e2e-lifecycle] incidents deleted:", delIncidents.rowCount ?? 0);
    console.log("[e2e-lifecycle] incident_witnesses:", delWitness.rowCount ?? 0);
    console.log("[e2e-lifecycle] incident_status_history:", delHistory.rowCount ?? 0);
    console.log("[e2e-lifecycle] chat (by incident):", delChatByIncident.rowCount ?? 0);
    console.log("[e2e-lifecycle] chat (by sender):", delChatBySender.rowCount ?? 0);
    console.log("[e2e-lifecycle] notifications:", delNotif.rowCount ?? 0);
    console.log("[e2e-lifecycle] audit_logs:", delAudit.rowCount ?? 0);
    console.log("[e2e-lifecycle] dm cleanup reactions/receipts/participants/messages:", [
      delDmReactions.rowCount,
      delDmReceipts.rowCount,
      delDmParticipants.rowCount,
      delDmMessages.rowCount,
    ].join(", "));
    console.log("[e2e-lifecycle] responder_locations:", delResponderLoc.rowCount ?? 0);
    console.log("[e2e-lifecycle] incidents unassigned:", unassign.rowCount ?? 0);
    console.log("[e2e-lifecycle] users deleted:", delUsers.rowCount ?? 0);
    console.log("[e2e-lifecycle] empty dm_conversations removed:", delEmptyDmConvos.rowCount ?? 0);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[e2e-lifecycle] failed:", err);
  process.exit(1);
});
