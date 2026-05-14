import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db";
import type { User } from "../types";
import { type Permission } from "../rbac";
import { getAdminSetting, getAuthSessionVersion } from "../adminSettings";
import { hasRolePermission } from "../rolePermissions";
import { verifyAdminPortalToken } from "../adminPortalAuth";

export interface AuthUser extends User {
  id: string;
  role: "dispatcher" | "responder";
}

export interface AdminPrincipal {
  id: string;
  role: "admin";
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      adminPrincipal?: AdminPrincipal;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret";

function getBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export function getUserIdFromAuth(req: Request): string | null {
  const token = getBearerToken(req);
  if (!token) return null;

  // Prefer JWTs; keep demo-* tokens for backward compatibility in dev
  if (token.startsWith("demo-")) {
    return token.slice(5);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string };
    return (decoded.sub as string) || (decoded.userId as string) || null;
  } catch {
    return null;
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const userId = getUserIdFromAuth(req);
  if (!userId) {
    next();
    return;
  }
  try {
    const { rows } = await query<User>(
      `SELECT id, username, name, role, callsign, unit
       FROM users
       WHERE id = $1
         AND COALESCE(is_active, TRUE) = TRUE`,
      [userId]
    );
    if (rows[0]) {
      req.authUser = rows[0] as AuthUser;
    }
  } catch {
    // ignore
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = getUserIdFromAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const auth = req.headers.authorization;
    const token = auth?.split(" ")[1];
    if (token && !token.startsWith("demo-")) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { sv?: number };
        const currentSv = await getAuthSessionVersion();
        const tokenSv = Number(decoded?.sv ?? 0);
        if (!Number.isFinite(tokenSv) || tokenSv !== currentSv) {
          res.status(401).json({ error: "Session expired. Please sign in again." });
          return;
        }
      } catch {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const { rows } = await query<User>(
      `SELECT id, username, name, role, callsign, unit
       FROM users
       WHERE id = $1
         AND COALESCE(is_active, TRUE) = TRUE`,
      [userId]
    );
    if (!rows[0]) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const maintenance = await getAdminSetting("maintenance_mode_enabled");
    if (maintenance && rows[0].role !== "dispatcher") {
      res.status(503).json({ error: "System is in maintenance mode. Please try again later." });
      return;
    }
    req.authUser = rows[0] as AuthUser;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Array<"dispatcher" | "responder">) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

export function requirePermission(...permissions: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const checks = await Promise.all(
      permissions.map((p) => hasRolePermission(user.role as "dispatcher" | "responder", p))
    );
    const allowed = checks.some(Boolean);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireAdminAccess() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const adminClaims = verifyAdminPortalToken(token);
    if (adminClaims) {
      req.adminPrincipal = {
        id: adminClaims.sub,
        role: "admin",
        name: adminClaims.name || "Administrator",
      };
      next();
      return;
    }

    // Fallback: allow regular app users with users:manage permission.
    const userId = getUserIdFromAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sv?: number };
      const currentSv = await getAuthSessionVersion();
      const tokenSv = Number(decoded?.sv ?? 0);
      if (!Number.isFinite(tokenSv) || tokenSv !== currentSv) {
        res.status(401).json({ error: "Session expired. Please sign in again." });
        return;
      }

      const { rows } = await query<User>(
        `SELECT id, username, name, role, callsign, unit
         FROM users
         WHERE id = $1
           AND COALESCE(is_active, TRUE) = TRUE`,
        [userId]
      );
      const user = rows[0] as AuthUser | undefined;
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const allowed = await hasRolePermission(user.role as "dispatcher" | "responder", "users:manage");
      if (!allowed) {
        res.status(403).json({ error: "Forbidden: insufficient permissions" });
        return;
      }
      req.authUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
