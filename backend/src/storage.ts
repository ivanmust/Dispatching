import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
const RECORDINGS_DIR = path.join(UPLOADS_DIR, "recordings");
// Allow up to 50 MB. Phone camera photos routinely exceed the old 2 MB cap, and
// short videos can reach tens of megabytes.
const MAX_SIZE_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 50 * 1024 * 1024;
// Note: keep this in sync with frontend DM attachment accept list.
const ALLOWED_TYPES = [
  // Images (include iOS HEIC/HEIF defaults)
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/bmp",
  // Videos (include iOS QuickTime + common mobile formats)
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "video/3gpp",
  "video/3gpp2",
  // Documents
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Fallback for mobile uploads where the client cannot determine a type.
  "application/octet-stream",
];

export function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

export function ensureRecordingsDir() {
  ensureUploadsDir();
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
}

export function getUploadsDir() {
  return UPLOADS_DIR;
}

export function getRecordingsDir() {
  return RECORDINGS_DIR;
}

export function getMaxSizeBytes() {
  return MAX_SIZE_BYTES;
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_TYPES.includes(mime);
}

/**
 * Save buffer to disk, return relative URL path (e.g. /api/uploads/abc-123.jpg)
 */
export function saveFile(buffer: Buffer, mime: string, originalName?: string): string {
  ensureUploadsDir();
  const normalizedMime = String(mime || "").toLowerCase();
  let ext = "bin";
  if (normalizedMime === "image/jpeg" || normalizedMime === "image/jpg" || normalizedMime === "image/pjpeg") ext = "jpg";
  else if (normalizedMime === "image/heic" || normalizedMime === "image/heic-sequence") ext = "heic";
  else if (normalizedMime === "image/heif" || normalizedMime === "image/heif-sequence") ext = "heif";
  else if (normalizedMime === "image/png") ext = "png";
  else if (normalizedMime === "image/gif") ext = "gif";
  else if (normalizedMime === "image/webp") ext = "webp";
  else if (normalizedMime === "image/bmp") ext = "bmp";
  else if (normalizedMime === "video/mp4") ext = "mp4";
  else if (normalizedMime === "video/webm") ext = "webm";
  else if (normalizedMime === "video/quicktime") ext = "mov";
  else if (normalizedMime === "video/x-m4v") ext = "m4v";
  else if (normalizedMime === "video/3gpp") ext = "3gp";
  else if (normalizedMime === "video/3gpp2") ext = "3g2";
  else if (normalizedMime === "application/pdf") ext = "pdf";
  else if (normalizedMime === "text/plain") ext = "txt";
  else if (normalizedMime === "application/msword") ext = "doc";
  else if (normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ext = "docx";
  else if (normalizedMime === "application/vnd.ms-excel") ext = "xls";
  else if (normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ext = "xlsx";
  else if (normalizedMime === "application/vnd.ms-powerpoint") ext = "ppt";
  else if (normalizedMime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") ext = "pptx";
  else if (originalName && /\.[a-zA-Z0-9]{1,6}$/.test(originalName)) {
    ext = originalName.split(".").pop()!.toLowerCase();
  }
  const safeExt = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "bmp",
    "heic",
    "heif",
    "mp4",
    "webm",
    "mov",
    "m4v",
    "3gp",
    "3g2",
    "pdf",
    "txt",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
  ].includes(ext)
    ? ext
    : "bin";
  const filename = `${randomUUID()}.${safeExt}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return `/api/uploads/${filename}`;
}
