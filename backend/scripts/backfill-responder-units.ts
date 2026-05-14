/**
 * Backfill responder units: set unit='EMS' for responders with missing or invalid unit.
 *
 * Run:
 *   npm run backfill:responder-units
 *   npm run backfill:responder-units -- --dry-run
 */
import { pool, query } from "../src/db";

const VALID_UNITS = new Set(["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"]);
const DEFAULT_UNIT = "EMS";

type UserRow = { id: string; unit: string | null; role: string };

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { rows } = await query<UserRow>(
    `SELECT id, unit, role FROM users WHERE role = 'responder'`
  );

  let updated = 0;

  for (const row of rows) {
    const u = (row.unit ?? "").trim();
    if (VALID_UNITS.has(u)) continue;

    if (!dryRun) {
      await query(`UPDATE users SET unit = $1 WHERE id = $2`, [DEFAULT_UNIT, row.id]);
    }
    updated += 1;
  }

  console.log(
    `[backfill-responder-units] ${dryRun ? "DRY RUN" : "APPLIED"} | responders=${rows.length} updated=${updated}`
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error("[backfill-responder-units] failed:", err);
  await pool.end();
  process.exit(1);
});
