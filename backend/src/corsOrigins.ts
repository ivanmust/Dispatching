const LOCAL_DEV_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:8083",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8084",
  "http://localhost:8085",
  "http://localhost:19006",
];

function configuredOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGINS ?? "";
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin: string | undefined, isProd: boolean): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (
    normalized.startsWith("http://localhost:") ||
    normalized.startsWith("http://127.0.0.1:") ||
    normalized.startsWith("https://localhost:") ||
    normalized.startsWith("https://127.0.0.1:")
  ) {
    return true;
  }
  if (!isProd && /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(normalized)) {
    return true;
  }
  return new Set([...LOCAL_DEV_ORIGINS, ...configuredOrigins()]).has(normalized);
}
