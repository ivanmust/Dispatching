export type IncidentStatus = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Incident {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  priority: Priority;
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
  createdByRole?: "dispatcher" | "responder" | null;
  createdAt: string;
  updatedAt: string;
}

export interface Witness {
  id: string;
  incidentId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface IncidentDrawing {
  id: string;
  incidentId: string;
  type: "point" | "polyline" | "polygon";
  geometry: Record<string, unknown>;
  style?: Record<string, unknown> | null;
  createdById?: string | null;
  createdAt: string;
}

export interface Document {
  id: string;
  name: string;
  category: "SOP" | "evacuation" | "form" | "other";
  fileUrl: string;
  createdAt: string;
}

export interface Geofence {
  id: string;
  name: string;
  type: string;
  geometry: Record<string, unknown>;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  incidentId: string;
  senderId: string;
  senderName: string;
  senderRole: "dispatcher" | "responder";
  content: string;
  timestamp: string;
  attachmentUrl?: string | null;
  attachmentType?: "image" | "video" | null;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: "dispatcher" | "responder";
  callsign?: string | null;
  unit?: string | null;
  phone?: string | null;
}

