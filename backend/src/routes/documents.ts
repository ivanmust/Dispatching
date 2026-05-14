import type { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { query } from "../db";
import { requireAuth, requirePermission } from "../middleware/auth";
import { saveFile } from "../storage";
import type { Document } from "../types";

const DOCUMENT_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for SOPs/evacuation
  fileFilter: (_req, file, cb) => {
    if (DOCUMENT_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: PDF, images"));
    }
  },
});

const categorySchema = z.enum(["SOP", "evacuation", "form", "other"]);

export function registerDocumentRoutes(router: Router) {
  router.get("/documents", requireAuth, requirePermission("documents:read"), async (_req, res, next) => {
    try {
      const { rows } = await query<Document>(
        `SELECT id, name, category, file_url AS "fileUrl", created_at AS "createdAt"
         FROM documents ORDER BY category, name`
      );
      res.json(rows);
    } catch (err) {
      const e = err as any;
      const isMissingTable = e?.code === "42P01" || String(e?.message ?? "").includes("relation") && String(e?.message ?? "").includes("documents");
      if (isMissingTable) {
        res.json([]);
        return;
      }
      next(err);
    }
  });

  router.post("/documents", requireAuth, requirePermission("upload:create"), upload.single("file"), async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      if (!DOCUMENT_MIMES.includes(file.mimetype)) {
        res.status(400).json({ error: "Invalid file type" });
        return;
      }
      const name = (req.body.name as string)?.trim() || file.originalname || "Document";
      const category = categorySchema.parse((req.body.category as string) || "other");
      const path = saveFile(file.buffer, file.mimetype);
      const base = process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const fileUrl = path.startsWith("http") ? path : `${base}${path}`;

      const { rows } = await query<Document>(
        `INSERT INTO documents (name, category, file_url) VALUES ($1, $2, $3)
         RETURNING id, name, category, file_url AS "fileUrl", created_at AS "createdAt"`,
        [name, category, fileUrl]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });
}
