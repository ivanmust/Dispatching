import type { MobileUser } from "../lib/storage";
import { getCadToken } from "./storage";
import { API_BASE, API_BASE_CANDIDATES } from "../config";

export type IncidentStatus = "NEW" | "ASSIGNED" | "REJECTED" | "CLOSED" | string;
export type IncidentPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;

export type Incident = {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  category: string;
  location: { lat: number; lon: number; address: string };
  callerPhone?: string | null;
  details?: Record<string, unknown> | null;
  assignedResponderId?: string | null;
  assignedResponderName?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationItem = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  incidentId: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  content?: string;
  timestamp: string;
  attachmentUrl?: string | null;
  attachmentType?: "image" | "video" | null;
};

export type DmContact = {
  id: string;
  username: string;
  name: string;
  role: string;
  callsign?: string | null;
  unit?: string | null;
  phone?: string | null;
  isActive: boolean;
  online?: boolean;
  lastSeen?: string | null;
  unreadCount?: number;
  /** Total messages in the DM thread with this contact (both directions). */
  totalMessageCount?: number;
  /** Messages sent by the current logged-in user in this DM thread. */
  mySentCount?: number;
  /** Messages sent by this contact in this DM thread. */
  theirSentCount?: number;
};

export type DmMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  deliveredAt?: string | null;
  readAt?: string | null;
  deletedAt?: string | null;
  myReaction?: string | null;
  reactionCounts?: Record<string, number>;
  attachmentUrl?: string | null;
  attachmentType?: "image" | "video" | "document" | null;
  attachmentName?: string | null;
};

export type ResponderListItem = {
  id: string;
  name: string;
  status: "AVAILABLE" | "BUSY" | "OFF_DUTY" | string;
  unit: string;
  phone?: string;
};

export type PointOfInterest = {
  id: string;
  type: string;
  lat: number;
  lon: number;
  label?: string | null;
};

export type Geofence = {
  id: string;
  name: string;
  type: string;
  geometry: Record<string, unknown>;
  createdAt: string;
};

export type ReverseGeocodeResult = {
  province?: string | null;
  district?: string | null;
  sector?: string | null;
  cell?: string | null;
  village?: string | null;
  addressLine?: string | null;
};

export type NavigationRouteResult = {
  path: Array<{ lat: number; lon: number }>;
  distanceMeters: number;
  etaMinutes: number;
  maneuvers: Array<{
    text: string;
    lengthMeters?: number;
    timeMinutes?: number;
    path?: Array<{ lat: number; lon: number }>;
  }>;
};

export type NavigationPublishPayload = {
  incidentId: string;
  origin?: { lat: number; lon: number };
  path?: Array<{ lat: number; lon: number }>;
  distanceMeters?: number;
  etaMinutes?: number;
  routeUnavailable?: boolean;
  routingEngine?: string;
};

type BackendIncident = {
  id: string;
  title: string;
  description: string;
  status: Incident["status"];
  priority: Incident["priority"];
  category: string;
  locationLat: number;
  locationLon: number;
  locationAddress?: string | null;
  callerPhone?: string | null;
  details?: Record<string, unknown> | null;
  assignedResponderId?: string | null;
  assignedResponderName?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Canonical map key so UUID casing variants collapse to one row. */
export function incidentDedupeKey(id: unknown): string {
  return String(id ?? "").trim().toLowerCase();
}

/** Assigned-incident payloads should not repeat the same id (matches dispatcher dedupe). */
export function dedupeIncidentsByIdPreferNewest(items: Incident[]): Incident[] {
  const byId = new Map<string, Incident>();
  for (const inc of items) {
    const key = incidentDedupeKey(inc.id);
    if (!key) continue;
    const prev = byId.get(key);
    if (!prev || new Date(inc.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()) {
      byId.set(key, inc);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function mapIncident(raw: BackendIncident): Incident {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    priority: raw.priority,
    category: raw.category,
    location: {
      lat: raw.locationLat,
      lon: raw.locationLon,
      address: raw.locationAddress ?? "",
    },
    callerPhone: raw.callerPhone ?? null,
    details: raw.details ?? null,
    assignedResponderId: raw.assignedResponderId ?? null,
    assignedResponderName: raw.assignedResponderName ?? null,
    createdById: raw.createdById ?? null,
    createdByName: raw.createdByName ?? null,
    createdByRole: raw.createdByRole ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getCadToken();
  let lastErr: unknown = null;
  const bases = Array.isArray(API_BASE_CANDIDATES) && API_BASE_CANDIDATES.length ? API_BASE_CANDIDATES : [API_BASE];
  const timeoutMs = 12_000;

  for (const base of bases) {
    // Simple retry for transient network errors per candidate host.
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${base}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options?.headers ?? {}),
          },
        });
        clearTimeout(timer);

        if (res.status === 401) {
          throw new Error("Unauthorized");
        }

        if (!res.ok) {
          let msg = `API error: ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error && typeof body.error === "string") msg = body.error;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }

        if (res.status === 204) {
          return undefined as T;
        }
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const m = msg.toLowerCase();
        const isRetryable =
          m.includes("fetch") ||
          m.includes("network") ||
          m.includes("failed to fetch") ||
          m.includes("aborted");

        if (attempt < 1 && isRetryable) {
          await new Promise((r) => setTimeout(r, 650));
          continue;
        }

        // Only move to next base candidate for network-level failures.
        if (isRetryable) break;
        throw err;
      }
    }
  }

  throw new Error(
    `Unable to reach backend API. Check network/API host and ensure backend is running on port 3003. Tried: ${bases.join(", ")}`,
  );
}

export const api = {
  login: async (credentials: { username: string; password: string }): Promise<{ token: string; user: any }> => {
    return request(`/auth/login`, {
      method: "POST",
      body: JSON.stringify(credentials),
    });
  },

  getAssignedIncidents: async (): Promise<Incident[]> => {
    const rows = await request<BackendIncident[]>(`/responder/incidents`);
    return dedupeIncidentsByIdPreferNewest(rows.map(mapIncident));
  },

  // Full incident list (same endpoint the dispatcher uses). Backend allows responders read-only.
  getAllIncidents: async (params?: {
    status?: string | string[];
    limit?: number;
    offset?: number;
  }): Promise<Incident[]> => {
    const q = new URLSearchParams();
    if (params?.status) {
      const s = Array.isArray(params.status) ? params.status.join(",") : params.status;
      if (s) q.set("status", s);
    }
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const query = q.toString();
    const rows = await request<BackendIncident[]>(`/incidents${query ? `?${query}` : ""}`);
    return rows.map(mapIncident);
  },

  // Full responder roster (dispatcher-style) for fleet rendering on the map.
  getResponders: async (params?: { unit?: "EMS" | "TRAFFIC_POLICE" | "CRIME_POLICE" }): Promise<ResponderListItem[]> => {
    const q = params?.unit ? `?unit=${encodeURIComponent(params.unit)}` : "";
    return request<ResponderListItem[]>(`/responders${q}`);
  },

  getPointsOfInterest: async (): Promise<PointOfInterest[]> => {
    return request<PointOfInterest[]>(`/points-of-interest`);
  },

  getGeofences: async (): Promise<Geofence[]> => {
    return request<Geofence[]>(`/geofences`);
  },

  // Rwanda-aware reverse geocoding used by the dispatcher for pick-mode address resolution.
  getReverseGeocode: async (lat: number, lon: number): Promise<ReverseGeocodeResult> => {
    const q = new URLSearchParams();
    q.set("lat", String(lat));
    q.set("lon", String(lon));
    return request<ReverseGeocodeResult>(`/arcgis/reverse-geocode?${q.toString()}`);
  },

  getNavigationRoute: async (origin: { lat: number; lon: number }, destination: { lat: number; lon: number }): Promise<NavigationRouteResult> => {
    const payload = { method: "POST", body: JSON.stringify({ origin, destination }) };
    const endpoints = [
      "/arcgis/navigation/route", // current canonical
      "/route", // legacy fallback
      "/arcgis/route", // legacy variant seen in older branches
    ];
    let lastErr: unknown = null;
    for (const endpoint of endpoints) {
      try {
        return await request<NavigationRouteResult>(endpoint, payload);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        // Continue trying only for 404 path mismatch.
        if (/API error:\s*404/i.test(msg)) continue;
        throw err;
      }
    }
    throw new Error(
      `Route endpoint not found (404). Tried: ${endpoints.join(", ")}. Restart backend on latest code and ensure /api/arcgis/navigation/route is available. Last error: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`
    );
  },

  publishNavigationUpdate: async (payload: NavigationPublishPayload): Promise<void> => {
    await request<void>(`/responder/navigation-update`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createIncident: async (payload: {
    title: string;
    description: string;
    status: "NEW";
    priority: IncidentPriority;
    category: string;
    location: { lat: number; lon: number; address?: string };
    callerPhone?: string;
    details?: Record<string, unknown>;
    createdById?: string;
    createdByName?: string;
    createdByRole?: "dispatcher" | "responder";
  }): Promise<Incident> => {
    const row = await request<BackendIncident>(`/incidents`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return mapIncident(row);
  },

  getIncident: async (incidentId: string): Promise<Incident> => {
    const row = await request<BackendIncident>(`/incidents/${incidentId}`);
    return mapIncident(row);
  },

  acceptAssignedIncident: async (incidentId: string): Promise<Incident> => {
    const row = await request<BackendIncident>(`/incidents/${incidentId}/accept`, { method: "POST", body: JSON.stringify({}) });
    return mapIncident(row);
  },

  startAssignedIncident: async (incidentId: string): Promise<Incident> => {
    try {
      return await api.acceptAssignedIncident(incidentId);
    } catch (err) {
      const current = await api.getIncident(incidentId);
      if (String(current.status).toUpperCase() === "IN_PROGRESS") return current;
      throw err;
    }
  },

  rejectAssignedIncident: async (incidentId: string, reason?: string): Promise<Incident> => {
    const row = await request<BackendIncident>(`/incidents/${incidentId}/reject-responder`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? undefined }),
    });
    return mapIncident(row);
  },

  completeAssignedIncident: async (incidentId: string, summary?: string): Promise<Incident> => {
    const row = await request<BackendIncident>(`/incidents/${incidentId}/complete`, {
      method: "POST",
      body: JSON.stringify({ summary: summary ?? undefined }),
    });
    return mapIncident(row);
  },

  getNotifications: async (limit = 50, offset = 0): Promise<NotificationItem[]> => {
    const q = new URLSearchParams();
    q.set("limit", String(limit));
    q.set("offset", String(offset));
    return request<NotificationItem[]>(`/notifications?${q.toString()}`);
  },

  markAllNotificationsRead: async (): Promise<void> => {
    await request<void>(`/notifications/read-all`, { method: "PATCH" });
  },

  markNotificationRead: async (notificationId: string): Promise<void> => {
    await request<void>(`/notifications/${notificationId}/read`, { method: "PATCH" });
  },

  getUnreadNotificationCount: async (): Promise<{ count: number }> => {
    return request<{ count: number }>(`/notifications/unread-count`);
  },

  getIncidentMessages: async (incidentId: string): Promise<ChatMessage[]> => {
    return request<ChatMessage[]>(`/incidents/${incidentId}/messages`);
  },

  sendIncidentMessage: async (
    incidentId: string,
    data: {
      content?: string;
      attachmentUrl?: string | null;
      attachmentType?: "image" | "video" | null;
    },
  ): Promise<ChatMessage> => {
    const body: Record<string, unknown> = {};
    if (typeof data.content === "string" && data.content.trim().length > 0) body.content = data.content.trim();
    if (data.attachmentUrl) body.attachmentUrl = data.attachmentUrl;
    if (data.attachmentType) body.attachmentType = data.attachmentType;
    return request<ChatMessage>(`/incidents/${incidentId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getLivekitToken: async (incidentId: string): Promise<{ token: string; url: string; roomName: string }> => {
    return request<{ token: string; url: string; roomName: string }>(`/livekit/token`, {
      method: "POST",
      body: JSON.stringify({ incidentId }),
    });
  },

  listDmContacts: async (): Promise<DmContact[]> => {
    return request<DmContact[]>(`/dm/contacts`);
  },

  openDmConversation: async (userId: string): Promise<{ conversationId: string }> => {
    return request<{ conversationId: string }>(`/dm/open`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  getDmHistory: async (conversationId: string, limit = 100): Promise<DmMessage[]> => {
    const q = new URLSearchParams();
    q.set("conversationId", conversationId);
    q.set("limit", String(limit));
    return request<DmMessage[]>(`/dm/history?${q.toString()}`);
  },

  sendDmMessage: async (
    conversationId: string,
    data: {
      content: string;
      attachmentUrl?: string | null;
      attachmentType?: "image" | "video" | "document" | null;
      attachmentName?: string | null;
    },
  ): Promise<DmMessage> => {
    return request<DmMessage>(`/dm/send`, {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        content: data.content,
        attachmentUrl: data.attachmentUrl ?? undefined,
        attachmentType: data.attachmentType ?? undefined,
        attachmentName: data.attachmentName ?? undefined,
      }),
    });
  },

  markDmMessageReceipt: async (messageId: string, status: "delivered" | "read" = "read"): Promise<void> => {
    await request<void>(`/dm/receipt`, {
      method: "POST",
      body: JSON.stringify({ messageId, status }),
    });
  },

  reactDmMessage: async (
    messageId: string,
    reactionType: "like" | "love" | "laugh" | "wow" | "sad" | "angry",
  ): Promise<{ messageId: string; myReaction: string | null; reactionCounts: Record<string, number> }> => {
    return request("/dm/react", {
      method: "POST",
      body: JSON.stringify({ messageId, reactionType }),
    });
  },

  deleteDmMessage: async (messageId: string): Promise<void> => {
    await request("/dm/delete", {
      method: "POST",
      body: JSON.stringify({ messageId }),
    });
  },

  uploadFile: async (file: {
    uri: string;
    name: string;
    type: string;
  }): Promise<{ url: string }> => {
    const token = await getCadToken();
    const form = new FormData();
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);
    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      let msg = `Upload failed: ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error && typeof body.error === "string") msg = body.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return (await res.json()) as { url: string };
  },

  // Used by responder dashboard to update unit availability and location.
  updateLocation: async (lat: number, lon: number): Promise<void> => {
    await request<void>(`/responder/location`, { method: "POST", body: JSON.stringify({ lat, lon }) });
  },

  // Convenience for mobile login: normalize user object to what UI needs.
  mapResponderUser: (u: any): MobileUser => ({
    id: String(u.id),
    name: String(u.name ?? ""),
    callsign: u.callsign ?? undefined,
    unit: u.unit ?? undefined,
  }),
};

