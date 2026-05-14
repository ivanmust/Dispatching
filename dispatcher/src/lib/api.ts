import type { Incident, Responder, ChatMessage, IncidentStatus, IncidentCategory, IncidentPriority } from '@/types/incident';

export interface AuditLogEntry {
  id: string;
  action: string;
  userId?: string | null;
  userName?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface IncidentHistoryEntry {
  id: string;
  incidentId: string;
  fromStatus: string | null;
  toStatus: string;
  changedById: string | null;
  changedByName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminSettings {
  allow_user_registration: boolean;
  messaging_enabled: boolean;
  video_streaming_enabled: boolean;
  allow_dispatcher_incident_creation: boolean;
  allow_responder_incident_creation: boolean;
  maintenance_mode_enabled: boolean;
}

export interface AdminOverview {
  users: {
    total: number;
    active: number;
    dispatchers: number;
    responders: number;
    onlineTotal: number;
    onlineResponders: number;
  };
  settings: AdminSettings;
}

export type AdminPermission =
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

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3003/api';
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('cad_token');
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options?.headers || {}),
        },
      });
      if (res.status === 401) {
        // Token missing/expired or backend restarted: force re-auth instead of spamming requests.
        sessionStorage.removeItem('cad_token');
        sessionStorage.removeItem('cad_user');
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        let msg = `API error: ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error && typeof body.error === 'string') msg = body.error;
        } catch {
          // ignore JSON parse failure
        }
        throw new Error(msg);
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch');
      if (attempt < RETRY_ATTEMPTS && isRetryable) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

type BackendIncident = {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  priority: IncidentPriority;
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
  createdByRole?: 'dispatcher' | 'responder' | null;
  createdAt: string;
  updatedAt: string;
};

type BackendChatMessage = {
  id: string;
  incidentId: string;
  senderId: string;
  senderName: string;
  senderRole: 'dispatcher' | 'responder';
  content: string;
  timestamp: string;
  attachmentUrl?: string | null;
  attachmentType?: 'image' | 'video' | null;
};

/** Canonical map key so merged payloads never show the same UUID twice when casing differs. */
export function incidentDedupeKey(id: unknown): string {
  return String(id ?? '').trim().toLowerCase();
}

/** Crime + legacy incident merges (or bad rows) should never surface duplicate ids in the UI. */
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

function dedupeRespondersById(items: Responder[]): Responder[] {
  return [...new Map(items.map((r) => [r.id, r])).values()];
}

function mapIncident(raw: BackendIncident): Incident {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    priority: raw.priority,
    category: raw.category as IncidentCategory,
    location: {
      lat: raw.locationLat,
      lon: raw.locationLon,
      address: raw.locationAddress ?? undefined,
    },
    callerPhone: raw.callerPhone ?? undefined,
    details: raw.details ?? null,
    assignedResponderId: raw.assignedResponderId ?? undefined,
    assignedResponderName: raw.assignedResponderName ?? undefined,
    createdById: raw.createdById ?? undefined,
    createdByName: raw.createdByName ?? undefined,
    createdByRole: raw.createdByRole ?? undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapMessage(raw: BackendChatMessage): ChatMessage {
  return {
    id: raw.id,
    incidentId: raw.incidentId,
    sender: raw.senderRole,
    senderName: raw.senderName,
    text: raw.content,
    timestamp: raw.timestamp,
    attachmentUrl: raw.attachmentUrl ?? undefined,
    attachmentType: raw.attachmentType ?? undefined,
  };
}

export const api = {
  // Dispatcher auth
  async registerDispatcher(data: { email: string; password: string; name: string; role?: 'dispatcher' }) {
    return request<{ token: string; user: { id: string; username: string; name: string; role: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: data.email,
        password: data.password,
        name: data.name,
        role: data.role ?? 'dispatcher',
      }),
    });
  },

  async changePassword(data: { email: string; currentPassword: string; newPassword: string }) {
    return request<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        username: data.email,
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }),
    });
  },

  /** Reset password without current password (forgot-password flow). Requires ALLOW_INSECURE_PASSWORD_RESET. */
  async resetPassword(data: { username: string; newPassword: string }) {
    return request<{ success: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async loginDispatcher(credentials: { email: string; password: string }) {
    return request<{ token: string; user: { id: string; username: string; name: string; role: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: credentials.email,
        password: credentials.password,
      }),
    });
  },

  async getIncidents(params?: {
    status?: string | string[];
    unit?: 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE';
    limit?: number;
    offset?: number;
  }): Promise<Incident[]> {
    const q = new URLSearchParams();
    if (params?.status) {
      const s = Array.isArray(params.status) ? params.status.join(',') : params.status;
      if (s) q.set('status', s);
    }
    if (params?.unit) q.set('unit', params.unit);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    const query = q.toString();
    const data = await request<BackendIncident[]>(`/incidents${query ? `?${query}` : ''}`);
    return dedupeIncidentsByIdPreferNewest(data.map(mapIncident));
  },

  async getCallLog(phone: string): Promise<Incident[]> {
    const data = await request<BackendIncident[]>(`/call-log?phone=${encodeURIComponent(phone)}`);
    return dedupeIncidentsByIdPreferNewest(data.map(mapIncident));
  },

  async getIncident(id: string): Promise<Incident | undefined> {
    const data = await request<BackendIncident>(`/incidents/${id}`);
    return mapIncident(data);
  },

  async getIncidentHistory(incidentId: string): Promise<IncidentHistoryEntry[]> {
    return request<IncidentHistoryEntry[]>(`/incidents/${incidentId}/history`);
  },

  async createIncident(data: Omit<Incident, 'id' | 'createdAt' | 'updatedAt'>): Promise<Incident> {
    const payload: Record<string, unknown> = {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      category: data.category,
      location: {
        lat: data.location.lat,
        lon: data.location.lon,
        address: data.location.address,
      },
      callerPhone: data.callerPhone ?? null,
      assignedResponderId: data.assignedResponderId,
      assignedResponderName: data.assignedResponderName,
      createdById: data.createdById,
      createdByName: data.createdByName,
      createdByRole: data.createdByRole,
    };
    if (data.details !== undefined && data.details !== null) {
      payload.details = data.details;
    }
    const created = await request<BackendIncident>('/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return mapIncident(created);
  },

  async updateIncident(id: string, updates: Partial<Incident>): Promise<Incident> {
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.location) {
      payload.location = {
        lat: updates.location.lat,
        lon: updates.location.lon,
        address: updates.location.address,
      };
    }
    if (updates.callerPhone !== undefined) payload.callerPhone = updates.callerPhone;
    if (updates.details !== undefined) payload.details = updates.details;
    if (updates.assignedResponderId !== undefined) payload.assignedResponderId = updates.assignedResponderId;
    if (updates.assignedResponderName !== undefined) payload.assignedResponderName = updates.assignedResponderName;

    const updated = await request<BackendIncident>(`/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return mapIncident(updated);
  },

  async assignResponder(
    incidentId: string,
    responderId: string,
    options?: { unitOverride?: boolean; reason?: string }
  ): Promise<Incident> {
    const updated = await request<BackendIncident>(`/incidents/${incidentId}/assign`, {
      method: 'POST',
      body: JSON.stringify({
        responderId,
        ...(options?.unitOverride ? { unitOverride: true } : {}),
        ...(options?.reason ? { reason: options.reason } : {}),
      }),
    });
    return mapIncident(updated);
  },

  async reassignResponder(
    incidentId: string,
    responderId: string,
    options?: { unitOverride?: boolean; reason?: string }
  ): Promise<Incident> {
    const updated = await request<BackendIncident>(`/incidents/${incidentId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({
        responderId,
        ...(options?.unitOverride ? { unitOverride: true } : {}),
        ...(options?.reason ? { reason: options.reason } : {}),
      }),
    });
    return mapIncident(updated);
  },

  async rejectIncident(incidentId: string, reason: string): Promise<Incident> {
    const updated = await request<BackendIncident>(`/incidents/${incidentId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return mapIncident(updated);
  },

  async updateStatus(incidentId: string, status: IncidentStatus): Promise<Incident> {
    const updated = await request<BackendIncident>(`/incidents/${incidentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    return mapIncident(updated);
  },

  async getResponders(params?: { unit?: 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE' }): Promise<Responder[]> {
    const q = params?.unit ? `?unit=${encodeURIComponent(params.unit)}` : '';
    const rows = await request<Responder[]>(`/responders${q}`);
    return dedupeRespondersById(rows);
  },

  /**
   * Ask the backend to rank the closest responders to a point using the in-country
   * ArcGIS Server GPServer FindClosestFacilities tool (road travel time). Falls
   * back to haversine server-side if the tool is unreachable or unconfigured; the
   * response's `engine` field ("arcgis" | "haversine" | "none") tells which was used.
   */
  async getClosestResponders(params: {
    lat: number;
    lon: number;
    limit?: number;
    unit?: 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE';
    cutoffMinutes?: number;
  }): Promise<{
    engine: 'arcgis' | 'haversine' | 'none';
    results: Array<{
      responderId: string;
      name: string;
      unit: string | null;
      distanceKm: number;
      travelTimeMinutes: number | null;
    }>;
  }> {
    const q = new URLSearchParams();
    q.set('lat', String(params.lat));
    q.set('lon', String(params.lon));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.unit) q.set('unit', params.unit);
    if (params.cutoffMinutes) q.set('cutoffMinutes', String(params.cutoffMinutes));
    return request(`/responders/closest?${q.toString()}`);
  },

  async getNavigationRoute(
    origin: { lat: number; lon: number },
    destination: { lat: number; lon: number },
  ): Promise<{
    path: Array<{ lat: number; lon: number }>;
    distanceMeters: number;
    etaMinutes: number;
    maneuvers: Array<{ text: string; lengthMeters?: number; timeMinutes?: number; path?: Array<{ lat: number; lon: number }> }>;
  }> {
    return request('/arcgis/navigation/route', {
      method: 'POST',
      body: JSON.stringify({ origin, destination }),
    });
  },

  async getAuditLogs(params?: { action?: string; limit?: number; offset?: number }) {
    const q = new URLSearchParams();
    if (params?.action) q.set('action', params.action);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const query = q.toString();
    return request<AuditLogEntry[]>(`/audit${query ? `?${query}` : ''}`);
  },

  async getChatMessages(incidentId: string): Promise<ChatMessage[]> {
    const data = await request<BackendChatMessage[]>(`/incidents/${incidentId}/messages`);
    return data.map(mapMessage);
  },

  async getPointsOfInterest(): Promise<Array<{ id: string; type: string; lat: number; lon: number; label?: string | null }>> {
    return request<Array<{ id: string; type: string; lat: number; lon: number; label?: string | null }>>("/points-of-interest");
  },

  async getWitnesses(incidentId: string): Promise<import('@/types/incident').Witness[]> {
    return request(`/incidents/${incidentId}/witnesses`);
  },
  async addWitness(incidentId: string, data: { name: string; phone?: string; email?: string; notes?: string }): Promise<import('@/types/incident').Witness> {
    return request(`/incidents/${incidentId}/witnesses`, { method: 'POST', body: JSON.stringify(data) });
  },
  async deleteWitness(incidentId: string, witnessId: string): Promise<void> {
    const token = sessionStorage.getItem('cad_token');
    const res = await fetch(`${API_BASE}/incidents/${incidentId}/witnesses/${witnessId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
  },

  async getGeofences(): Promise<Array<{ id: string; name: string; type: string; geometry: Record<string, unknown>; createdAt: string }>> {
    return request('/geofences');
  },
  async createGeofence(data: { name: string; type?: string; geometry: { type: 'circle'; lat: number; lon: number; radiusMeters: number } }): Promise<{ id: string; name: string; type: string; geometry: Record<string, unknown> }> {
    return request('/geofences', { method: 'POST', body: JSON.stringify(data) });
  },
  async deleteGeofence(id: string): Promise<void> {
    const token = sessionStorage.getItem('cad_token');
    const res = await fetch(`${API_BASE}/geofences/${id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
  },

  async getDrawings(incidentId: string): Promise<Array<{
    id: string;
    incidentId: string;
    type: 'point' | 'polyline' | 'polygon';
    geometry: Record<string, unknown>;
    style?: Record<string, unknown> | null;
    createdById?: string | null;
    createdAt: string;
  }>> {
    return request(`/incidents/${incidentId}/drawings`);
  },

  async createDrawing(
    incidentId: string,
    data: { type: 'point' | 'polyline' | 'polygon'; geometry: Record<string, unknown>; style?: Record<string, unknown> | null }
  ): Promise<{
    id: string;
    incidentId: string;
    type: 'point' | 'polyline' | 'polygon';
    geometry: Record<string, unknown>;
    style?: Record<string, unknown> | null;
    createdById?: string | null;
    createdAt: string;
  }> {
    const payload: {
      type: 'point' | 'polyline' | 'polygon';
      geometry: Record<string, unknown>;
      style?: Record<string, unknown> | null;
    } = { type: data.type, geometry: data.geometry };
    if (data.style && Object.keys(data.style).length > 0) {
      payload.style = data.style;
    }
    return request(`/incidents/${incidentId}/drawings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteDrawing(incidentId: string, drawingId: string): Promise<void> {
    const token = sessionStorage.getItem('cad_token');
    const res = await fetch(`${API_BASE}/incidents/${incidentId}/drawings/${drawingId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
  },

  async getStatsSummary(): Promise<{
    countsByStatus: Record<string, number>;
    countsByCategory: Record<string, number>;
    countsByUnit?: Record<string, number>;
    avgResolutionMinutes: number | null;
  }> {
    return request('/stats/summary');
  },

  async getStatsTimeseries(params: { bucket?: 'day' | 'hour'; days?: number }): Promise<{
    bucket: 'day' | 'hour' | string;
    points: Array<{ bucket: string; count: number }>;
  }> {
    const search = new URLSearchParams();
    if (params.bucket) search.set('bucket', params.bucket);
    if (params.days) search.set('days', String(params.days));
    const q = search.toString();
    return request(`/stats/timeseries${q ? `?${q}` : ''}`);
  },

  async getMediaAttachments(): Promise<Array<{
    incidentId: string;
    incidentTitle: string;
    messageId: string;
    attachmentUrl: string;
    attachmentType: string | null;
    createdAt: string;
  }>> {
    return request("/media/attachments");
  },

  async uploadFile(file: File): Promise<{ url: string }> {
    const token = sessionStorage.getItem('cad_token');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  async sendChatMessage(incidentId: string, text: string, opts?: { attachmentUrl?: string; attachmentType?: 'image' | 'video' }): Promise<ChatMessage> {
    const body: Record<string, unknown> = { content: text.trim() || undefined, role: 'dispatcher' };
    if (opts?.attachmentUrl) body.attachmentUrl = opts.attachmentUrl;
    if (opts?.attachmentType) body.attachmentType = opts.attachmentType;
    const created = await request<BackendChatMessage>(`/incidents/${incidentId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return mapMessage(created);
  },

  async getLivekitToken(incidentId: string): Promise<{ token: string; url: string; roomName: string }> {
    return request(`/livekit/token`, {
      method: "POST",
      body: JSON.stringify({ incidentId }),
    });
  },

  async getNotifications(params?: { limit?: number; offset?: number }): Promise<NotificationItem[]> {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    const q = search.toString();
    return request(`/notifications${q ? `?${q}` : ""}`);
  },

  async getUnreadNotificationCount(): Promise<{ count: number }> {
    return request("/notifications/unread-count");
  },

  async markNotificationRead(id: string): Promise<void> {
    await request(`/notifications/${id}/read`, { method: "PATCH" });
  },

  async markAllNotificationsRead(): Promise<void> {
    await request("/notifications/read-all", { method: "PATCH" });
  },

  async getUsers(params?: { q?: string; role?: string; status?: 'active' | 'inactive' }): Promise<Array<{
    id: string;
    username: string;
    name: string;
    role: string;
    callsign?: string | null;
    unit?: string | null;
    phone?: string | null;
    isActive: boolean;
  }>> {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    if (params?.role) search.set('role', params.role);
    if (params?.status) search.set('status', params.status);
    const q = search.toString();
    const rows = await request<
      Array<{
        id: string;
        username: string;
        name: string;
        role: string;
        callsign?: string | null;
        unit?: string | null;
        phone?: string | null;
        isActive: boolean;
      }>
    >(`/users${q ? `?${q}` : ''}`);
    return [...new Map(rows.map((u) => [u.id, u])).values()];
  },

  async createUser(data: {
    username: string;
    name: string;
    role: string;
    callsign?: string;
    unit?: string;
    phone?: string;
    isActive?: boolean;
    password?: string;
  }): Promise<{
    id: string;
    username: string;
    name: string;
    role: string;
    callsign?: string | null;
    unit?: string | null;
    phone?: string | null;
    isActive: boolean;
    temporaryPassword?: string;
  }> {
    return request('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateUser(id: string, data: {
    name?: string;
    role?: string;
    callsign?: string;
    unit?: string;
    phone?: string;
    isActive?: boolean;
    password?: string;
  }): Promise<{
    id: string;
    username: string;
    name: string;
    role: string;
    callsign?: string | null;
    unit?: string | null;
    phone?: string | null;
    isActive: boolean;
  }> {
    return request(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async activateUser(id: string): Promise<void> {
    await request(`/users/${id}/activate`, { method: 'POST' });
  },

  async deactivateUser(id: string): Promise<void> {
    await request(`/users/${id}/deactivate`, { method: 'POST' });
  },

  async resetUserPassword(id: string, newPassword: string): Promise<{ success: boolean }> {
    return request(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  },

  async listDmContacts(params?: { q?: string }): Promise<Array<{
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
    lastMessagePreview?: string | null;
    lastMessageAt?: string | null;
    lastMessageFromMe?: boolean;
  }>> {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    const q = search.toString();
    return request(`/dm/contacts${q ? `?${q}` : ''}`);
  },

  async getAdminSettings(): Promise<AdminSettings> {
    return request("/admin/settings");
  },

  async updateAdminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
    return request("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async getAdminOverview(): Promise<AdminOverview> {
    return request("/admin/overview");
  },

  async forceLogoutAll(): Promise<{ success: boolean; authSessionVersion: number }> {
    return request("/admin/force-logout-all", { method: "POST" });
  },

  async getAdminPermissions(): Promise<{
    availablePermissions: AdminPermission[];
    matrix: {
      dispatcher: AdminPermission[];
      responder: AdminPermission[];
    };
  }> {
    return request("/admin/permissions");
  },

  async updateAdminPermissions(
    role: "dispatcher" | "responder",
    permissions: AdminPermission[]
  ): Promise<{ role: "dispatcher" | "responder"; permissions: AdminPermission[] }> {
    return request("/admin/permissions", {
      method: "PATCH",
      body: JSON.stringify({ role, permissions }),
    });
  },

  async openDmConversation(userId: string): Promise<{ conversationId: string }> {
    return request('/dm/open', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  },

  async getDmHistory(conversationId: string, opts?: { limit?: number; before?: string }): Promise<Array<{
    id: string;
    conversationId: string;
    senderId: string;
    senderName: string;
    clientMessageId?: string | null;
    content: string;
    priority: 'normal' | 'urgent' | 'emergency';
    createdAt: string;
    deliveredAt?: string | null;
    readAt?: string | null;
    attachmentUrl?: string | null;
    attachmentType?: 'image' | 'video' | 'document' | null;
    attachmentName?: string | null;
    attachmentMimeType?: string | null;
  }>> {
    const search = new URLSearchParams();
    search.set('conversationId', conversationId);
    search.set('limit', String(opts?.limit ?? 100));
    if (opts?.before) search.set('before', opts.before);
    const q = search.toString();
    return request(`/dm/history?${q}`);
  },

  async sendDmMessage(
    conversationId: string,
    data: {
      content: string;
      priority?: 'normal' | 'urgent' | 'emergency';
      attachmentUrl?: string | null;
      attachmentType?: 'image' | 'video' | 'document' | null;
      attachmentName?: string | null;
      attachmentMimeType?: string | null;
      clientMessageId?: string;
    }
  ): Promise<{
    id: string;
    conversationId: string;
    senderId: string;
    senderName: string;
    content: string;
    priority: 'normal' | 'urgent' | 'emergency';
    createdAt: string;
    clientMessageId?: string | null;
    attachmentUrl?: string | null;
    attachmentType?: 'image' | 'video' | 'document' | null;
    attachmentName?: string | null;
    attachmentMimeType?: string | null;
  }> {
    return request('/dm/send', {
      method: 'POST',
      body: JSON.stringify({
        conversationId,
        content: data.content,
        priority: data.priority ?? 'normal',
        attachmentUrl: data.attachmentUrl ?? undefined,
        attachmentType: data.attachmentType ?? undefined,
        attachmentName: data.attachmentName ?? undefined,
        attachmentMimeType: data.attachmentMimeType ?? undefined,
        clientMessageId: data.clientMessageId ?? undefined,
      }),
    });
  },

  reactDmMessage: async (
    messageId: string,
    reactionType: 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry',
  ): Promise<{ messageId: string; myReaction: string | null; reactionCounts: Record<string, number> }> => {
    return request('/dm/react', {
      method: 'POST',
      body: JSON.stringify({ messageId, reactionType }),
    });
  },

  editDmMessage: async (messageId: string, content: string): Promise<void> => {
    await request('/dm/edit', {
      method: 'POST',
      body: JSON.stringify({ messageId, content }),
    });
  },

  deleteDmMessage: async (messageId: string): Promise<void> => {
    await request('/dm/delete', {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    });
  },

  forwardDmMessage: async (
    conversationId: string,
    messageId: string,
  ): Promise<{
    id: string;
    conversationId: string;
    clientMessageId?: string | null;
    senderId: string;
    senderName: string;
    content: string;
    priority: 'normal' | 'urgent' | 'emergency';
    createdAt: string;
    attachmentUrl?: string | null;
    attachmentType?: 'image' | 'video' | 'document' | null;
    attachmentName?: string | null;
    attachmentMimeType?: string | null;
    forwardedFromMessageId: string;
  }> => {
    return request('/dm/forward', {
      method: 'POST',
      body: JSON.stringify({ conversationId, messageId }),
    });
  },

  async markDmMessageReceipt(
    messageId: string,
    status: 'delivered' | 'read' = 'read',
  ): Promise<void> {
    await request('/dm/receipt', {
      method: 'POST',
      body: JSON.stringify({ messageId, status }),
    });
  },
};

