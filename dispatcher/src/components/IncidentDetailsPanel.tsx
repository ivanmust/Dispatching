import { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChatPanel } from './ChatPanel';
import { VideoPanel } from './VideoPanel';
import { StatusPill } from './StatusPill';
import { PriorityBadge } from './PriorityBadge';
import { useIncidents, useResponders, useAssignResponder, useReassignResponder, useUpdateIncident, useIncidentHistory } from '@/hooks/useIncidents';
import { useSocket } from '@/hooks/useSocket';
import { incidentCategoryDisplayLabel, type Incident, type IncidentCategory, type IncidentPriority } from '@/types/incident';

/** Map incident category to appropriate responder unit. */
const CATEGORY_TO_UNIT: Record<IncidentCategory, string> = {
  CRIME: 'CRIME_POLICE',
  TRAFFIC: 'TRAFFIC_POLICE',
  FIRE: 'EMS',
  MEDICAL: 'EMS',
  HAZMAT: 'EMS',
  OTHER: 'EMS',
};

const UNIT_LABELS: Record<string, string> = {
  EMS: 'EMS',
  TRAFFIC_POLICE: 'Traffic Police',
  CRIME_POLICE: 'Crime Police',
};

const VALID_UNITS = new Set(['EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE']);

import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { queryRwandaAddress } from '@/lib/rwandaAddress';
import { haversineKm } from '@/lib/geo';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Witness } from '@/types/incident';
import { X, MapPin, Clock, User, Phone, History, UserPlus, Trash2, Pencil, Save, XCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { IncidentHistoryEntry } from '@/lib/api';

function formatAddressForDisplay(addr: Record<string, unknown> | null | undefined): string {
  if (!addr || typeof addr !== 'object') return '';
  const parts = [
    addr.province,
    addr.district,
    addr.sector,
    addr.cell,
    addr.village,
  ].filter((v) => v != null && String(v).trim() !== '') as string[];
  return parts.map(String).join(', ');
}

function formatWitnessForDisplay(wit: Record<string, unknown> | null | undefined): string {
  if (!wit || typeof wit !== 'object') return '';
  const parts = [
    wit.name ? `Name: ${wit.name}` : null,
    wit.phone ? `Phone: ${wit.phone}` : null,
    wit.email ? `Email: ${wit.email}` : null,
    wit.notes ? `Notes: ${wit.notes}` : null,
  ].filter(Boolean) as string[];
  return parts.join(' • ');
}

function formatDispatcherDecisionForDisplay(d: Record<string, unknown> | null | undefined): string {
  if (!d || typeof d !== 'object') return '';
  const parts: string[] = [];
  if (d.status) parts.push(`Status: ${d.status}`);
  if (d.assignedAt) parts.push(`Assigned: ${d.assignedAt}`);
  if (d.rejectedAt) parts.push(`Rejected: ${d.rejectedAt}`);
  if (d.reason) parts.push(`Reason: ${d.reason}`);
  return parts.join(' • ');
}

function formatDispatchAssignmentForDisplay(d: Record<string, unknown> | null | undefined): string {
  if (!d || typeof d !== 'object') return '';
  const target = typeof d.targetUnit === 'string' ? UNIT_LABELS[d.targetUnit] ?? d.targetUnit : '';
  const assigned = typeof d.assignedUnit === 'string' ? UNIT_LABELS[d.assignedUnit] ?? d.assignedUnit : '';
  const parts: string[] = [];
  if (target) parts.push(`Incident unit: ${target}`);
  if (assigned) parts.push(`Assigned unit: ${assigned}`);
  if (d.unitOverride === true) parts.push('Cross-unit override');
  if (d.originalUnitUnavailable === true) parts.push('Original unit unavailable');
  if (d.overrideReason) parts.push(`Reason: ${String(d.overrideReason)}`);
  return parts.join(' • ');
}

function formatHistoryLabel(entry: IncidentHistoryEntry): string {
  const { fromStatus, toStatus, metadata } = entry;
  if (!fromStatus && toStatus === 'NEW') return 'Created';
  if (fromStatus === 'NEW' && toStatus === 'ASSIGNED') return `Assigned to ${(metadata?.responderName as string) ?? 'responder'}`;
  if (fromStatus === 'ASSIGNED' && toStatus === 'ASSIGNED' && metadata?.reassignedTo) return `Reassigned to ${(metadata?.newResponderName as string) ?? 'responder'}`;
  if (fromStatus === 'ASSIGNED' && (toStatus === 'IN_PROGRESS' || toStatus === 'EN_ROUTE')) return 'Responder accepted';
  if (fromStatus === 'ASSIGNED' && toStatus === 'NEW') return 'Responder rejected';
  if (toStatus === 'ON_SCENE') return 'In progress';
  if (toStatus === 'RESOLVED') return 'Completed';
  if (toStatus === 'CLOSED') {
    if (metadata?.source === 'auto-close') return 'Auto-closed';
    if (metadata?.reason) return `Rejected: ${(metadata.reason as string).slice(0, 50)}`;
    return 'Closed';
  }
  return `${fromStatus ?? '—'} → ${toStatus}`;
}

function IncidentTimelineSection({ incidentId }: { incidentId: string }) {
  const { data: history = [], isLoading } = useIncidentHistory(incidentId);
  if (isLoading || history.length === 0) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <Label className="text-[11px] text-muted-foreground flex items-center gap-1 uppercase tracking-wide">
        <History className="h-3 w-3" /> Timeline
      </Label>
      <div className="mt-2 space-y-2">
        {history.map((entry, i) => (
          <div key={entry.id} className="flex gap-2 text-sm">
            <div className="shrink-0 w-1.5 rounded-full bg-primary/40 mt-1.5" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{formatHistoryLabel(entry)}</p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(entry.createdAt), 'MMM d, yyyy HH:mm')}
                {entry.changedByName && ` · ${entry.changedByName}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WitnessesSection({ incidentId, readOnly }: { incidentId: string; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const { data: witnesses = [] } = useQuery({
    queryKey: ['witnesses', incidentId],
    queryFn: () => api.getWitnesses(incidentId),
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const addMutation = useMutation({
    mutationFn: (data: { name: string; phone?: string; email?: string; notes?: string }) =>
      api.addWitness(incidentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['witnesses', incidentId] });
      setName(''); setPhone(''); setEmail(''); setNotes('');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (witnessId: string) => api.deleteWitness(incidentId, witnessId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['witnesses', incidentId] }),
  });

  return (
    <div className="border-t pt-3">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        <User className="h-3 w-3" /> Witnesses
      </Label>
      {witnesses.length > 0 && (
        <ul className="mt-2 space-y-2">
          {witnesses.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-2 rounded border px-2 py-1.5 text-sm">
              <div>
                <p className="font-medium">{w.name}</p>
                {(w.phone || w.email) && (
                  <p className="text-xs text-muted-foreground">{[w.phone, w.email].filter(Boolean).join(' · ')}</p>
                )}
                {w.notes && <p className="text-xs text-muted-foreground mt-0.5">{w.notes}</p>}
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => deleteMutation.mutate(w.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="mt-2 space-y-1.5">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
          <div className="flex gap-1.5">
            <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-8 text-xs flex-1" />
            <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-8 text-xs flex-1" />
          </div>
          <Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8 text-xs" />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => name.trim() && addMutation.mutate({ name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, notes: notes.trim() || undefined })}
            disabled={!name.trim() || addMutation.isPending}
          >
            <UserPlus className="h-3 w-3 mr-1" /> Add witness
          </Button>
        </div>
      )}
    </div>
  );
}

function CallLogSheet({ phone, currentIncidentId }: { phone: string; currentIncidentId: string }) {
  const [open, setOpen] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !phone.trim()) return;
    setLoading(true);
    api.getCallLog(phone).then((data) => { setIncidents(data); setLoading(false); }).catch(() => setLoading(false));
  }, [open, phone]);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <History className="h-3 w-3" /> Previous calls
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <Phone className="h-4 w-4" /> Call log: {phone}
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[80vh] mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other incidents from this number.</p>
          ) : (
            <ul className="space-y-2 pr-4">
              {incidents.map((inc) => (
                <li
                  key={inc.id}
                  className={`rounded border p-2 text-sm ${inc.id === currentIncidentId ? 'border-primary bg-muted/50' : ''}`}
                >
                  <p className="font-medium">{inc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(inc.createdAt), { addSuffix: true })} · {inc.status}
                    {inc.id === currentIncidentId && ' (current)'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

interface IncidentDetailsPanelProps {
  incident: Incident;
  onClose: () => void;
  suggestedResponderId?: string | null;
  suggestedResponderDistanceKm?: number | null;
  responderLocations?: Record<string, { lat: number; lon: number }>;
  responderAvailability?: Record<string, boolean>;
  etaUpdate?: {
    eta_seconds: number;
    eta_minutes: number;
    distance_meters: number;
    route?: string | null;
    alt_routes?: string[];
    alt_route_summaries?: Array<{
      index: number;
      label: "faster" | "shorter" | "balanced";
      distanceMeters: number;
      etaSeconds: number;
      etaMinutes: number;
    }> | null;
    active_route_index?: number | null;
    route_unavailable?: boolean;
    routing_engine?: string;
  } | null;
  readOnly?: boolean;
  onEditRequest?: (incident: Incident) => void;
}

export function IncidentDetailsPanel({
  incident,
  onClose,
  suggestedResponderId,
  suggestedResponderDistanceKm,
  responderLocations,
  responderAvailability,
  etaUpdate,
  readOnly = false,
  onEditRequest,
}: IncidentDetailsPanelProps) {
  type IncidentDetailsShape = {
    subtype?: unknown;
    address?: Record<string, unknown>;
    witness?: Record<string, unknown>;
    timeline?: Record<string, unknown>;
    dispatchAssignment?: Record<string, unknown>;
    responderDecision?: Record<string, unknown>;
    dispatcherDecision?: Record<string, unknown>;
  };

  const incidentsQuery = useIncidents();
  const incidents: Incident[] = useMemo(
    () => (incidentsQuery.data as Incident[] | undefined) ?? [],
    [incidentsQuery.data]
  );
  const [showAllUnits, setShowAllUnits] = useState(false);
  const targetUnitForFetch = CATEGORY_TO_UNIT[incident.category];
  const { data: responders } = useResponders({
    unit: showAllUnits ? undefined : (targetUnitForFetch as 'EMS' | 'TRAFFIC_POLICE' | 'CRIME_POLICE'),
  });
  const assignMutation = useAssignResponder();
  const reassignMutation = useReassignResponder();
  const updateMutation = useUpdateIncident();
  const [selectedResponder, setSelectedResponder] = useState(incident.assignedResponderId ?? '');
  const { onResponderAvailability } = useSocket();
  const [availableMap, setAvailableMap] = useState<Record<string, boolean>>(responderAvailability ?? {});
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(incident.title);
  const [editDescription, setEditDescription] = useState(incident.description);
  const [editCategory, setEditCategory] = useState(incident.category);
  const [editPriority, setEditPriority] = useState(incident.priority);
  const [editCallerPhone, setEditCallerPhone] = useState(incident.callerPhone ?? '');
  const [editLocationAddress, setEditLocationAddress] = useState(incident.location.address ?? '');

  const details = (incident.details ?? {}) as IncidentDetailsShape;
  const detailsRecord = (incident.details ?? {}) as Record<string, unknown>;
  const detailsAddress = (details.address ?? {}) as Record<string, unknown>;
  const detailsWitness = (details.witness ?? {}) as Record<string, unknown>;
  const detailsTimeline = (details.timeline ?? {}) as Record<string, unknown>;
  const detailsDispatchAssignment = (details.dispatchAssignment ?? {}) as Record<string, unknown>;
  const detailsResponderDecision = (details.responderDecision ?? {}) as Record<string, unknown>;
  const detailsDispatcherDecision = (details.dispatcherDecision ?? {}) as Record<string, unknown>;
  const assignedAt =
    (typeof detailsTimeline.assignedAt === 'string' && detailsTimeline.assignedAt) ||
    (typeof detailsDispatchAssignment.assignedAt === 'string' && detailsDispatchAssignment.assignedAt) ||
    (incident.status !== 'NEW' && incident.assignedResponderId ? incident.updatedAt : null);
  const completedOrClosedAt =
    incident.status === 'CLOSED'
      ? (typeof detailsTimeline.closedAt === 'string' && detailsTimeline.closedAt) ||
        (typeof detailsDispatcherDecision.rejectedAt === 'string' && detailsDispatcherDecision.rejectedAt) ||
        (typeof detailsResponderDecision.completedAt === 'string' && detailsResponderDecision.completedAt) ||
        incident.updatedAt
      : incident.status === 'RESOLVED'
        ? (typeof detailsTimeline.completedAt === 'string' && detailsTimeline.completedAt) ||
          (typeof detailsResponderDecision.completedAt === 'string' && detailsResponderDecision.completedAt) ||
          incident.updatedAt
        : null;
  const [editSubtype, setEditSubtype] = useState(String(details.subtype ?? ''));
  const [editProvince, setEditProvince] = useState(String(detailsAddress.province ?? ''));
  const [editDistrict, setEditDistrict] = useState(String(detailsAddress.district ?? ''));
  const [editSector, setEditSector] = useState(String(detailsAddress.sector ?? ''));
  const [editCell, setEditCell] = useState(String(detailsAddress.cell ?? ''));
  const [editVillage, setEditVillage] = useState(String(detailsAddress.village ?? ''));
  const [editWitnessName, setEditWitnessName] = useState(String(detailsWitness.name ?? ''));
  const [editWitnessPhone, setEditWitnessPhone] = useState(String(detailsWitness.phone ?? ''));
  const [editWitnessNotes, setEditWitnessNotes] = useState(String(detailsWitness.notes ?? ''));
  const [unitMismatchConfirmOpen, setUnitMismatchConfirmOpen] = useState(false);
  const [reassignMismatchConfirmOpen, setReassignMismatchConfirmOpen] = useState(false);
  const [assignOverrideReason, setAssignOverrideReason] = useState('');
  const [reassignOverrideReason, setReassignOverrideReason] = useState('');
  const [reassignMode, setReassignMode] = useState(false);

  const formatEtaSeconds = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  };
  const formatDistanceMeters = (meters: number) => {
    if (!Number.isFinite(meters) || meters < 0) return '—';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const { data: geocodedAddress } = useQuery({
    queryKey: ['rwanda-address', incident.id, incident.location.lat, incident.location.lon],
    queryFn: () => queryRwandaAddress(incident.location.lat, incident.location.lon),
    staleTime: 5 * 60 * 1000,
  });

  const displayAddress = {
    province: detailsAddress.province || geocodedAddress?.province || '',
    district: detailsAddress.district || geocodedAddress?.district || '',
    sector: detailsAddress.sector || geocodedAddress?.sector || '',
    cell: detailsAddress.cell || geocodedAddress?.cell || '',
    village: detailsAddress.village || geocodedAddress?.village || '',
  };

  const isAlreadyAssigned = !!incident.assignedResponderId;
  const isAssignableStatus = incident.status === 'NEW';
  const canAssign = !isAlreadyAssigned && isAssignableStatus;
  const canReassign = isAlreadyAssigned && !readOnly && ['ASSIGNED', 'IN_PROGRESS'].includes(incident.status);
  const canEditIncident = !readOnly && incident.status === 'NEW' && !incident.assignedResponderId;

  const activeIncidentCountByResponder = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of incidents) {
      const rid = i.assignedResponderId;
      if (!rid) continue;
      // Keep in sync with backend "busy" rule: status NOT IN ('RESOLVED', 'CLOSED')
      if (i.status === 'RESOLVED' || i.status === 'CLOSED') continue;
      counts[rid] = (counts[rid] ?? 0) + 1;
    }
    return counts;
  }, [incidents]);

  const responderIdsWithActiveIncident = useMemo(() => new Set(Object.keys(activeIncidentCountByResponder)), [activeIncidentCountByResponder]);

  const isSelectedResponderBusy =
    !!selectedResponder &&
    responderIdsWithActiveIncident.has(selectedResponder) &&
    selectedResponder !== incident.assignedResponderId;

  // Keep local selects in sync when switching incidents
  useEffect(() => {
    setSelectedResponder(incident.assignedResponderId ?? '');
    setIsEditing(false);
    setEditTitle(incident.title);
    setEditDescription(incident.description);
    setEditCategory(incident.category);
    setEditPriority(incident.priority);
    setEditCallerPhone(incident.callerPhone ?? '');
    setEditLocationAddress(incident.location.address ?? '');

    const d = (incident.details ?? {}) as IncidentDetailsShape;
    const addr = (d.address ?? {}) as Record<string, unknown>;
    const wit = (d.witness ?? {}) as Record<string, unknown>;
    setEditSubtype(String(d.subtype ?? ''));
    setEditProvince(String(addr.province ?? ''));
    setEditDistrict(String(addr.district ?? ''));
    setEditSector(String(addr.sector ?? ''));
    setEditCell(String(addr.cell ?? ''));
    setEditVillage(String(addr.village ?? ''));
    setEditWitnessName(String(wit.name ?? ''));
    setEditWitnessPhone(String(wit.phone ?? ''));
    setEditWitnessNotes(String(wit.notes ?? ''));
    setShowAllUnits(false);
    setReassignMode(false);
    setUnitMismatchConfirmOpen(false);
    setReassignMismatchConfirmOpen(false);
    setAssignOverrideReason('');
    setReassignOverrideReason('');
  }, [
    incident.id,
    incident.assignedResponderId,
    incident.title,
    incident.description,
    incident.category,
    incident.priority,
    incident.callerPhone,
    incident.location.address,
    incident.details,
  ]);

  // Track which responders are currently online & available
  useEffect(() => {
    setAvailableMap(responderAvailability ?? {});
  }, [responderAvailability]);

  useEffect(() => {
    const unsub = onResponderAvailability(({ responderId, available }) => {
      setAvailableMap(prev => ({ ...prev, [responderId]: available }));
    });
    return unsub;
  }, [onResponderAvailability]);

  const targetUnit = targetUnitForFetch;
  // When !showAllUnits, API returns only matching unit; when showAllUnits, API returns all
  const allAssignableResponders = responders ?? [];
  const assignableResponders = canReassign
    ? allAssignableResponders.filter((r) => r.id !== incident.assignedResponderId)
    : allAssignableResponders;

  // Auto-select suggested responder when incident is unassigned (only if they're in assignable list)
  useEffect(() => {
    if (incident.assignedResponderId) return;
    if (!suggestedResponderId) return;
    if (selectedResponder) return;
    if (!assignableResponders.some(r => r.id === suggestedResponderId)) return;
    // Suggested may be nearest/available in the dashboard calculation, but still be busy by the
    // time the incident panel renders. Prevent auto-select if responder has active load.
    if (!(availableMap[suggestedResponderId] ?? false)) return;
    if ((activeIncidentCountByResponder[suggestedResponderId] ?? 0) > 0) return;
    setSelectedResponder(suggestedResponderId);
  }, [
    incident.assignedResponderId,
    suggestedResponderId,
    selectedResponder,
    assignableResponders,
    availableMap,
    activeIncidentCountByResponder,
  ]);

  const suggestedResponder =
    suggestedResponderId && assignableResponders.some(r => r.id === suggestedResponderId)
      ? assignableResponders.find(r => r.id === suggestedResponderId)
      : undefined;
  const suggestedAvailability =
    suggestedResponderId ? (availableMap[suggestedResponderId] ?? false) : false;
  const suggestedHasActiveIncident =
    !!suggestedResponderId && responderIdsWithActiveIncident.has(suggestedResponderId);

  const normalizeUnit = (unit: string | null | undefined) => {
    const u = String(unit ?? '').trim();
    return VALID_UNITS.has(u) ? u : 'EMS';
  };

  const scoreCandidate = (r: { id: string; unit?: string | null }) => {
    const isAvailable = availableMap[r.id] ?? false;
    const unitMismatch = normalizeUnit(r.unit) !== targetUnit;

    const pos = responderLocations?.[r.id];
    const distanceKm =
      pos && typeof pos.lat === 'number' && typeof pos.lon === 'number'
        ? haversineKm(
            { lat: incident.location.lat, lon: incident.location.lon },
            { lat: pos.lat, lon: pos.lon }
          )
        : null;

    // Deterministic score: smaller is better.
    // Availability is a hard constraint; workload + distance are explicit soft costs.
    const availabilityPenalty = isAvailable ? 0 : 100000;
    const candidateActiveLoad = (activeIncidentCountByResponder[r.id] ?? 0) - (r.id === incident.assignedResponderId ? 1 : 0);
    const workloadLoad = Math.max(0, candidateActiveLoad);
    const WEIGHT_DISTANCE_KM = 150;
    const WEIGHT_WORKLOAD = 3000;
    const DEFAULT_DISTANCE_KM = 20;
    const workloadPenalty = workloadLoad * WEIGHT_WORKLOAD;
    const unitPenalty = unitMismatch ? 2000 : 0;
    const distancePenalty = (distanceKm == null ? DEFAULT_DISTANCE_KM : distanceKm) * WEIGHT_DISTANCE_KM;

    const suggestedBonus = suggestedResponderId && r.id === suggestedResponderId ? -500 : 0;
    const overrideBonus = showAllUnits && !unitMismatch ? -50 : 0;

    return availabilityPenalty + workloadPenalty + unitPenalty + distancePenalty + suggestedBonus + overrideBonus;
  };

  const performAssign = (unitOverride = false, reason?: string) => {
    if (!selectedResponder) return;
    assignMutation.mutate(
      {
        incidentId: incident.id,
        responderId: selectedResponder,
        unitOverride,
        ...(unitOverride && reason?.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast({ title: 'Assigned', description: `Incident assigned successfully.` });
          setUnitMismatchConfirmOpen(false);
          setAssignOverrideReason('');
        },
        onError: (err) => {
          toast({
            title: 'Assign failed',
            description: err instanceof Error ? err.message : 'Could not assign incident.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const performReassign = (unitOverride = false, reason?: string) => {
    if (!selectedResponder) return;
    reassignMutation.mutate(
      {
        incidentId: incident.id,
        responderId: selectedResponder,
        unitOverride,
        ...(unitOverride && reason?.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast({ title: 'Reassigned', description: `Incident reassigned successfully.` });
          setReassignMismatchConfirmOpen(false);
          setReassignMode(false);
          setSelectedResponder('');
          setReassignOverrideReason('');
        },
        onError: (err) => {
          toast({
            title: 'Reassign failed',
            description: err instanceof Error ? err.message : 'Could not reassign incident.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleReassign = () => {
    if (!selectedResponder) return;
    const selected = assignableResponders.find((r) => r.id === selectedResponder);
    const selectedUnit = selected?.unit?.trim() || '';
    const effectiveSelectedUnit = VALID_UNITS.has(selectedUnit) ? selectedUnit : 'EMS';
    const isUnitMismatch = showAllUnits && effectiveSelectedUnit !== targetUnit;
    if (isUnitMismatch) {
      setReassignMismatchConfirmOpen(true);
    } else {
      performReassign();
    }
  };

  const handleAssign = () => {
    if (!selectedResponder) return;
    const selected = assignableResponders.find((r) => r.id === selectedResponder);
    const selectedUnit = selected?.unit?.trim() || '';
    const effectiveSelectedUnit = VALID_UNITS.has(selectedUnit) ? selectedUnit : 'EMS';
    const isUnitMismatch = showAllUnits && effectiveSelectedUnit !== targetUnit;
    if (isUnitMismatch) {
      setUnitMismatchConfirmOpen(true);
    } else {
      performAssign();
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditTitle(incident.title);
    setEditDescription(incident.description);
    setEditCategory(incident.category);
    setEditPriority(incident.priority);
    setEditCallerPhone(incident.callerPhone ?? '');
    setEditLocationAddress(incident.location.address ?? '');
    const d = (incident.details ?? {}) as IncidentDetailsShape;
    const addr = (d.address ?? {}) as Record<string, unknown>;
    const wit = (d.witness ?? {}) as Record<string, unknown>;
    setEditSubtype(String(d.subtype ?? ''));
    setEditProvince(String(addr.province ?? ''));
    setEditDistrict(String(addr.district ?? ''));
    setEditSector(String(addr.sector ?? ''));
    setEditCell(String(addr.cell ?? ''));
    setEditVillage(String(addr.village ?? ''));
    setEditWitnessName(String(wit.name ?? ''));
    setEditWitnessPhone(String(wit.phone ?? ''));
    setEditWitnessNotes(String(wit.notes ?? ''));
  };

  const handleSaveEdit = () => {
    if (editTitle.trim().length < 3) {
      toast({ title: 'Validation error', description: 'Title must be at least 3 characters', variant: 'destructive' });
      return;
    }
    if (editDescription.trim().length < 5) {
      toast({ title: 'Validation error', description: 'Description must be at least 5 characters', variant: 'destructive' });
      return;
    }
    const mergedDetails: Record<string, unknown> = {
      ...((incident.details ?? {}) as Record<string, unknown>),
      subtype: editSubtype.trim() || undefined,
      address: {
        ...((((incident.details ?? {}) as IncidentDetailsShape).address ?? {}) as Record<string, unknown>),
        province: editProvince.trim() || undefined,
        district: editDistrict.trim() || undefined,
        sector: editSector.trim() || undefined,
        cell: editCell.trim() || undefined,
        village: editVillage.trim() || undefined,
      },
      witness: {
        ...((((incident.details ?? {}) as IncidentDetailsShape).witness ?? {}) as Record<string, unknown>),
        name: editWitnessName.trim() || undefined,
        phone: editWitnessPhone.trim() || undefined,
        notes: editWitnessNotes.trim() || undefined,
      },
    };

    updateMutation.mutate(
      {
        id: incident.id,
        updates: {
          title: editTitle.trim(),
          description: editDescription.trim(),
          category: editCategory,
          priority: editPriority,
          callerPhone: editCallerPhone.trim() || undefined,
          location: { ...incident.location, address: editLocationAddress.trim() || undefined },
          details: mergedDetails,
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Incident updated', description: 'Changes saved.' });
          setIsEditing(false);
        },
        onError: (err: unknown) => toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Could not save changes.', variant: 'destructive' }),
      }
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-l shadow-md">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-secondary/40">
        <div className="flex items-center gap-2 min-w-0">
          <StatusPill status={incident.status} />
          <PriorityBadge priority={incident.priority} />
        </div>
        <div className="flex items-center gap-1.5">
          {canEditIncident && !isEditing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => (onEditRequest ? onEditRequest(incident) : setIsEditing(true))}
              aria-label="Edit incident"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {!readOnly && isEditing && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={handleCancelEdit}
                disabled={updateMutation.isPending}
                aria-label="Cancel edit"
              >
                <XCircle className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={handleSaveEdit}
                disabled={
                  updateMutation.isPending ||
                  !editTitle.trim() ||
                  !editDescription.trim()
                }
                aria-label="Save changes"
              >
                <Save className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="details" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 shrink-0 bg-muted/60 rounded-full px-1 py-0.5">
          <TabsTrigger value="details" className="text-xs rounded-full px-3">Details</TabsTrigger>
          <TabsTrigger value="chat" className="text-xs rounded-full px-3">Chat</TabsTrigger>
          <TabsTrigger value="video" className="text-xs rounded-full px-3">Video</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex-1 overflow-auto px-4 pb-4 mt-0">
          <div className="space-y-3 pt-3">
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 space-y-2">
              <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">General</Label>
              <div>
                <Label className="text-[11px] text-muted-foreground">Title</Label>
                {isEditing ? (
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-8 text-xs mt-1" />
                ) : (
                  <p className="text-sm font-semibold">{incident.title}</p>
                )}
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Description</Label>
                {isEditing ? (
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} className="mt-1 text-xs" />
                ) : (
                  <p className="text-sm text-foreground/80">{incident.description}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-background px-3 py-2">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Category</Label>
                {isEditing ? (
                  <Select value={editCategory} onValueChange={(v) => setEditCategory(v as IncidentCategory)}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['FIRE', 'MEDICAL', 'TRAFFIC', 'CRIME', 'HAZMAT', 'OTHER'] as const).map((c) => (
                        <SelectItem key={c} value={c}>{incidentCategoryDisplayLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium mt-0.5">{incidentCategoryDisplayLabel(incident.category)}</p>
                )}
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                {isEditing ? (
                  <>
                    <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Urgency</Label>
                    <Select value={editPriority} onValueChange={(v) => setEditPriority(v as IncidentPriority)}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Timing</Label>
                    <div className="mt-0.5 space-y-1">
                      {assignedAt && (
                        <p className="text-sm flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Assigned {formatDistanceToNow(new Date(assignedAt), { addSuffix: true })}
                        </p>
                      )}
                      {etaUpdate &&
                        ['ASSIGNED', 'IN_PROGRESS'].includes(incident.status) && (
                          <>
                            <p className="text-sm flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              ETA ~{formatEtaSeconds(etaUpdate.eta_seconds)}
                            </p>
                            <p className="text-sm flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              Distance {formatDistanceMeters(etaUpdate.distance_meters)}
                            </p>
                          </>
                        )}
                      {etaUpdate &&
                      !etaUpdate.route_unavailable &&
                      typeof etaUpdate.active_route_index === "number" &&
                      etaUpdate.active_route_index >= 0 &&
                      etaUpdate.alt_route_summaries?.length ? (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Map shows the responder&apos;s selected route (alternative{" "}
                          {etaUpdate.active_route_index + 1}).
                        </p>
                      ) : etaUpdate && !etaUpdate.route_unavailable ? (
                        <p className="text-[11px] text-muted-foreground mt-1">Map shows the responder&apos;s active main route.</p>
                      ) : null}
                      {completedOrClosedAt && (
                        <p className="text-sm flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {incident.status === 'CLOSED' ? 'Closed' : 'Completed'} {formatDistanceToNow(new Date(completedOrClosedAt), { addSuffix: true })}
                        </p>
                      )}
                      {!assignedAt && !completedOrClosedAt && (
                        <p className="text-xs text-muted-foreground">No timing milestone yet</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {(incident.callerPhone || isEditing) && (
              <div className="rounded-lg border bg-background px-3 py-2">
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1 uppercase tracking-wide">
                  <Phone className="h-3 w-3" /> Caller phone
                </Label>
                <div className="flex items-center gap-2 mt-1.5">
                  {isEditing ? (
                    <Input value={editCallerPhone} onChange={(e) => setEditCallerPhone(e.target.value)} className="h-8 text-xs flex-1" />
                  ) : (
                    <>
                      <p className="text-sm font-medium">{incident.callerPhone}</p>
                      <CallLogSheet phone={incident.callerPhone!} currentIncidentId={incident.id} />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Hide reporter identity details on the UI (we still keep createdByName/Role for logic). */}

            <div className="rounded-lg border bg-background px-3 py-2">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1 uppercase tracking-wide">
                <MapPin className="h-3 w-3" /> Location
              </Label>
              {isEditing ? (
                <>
                  <Input
                    value={editLocationAddress}
                    onChange={(e) => setEditLocationAddress(e.target.value)}
                    placeholder="Address"
                    className="h-8 text-xs mt-1"
                  />
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Province</Label>
                      <Input value={editProvince} onChange={(e) => setEditProvince(e.target.value)} className="h-8 text-xs mt-1" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">District</Label>
                      <Input value={editDistrict} onChange={(e) => setEditDistrict(e.target.value)} className="h-8 text-xs mt-1" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Sector</Label>
                      <Input value={editSector} onChange={(e) => setEditSector(e.target.value)} className="h-8 text-xs mt-1" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Cell</Label>
                      <Input value={editCell} onChange={(e) => setEditCell(e.target.value)} className="h-8 text-xs mt-1" />
                    </div>
                  </div>
                  <div className="mt-2">
                    <Label className="text-[11px] text-muted-foreground">Village</Label>
                    <Input value={editVillage} onChange={(e) => setEditVillage(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                </>
              ) : (
                <>
                  {(() => {
                    const parts = [
                      displayAddress.district ? `District: ${String(displayAddress.district)}` : null,
                      displayAddress.sector ? `Sector: ${String(displayAddress.sector)}` : null,
                      displayAddress.cell ? `Cell: ${String(displayAddress.cell)}` : null,
                      displayAddress.village ? `Village: ${String(displayAddress.village)}` : null,
                    ].filter(Boolean) as string[];
                    if (parts.length === 0) return null;
                    return <p className="text-xs text-muted-foreground mt-1">{parts.join(" • ")}</p>;
                  })()}
                </>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {incident.location.lat.toFixed(4)}, {incident.location.lon.toFixed(4)}
              </p>
            </div>

            {isEditing && (
              <div className="rounded-lg border bg-background px-3 py-2">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Additional details</Label>
                <div className="mt-2 space-y-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Subtype</Label>
                    <Input value={editSubtype} onChange={(e) => setEditSubtype(e.target.value)} className="h-8 text-xs mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Witness name</Label>
                      <Input value={editWitnessName} onChange={(e) => setEditWitnessName(e.target.value)} className="h-8 text-xs mt-1" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Witness phone</Label>
                      <Input value={editWitnessPhone} onChange={(e) => setEditWitnessPhone(e.target.value)} className="h-8 text-xs mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Witness notes</Label>
                    <Textarea value={editWitnessNotes} onChange={(e) => setEditWitnessNotes(e.target.value)} rows={2} className="mt-1 text-xs" />
                  </div>
                </div>
              </div>
            )}

            {incident.details && Object.keys(incident.details).length > 0 && (
              <div className="rounded-lg border bg-background px-3 py-2">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Call details</Label>
                <div className="mt-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs space-y-1">
                  {detailsRecord.subtype && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">Subtype</span>
                      <span className="text-muted-foreground">{String(detailsRecord.subtype)}</span>
                    </div>
                  )}
                  {formatWitnessForDisplay(detailsWitness) && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">Witness</span>
                      <span className="text-muted-foreground">{formatWitnessForDisplay(detailsWitness)}</span>
                    </div>
                  )}
                  {detailsRecord.callTime && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">Call time</span>
                      <span className="text-muted-foreground">{String(detailsRecord.callTime)}</span>
                    </div>
                  )}
                  {detailsRecord.callerName && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">Caller name</span>
                      <span className="text-muted-foreground">{String(detailsRecord.callerName)}</span>
                    </div>
                  )}
                  {formatDispatcherDecisionForDisplay(detailsDispatcherDecision) && (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">Dispatcher decision</span>
                      <span className="text-muted-foreground">{formatDispatcherDecisionForDisplay(detailsDispatcherDecision)}</span>
                    </div>
                  )}
                  {formatDispatchAssignmentForDisplay(detailsDispatchAssignment) && (
                    <div className="flex flex-col gap-0.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
                      <span className="font-medium">Assignment control</span>
                      <span>{formatDispatchAssignmentForDisplay(detailsDispatchAssignment)}</span>
                    </div>
                  )}
                  {Object.entries(incident.details).map(([key, value]) => {
                    const knownKeys = ['address', 'subtype', 'witness', 'callTime', 'callerName', 'dispatcherDecision', 'timeline', 'dispatchAssignment', 'responderDecision'];
                    if (knownKeys.includes(key)) return null;
                    if (value === undefined || value === null || value === '') return null;
                    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
                    const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
                    return (
                      <div key={key} className="flex flex-col gap-0.5">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground">{display}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <WitnessesSection incidentId={incident.id} readOnly={readOnly} />

            <IncidentTimelineSection incidentId={incident.id} />

            {!readOnly && incident.status !== 'RESOLVED' && incident.status !== 'CLOSED' && (
            <div className="border-t pt-3 space-y-2">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1 uppercase tracking-wide">
                <User className="h-3 w-3" /> Assign
              </Label>
              {!canAssign && !canReassign && (
                <p className="text-xs text-muted-foreground">
                  Closed or resolved; no assignment actions available.
                </p>
              )}
              {canReassign && !reassignMode && (
                <div className="space-y-2">
                  <p className="text-xs">
                    Assigned to <span className="font-medium">{incident.assignedResponderName ?? 'Unknown'}</span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setReassignMode(true);
                      setSelectedResponder('');
                    }}
                  >
                    Reassign to another responder
                  </Button>
                </div>
              )}
              {canReassign && reassignMode && (
                <>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={showAllUnits} onCheckedChange={(c) => setShowAllUnits(!!c)} />
                    Show all units (emergency override)
                  </label>
                  {assignableResponders.length > 0 && (
                    <div className="flex gap-2">
                      <Select
                        value={selectedResponder}
                        onValueChange={setSelectedResponder}
                        disabled={reassignMutation.isPending}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder={showAllUnits ? 'Select responder (all units)' : `Select responder (${UNIT_LABELS[targetUnit] ?? targetUnit})`} />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableResponders
                            .filter((r) => availableMap[r.id] ?? false)
                            .sort((a, b) => scoreCandidate(a) - scoreCandidate(b))
                            .map((r) => (
                              <SelectItem
                                key={r.id}
                                value={r.id}
                                disabled={responderIdsWithActiveIncident.has(r.id)}
                              >
                                {r.name} ({UNIT_LABELS[r.unit] ?? r.unit})
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 text-xs"
                        onClick={() => {
                          setReassignMode(false);
                          setSelectedResponder('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleReassign}
                        disabled={!selectedResponder || isSelectedResponderBusy || reassignMutation.isPending}
                      >
                        {reassignMutation.isPending ? 'Reassigning…' : 'Reassign'}
                      </Button>
                    </div>
                  )}
                  <AlertDialog
                    open={reassignMismatchConfirmOpen}
                    onOpenChange={(open) => {
                      setReassignMismatchConfirmOpen(open);
                      if (!open) setReassignOverrideReason('');
                    }}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Unit mismatch</AlertDialogTitle>
                        <AlertDialogDescription>
                          This incident is {incidentCategoryDisplayLabel(incident.category)} (typically {UNIT_LABELS[targetUnit] ?? targetUnit}). You
                          are reassigning to a responder from a different unit. The backend will only allow this if no original-unit responder is available.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="space-y-2">
                        <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Override reason</Label>
                        <Textarea
                          value={reassignOverrideReason}
                          onChange={(e) => setReassignOverrideReason(e.target.value)}
                          placeholder="Why is cross-unit reassignment required?"
                          rows={3}
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={reassignMutation.isPending}>Cancel</AlertDialogCancel>
                        <Button
                          onClick={() => performReassign(true, reassignOverrideReason)}
                          disabled={reassignMutation.isPending || reassignOverrideReason.trim().length < 3}
                        >
                          {reassignMutation.isPending ? 'Reassigning…' : 'Reassign anyway'}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
              {canAssign && assignableResponders.length === 0 && !showAllUnits && (
                <p className="text-xs text-muted-foreground">
                  No responders from {UNIT_LABELS[targetUnit] ?? targetUnit} available.
                </p>
              )}
              {canAssign && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox checked={showAllUnits} onCheckedChange={(c) => setShowAllUnits(!!c)} />
                  Show all units (emergency override)
                </label>
              )}
              {canAssign && assignableResponders.length > 0 && suggestedResponder && (
                <div className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Suggested (best match)</p>
                      <p className="text-sm font-semibold truncate">
                        {suggestedResponder.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {suggestedAvailability ? 'Available' : 'Busy'}
                        {suggestedResponder.unit ? ` • ${UNIT_LABELS[suggestedResponder.unit] ?? suggestedResponder.unit}` : ''}
                        {typeof suggestedResponderDistanceKm === 'number'
                          ? ` • ~${suggestedResponderDistanceKm.toFixed(1)} km`
                          : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs"
                      onClick={() => setSelectedResponder(suggestedResponder.id)}
                      disabled={suggestedHasActiveIncident}
                    >
                      Select
                    </Button>
                  </div>
                </div>
              )}
              {canAssign && assignableResponders.length > 0 && (
              <div className="flex gap-2">
                <Select
                  value={selectedResponder}
                  onValueChange={setSelectedResponder}
                  disabled={assignMutation.isPending}
                >
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder={showAllUnits ? "Select responder (all units)" : `Select responder (${UNIT_LABELS[targetUnit] ?? targetUnit})`} /></SelectTrigger>
                  <SelectContent>
                    {assignableResponders
                      .filter(r => availableMap[r.id] ?? false) // only responders known to be available
                      .sort((a, b) => scoreCandidate(a) - scoreCandidate(b))
                      .map(r => (
                      <SelectItem
                        key={r.id}
                        value={r.id}
                        disabled={responderIdsWithActiveIncident.has(r.id) && r.id !== incident.assignedResponderId}
                      >
                        {r.name} ({UNIT_LABELS[r.unit] ?? r.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleAssign}
                  disabled={!selectedResponder || isSelectedResponderBusy || assignMutation.isPending}
                >
                  Assign
                </Button>
              </div>
              )}
              {isSelectedResponderBusy && (
                <p className="text-xs text-muted-foreground">
                  Selected responder is currently busy; please choose another.
                </p>
              )}

              <AlertDialog
                open={unitMismatchConfirmOpen}
                onOpenChange={(open) => {
                  setUnitMismatchConfirmOpen(open);
                  if (!open) setAssignOverrideReason('');
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Unit mismatch</AlertDialogTitle>
                    <AlertDialogDescription>
                      This incident is {incidentCategoryDisplayLabel(incident.category)} (typically {UNIT_LABELS[targetUnit] ?? targetUnit}). You are
                      assigning to a responder from a different unit. The backend will only allow this if no original-unit responder is available.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-2">
                    <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Override reason</Label>
                    <Textarea
                      value={assignOverrideReason}
                      onChange={(e) => setAssignOverrideReason(e.target.value)}
                      placeholder="Why is cross-unit assignment required?"
                      rows={3}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={assignMutation.isPending}>Cancel</AlertDialogCancel>
                    <Button
                      onClick={() => performAssign(true, assignOverrideReason)}
                      disabled={assignMutation.isPending || assignOverrideReason.trim().length < 3}
                    >
                      {assignMutation.isPending ? 'Assigning…' : 'Assign anyway'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="chat" className="flex-1 overflow-hidden mt-0">
          <ChatPanel incidentId={incident.id} readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="video" className="flex-1 overflow-hidden mt-0">
          <VideoPanel incidentId={incident.id} incidentTitle={incident.title} readOnly={readOnly} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
