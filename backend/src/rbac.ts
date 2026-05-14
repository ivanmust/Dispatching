/**
 * Role-Based Access Control
 * Maps roles to allowed permissions. Use requirePermission middleware for route protection.
 */
export type Role = "dispatcher" | "responder";

export type Permission =
  | "incidents:read"
  | "incidents:create"
  | "incidents:update"
  | "incidents:assign"
  | "incidents:mine"
  | "responders:read"
  | "audit:read"
  | "messages:read"
  | "messages:send"
  | "upload:create"
  | "poi:read"
  | "documents:read"
  | "responder:incidents"
  | "responder:location"
  | "status:update"
  | "users:read"
  | "users:manage"
  | "users:password:reset";

export const ALL_PERMISSIONS: Permission[] = [
  "incidents:read",
  "incidents:create",
  "incidents:update",
  "incidents:assign",
  "incidents:mine",
  "responders:read",
  "audit:read",
  "messages:read",
  "messages:send",
  "upload:create",
  "poi:read",
  "documents:read",
  "responder:incidents",
  "responder:location",
  "status:update",
  "users:read",
  "users:manage",
  "users:password:reset",
];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  dispatcher: [
    "incidents:read",
    "incidents:create",
    "incidents:update",
    "incidents:assign",
    "responders:read",
    "audit:read",
    "messages:read",
    "messages:send",
    "upload:create",
    "poi:read",
    "documents:read",
    "status:update",
    "users:read",
    "users:manage",
    "users:password:reset",
  ],
  responder: [
    "incidents:create",
    "responder:incidents",
    "responder:location",
    "messages:read",
    "messages:send",
    "upload:create",
    "poi:read",
    "documents:read",
    "status:update",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const perms = DEFAULT_ROLE_PERMISSIONS[role];
  return perms?.includes(permission) ?? false;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}
