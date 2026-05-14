import { query } from "./db";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from "./rbac";

const permissionSettingKey = (role: Role) => `role_permissions_${role}`;

export async function ensureRolePermissionsSeeded() {
  for (const role of ["dispatcher", "responder"] as const) {
    await query(
      `INSERT INTO admin_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [permissionSettingKey(role), JSON.stringify(DEFAULT_ROLE_PERMISSIONS[role])]
    );
  }
}

export async function getRolePermissions(role: Role): Promise<Permission[]> {
  const { rows } = await query<{ value: unknown }>(
    `SELECT value FROM admin_settings WHERE key = $1 LIMIT 1`,
    [permissionSettingKey(role)]
  );
  const val = rows[0]?.value;
  if (Array.isArray(val)) {
    const filtered = val.filter((p): p is Permission => typeof p === "string" && ALL_PERMISSIONS.includes(p as Permission));
    return Array.from(new Set(filtered));
  }
  return DEFAULT_ROLE_PERMISSIONS[role];
}

export async function hasRolePermission(role: Role, permission: Permission): Promise<boolean> {
  const perms = await getRolePermissions(role);
  return perms.includes(permission);
}

export async function setRolePermissions(role: Role, permissions: Permission[]) {
  const normalized = Array.from(
    new Set(permissions.filter((p) => ALL_PERMISSIONS.includes(p)))
  );
  await query(
    `INSERT INTO admin_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [permissionSettingKey(role), JSON.stringify(normalized)]
  );
}

