import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
    `);
    console.log("last_seen_at column ensured on users table.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

