/**
 * Reset database: remove all users and data for a fresh start.
 * Run: npm run reset-db
 */
import { pool } from "../src/db";
import fs from "fs";
import path from "path";

const sqlPath = path.join(__dirname, "reset-db.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function main() {
  await pool.query(sql);
  console.log("Database reset complete. All users and data removed.");
  await pool.end();
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
