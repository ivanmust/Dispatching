import dotenv from "dotenv";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";


dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function buildConnectionStringFromParts(): string | null {
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD ?? "";
  if (!host || !port || !database || !user) return null;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function isLocalDatabaseHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function resolvePostgresSsl(connection: string): false | { rejectUnauthorized: boolean } {
  const explicitMode = String(process.env.PGSSLMODE ?? "").trim().toLowerCase();
  if (explicitMode === "disable") return false;
  if (explicitMode === "require" || explicitMode === "no-verify") return { rejectUnauthorized: false };
  if (explicitMode === "verify-full" || explicitMode === "verify-ca") return { rejectUnauthorized: true };

  try {
    const url = new URL(connection);
    const sslMode = String(url.searchParams.get("sslmode") ?? "").trim().toLowerCase();
    if (sslMode === "disable") return false;
    if (sslMode === "require" || sslMode === "no-verify") return { rejectUnauthorized: false };
    if (sslMode === "verify-full" || sslMode === "verify-ca") return { rejectUnauthorized: true };
    if (!isLocalDatabaseHost(url.hostname)) return { rejectUnauthorized: false };
  } catch {
    // Fall through to the environment-based default.
  }

  return process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false;
}

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.DB_URL ??
  buildConnectionStringFromParts();

if (!connectionString) {
  throw new Error(
    "Database connection is not configured. Set DATABASE_URL (or POSTGRES_URL/DB_URL, or PGHOST+PGPORT+PGDATABASE+PGUSER+PGPASSWORD)."
  );
}

export const pool = new Pool({
  connectionString,
  ssl: resolvePostgresSsl(connectionString),
  // Helps prevent unexpected disconnects on some networks/hosts.
  keepAlive: true,
  // Avoid hanging forever when DB is down, but allow enough time for LAN/dev DB.
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 30_000),
  // Keep the pool healthy over time (Postgres can terminate idle connections).
  idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_TIMEOUT_MS ?? 30_000),
  // Cap connections so background jobs (and API traffic) don't overwhelm Postgres.
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

pool.on("error", (err) => {
  console.error("[db] Pool error:", err?.message ?? err);
});

function isTransientConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; code?: string };
  const message = String(e.message ?? "");
  const code = String(e.code ?? "");
  return (
    message.includes("Connection terminated unexpectedly") ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "57P01" ||
    code === "57P02"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<{ rows: T[] }> {
  try {
    const res = await pool.query<T>(text, params);
    return { rows: res.rows };
  } catch (err) {
    if (!isTransientConnectionError(err)) throw err;
    console.warn("[db] transient connection error; retrying query once");
    await sleep(100);
    const retry = await pool.query<T>(text, params);
    return { rows: retry.rows };
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

