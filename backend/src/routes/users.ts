import type { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requirePermission } from "../middleware/auth";
import type { User } from "../types";
import { logAudit } from "../audit";

const userFilterSchema = z.object({
  q: z.string().optional(),
  role: z.enum(["dispatcher", "responder"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const RESPONDER_UNITS = ["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"] as const;

const upsertUserBaseSchema = z.object({
  username: z.string().min(3),
  name: z.string().min(1),
  role: z.enum(["dispatcher", "responder"]),
  callsign: z.string().optional(),
  unit: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers.")
    .optional(),
});

const upsertUserSchema = upsertUserBaseSchema.refine(
  (data) =>
    data.role === "responder"
      ? data.unit && RESPONDER_UNITS.includes(data.unit as (typeof RESPONDER_UNITS)[number])
      : true,
  { message: "Responders must have a department (EMS, Traffic Police, or Crime Police).", path: ["unit"] }
);

const updateUserSchema = upsertUserBaseSchema.partial().extend({
  password: upsertUserBaseSchema.shape.password,
});

const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers."),
});

export function registerUserRoutes(router: Router) {
  // List/search/filter users
  router.get("/users", requireAuth, requirePermission("users:read"), async (req, res, next) => {
    try {
      const params = userFilterSchema.parse(req.query);
      const values: unknown[] = [];
      const conditions: string[] = [];

      if (params.q) {
        values.push(`%${params.q}%`);
        const idx = values.length;
        conditions.push(
          `(username ILIKE $${idx} OR name ILIKE $${idx} OR phone ILIKE $${idx})`
        );
      }
      if (params.role) {
        values.push(params.role);
        conditions.push(`role = $${values.length}`);
      }
      if (params.status) {
        values.push(params.status === "active");
        conditions.push(`is_active = $${values.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await query<
        User & {
          is_active: boolean;
        }
      >(
        `SELECT id, username, name, role, callsign, unit, phone, is_active
         FROM users
         ${where}
         ORDER BY name ASC`,
        values
      );

      const unique = [...new Map(rows.map((u) => [u.id, u])).values()];
      unique.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

      res.json(
        unique.map((u) => ({
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          callsign: u.callsign,
          unit: u.unit,
          phone: u.phone,
          isActive: u.is_active,
        }))
      );
    } catch (err) {
      next(err);
    }
  });

  // Create user
  router.post("/users", requireAuth, requirePermission("users:manage"), async (req, res, next) => {
    try {
      const authUser = req.authUser!;
      const data = upsertUserSchema.parse(req.body);

      const { rows: existing } = await query<{ id: string }>(
        `SELECT id FROM users WHERE username = $1`,
        [data.username]
      );
      if (existing[0]) {
        res.status(400).json({ error: "Username already exists" });
        return;
      }

      const password =
        data.password ??
        Math.random().toString(36).slice(2, 10) + Math.random().toString(10).slice(2, 4);
      const passwordHash = await bcrypt.hash(password, 10);

      const { rows } = await query<
        User & {
          is_active: boolean;
        }
      >(
        `INSERT INTO users (username, name, role, callsign, unit, phone, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))
         RETURNING id, username, name, role, callsign, unit, phone, is_active`,
        [
          data.username,
          data.name,
          data.role,
          data.callsign ?? null,
          data.unit ?? null,
          data.phone ?? null,
          passwordHash,
          data.isActive ?? true,
        ]
      );

      const user = rows[0];
      await logAudit({
        action: "user:created",
        userId: authUser.id,
        userName: authUser.name,
        entityType: "user",
        entityId: user.id,
        details: { role: user.role },
      });

      res.status(201).json({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        callsign: user.callsign,
        unit: user.unit,
        phone: user.phone,
        isActive: user.is_active,
        // Return generated password only once for display; caller should show it securely.
        temporaryPassword: data.password ? undefined : password,
      });
    } catch (err) {
      next(err);
    }
  });

  // Update user (name, role, contact, active flag, optional password)
  router.patch(
    "/users/:id",
    requireAuth,
    requirePermission("users:manage"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { id } = req.params;
        const data = updateUserSchema.parse(req.body);

        const { rows: existing } = await query<
          User & {
            is_active: boolean;
          }
        >(`SELECT id, username, name, role, callsign, unit, phone, is_active FROM users WHERE id = $1`, [
          id,
        ]);
        const current = existing[0];
        if (!current) {
          res.status(404).json({ error: "User not found" });
          return;
        }

        const fields: string[] = [];
        const values: unknown[] = [];

        if (data.name !== undefined) {
          values.push(data.name);
          fields.push(`name = $${values.length}`);
        }
        if (data.role !== undefined) {
          values.push(data.role);
          fields.push(`role = $${values.length}`);
        }
        if (data.callsign !== undefined) {
          values.push(data.callsign);
          fields.push(`callsign = $${values.length}`);
        }
        if (data.unit !== undefined) {
          values.push(data.unit);
          fields.push(`unit = $${values.length}`);
        }
        if (data.phone !== undefined) {
          values.push(data.phone);
          fields.push(`phone = $${values.length}`);
        }
        if (data.isActive !== undefined) {
          values.push(data.isActive);
          fields.push(`is_active = $${values.length}`);
        }

        if (data.password) {
          const passwordHash = await bcrypt.hash(data.password, 10);
          values.push(passwordHash);
          fields.push(`password_hash = $${values.length}`);
        }

        if (fields.length === 0) {
          res.status(400).json({ error: "No changes provided" });
          return;
        }

        values.push(id);
        const { rows } = await query<
          User & {
            is_active: boolean;
          }
        >(
          `UPDATE users
           SET ${fields.join(", ")}
           WHERE id = $${values.length}
           RETURNING id, username, name, role, callsign, unit, phone, is_active`,
          values
        );

        const updated = rows[0];
        await logAudit({
          action: "user:updated",
          userId: authUser.id,
          userName: authUser.name,
          entityType: "user",
          entityId: updated.id,
        });

        res.json({
          id: updated.id,
          username: updated.username,
          name: updated.name,
          role: updated.role,
          callsign: updated.callsign,
          unit: updated.unit,
          phone: updated.phone,
          isActive: updated.is_active,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Explicit activate/deactivate helpers
  router.post(
    "/users/:id/activate",
    requireAuth,
    requirePermission("users:manage"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { id } = req.params;
        const { rows } = await query<{ id: string; role: string }>(
          `UPDATE users SET is_active = TRUE WHERE id = $1 RETURNING id, role`,
          [id]
        );
        const updated = rows[0];
        if (!updated) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        await logAudit({
          action: "user:activated",
          userId: authUser.id,
          userName: authUser.name,
          entityType: "user",
          entityId: updated.id,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/users/:id/deactivate",
    requireAuth,
    requirePermission("users:manage"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { id } = req.params;
        const { rows } = await query<{ id: string; role: string }>(
          `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id, role`,
          [id]
        );
        const updated = rows[0];
        if (!updated) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        await logAudit({
          action: "user:deactivated",
          userId: authUser.id,
          userName: authUser.name,
          entityType: "user",
          entityId: updated.id,
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  // Reset password for a specific user (managed, not self-service)
  router.post(
    "/users/:id/reset-password",
    requireAuth,
    requirePermission("users:password:reset"),
    async (req, res, next) => {
      try {
        const authUser = req.authUser!;
        const { id } = req.params;
        const { newPassword } = resetPasswordSchema.parse(req.body);

        const { rows: existing } = await query<{ id: string; username: string; role: string }>(
          `SELECT id, username, role FROM users WHERE id = $1`,
          [id]
        );
        const current = existing[0];
        if (!current) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);

        await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, id]);

        await logAudit({
          action: "user:password_reset",
          userId: authUser.id,
          userName: authUser.name,
          entityType: "user",
          entityId: current.id,
        });

        res.status(200).json({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );
}

