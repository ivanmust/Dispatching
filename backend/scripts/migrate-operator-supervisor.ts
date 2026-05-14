/**
 * One-time migration: Migrate existing operator and supervisor users to dispatcher.
 * Run with: npm run migrate:operator-supervisor
 */
import { pool, query } from "../src/db";

async function run() {
  const res = await pool.query(
    `UPDATE users SET role = 'dispatcher' WHERE role IN ('operator', 'supervisor') RETURNING id`
  );
  const count = res.rowCount ?? 0;
  console.log(`Migrated ${count} operator/supervisor user(s) to dispatcher.`);
}

run()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
