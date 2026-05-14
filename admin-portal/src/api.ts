/**
 * Base URL for `/api` JSON routes. Default matches backend `PORT=3003`.
 * If you set `VITE_API_BASE=http://localhost:3003` (missing `/api`), we append `/api` for localhost only.
 */
export const API_BASE = (() => {
  const fallback = "http://localhost:3003/api";
  const raw = String(import.meta.env.VITE_API_BASE ?? "").trim();
  const base = raw || fallback;
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/api")) return trimmed;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) {
    return `${trimmed}/api`;
  }
  return trimmed;
})();

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("cad_admin_token");
  // Merge headers so caller `init.headers` cannot wipe `Authorization` (was overwriting Bearer token → 401).
  const headers = init?.headers != null ? new Headers(init.headers) : new Headers();
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    if (res.status === 401) {
      // Token missing/expired/invalid: reset auth state so the UI returns to login.
      localStorage.removeItem("cad_admin_token");
      localStorage.removeItem("cad_admin_user");
    }
    let msg = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = String(body.error);
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type AdminSettings = {
  allow_user_registration: boolean;
  messaging_enabled: boolean;
  video_streaming_enabled: boolean;
  allow_dispatcher_incident_creation: boolean;
  allow_responder_incident_creation: boolean;
  maintenance_mode_enabled: boolean;
};

export type PermissionMatrix = {
  availablePermissions: string[];
  matrix: {
    dispatcher: string[];
    responder: string[];
  };
};
