import fs from "fs";
import path from "path";
import { pool } from "./db";

/** Add IN_PROGRESS and migrate legacy EN_ROUTE / ON_SCENE (idempotent). */
async function ensureFiveStateIncidentStatus(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        INNER JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'incident_status' AND e.enumlabel = 'IN_PROGRESS'
      ) AS exists
    `);
    if (!rows[0]?.exists) {
      await client.query(`ALTER TYPE incident_status ADD VALUE 'IN_PROGRESS'`);
    }
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    if (!/already exists|duplicate/i.test(msg)) throw err;
  } finally {
    client.release();
  }

  await pool.query(
    `UPDATE incidents SET status = 'IN_PROGRESS'::incident_status WHERE status::text IN ('EN_ROUTE', 'ON_SCENE')`
  );
  await pool.query(
    `UPDATE incident_status_history SET to_status = 'IN_PROGRESS' WHERE to_status IN ('EN_ROUTE', 'ON_SCENE')`
  );
  await pool.query(
    `UPDATE incident_status_history SET from_status = 'IN_PROGRESS' WHERE from_status IN ('EN_ROUTE', 'ON_SCENE')`
  );
}

async function run() {
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  await ensureFiveStateIncidentStatus();
  console.log("Database schema applied successfully.");
}

run()
  .catch((err) => {
    console.error("Migration failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
