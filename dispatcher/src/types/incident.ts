export type IncidentStatus = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type IncidentPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentCategory = 'FIRE' | 'MEDICAL' | 'TRAFFIC' | 'CRIME' | 'HAZMAT' | 'OTHER';

export interface IncidentLocation {
  lat: number;
  lon: number;
  address?: string;
}

export interface Responder {
  id: string;
  name: string;
  status: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY';
  unit: string;
  phone?: string;
}

export interface ChatMessage {
  id: string;
  incidentId: string;
  sender: 'dispatcher' | 'responder';
  senderName: string;
  text: string;
  timestamp: string;
  attachmentUrl?: string | null;
  attachmentType?: 'image' | 'video' | null;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  priority: IncidentPriority;
  category: IncidentCategory;
  location: IncidentLocation;
  callerPhone?: string | null;
  details?: Record<string, unknown> | null;
  assignedResponderId?: string;
  assignedResponderName?: string;
  createdById?: string;
  createdByName?: string;
  createdByRole?: 'dispatcher' | 'responder';
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

export const STATUS_COLORS: Record<IncidentStatus, string> = {
  // Matches the incident list + map legend:
  // Red = Unassigned, Orange = Assigned, Blue = In Progress, Green = Completed/Closed
  NEW: '#ef4444',
  ASSIGNED: '#f59e0b',
  IN_PROGRESS: '#3b82f6',
  RESOLVED: '#22c55e',
  CLOSED: '#22c55e',
};

export const PRIORITY_COLORS: Record<IncidentPriority, string> = {
  LOW: '#6b7280',
  MEDIUM: '#3b82f6',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

/** User-facing lifecycle labels (internal API status codes unchanged). */
export function incidentStatusDisplayLabel(status: string): string {
  const s = String(status).toUpperCase();
  switch (s) {
    case 'NEW':
      return 'Unassigned';
    case 'ASSIGNED':
      return 'Assigned';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'RESOLVED':
      return 'Completed';
    case 'CLOSED':
      return 'Closed';
    default:
      return status;
  }
}

export function incidentPriorityDisplayLabel(priority: string): string {
  const p = String(priority).toLowerCase();
  if (!p) return priority;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function incidentCategoryDisplayLabel(category: string): string {
  const c = String(category).toLowerCase().replace(/_/g, ' ');
  if (!c) return category;
  if (c === 'other' || c === 'other incidents' || c === 'other incident') return 'Other Incident';
  return c.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
