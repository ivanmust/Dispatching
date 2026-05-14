import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Set it in .env or pass it as an env var.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Expected columns per table (critical columns the app needs)
const EXPECTED: Record<string, string[]> = {
  users: [
    "id", "username", "name", "role", "callsign", "unit", "password_hash",
    "is_active", "phone", "last_seen_at",
  ],
  incidents: [
    "id", "title", "description", "status", "priority", "category",
    "location_lat", "location_lon", "location_address",
    "assigned_responder_id", "assigned_responder_name",
    "created_by_id", "created_by_name", "created_by_role",
    "created_at", "updated_at", "caller_phone", "details",
  ],
  incident_witnesses: ["id", "incident_id", "name", "phone", "email", "notes", "created_at"],
  chat_messages: [
    "id", "incident_id", "sender_id", "sender_name", "sender_role", "content",
    "created_at", "attachment_url", "attachment_type",
  ],
  audit_logs: ["id", "action", "user_id", "user_name", "entity_type", "entity_id", "details", "created_at"],
  notifications: ["id", "user_id", "type", "title", "body", "metadata", "is_read", "created_at"],
};

async function getTables(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: { table_name: string }[] }> }): Promise<string[]> {
  const r = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return r.rows.map((row) => row.table_name);
}

async function getColumns(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: { column_name: string }[] }> }, table: string): Promise<string[]> {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return r.rows.map((row) => row.column_name);
}

async function main() {
  const client = await pool.connect();
  try {
    const tables = await getTables(client);
    console.log("Tables in database:", tables.join(", "));
    console.log("");

    const missing: string[] = [];
    const extra: string[] = [];

    for (const [table, expectedCols] of Object.entries(EXPECTED)) {
      if (!tables.includes(table)) {
        missing.push(`Table '${table}' is missing`);
        continue;
      }
      const cols = await getColumns(client, table);
      for (const col of expectedCols) {
        if (!cols.includes(col)) {
          missing.push(`${table}.${col}`);
        }
      }
    }

    if (missing.length > 0) {
      console.log("Missing schema elements:");
      missing.forEach((m) => console.log("  -", m));
      console.log("");
      console.log("Run 'npm run migrate' to apply schema.sql (adds missing columns/tables).");
      process.exit(1);
    }

    console.log("All expected tables and columns are present.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
