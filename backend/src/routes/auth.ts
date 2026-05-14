import type { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db";
import type { User } from "../types";
import { getAdminSetting, getAuthSessionVersion } from "../adminSettings";
import { createRateLimiter } from "../middleware/rateLimit";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});

export const RESPONDER_UNITS = ["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"] as const;
export type ResponderUnit = (typeof RESPONDER_UNITS)[number];

const registerSchema = z
  .object({
    username: z.string().min(3),
    password: z
      .string()
      .min(8)
      .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers."),
    name: z.string().min(1),
    role: z.enum(["dispatcher", "responder"]),
    callsign: z.string().optional(),
    unit: z.enum(RESPONDER_UNITS).optional(),
    phone: z.string().optional(),
  })
  .refine(
    (data) => (data.role === "responder" ? data.unit && RESPONDER_UNITS.includes(data.unit as ResponderUnit) : true),
    { message: "Responders must select a department (EMS, Traffic Police, or Crime Police).", path: ["unit"] }
  );

const changePasswordSchema = z.object({
  username: z.string().min(1),
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers."),
});

const resetPasswordSchema = z.object({
  username: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers."),
});

const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret";
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] | undefined) ?? "12h";
const ALLOW_INSECURE_PASSWORD_RESET =
  process.env.ALLOW_INSECURE_PASSWORD_RESET === "true" ||
  process.env.ALLOW_INSECURE_PASSWORD_RESET === "1" ||
  process.env.NODE_ENV !== "production";

async function signToken(userId: string): Promise<string> {
  const sv = await getAuthSessionVersion();
  return jwt.sign({ sub: userId, sv }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function registerAuthRoutes(router: Router) {
  const registerLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 10,
    keyPrefix: "auth:register",
    message: "Too many registration attempts. Please wait and try again.",
  });
  const loginLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 12,
    keyPrefix: "auth:login",
    message: "Too many login attempts. Please wait and try again.",
  });
  const passwordLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 8,
    keyPrefix: "auth:password",
    message: "Too many password operations. Please wait and try again.",
  });

  // Register new user (dispatcher or responder)
  router.post("/auth/register", registerLimiter, async (req, res, next) => {
    try {
      const allowRegistration = await getAdminSetting("allow_user_registration");
      if (!allowRegistration) {
        res.status(403).json({ error: "User registration is disabled by admin." });
        return;
      }
      const data = registerSchema.parse(req.body);

      const { rows: existing } = await query<User>(
        `SELECT id, username, name, role, callsign, unit
         FROM users
         WHERE username = $1`,
        [data.username]
      );

      if (existing[0]) {
        res.status(400).json({ error: "Username already taken" });
        return;
      }

      const passwordHash = await bcrypt.hash(data.password, 10);

      const { rows } = await query<User>(
        `INSERT INTO users (username, name, role, callsign, unit, phone, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, username, name, role, callsign, unit, phone`,
        [data.username, data.name, data.role, data.callsign ?? null, data.unit ?? null, data.phone ?? null, passwordHash]
      );

      const user = rows[0];
      const token = await signToken(user.id);
      res.status(201).json({ token, user });
    } catch (err) {
      next(err);
    }
  });

  // Login
  router.post("/auth/login", loginLimiter, async (req, res, next) => {
    try {
      const { username, password } = loginSchema.parse(req.body);

      const { rows } = await query<
        User & { password_hash: string | null; is_active: boolean | null; role: string }
      >(
        `SELECT id, username, name, role, callsign, unit, password_hash, is_active
         FROM users
         WHERE username = $1`,
        [username]
      );

      const userRow = rows[0];
      if (!userRow || !userRow.password_hash) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      if (userRow.is_active === false) {
        res.status(403).json({ error: "Account inactive" });
        return;
      }
      const role = userRow.role as string;
      if (role === "operator" || role === "supervisor") {
        res.status(403).json({
          error:
            role === "operator"
              ? "Operator app has been removed. Use the Responder app to report incidents."
              : "Supervisor role has been removed. Contact admin.",
        });
        return;
      }

      const ok = await bcrypt.compare(password, userRow.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const user: User = {
        id: userRow.id,
        username: userRow.username,
        name: userRow.name,
        role: role as "dispatcher" | "responder",
        callsign: userRow.callsign,
        unit: userRow.unit,
      };

      const token = await signToken(user.id);
      res.json({ token, user });
    } catch (err) {
      next(err);
    }
  });

  // Change password (simple demo, not token-based)
  router.post("/auth/change-password", passwordLimiter, async (req, res, next) => {
    try {
      const { username, currentPassword, newPassword } = changePasswordSchema.parse(req.body);

      const { rows } = await query<User & { password_hash: string | null; is_active: boolean | null }>(
        `SELECT id, username, name, role, callsign, unit, password_hash, is_active
         FROM users
         WHERE username = $1`,
        [username]
      );

      const userRow = rows[0];
      if (!userRow || !userRow.password_hash) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      if (userRow.is_active === false) {
        res.status(403).json({ error: "Account inactive" });
        return;
      }

      const ok = await bcrypt.compare(currentPassword, userRow.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newHash, userRow.id]
      );

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // Reset password by username only (local/dev). Disabled in production unless explicitly enabled.
  router.post("/auth/reset-password", passwordLimiter, async (req, res, next) => {
    try {
      if (!ALLOW_INSECURE_PASSWORD_RESET) {
        res.status(403).json({ error: "Password reset endpoint disabled" });
        return;
      }

      const { username, newPassword } = resetPasswordSchema.parse(req.body);

      const { rows } = await query<User & { password_hash: string | null; is_active: boolean | null }>(
        `SELECT id, username, name, role, callsign, unit, password_hash, is_active
         FROM users
         WHERE username = $1`,
        [username]
      );

      const userRow = rows[0];
      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (userRow.is_active === false) {
        res.status(403).json({ error: "Account inactive" });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [newHash, userRow.id]
      );

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  });
}

