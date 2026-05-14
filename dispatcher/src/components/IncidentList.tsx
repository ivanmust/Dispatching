import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IncidentCard } from './IncidentCard';
import { useIncidents, useResponders, useUpdateIncident } from '@/hooks/useIncidents';
import type { Incident, IncidentStatus, IncidentPriority, IncidentCategory } from '@/types/incident';
import { Search, Plus, Loader2, Filter, Bell, AlertTriangle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface IncidentListProps {
  selectedId: string | null;
  onSelect: (incident: Incident) => void;
  onCreateClick?: () => void;
  showCreateButton?: boolean;
  statusFilter?: string;
  onStatusFilterChange?: (v: string) => void;
  unitFilter?: string;
  onUnitFilterChange?: (v: string) => void;
}

const VALID_UNITS = new Set(['EMS', 'TRAFFIC_POLICE', 'CRIME_POLICE']);
const UNIT_LABELS: Record<string, string> = { EMS: 'EMS', TRAFFIC_POLICE: 'Traffic Police', CRIME_POLICE: 'Crime Police' };

export function IncidentList({
  selectedId,
  onSelect,
  onCreateClick,
  showCreateButton,
  statusFilter: statusFilterProp,
  onStatusFilterChange,
  unitFilter: unitFilterProp,
  onUnitFilterChange,
}: IncidentListProps) {
  const { data: incidents, isLoading, isError, error, refetch, isFetching } = useIncidents();
  const { data: responders = [] } = useResponders();
  const [search, setSearch] = useState('');
  const [statusFilterState, setStatusFilterState] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [regionFilter, setRegionFilter] = useState<string>('ALL');
  const [unitFilterState, setUnitFilterState] = useState<string>('ALL');

  const statusFilter = statusFilterProp ?? statusFilterState;
  const setStatusFilter = onStatusFilterChange ?? setStatusFilterState;
  const unitFilter = unitFilterProp ?? unitFilterState;
  const setUnitFilter = onUnitFilterChange ?? setUnitFilterState;
  const [filterOpen, setFilterOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const qc = useQueryClient();
  const updateIncident = useUpdateIncident();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const pendingDispatcherAlerts = useMemo(() => {
    const rows = incidents ?? [];
    return rows.filter((inc) => {
      const details = (inc.details ?? {}) as Record<string, unknown>;
      const decision = details.dispatcherDecision as { status?: string } | undefined;
      const isPendingDecision = !decision || decision.status !== 'accepted';
      return inc.createdByRole === 'responder' && inc.status === 'NEW' && isPendingDecision;
    });
  }, [incidents]);

  const pendingAlertCount = pendingDispatcherAlerts.length;
  const totalAlertBadge = pendingAlertCount;

  const handleAccept = (id: string) => {
    const incident = (incidents ?? []).find((i) => i.id === id);
    if (!incident) return;
    const details = (incident.details ?? {}) as Record<string, unknown>;
    const nextDetails = {
      ...details,
      dispatcherDecision: {
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      },
    };
    updateIncident.mutate({ id, updates: { details: nextDetails } });
  };

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.rejectIncident(id, reason),
    onSuccess: async () => {
      setRejectReason('');
      setRejectingId(null);
      await qc.invalidateQueries({ queryKey: ['incidents'] });
    },
  });

  const handleSubmitReject = () => {
    if (!rejectingId || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: rejectingId, reason: rejectReason.trim() });
  };
  const activeIncidentCount = useMemo(
    () => (incidents ?? []).filter((inc) => inc.status !== 'RESOLVED' && inc.status !== 'CLOSED').length,
    [incidents]
  );
  const responderIdToUnit = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of responders) {
      const u = (r.unit ?? '').trim();
      m[r.id] = VALID_UNITS.has(u) ? u : 'EMS';
    }
    return m;
  }, [responders]);

  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    for (const inc of incidents ?? []) {
      const details = (inc.details ?? {}) as Record<string, unknown>;
      const addr = (details.address && typeof details.address === 'object' ? (details.address as Record<string, unknown>) : {});
      const district = typeof addr.district === 'string' ? addr.district.trim() : '';
      if (district) set.add(district);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [incidents]);

  const filtered = useMemo(() => {
    if (!incidents) return [];
    return incidents.filter(inc => {
      const categoryGroup =
        inc.category === 'CRIME'
          ? 'CRIME'
          : inc.category === 'TRAFFIC'
            ? 'ACCIDENT'
            : 'OTHER_INCIDENTS';
      const details = (inc.details ?? {}) as Record<string, unknown>;
      const addr = (details.address && typeof details.address === 'object' ? (details.address as Record<string, unknown>) : {});
      const district = typeof addr.district === 'string' ? addr.district.trim() : '';
      // Show pending responder-created incidents in the main list immediately.
      // Dispatch can still act on them from Alerts, but they should not disappear from the active list.
      const matchSearch = !search || inc.title.toLowerCase().includes(search.toLowerCase()) || inc.description.toLowerCase().includes(search.toLowerCase());
      const matchStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'COMPLETED'
            ? inc.status === 'RESOLVED'
            : inc.status === statusFilter;
      const matchPriority = priorityFilter === 'ALL' || inc.priority === priorityFilter;
      const matchCategory = categoryFilter === 'ALL' || categoryGroup === categoryFilter;
      const matchRegion = regionFilter === 'ALL' || district === regionFilter;
      const matchUnit =
        unitFilter === 'ALL' ||
        (inc.assignedResponderId && responderIdToUnit[inc.assignedResponderId] === unitFilter);
      return matchSearch && matchStatus && matchPriority && matchCategory && matchRegion && matchUnit;
    });
  }, [incidents, search, statusFilter, priorityFilter, categoryFilter, regionFilter, unitFilter, responderIdToUnit]);

  return (
    <div className="flex flex-col h-full bg-card shadow-md">
      <div className="p-3 border-b space-y-2 bg-secondary/40">
        <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-secondary-foreground/90">
          <span>
            Active incidents: <span className="font-bold">{activeIncidentCount}</span>
          </span>
          <div className="flex items-center gap-1">
            <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full">
                  <Filter className="h-3.5 w-3.5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="p-0">
                <div className="p-4 border-b">
                  <SheetHeader>
                    <SheetTitle className="text-base">Filter incidents</SheetTitle>
                  </SheetHeader>
                </div>
                <div className="p-4 space-y-3">
                <div className="space-y-3 pt-1">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Status</span>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All</SelectItem>
                        <SelectItem value="NEW">Unassigned</SelectItem>
                        <SelectItem value="ASSIGNED">Assigned</SelectItem>
                        <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                        <SelectItem value="COMPLETED">Completed</SelectItem>
                        <SelectItem value="CLOSED">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Priority</span>
                    <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="CRITICAL">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Category</span>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All</SelectItem>
                        <SelectItem value="CRIME">Crime</SelectItem>
                        <SelectItem value="ACCIDENT">Accident</SelectItem>
                        <SelectItem value="OTHER_INCIDENTS">Other Incident</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Region</span>
                    <Select value={regionFilter} onValueChange={setRegionFilter}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All</SelectItem>
                        {availableRegions.map((region) => (
                          <SelectItem key={region} value={region}>
                            {region}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Unit</span>
                    <Select value={unitFilter} onValueChange={setUnitFilter}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All</SelectItem>
                        <SelectItem value="EMS">{UNIT_LABELS.EMS}</SelectItem>
                        <SelectItem value="TRAFFIC_POLICE">{UNIT_LABELS.TRAFFIC_POLICE}</SelectItem>
                        <SelectItem value="CRIME_POLICE">{UNIT_LABELS.CRIME_POLICE}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                </div>
                <div className="p-4 border-t">
                  <SheetFooter>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => {
                        setStatusFilter('ALL');
                        setUnitFilter('ALL');
                        setPriorityFilter('ALL');
                        setCategoryFilter('ALL');
                        setRegionFilter('ALL');
                      }}
                    >
                      Reset
                    </Button>
                    <Button type="button" onClick={() => setFilterOpen(false)}>
                      OK
                    </Button>
                  </SheetFooter>
                </div>
              </SheetContent>
            </Sheet>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => {
                setAlertsOpen(true);
              }}
              aria-label="Alerts"
              title="Alerts"
            >
              <span className="relative">
                <Bell className="h-3.5 w-3.5" />
                {totalAlertBadge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-3.5 min-w-3.5 px-0.5 rounded-full bg-red-500 text-[9px] font-semibold flex items-center justify-center">
                    {totalAlertBadge > 99 ? '99+' : totalAlertBadge}
                  </span>
                )}
              </span>
            </Button>
            <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
              <SheetContent className="p-0">
                <div className="p-4 border-b">
                  <SheetHeader>
                    <SheetTitle className="text-base">Alerts</SheetTitle>
                  </SheetHeader>
                  <p className="text-sm text-muted-foreground mt-0.5">Incidents awaiting dispatch decision</p>
                </div>
                <ScrollArea className="h-[calc(100vh-140px)] p-4 space-y-6">
                  <section className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <h2 className="text-sm font-semibold">Responder incidents</h2>
                    </div>
                    {pendingDispatcherAlerts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No new incidents awaiting decision.</p>
                    ) : (
                      <div className="space-y-2">
                        {pendingDispatcherAlerts.map((inc) => (
                          <div key={inc.id} className="rounded-lg border bg-card p-3 flex flex-col gap-2">
                            <div>
                              <h3 className="font-medium text-sm">{inc.title}</h3>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{inc.description}</p>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Created {formatDistanceToNow(new Date(inc.createdAt), { addSuffix: true })}
                              </p>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setRejectingId(inc.id);
                                  setRejectReason('');
                                }}
                              >
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleAccept(inc.id)}
                                disabled={updateIncident.isPending}
                              >
                                Accept
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        {onCreateClick && (showCreateButton ?? false) && (
          <Button onClick={onCreateClick} className="w-full justify-center gap-2 mt-1 bg-emerald-600 hover:bg-emerald-700" size="sm">
            <Plus className="h-4 w-4" />
            <span className="uppercase tracking-wide text-xs font-semibold">Create incident</span>
          </Button>
        )}

        <Dialog
          open={!!rejectingId}
          onOpenChange={(open) => !open && setRejectingId(null)}
          modal={false}
        >
          <DialogContent
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Reason for rejection</DialogTitle>
            </DialogHeader>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Describe why this incident is being rejected…"
              className="min-h-[120px] text-sm"
            />
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setRejectingId(null);
                  setRejectReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmitReject}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                Submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y border-t bg-card">
          {isError ? (
            <div className="p-4 space-y-2 text-sm">
              <p className="text-destructive font-medium">Could not load incidents</p>
              <p className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8 space-y-1 px-3">
              <p>No incidents match the current filters.</p>
              {(incidents?.length ?? 0) === 0 && !isFetching ? (
                    <p className="text-xs">If you expected older cases, the list API includes all incidents.</p>
              ) : null}
            </div>
          ) : (
            filtered.map(inc => (
              <IncidentCard
                key={inc.id}
                incident={inc}
                isSelected={inc.id === selectedId}
                onClick={() => onSelect(inc)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
