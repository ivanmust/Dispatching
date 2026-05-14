import type { Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth, requirePermission } from "../middleware/auth";
import { saveFile, getMaxSizeBytes, isAllowedMime } from "../storage";

const ALLOWED_DESCRIPTION =
  "Allowed: images (jpg, png, gif, webp, heic, heif, bmp), videos (mp4, webm, mov, m4v, 3gp), documents (pdf, txt, doc, docx, xls, xlsx, ppt, pptx)";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getMaxSizeBytes() },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) {
      cb(null, true);
    } else {
      // Attach a recognizable code so the route handler can map it to a 415.
      const err = new Error(`Unsupported file type "${file.mimetype}". ${ALLOWED_DESCRIPTION}`);
      (err as any).code = "UNSUPPORTED_FILE_TYPE";
      cb(err as any);
    }
  },
});

function sendUploadError(err: any, res: Response): boolean {
  if (!err) return false;
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      const mb = Math.round(getMaxSizeBytes() / (1024 * 1024));
      res.status(413).json({ error: `File is too large. Maximum allowed size is ${mb} MB.` });
      return true;
    }
    res.status(400).json({ error: err.message || "Upload failed." });
    return true;
  }
  if ((err as any)?.code === "UNSUPPORTED_FILE_TYPE") {
    res.status(415).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

export function registerUploadRoutes(router: Router) {
  router.post(
    "/upload",
    requireAuth,
    requirePermission("upload:create"),
    (req: Request, res: Response, next) => {
      upload.single("file")(req, res, (err: any) => {
        if (err) {
          if (sendUploadError(err, res)) return;
          return next(err);
        }
        try {
          const file = req.file;
          if (!file) {
            res.status(400).json({ error: "No file uploaded" });
            return;
          }
          const path = saveFile(file.buffer, file.mimetype, file.originalname);
          const base = process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`;
          const url = path.startsWith("http") ? path : `${base}${path}`;
          res.json({ url });
        } catch (e) {
          next(e);
        }
      });
    },
  );
}
