import { pool } from "../src/db";

/**
 * Removes test/demo/e2e users and related incidents. Safe to re-run.
 *
 * Broadened patterns include legacy demo seeds (admin_dashboard_demo), Vitest
 * integration users (it.*@), Playwright/e2e helpers (e2e.seed.*), and obvious
 * title / details markers.
 */
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: testUsers } = await client.query<{ id: string; username: string; name: string }>(
      `SELECT id::text AS id, username, name
       FROM users
       WHERE
         username IN ('dispatcher@cad.local', 'responder@cad.local', 'responder@crime.rw')
         OR username ILIKE 'e2e.%'
         OR username ~* '^e2e\\.'
         OR username ILIKE 'e2e.seed%'
         OR username ILIKE 'e2e.lifecycle%'
         OR username ILIKE 'it.%'
         OR (username ILIKE '%@cad.local' AND username ILIKE '%+%')
         OR name ILIKE 'Demo %'
         OR name ILIKE 'E2E %'
         OR name ILIKE 'E2E Seed %'
         OR name ILIKE 'Integration Dispatcher'
         OR name ILIKE 'Integration Responder'
         OR name ILIKE 'Crime Responder'
         OR name ILIKE 'E2E ETA Dispatcher'
         OR name ILIKE 'E2E ETA Responder'
         OR name ILIKE 'E2E Lifecycle Dispatcher'
         OR name ILIKE 'E2E Lifecycle Responder'
         OR name ILIKE 'E2E Seed Dispatcher'
         OR name ILIKE 'E2E Seed Responder'`
    );
    const testUserIds = testUsers.map((u) => u.id);
    const testUserIdsText = testUserIds.length ? testUserIds : ["00000000-0000-0000-0000-000000000000"];

    const { rows: incidentRows } = await client.query<{ id: string }>(
      `SELECT id::text AS id
       FROM incidents
       WHERE
         title ILIKE 'ETA Test Incident%'
         OR title ILIKE 'Integration base incident%'
         OR title ILIKE 'Integration test%'
         OR title ILIKE 'Test incident'
         OR title ILIKE 'Test %'
         OR title ILIKE '% E2E %'
         OR title ILIKE 'E2E %'
         OR title ILIKE '%Seed Lifecycle%'
         OR title ILIKE '% E2E Seed %'
         OR title ILIKE '%demo%'
         OR COALESCE(created_by_name, '') ILIKE 'E2E %'
         OR COALESCE(created_by_name, '') ILIKE 'Demo %'
         OR COALESCE(created_by_name, '') ILIKE 'Integration %'
         OR COALESCE(assigned_responder_name, '') ILIKE 'E2E %'
         OR COALESCE(assigned_responder_name, '') ILIKE 'Demo %'
         OR assigned_responder_id::text = ANY($1::text[])
         OR created_by_id::text = ANY($1::text[])
         OR details::text ILIKE '%admin_dashboard_demo%'
         OR details::text ILIKE '%E2E seed%'
         OR details::text ILIKE '%e2e.seed%'`,
      [testUserIdsText]
    );
    const incidentIds = incidentRows.map((r) => r.id);
    const incidentIdsText = incidentIds.length ? incidentIds : ["00000000-0000-0000-0000-000000000000"];

    const delWitness = await client.query(
      `DELETE FROM incident_witnesses WHERE incident_id::text = ANY($1::text[])`,
      [incidentIdsText]
    );
    const delHistory = await client.query(
      `DELETE FROM incident_status_history WHERE incident_id::text = ANY($1::text[])`,
      [incidentIdsText]
    );
    const delChatByIncident = await client.query(
      `DELETE FROM chat_messages WHERE incident_id::text = ANY($1::text[])`,
      [incidentIdsText]
    );

    const delChatBySender = await client.query(
      `DELETE FROM chat_messages
       WHERE COALESCE(sender_name, '') ILIKE 'E2E %'
          OR COALESCE(sender_name, '') ILIKE 'Demo %'
          OR COALESCE(sender_name, '') ILIKE 'Integration %'
          OR sender_id::text = ANY($1::text[])`,
      [testUserIdsText]
    );

    const delIncidents = await client.query(
      `DELETE FROM incidents WHERE id::text = ANY($1::text[])`,
      [incidentIdsText]
    );

    const delNotif = await client.query(
      `DELETE FROM notifications
       WHERE user_id = ANY($1::text[])
          OR title ILIKE '%e2e%'
          OR body ILIKE '%e2e%'
          OR title ILIKE '%demo%'
          OR body ILIKE '%demo%'`,
      [testUserIdsText]
    );

    const delAudit = await client.query(
      `DELETE FROM audit_logs
       WHERE COALESCE(user_name, '') ILIKE 'E2E %'
          OR COALESCE(user_name, '') ILIKE 'Demo %'
          OR COALESCE(user_name, '') ILIKE 'Integration %'
          OR COALESCE(details::text, '') ILIKE '%e2e%'
          OR COALESCE(details::text, '') ILIKE '%demo%'`
    );

    const delDmReactions = await client.query(
      `DELETE FROM dm_message_reactions WHERE user_id::text = ANY($1::text[])`,
      [testUserIdsText]
    );
    const delDmReceipts = await client.query(
      `DELETE FROM dm_message_receipts WHERE user_id::text = ANY($1::text[])`,
      [testUserIdsText]
    );
    const delDmParticipants = await client.query(
      `DELETE FROM dm_participants WHERE user_id::text = ANY($1::text[])`,
      [testUserIdsText]
    );
    const delDmMessages = await client.query(
      `DELETE FROM dm_messages WHERE sender_id::text = ANY($1::text[])`,
      [testUserIdsText]
    );

    const delResponderLoc = await client.query(
      `DELETE FROM responder_locations WHERE responder_id = ANY($1::text[])`,
      [testUserIdsText]
    );

    const unassign = await client.query(
      `UPDATE incidents
       SET assigned_responder_id = NULL,
           assigned_responder_name = NULL,
           updated_at = NOW()
       WHERE assigned_responder_id::text = ANY($1::text[])`,
      [testUserIdsText]
    );

    const delUsers = await client.query(`DELETE FROM users WHERE id::text = ANY($1::text[])`, [testUserIdsText]);

    const delEmptyDmConvos = await client.query(
      `DELETE FROM dm_conversations c
       WHERE NOT EXISTS (SELECT 1 FROM dm_participants p WHERE p.conversation_id = c.id)`
    );

    await client.query("COMMIT");

    console.log("[cleanup] test/demo users matched:", testUsers.length);
    console.log("[cleanup] incidents removed:", delIncidents.rowCount ?? 0);
    console.log("[cleanup] incident_witnesses removed:", delWitness.rowCount ?? 0);
    console.log("[cleanup] incident_status_history removed:", delHistory.rowCount ?? 0);
    console.log("[cleanup] chat by incident removed:", delChatByIncident.rowCount ?? 0);
    console.log("[cleanup] chat by sender removed:", delChatBySender.rowCount ?? 0);
    console.log("[cleanup] notifications removed:", delNotif.rowCount ?? 0);
    console.log("[cleanup] audit logs removed:", delAudit.rowCount ?? 0);
    console.log("[cleanup] dm_message_reactions removed:", delDmReactions.rowCount ?? 0);
    console.log("[cleanup] dm_message_receipts removed:", delDmReceipts.rowCount ?? 0);
    console.log("[cleanup] dm_participants removed:", delDmParticipants.rowCount ?? 0);
    console.log("[cleanup] dm_messages removed:", delDmMessages.rowCount ?? 0);
    console.log("[cleanup] responder_locations removed:", delResponderLoc.rowCount ?? 0);
    console.log("[cleanup] incidents unassigned:", unassign.rowCount ?? 0);
    console.log("[cleanup] users removed:", delUsers.rowCount ?? 0);
    console.log("[cleanup] empty dm_conversations removed:", delEmptyDmConvos.rowCount ?? 0);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[cleanup] failed:", err);
  process.exit(1);
});
