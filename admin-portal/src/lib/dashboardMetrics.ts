/** Metrics keyed by `incidents.category` from the database. */

/**
 * Executive dashboard uses three segments only: Crime, Traffic, Other.
 * DB may store dispatcher enums (FIRE, MEDICAL, TRAFFIC, CRIME, HAZMAT, OTHER, etc.);
 * everything except CRIME and TRAFFIC maps to OTHER.
 */
export const CANONICAL_CATEGORIES = ["CRIME", "TRAFFIC", "OTHER"] as const;
export type DashboardCategoryKey = (typeof CANONICAL_CATEGORIES)[number];

export const CHART_CATEGORY_ORDER = [...CANONICAL_CATEGORIES] as const;

/** Stable bucket key for filters and chart series. */
export function categoryChartKey(raw: string | null | undefined): string {
  const c = String(raw ?? "").trim().toUpperCase();
  if (c === "CRIME") return "CRIME";
  if (c === "TRAFFIC") return "TRAFFIC";
  return "OTHER";
}

const CATEGORY_LABELS: Record<string, string> = {
  CRIME: "Crime",
  TRAFFIC: "Traffic",
  OTHER: "Other",
};

/** Human-readable label for a category chart bucket (filter / table / chart axis). */
export function categoryKeyDisplayLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

export type DashboardIncident = {
  id: string;
  title: string;
  status: string;
  priority: string;
  category?: string;
  assignedResponderName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  details?: Record<string, unknown> | null;
};

export type PerfCategory = { label: string; cellClass: string };

/** One row in the lifecycle: status label, wall time, and lag since the previous milestone. */
export type LifecycleStep = {
  key: string;
  statusLabel: string;
  atIso?: string;
  /** Minutes from the previous step’s `atIso`; null for the first step. */
  fromPreviousMinutes: number | null;
};

export type EnrichedIncidentRow = {
  incident: DashboardIncident;
  /** Bucket: CRIME | TRAFFIC | OTHER (derived from `incidents.category`). */
  categoryKey: string;
  /** Same bucket as display label: Crime, Traffic, or Other. */
  category: string;
  openCaseDate: string;
  responseHours: number | null;
  repairHours: number | null;
  completionHours: number | null;
  reopeningMinutes: number | null;
  responseCategory: PerfCategory;
  repairCategory: PerfCategory;
  completionCategory: PerfCategory;
  reopeningCategory: PerfCategory;
  /** Dispatcher assignment time (details.timeline / dispatchAssignment only). */
  dispatcherAssignedAt?: string;
  /** Responder acceptance (details.responderDecision.acceptedAt). */
  responderAcceptedAt?: string;
  /** Start of in-progress work (timeline.inProgressAt or same as acceptance when accept moves to IN_PROGRESS). */
  inProgressAt?: string;
  /** When marked completed (timeline / responderDecision). */
  completedAt?: string;
  /** When closed (timeline / dispatcherDecision). */
  closedAt?: string;
  /** Ordered milestones for status history + durations in the dashboard table. */
  lifecycleSteps: LifecycleStep[];
  /** Minutes from dispatcher assignment to responder acceptance. */
  assignToAcceptMinutes: number | null;
  /** Minutes from acceptance to in-progress timestamp (0 when simultaneous). */
  acceptToInProgressMinutes: number | null;
  /** Hours from in-progress start to completion, or elapsed hours while still IN_PROGRESS. */
  inProgressDurationHours: number | null;
  /** True when inProgressDurationHours measures time still in IN_PROGRESS. */
  inProgressDurationOngoing: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hoursBetween(startIso: string | undefined, endIso: string | undefined): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3600_000;
}

function minutesBetween(startIso: string | undefined, endIso: string | undefined): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 60_000;
}

type InferredTimeline = {
  dispatcherAssignedAt?: string;
  responderAcceptedAt?: string;
  inProgressAt?: string;
  completedAt?: string;
  closedAt?: string;
  reopenedAt?: string;
  reopenResolvedAt?: string;
};

function inferTimeline(inc: DashboardIncident): InferredTimeline {
  const details = asObject(inc.details);
  const timeline = asObject(details.timeline);
  const dispatchAssignment = asObject(details.dispatchAssignment);
  const responderDecision = asObject(details.responderDecision);
  const dispatcherDecision = asObject(details.dispatcherDecision);
  const status = String(inc.status || "").toUpperCase();
  const updatedAt = inc.updatedAt;

  const dispatcherAssignedAt =
    asString(timeline.assignedAt) ?? asString(dispatchAssignment.assignedAt) ?? undefined;

  const responderAcceptedAt = asString(responderDecision.acceptedAt);

  const inProgressAt =
    asString(timeline.inProgressAt) ??
    (responderAcceptedAt && ["IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status) ? responderAcceptedAt : undefined);

  const completedAt =
    asString(timeline.completedAt) ??
    asString(responderDecision.completedAt) ??
    (status === "RESOLVED" || status === "CLOSED" ? updatedAt : undefined);

  const closedAt =
    asString(timeline.closedAt) ??
    asString(dispatcherDecision.closedAt) ??
    asString(dispatcherDecision.rejectedAt) ??
    (status === "CLOSED" ? updatedAt : undefined);

  const reopenedAt = asString(timeline.reopenedAt);
  const reopenResolvedAt = asString(timeline.reopenResolvedAt);

  const out: InferredTimeline = {};
  if (dispatcherAssignedAt) out.dispatcherAssignedAt = dispatcherAssignedAt;
  if (responderAcceptedAt) out.responderAcceptedAt = responderAcceptedAt;
  if (inProgressAt) out.inProgressAt = inProgressAt;
  if (completedAt) out.completedAt = completedAt;
  if (closedAt) out.closedAt = closedAt;
  if (reopenedAt) out.reopenedAt = reopenedAt;
  if (reopenResolvedAt) out.reopenResolvedAt = reopenResolvedAt;
  return out;
}

export function classifyResponse(hours: number | null): PerfCategory {
  if (hours === null || !Number.isFinite(hours)) {
    return { label: "Not Closed", cellClass: "perfCellNeutral" };
  }
  if (hours < 1) return { label: "Excellent (<1 h)", cellClass: "perfCellExcellent" };
  if (hours < 3) return { label: "Good (1–3 h)", cellClass: "perfCellGood" };
  return { label: "Poor (≥3 h)", cellClass: "perfCellPoor" };
}

export function classifyRepair(hours: number | null, status: string): PerfCategory {
  const s = status.toUpperCase();
  if (hours === null || !Number.isFinite(hours)) {
    return { label: "Not Completed", cellClass: "perfCellNeutral" };
  }
  if (s === "NEW") return { label: "Not Completed", cellClass: "perfCellNeutral" };
  if (hours < 1) return { label: "Excellent (<1 h)", cellClass: "perfCellExcellent" };
  if (hours < 5) return { label: "Good (1–5 h)", cellClass: "perfCellGood" };
  return { label: "Poor (≥5 h)", cellClass: "perfCellPoor" };
}

export function classifyCompletion(hours: number | null, status: string): PerfCategory {
  const s = status.toUpperCase();
  if (s !== "RESOLVED" && s !== "CLOSED") {
    return { label: "Ongoing", cellClass: "perfCellOngoing" };
  }
  if (hours === null || !Number.isFinite(hours)) {
    return { label: "Ongoing", cellClass: "perfCellOngoing" };
  }
  if (hours < 2) return { label: "Excellent (<2 h)", cellClass: "perfCellExcellent" };
  if (hours < 6) return { label: "Good (2–6 h)", cellClass: "perfCellGood" };
  return { label: "Poor (≥6 h)", cellClass: "perfCellPoor" };
}

export function classifyReopening(minutes: number | null): PerfCategory {
  if (minutes === null || !Number.isFinite(minutes)) {
    return { label: "Not Reopened", cellClass: "perfCellNeutral" };
  }
  if (minutes < 30) return { label: "Excellent (<30 min)", cellClass: "perfCellExcellent" };
  if (minutes < 120) return { label: "Good (30–120 min)", cellClass: "perfCellGood" };
  return { label: "Poor (≥120 min)", cellClass: "perfCellPoor" };
}

function buildLifecycleSteps(inc: DashboardIncident, tl: InferredTimeline): LifecycleStep[] {
  const created = asString(inc.createdAt);
  const steps: LifecycleStep[] = [];
  if (created) {
    steps.push({ key: "new", statusLabel: "Unassigned", atIso: created, fromPreviousMinutes: null });
  }
  if (tl.dispatcherAssignedAt) {
    steps.push({
      key: "assigned",
      statusLabel: "Assigned",
      atIso: tl.dispatcherAssignedAt,
      fromPreviousMinutes: minutesBetween(created, tl.dispatcherAssignedAt),
    });
  }
  if (
    tl.responderAcceptedAt &&
    tl.inProgressAt &&
    tl.responderAcceptedAt !== tl.inProgressAt
  ) {
    const prevIso = tl.dispatcherAssignedAt ?? created;
    steps.push({
      key: "accepted",
      statusLabel: "Accepted",
      atIso: tl.responderAcceptedAt,
      fromPreviousMinutes: minutesBetween(prevIso, tl.responderAcceptedAt),
    });
  }
  if (tl.inProgressAt) {
    const prevIso = tl.responderAcceptedAt ?? tl.dispatcherAssignedAt ?? created;
    steps.push({
      key: "in_progress",
      statusLabel: "In progress",
      atIso: tl.inProgressAt,
      fromPreviousMinutes: minutesBetween(prevIso, tl.inProgressAt),
    });
  }
  if (tl.completedAt) {
    const prevIso = tl.inProgressAt ?? tl.dispatcherAssignedAt ?? created;
    steps.push({
      key: "resolved",
      statusLabel: "Completed",
      atIso: tl.completedAt,
      fromPreviousMinutes: minutesBetween(prevIso, tl.completedAt),
    });
  }
  if (tl.closedAt) {
    const prevIso = tl.completedAt ?? tl.inProgressAt ?? tl.dispatcherAssignedAt ?? undefined;
    steps.push({
      key: "closed",
      statusLabel: "Closed",
      atIso: tl.closedAt,
      fromPreviousMinutes: prevIso ? minutesBetween(prevIso, tl.closedAt) : null,
    });
  }
  return steps;
}

/** Compact “Unassigned → Assigned → …” string for table / export. */
export function statusProgressionText(steps: LifecycleStep[]): string {
  if (!steps.length) return "—";
  return steps.map((s) => s.statusLabel).join(" → ");
}

function inProgressDurationAndOngoing(
  tl: InferredTimeline,
  statusUpper: string,
  nowMs: number
): { hours: number | null; ongoing: boolean } {
  if (!tl.inProgressAt) return { hours: null, ongoing: false };
  const completedMs = tl.completedAt ? new Date(tl.completedAt).getTime() : null;
  if (completedMs != null && Number.isFinite(completedMs)) {
    const h = hoursBetween(tl.inProgressAt, tl.completedAt);
    return { hours: h, ongoing: false };
  }
  if (statusUpper === "IN_PROGRESS") {
    const isoNow = new Date(nowMs).toISOString();
    const h = hoursBetween(tl.inProgressAt, isoNow);
    return { hours: h, ongoing: true };
  }
  return { hours: null, ongoing: false };
}

export function enrichIncident(inc: DashboardIncident, nowMs = Date.now()): EnrichedIncidentRow {
  const tl = inferTimeline(inc);
  const createdAt = inc.createdAt ?? "";
  const responseHours = hoursBetween(createdAt, tl.dispatcherAssignedAt);
  const repairHours = hoursBetween(tl.dispatcherAssignedAt, tl.completedAt);
  const completionHours = hoursBetween(createdAt, tl.completedAt);
  let reopeningMinutes: number | null = null;
  if (tl.reopenedAt && tl.reopenResolvedAt) {
    reopeningMinutes = minutesBetween(tl.reopenedAt, tl.reopenResolvedAt);
  } else if (tl.reopenedAt && tl.closedAt) {
    reopeningMinutes = minutesBetween(tl.reopenedAt, tl.closedAt);
  }

  const status = String(inc.status || "");
  const statusUpper = status.toUpperCase();
  const assignToAcceptMinutes = minutesBetween(tl.dispatcherAssignedAt, tl.responderAcceptedAt);
  const acceptToInProgressMinutes = minutesBetween(tl.responderAcceptedAt, tl.inProgressAt);
  const { hours: inProgressDurationHours, ongoing: inProgressDurationOngoing } = inProgressDurationAndOngoing(
    tl,
    statusUpper,
    nowMs
  );

  const lifecycleSteps = buildLifecycleSteps(inc, tl);
  const categoryKey = categoryChartKey(inc.category);
  const category = categoryKeyDisplayLabel(categoryKey);

  return {
    incident: inc,
    categoryKey,
    category,
    openCaseDate: createdAt,
    responseHours,
    repairHours,
    completionHours,
    reopeningMinutes,
    responseCategory: classifyResponse(responseHours),
    repairCategory: classifyRepair(repairHours, status),
    completionCategory: classifyCompletion(completionHours, status),
    reopeningCategory: classifyReopening(reopeningMinutes),
    dispatcherAssignedAt: tl.dispatcherAssignedAt,
    responderAcceptedAt: tl.responderAcceptedAt,
    inProgressAt: tl.inProgressAt,
    completedAt: tl.completedAt,
    closedAt: tl.closedAt,
    lifecycleSteps,
    assignToAcceptMinutes,
    acceptToInProgressMinutes,
    inProgressDurationHours,
    inProgressDurationOngoing,
  };
}

export function enrichAll(incidents: DashboardIncident[], nowMs = Date.now()): EnrichedIncidentRow[] {
  return incidents.map((inc) => enrichIncident(inc, nowMs));
}

/** Aggregate mean hours (non-null only) by incident category bucket for charts. */
export function meanByCategory(
  rows: EnrichedIncidentRow[],
  pick: (r: EnrichedIncidentRow) => number | null,
  categoryKeys: readonly string[] = CHART_CATEGORY_ORDER
): { labels: string[]; values: number[] } {
  const keys = [...categoryKeys];
  const labels = keys.map((k) => categoryKeyDisplayLabel(k));
  const values = keys.map((key) => {
    const subset = rows.filter((r) => r.categoryKey === key);
    const nums = subset.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
    if (!nums.length) return 0;
    return Math.round((nums.reduce((a, n) => a + n, 0) / nums.length) * 10) / 10;
  });
  return { labels, values };
}

type StatusChartBucket = "NEW" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "OTHER";

function incidentStatusBucket(status: string): StatusChartBucket {
  const s = String(status || "NEW").toUpperCase();
  if (s === "NEW") return "NEW";
  if (s === "ASSIGNED") return "ASSIGNED";
  if (s === "IN_PROGRESS" || s === "EN_ROUTE" || s === "ON_SCENE") return "IN_PROGRESS";
  if (s === "RESOLVED") return "RESOLVED";
  if (s === "CLOSED") return "CLOSED";
  return "OTHER";
}

const STATUS_CHART_ORDER: StatusChartBucket[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];

function statusChartLabel(bucket: StatusChartBucket): string {
  switch (bucket) {
    case "NEW":
      return "Unassigned";
    case "ASSIGNED":
      return "Assigned";
    case "IN_PROGRESS":
      return "In progress";
    case "RESOLVED":
      return "Completed";
    case "CLOSED":
      return "Closed";
    case "OTHER":
      return "Other";
    default:
      return bucket;
  }
}

export function countByStatus(rows: EnrichedIncidentRow[]): { labels: string[]; values: number[] } {
  const counts = new Map<StatusChartBucket, number>();
  STATUS_CHART_ORDER.forEach((b) => counts.set(b, 0));
  let other = 0;
  rows.forEach((r) => {
    const b = incidentStatusBucket(String(r.incident.status || "NEW"));
    if (b === "OTHER") {
      other += 1;
    } else {
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  });
  const labels = STATUS_CHART_ORDER.map(statusChartLabel);
  const values = STATUS_CHART_ORDER.map((b) => counts.get(b) ?? 0);
  if (other > 0) {
    return { labels: [...labels, statusChartLabel("OTHER")], values: [...values, other] };
  }
  return { labels, values };
}

/** Human-readable status for tables, exports, and sorting. */
export function statusDisplayLabel(status: string): string {
  const s = String(status || "").toUpperCase();
  if (s === "NEW") return "Unassigned";
  if (s === "ASSIGNED") return "Assigned";
  if (s === "IN_PROGRESS" || s === "EN_ROUTE" || s === "ON_SCENE") return "In progress";
  if (s === "RESOLVED") return "Completed";
  if (s === "CLOSED") return "Closed";
  return String(status || "—");
}
