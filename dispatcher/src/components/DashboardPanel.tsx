import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, dedupeIncidentsByIdPreferNewest } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { incidentCategoryDisplayLabel, type Incident, type IncidentStatus, type Responder } from "@/types/incident";
import type { IncidentHistoryEntry } from "@/lib/api";

const UNIT_ORDER = ["EMS", "TRAFFIC_POLICE", "CRIME_POLICE", "Unassigned"] as const;
const UNIT_LABELS: Record<string, string> = {
  EMS: "EMS",
  TRAFFIC_POLICE: "Traffic Police",
  CRIME_POLICE: "Crime Police",
  Unassigned: "Unassigned",
};

type TransitionName = "UNASSIGNED_TO_ASSIGNED" | "ASSIGNED_TO_IN_PROGRESS" | "IN_PROGRESS_TO_COMPLETED";
type TransitionMetrics = Record<TransitionName, number[]>;

type DashboardRow = {
  id: string;
  user: string;
  unit: string;
  category: string;
  subcategory: string;
  statusRaw: IncidentStatus;
  createdTime: string;
  createdAtMs: number;
  progressStatus: string;
  incidentDurationMinutes: number;
  statusProgression: string;
  statusChangeTimeline: string[];
  transitionValues: Partial<Record<TransitionName, number>>;
};

type DashboardData = {
  incidents: Incident[];
  rows: DashboardRow[];
  counts: {
    total: number;
    unassigned: number;
    assigned: number;
    inProgress: number;
    completed: number;
  };
  perUnit: Array<{
    unit: string;
    total: number;
    unassigned: number;
    assigned: number;
    inProgress: number;
    completed: number;
  }>;
  transitionsByUnit: Record<string, TransitionMetrics>;
};

function statusLabel(status: IncidentStatus): string {
  if (status === "NEW") return "Unassigned";
  if (status === "ASSIGNED") return "Assigned";
  if (status === "IN_PROGRESS") return "In Progress";
  if (status === "RESOLVED" || status === "CLOSED") return "Completed";
  return status;
}

function statusBucket(status: IncidentStatus): keyof DashboardData["counts"] {
  if (status === "NEW") return "unassigned";
  if (status === "ASSIGNED") return "assigned";
  if (status === "IN_PROGRESS") return "inProgress";
  return "completed";
}

function toMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function formatDateTime(iso?: string): string {
  const ms = toMs(iso);
  if (ms == null) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const mins = Math.round(minutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function extractSubcategory(incident: Incident): string {
  const details = incident.details;
  if (!details || typeof details !== "object") return incident.title?.trim() || "—";
  const d = details as Record<string, unknown>;
  const pick =
    d.subcategory ??
    d.subCategory ??
    d.incidentSubcategory ??
    d.incident_subcategory ??
    d.type ??
    d.incidentType ??
    d.incident_type;
  if (typeof pick === "string" && pick.trim()) return pick.trim();
  return incident.title?.trim() || "—";
}

function firstAt(history: IncidentHistoryEntry[], status: string): number | null {
  for (const h of history) {
    if (String(h.toStatus).toUpperCase() === status) {
      const t = toMs(h.createdAt);
      if (t != null) return t;
    }
  }
  return null;
}

function buildTransitions(history: IncidentHistoryEntry[], createdAt: string): Partial<Record<TransitionName, number>> {
  const out: Partial<Record<TransitionName, number>> = {};
  const createdMs = toMs(createdAt);
  const assignedMs = firstAt(history, "ASSIGNED");
  const inProgressMs = firstAt(history, "IN_PROGRESS");
  const resolvedMs = firstAt(history, "RESOLVED");
  const closedMs = firstAt(history, "CLOSED");
  const completedMs = resolvedMs ?? closedMs;

  if (createdMs != null && assignedMs != null && assignedMs >= createdMs) {
    out.UNASSIGNED_TO_ASSIGNED = (assignedMs - createdMs) / 60000;
  }
  if (assignedMs != null && inProgressMs != null && inProgressMs >= assignedMs) {
    out.ASSIGNED_TO_IN_PROGRESS = (inProgressMs - assignedMs) / 60000;
  }
  if (inProgressMs != null && completedMs != null && completedMs >= inProgressMs) {
    out.IN_PROGRESS_TO_COMPLETED = (completedMs - inProgressMs) / 60000;
  }
  return out;
}

function buildStatusProgression(history: IncidentHistoryEntry[], currentStatus: IncidentStatus): string {
  const seq: string[] = ["Unassigned"];
  for (const h of history) {
    const s = String(h.toStatus).toUpperCase();
    const label = statusLabel(s as IncidentStatus);
    if (!seq.includes(label)) seq.push(label);
  }
  const current = statusLabel(currentStatus);
  if (!seq.includes(current)) seq.push(current);
  return seq.join(" → ");
}

function buildStatusTimeline(history: IncidentHistoryEntry[], createdAt: string): string[] {
  const events: Array<{ label: string; at: string }> = [
    { label: "Unassigned", at: createdAt },
    ...history.map((h) => ({
      label: statusLabel(String(h.toStatus).toUpperCase() as IncidentStatus),
      at: h.createdAt,
    })),
  ];

  const lines: string[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (prev.label === curr.label) continue;
    const prevMs = toMs(prev.at);
    const currMs = toMs(curr.at);
    const deltaMinutes = prevMs != null && currMs != null && currMs >= prevMs ? (currMs - prevMs) / 60000 : null;
    lines.push(
      `${prev.label} → ${curr.label}: ${deltaMinutes == null ? "—" : formatDuration(deltaMinutes)} (at ${formatDateTime(curr.at)})`
    );
  }

  if (!lines.length) {
    lines.push(`Unassigned: ${formatDateTime(createdAt)}`);
  }
  return lines;
}

type DatePreset = "all_time" | "today" | "this_week" | "last_week" | "this_month" | "last_month" | "date";

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekMs(ms: number): number {
  const d = new Date(ms);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday as first day
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonthMs(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isInDatePreset(createdAtMs: number, preset: DatePreset, customDate: string, nowMs = Date.now()): boolean {
  if (!Number.isFinite(createdAtMs)) return false;
  if (preset === "all_time") return true;
  const todayStart = startOfDayMs(nowMs);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  if (preset === "today") return createdAtMs >= todayStart && createdAtMs < tomorrowStart;

  const thisWeekStart = startOfWeekMs(nowMs);
  const nextWeekStart = thisWeekStart + 7 * 24 * 60 * 60 * 1000;
  if (preset === "this_week") return createdAtMs >= thisWeekStart && createdAtMs < nextWeekStart;
  if (preset === "last_week") return createdAtMs >= thisWeekStart - 7 * 24 * 60 * 60 * 1000 && createdAtMs < thisWeekStart;

  const thisMonthStart = startOfMonthMs(nowMs);
  const nextMonthStart = (() => {
    const d = new Date(thisMonthStart);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  })();
  if (preset === "this_month") return createdAtMs >= thisMonthStart && createdAtMs < nextMonthStart;
  if (preset === "last_month") {
    const lastMonthStart = (() => {
      const d = new Date(thisMonthStart);
      d.setMonth(d.getMonth() - 1);
      return d.getTime();
    })();
    return createdAtMs >= lastMonthStart && createdAtMs < thisMonthStart;
  }

  const value = customDate?.trim();
  if (!value) return true;
  const selected = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(selected.getTime())) return true;
  const start = selected.getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return createdAtMs >= start && createdAtMs < end;
}

async function fetchAllIncidents(): Promise<Incident[]> {
  const limit = 500;
  const all: Incident[] = [];
  for (let offset = 0; offset < 5000; offset += limit) {
    const batch = await api.getIncidents({ limit, offset });
    all.push(...batch);
    if (batch.length < limit) break;
  }
  // Backend currently ignores limit/offset; repeated pages would duplicate rows without this.
  return dedupeIncidentsByIdPreferNewest(all);
}

async function loadDashboardData(): Promise<DashboardData> {
  const [incidents, responders] = await Promise.all([fetchAllIncidents(), api.getResponders().catch(() => [] as Responder[])]);
  const responderUnitById = new Map<string, string>();
  for (const r of responders) responderUnitById.set(r.id, r.unit || "Unassigned");

  const histories = await Promise.all(
    incidents.map(async (inc) => ({
      id: inc.id,
      history: (await api.getIncidentHistory(inc.id).catch(() => [])) as IncidentHistoryEntry[],
    }))
  );
  const historyByIncident = new Map(histories.map((h) => [h.id, h.history.sort((a, b) => (toMs(a.createdAt) ?? 0) - (toMs(b.createdAt) ?? 0))]));

  const counts = { total: incidents.length, unassigned: 0, assigned: 0, inProgress: 0, completed: 0 };
  const unitStats = new Map<string, DashboardData["perUnit"][number]>();
  const transitionsByUnit: DashboardData["transitionsByUnit"] = {};

  const ensureUnit = (unit: string) => {
    if (!unitStats.has(unit)) {
      unitStats.set(unit, { unit, total: 0, unassigned: 0, assigned: 0, inProgress: 0, completed: 0 });
    }
    if (!transitionsByUnit[unit]) {
      transitionsByUnit[unit] = {
        UNASSIGNED_TO_ASSIGNED: [],
        ASSIGNED_TO_IN_PROGRESS: [],
        IN_PROGRESS_TO_COMPLETED: [],
      };
    }
  };

  const rows: DashboardRow[] = incidents.map((inc) => {
    const unit = (inc.assignedResponderId && responderUnitById.get(inc.assignedResponderId)) || "Unassigned";
    ensureUnit(unit);

    const bucket = statusBucket(inc.status);
    counts[bucket] += 1;
    const us = unitStats.get(unit)!;
    us.total += 1;
    us[bucket] += 1;

    const history = historyByIncident.get(inc.id) ?? [];
    const transition = buildTransitions(history, inc.createdAt);
    if (transition.UNASSIGNED_TO_ASSIGNED != null) transitionsByUnit[unit].UNASSIGNED_TO_ASSIGNED.push(transition.UNASSIGNED_TO_ASSIGNED);
    if (transition.ASSIGNED_TO_IN_PROGRESS != null) transitionsByUnit[unit].ASSIGNED_TO_IN_PROGRESS.push(transition.ASSIGNED_TO_IN_PROGRESS);
    if (transition.IN_PROGRESS_TO_COMPLETED != null) transitionsByUnit[unit].IN_PROGRESS_TO_COMPLETED.push(transition.IN_PROGRESS_TO_COMPLETED);

    const createdMs = toMs(inc.createdAt) ?? Date.now();
    const endMs = inc.status === "RESOLVED" || inc.status === "CLOSED" ? toMs(inc.updatedAt) ?? Date.now() : Date.now();
    const durationMinutes = Math.max(0, (endMs - createdMs) / 60000);

    return {
      id: inc.id,
      user: inc.assignedResponderName || "Unassigned",
      unit,
      category: incidentCategoryDisplayLabel(inc.category || "—"),
      subcategory: extractSubcategory(inc),
      statusRaw: inc.status,
      createdTime: formatDateTime(inc.createdAt),
      createdAtMs: createdMs,
      progressStatus: statusLabel(inc.status),
      incidentDurationMinutes: durationMinutes,
      statusProgression: buildStatusProgression(history, inc.status),
      statusChangeTimeline: buildStatusTimeline(history, inc.createdAt),
      transitionValues: transition,
    };
  });

  const perUnit = Array.from(unitStats.values()).sort((a, b) => {
    const ai = UNIT_ORDER.indexOf(a.unit as (typeof UNIT_ORDER)[number]);
    const bi = UNIT_ORDER.indexOf(b.unit as (typeof UNIT_ORDER)[number]);
    const av = ai === -1 ? 99 : ai;
    const bv = bi === -1 ? 99 : bi;
    return av - bv || a.unit.localeCompare(b.unit);
  });

  return { incidents, rows, counts, perUnit, transitionsByUnit };
}

function TransitionDiagram({
  title,
  keyName,
  transitionsByUnit,
}: {
  title: string;
  keyName: TransitionName;
  transitionsByUnit: DashboardData["transitionsByUnit"];
}) {
  const rows = Object.entries(transitionsByUnit).map(([unit, metrics]) => {
    const arr = metrics[keyName];
    const avg = arr.length ? arr.reduce((a, n) => a + n, 0) / arr.length : 0;
    return { unit, avg, samples: arr.length };
  });
  const max = rows.reduce((m, r) => Math.max(m, r.avg), 0);
  const chartRows = rows.filter((r) => r.samples > 0);
  const W = 520;
  const H = 170;
  const padL = 36;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const lineColor =
    keyName === "UNASSIGNED_TO_ASSIGNED"
      ? "#2563eb"
      : keyName === "ASSIGNED_TO_IN_PROGRESS"
      ? "#d97706"
      : "#059669";
  const x = (i: number) => (chartRows.length <= 1 ? padL : padL + (i * (W - padL - padR)) / (chartRows.length - 1));
  const y = (v: number) => (max <= 0 ? H - padB : H - padB - (v / max) * (H - padT - padB));
  const pathD = chartRows
    .map((r, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(r.avg).toFixed(1)}`)
    .join(" ");
  return (
    <Card className="border-slate-200 bg-slate-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-700">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {chartRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data yet.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 rounded-md border bg-background">
              <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
              <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
              <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2.5" />
              {chartRows.map((r, i) => (
                <g key={r.unit}>
                  <circle cx={x(i)} cy={y(r.avg)} r={4} fill={lineColor} />
                  <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">
                    {(UNIT_LABELS[r.unit] ?? r.unit).replace(" Police", "")}
                  </text>
                </g>
              ))}
            </svg>
            <div className="space-y-1">
              {chartRows.map((r) => (
                <div key={r.unit} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{UNIT_LABELS[r.unit] ?? r.unit}</span>
                  <span className="font-medium">{formatDuration(r.avg)} ({r.samples})</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dispatcher", "overview-dashboard-v2"],
    queryFn: loadDashboardData,
    refetchInterval: 30000,
  });
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("all_time");
  const [customDate, setCustomDate] = useState<string>("");
  const allRows = data?.rows ?? [];

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) set.add(r.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (categoryFilter !== "ALL" && r.category !== categoryFilter) return false;
      if (statusFilter !== "ALL" && r.progressStatus !== statusFilter) return false;
      if (!isInDatePreset(r.createdAtMs, datePreset, customDate)) return false;
      return true;
    });
  }, [allRows, categoryFilter, statusFilter, datePreset, customDate]);

  const counts = useMemo(() => {
    const c = { total: filteredRows.length, unassigned: 0, assigned: 0, inProgress: 0, completed: 0 };
    for (const r of filteredRows) c[statusBucket(r.statusRaw)] += 1;
    return c;
  }, [filteredRows]);

  const perUnit = useMemo(() => {
    const map = new Map<string, { unit: string; total: number; unassigned: number; assigned: number; inProgress: number; completed: number }>();
    const ensure = (unit: string) => {
      if (!map.has(unit)) map.set(unit, { unit, total: 0, unassigned: 0, assigned: 0, inProgress: 0, completed: 0 });
      return map.get(unit)!;
    };
    for (const r of filteredRows) {
      const u = ensure(r.unit || "Unassigned");
      u.total += 1;
      u[statusBucket(r.statusRaw)] += 1;
    }
    return Array.from(map.values()).sort((a, b) => {
      const ai = UNIT_ORDER.indexOf(a.unit as (typeof UNIT_ORDER)[number]);
      const bi = UNIT_ORDER.indexOf(b.unit as (typeof UNIT_ORDER)[number]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.unit.localeCompare(b.unit);
    });
  }, [filteredRows]);

  const transitionsByUnit = useMemo(() => {
    const out: Record<string, TransitionMetrics> = {};
    const ensure = (unit: string) => {
      if (!out[unit]) out[unit] = { UNASSIGNED_TO_ASSIGNED: [], ASSIGNED_TO_IN_PROGRESS: [], IN_PROGRESS_TO_COMPLETED: [] };
      return out[unit];
    };
    for (const r of filteredRows) {
      const unit = r.unit || "Unassigned";
      const t = ensure(unit);
      if (r.transitionValues.UNASSIGNED_TO_ASSIGNED != null) t.UNASSIGNED_TO_ASSIGNED.push(r.transitionValues.UNASSIGNED_TO_ASSIGNED);
      if (r.transitionValues.ASSIGNED_TO_IN_PROGRESS != null) t.ASSIGNED_TO_IN_PROGRESS.push(r.transitionValues.ASSIGNED_TO_IN_PROGRESS);
      if (r.transitionValues.IN_PROGRESS_TO_COMPLETED != null) t.IN_PROGRESS_TO_COMPLETED.push(r.transitionValues.IN_PROGRESS_TO_COMPLETED);
    }
    return out;
  }, [filteredRows]);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading dashboard…</div>;
  }
  if (error || !data) {
    return <div className="text-sm text-red-600">Failed to load dashboard data.</div>;
  }

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 bg-blue-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-blue-700">Dashboard Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-xs text-muted-foreground">
              Category
              <select
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="ALL">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Status
              <select
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All statuses</option>
                <option value="Unassigned">Unassigned</option>
                <option value="Assigned">Assigned</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Date range
              <select
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              >
                <option value="all_time">All time</option>
                <option value="today">Today</option>
                <option value="this_week">This week</option>
                <option value="last_week">Last week</option>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="date">Date</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                disabled={datePreset !== "date"}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-indigo-200 bg-indigo-50"><CardHeader className="pb-2"><CardTitle className="text-xs text-indigo-700">Total Incidents</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-indigo-900">{counts.total}</div></CardContent></Card>
        <Card className="border-slate-200 bg-slate-50"><CardHeader className="pb-2"><CardTitle className="text-xs text-slate-700">Unassigned</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-slate-900">{counts.unassigned}</div></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50"><CardHeader className="pb-2"><CardTitle className="text-xs text-blue-700">Assigned</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-blue-900">{counts.assigned}</div></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50"><CardHeader className="pb-2"><CardTitle className="text-xs text-amber-700">In Progress</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-amber-900">{counts.inProgress}</div></CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50"><CardHeader className="pb-2"><CardTitle className="text-xs text-emerald-700">Completed</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-emerald-900">{counts.completed}</div></CardContent></Card>
      </div>

      <Card className="border-violet-200 bg-violet-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-violet-700">Performance Indicators · Incidents per unit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-2 py-2">Unit</th>
                  <th className="text-right px-2 py-2">Total</th>
                  <th className="text-right px-2 py-2">Unassigned</th>
                  <th className="text-right px-2 py-2">Assigned</th>
                  <th className="text-right px-2 py-2">In Progress</th>
                  <th className="text-right px-2 py-2">Completed</th>
                </tr>
              </thead>
              <tbody>
                {perUnit.map((u) => (
                  <tr key={u.unit} className="border-t">
                    <td className="px-2 py-2 font-medium">{UNIT_LABELS[u.unit] ?? u.unit}</td>
                    <td className="px-2 py-2 text-right">{u.total}</td>
                    <td className="px-2 py-2 text-right">{u.unassigned}</td>
                    <td className="px-2 py-2 text-right">{u.assigned}</td>
                    <td className="px-2 py-2 text-right">{u.inProgress}</td>
                    <td className="px-2 py-2 text-right">{u.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <TransitionDiagram
          title="Chart 1: Unassigned → Assigned"
          keyName="UNASSIGNED_TO_ASSIGNED"
          transitionsByUnit={transitionsByUnit}
        />
        <TransitionDiagram
          title="Chart 2: Assigned → In Progress"
          keyName="ASSIGNED_TO_IN_PROGRESS"
          transitionsByUnit={transitionsByUnit}
        />
        <TransitionDiagram
          title="Chart 3: In Progress → Completed"
          keyName="IN_PROGRESS_TO_COMPLETED"
          transitionsByUnit={transitionsByUnit}
        />
      </div>

      <Card className="border-cyan-200 bg-cyan-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-cyan-700">Incident Table</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[28rem] overflow-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-2">User</th>
                  <th className="text-left px-2 py-2">Category</th>
                  <th className="text-left px-2 py-2">Subcategory</th>
                  <th className="text-left px-2 py-2">Created Time</th>
                  <th className="text-left px-2 py-2">Progress Status</th>
                  <th className="text-left px-2 py-2">Incident Duration</th>
                  <th className="text-left px-2 py-2">Status Progression</th>
                  <th className="text-left px-2 py-2">Status Change Times</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-2">{r.user}</td>
                    <td className="px-2 py-2">{r.category}</td>
                    <td className="px-2 py-2">{r.subcategory}</td>
                    <td className="px-2 py-2">{r.createdTime}</td>
                    <td className="px-2 py-2">{r.progressStatus}</td>
                    <td className="px-2 py-2">{formatDuration(r.incidentDurationMinutes)}</td>
                    <td className="px-2 py-2">{r.statusProgression}</td>
                    <td className="px-2 py-2">
                      <details>
                        <summary className="cursor-pointer text-primary font-medium">
                          {r.statusChangeTimeline.length} event{r.statusChangeTimeline.length === 1 ? "" : "s"}
                        </summary>
                        <div className="mt-1 space-y-1 text-muted-foreground">
                          {r.statusChangeTimeline.map((line, idx) => (
                            <div key={`${r.id}-${idx}`}>{line}</div>
                          ))}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

