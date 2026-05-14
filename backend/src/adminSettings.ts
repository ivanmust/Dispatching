import { query } from "./db";

export type AdminSettingKey =
  | "allow_user_registration"
  | "messaging_enabled"
  | "video_streaming_enabled"
  | "allow_dispatcher_incident_creation"
  | "allow_responder_incident_creation"
  | "maintenance_mode_enabled";

type AdminSettings = Record<AdminSettingKey, boolean>;

const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  allow_user_registration: true,
  messaging_enabled: true,
  video_streaming_enabled: true,
  allow_dispatcher_incident_creation: true,
  allow_responder_incident_creation: true,
  maintenance_mode_enabled: false,
};

const AUTH_SESSION_VERSION_KEY = "auth_session_version";

export async function ensureAdminSettingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const [key, val] of Object.entries(DEFAULT_ADMIN_SETTINGS)) {
    await query(
      `INSERT INTO admin_settings (key, value)
       VALUES ($1, to_jsonb($2::boolean))
       ON CONFLICT (key) DO NOTHING`,
      [key, val]
    );
  }
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const { rows } = await query<{ key: AdminSettingKey; value: unknown }>(
    `SELECT key, value FROM admin_settings
     WHERE key IN (
       'allow_user_registration',
       'messaging_enabled',
       'video_streaming_enabled',
       'allow_dispatcher_incident_creation',
       'allow_responder_incident_creation',
       'maintenance_mode_enabled'
     )`
  );
  const out: AdminSettings = { ...DEFAULT_ADMIN_SETTINGS };
  for (const row of rows) {
    if (
      row.key in out &&
      typeof row.value === "boolean"
    ) {
      out[row.key] = row.value;
    }
  }
  return out;
}

export async function getAdminSetting(key: AdminSettingKey): Promise<boolean> {
  const { rows } = await query<{ value: unknown }>(
    `SELECT value FROM admin_settings WHERE key = $1 LIMIT 1`,
    [key]
  );
  const val = rows[0]?.value;
  if (typeof val === "boolean") return val;
  return DEFAULT_ADMIN_SETTINGS[key];
}

export async function setAdminSettings(next: Partial<AdminSettings>) {
  const entries = Object.entries(next).filter(([, v]) => typeof v === "boolean") as Array<
    [AdminSettingKey, boolean]
  >;
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO admin_settings (key, value, updated_at)
       VALUES ($1, to_jsonb($2::boolean), NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  }
}

export async function getAuthSessionVersion(): Promise<number> {
  const { rows } = await query<{ value: unknown }>(
    `SELECT value FROM admin_settings WHERE key = $1 LIMIT 1`,
    [AUTH_SESSION_VERSION_KEY]
  );
  const v = rows[0]?.value;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  await query(
    `INSERT INTO admin_settings (key, value, updated_at)
     VALUES ($1, to_jsonb($2::int), NOW())
     ON CONFLICT (key) DO NOTHING`,
    [AUTH_SESSION_VERSION_KEY, 1]
  );
  return 1;
}

export async function bumpAuthSessionVersion(): Promise<number> {
  const current = await getAuthSessionVersion();
  const next = current + 1;
  await query(
    `INSERT INTO admin_settings (key, value, updated_at)
     VALUES ($1, to_jsonb($2::int), NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [AUTH_SESSION_VERSION_KEY, next]
  );
  return next;
}

