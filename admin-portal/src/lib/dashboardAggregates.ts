import { CHART_CATEGORY_ORDER, type EnrichedIncidentRow, categoryKeyDisplayLabel } from "./dashboardMetrics";
import { formatDurationHours } from "./dashboardTimeFormat";

export type DateRangePreset = "all" | "24h" | "7d" | "30d";

export function createdMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function rangeDurationMs(range: DateRangePreset): number | null {
  if (range === "all") return null;
  if (range === "24h") return 24 * 3600 * 1000;
  if (range === "7d") return 7 * 24 * 3600 * 1000;
  return 30 * 24 * 3600 * 1000;
}

/** Inclusive window [start, end) in ms for incidents created in the preset window ending at `now`. */
export function activeTimeWindow(range: DateRangePreset, now = Date.now()): { start: number; end: number } | null {
  const dur = rangeDurationMs(range);
  if (dur == null) return null;
  return { start: now - dur, end: now };
}

export function previousTimeWindow(range: DateRangePreset, now = Date.now()): { start: number; end: number } | null {
  const w = activeTimeWindow(range, now);
  if (!w) return null;
  const len = w.end - w.start;
  return { start: w.start - len, end: w.start };
}

export function statusMatchesFilter(status: string, filter: string): boolean {
  if (filter === "ALL") return true;
  return String(status).toUpperCase() === filter;
}

export function filterByGlobal(
  rows: EnrichedIncidentRow[],
  opts: { range: DateRangePreset; category: string; status: string; now?: number }
): EnrichedIncidentRow[] {
  const now = opts.now ?? Date.now();
  const win = activeTimeWindow(opts.range, now);
  return rows.filter((r) => {
    if (opts.category !== "ALL" && r.categoryKey !== opts.category) return false;
    if (!statusMatchesFilter(r.incident.status, opts.status)) return false;
    if (opts.range === "all") return true;
    if (!win) return false;
    const t = createdMs(r.openCaseDate);
    if (t == null) return false;
    return t >= win.start && t < win.end;
  });
}

export function filterByGlobalPrevious(
  rows: EnrichedIncidentRow[],
  opts: { range: DateRangePreset; category: string; status: string; now?: number }
): EnrichedIncidentRow[] {
  const now = opts.now ?? Date.now();
  const win = previousTimeWindow(opts.range, now);
  if (!win) return [];
  return rows.filter((r) => {
    if (opts.category !== "ALL" && r.categoryKey !== opts.category) return false;
    if (!statusMatchesFilter(r.incident.status, opts.status)) return false;
    const t = createdMs(r.openCaseDate);
    if (t == null) return false;
    return t >= win.start && t < win.end;
  });
}

export function isPoorSla(c: { cellClass: string }): boolean {
  return c.cellClass === "perfCellPoor";
}

export type ExecutiveKpis = {
  totalIncidents: number;
  openCases: number;
  completedCases: number;
  ongoingCases: number;
  reopenedCases: number;
  avgResponseHours: number | null;
  avgRepairHours: number | null;
  slaCompliancePct: number | null;
};

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, n) => a + n, 0) / nums.length) * 100) / 100;
}

export function computeExecutiveKpis(rows: EnrichedIncidentRow[]): ExecutiveKpis {
  const st = (s: string) => String(s || "").toUpperCase();
  let openCases = 0;
  let completedCases = 0;
  let ongoingCases = 0;
  let reopenedCases = 0;
  const resp: number[] = [];
  const rep: number[] = [];
  let slaPass = 0;
  let slaDenom = 0;

  for (const r of rows) {
    const s = st(r.incident.status);
    if (s !== "RESOLVED" && s !== "CLOSED") openCases += 1;
    if (s === "RESOLVED" || s === "CLOSED") completedCases += 1;
    if (s === "IN_PROGRESS" || s === "EN_ROUTE" || s === "ON_SCENE") ongoingCases += 1;
    if (r.reopeningMinutes != null && Number.isFinite(r.reopeningMinutes)) reopenedCases += 1;
    if (r.responseHours != null && Number.isFinite(r.responseHours)) resp.push(r.responseHours);
    if (r.repairHours != null && Number.isFinite(r.repairHours)) rep.push(r.repairHours);

    slaDenom += 1;
    const ok =
      !isPoorSla(r.responseCategory) &&
      !isPoorSla(r.repairCategory) &&
      !isPoorSla(r.completionCategory) &&
      !isPoorSla(r.reopeningCategory);
    if (ok) slaPass += 1;
  }

  const slaCompliancePct = slaDenom > 0 ? Math.round((slaPass / slaDenom) * 1000) / 10 : null;

  return {
    totalIncidents: rows.length,
    openCases,
    completedCases,
    ongoingCases,
    reopenedCases,
    avgResponseHours: mean(resp),
    avgRepairHours: mean(rep),
    slaCompliancePct,
  };
}

export type TrendKind = "up" | "down" | "flat";

export function trendDelta(prev: number | null, curr: number | null): { kind: TrendKind; pct: number | null } {
  if (prev == null || curr == null || !Number.isFinite(prev) || !Number.isFinite(curr)) {
    return { kind: "flat", pct: null };
  }
  if (prev === 0 && curr === 0) return { kind: "flat", pct: 0 };
  if (prev === 0) return { kind: curr > 0 ? "up" : "flat", pct: null };
  const pct = Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
  if (Math.abs(pct) < 0.05) return { kind: "flat", pct: 0 };
  return { kind: curr > prev ? "up" : "down", pct };
}

export type SmartInsight = { tone: "success" | "warning" | "danger"; icon: string; text: string };

export function buildSmartInsights(
  current: EnrichedIncidentRow[],
  previous: EnrichedIncidentRow[],
  range: DateRangePreset
): SmartInsight[] {
  const out: SmartInsight[] = [];
  if (!current.length) {
    out.push({ tone: "warning", icon: "ℹ️", text: "No incidents match the current filters. Widen the date range or clear filters." });
    return out;
  }

  const byCategoryRepair = CHART_CATEGORY_ORDER.map((k) => {
    const subset = current.filter((r) => r.categoryKey === k);
    const nums = subset.map((r) => r.repairHours).filter((v): v is number => v != null && Number.isFinite(v));
    const m = mean(nums);
    return { categoryKey: k, label: categoryKeyDisplayLabel(k), mean: m, n: subset.length };
  }).filter((x) => x.mean != null && x.n >= 1);

  const worstRepair = [...byCategoryRepair].sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0))[0];
  const bestResp = [...CHART_CATEGORY_ORDER.map((k) => {
    const subset = current.filter((r) => r.categoryKey === k);
    const nums = subset.map((r) => r.responseHours).filter((v): v is number => v != null && Number.isFinite(v));
    return { categoryKey: k, label: categoryKeyDisplayLabel(k), mean: mean(nums), n: subset.length };
  })].filter((x) => x.mean != null && x.n >= 2)
    .sort((a, b) => (a.mean ?? 0) - (b.mean ?? 0))[0];

  if (worstRepair?.mean != null && worstRepair.mean >= 1) {
    out.push({
      tone: "warning",
      icon: "⚠️",
      text: `${worstRepair.label} has the highest average repair time (${formatDurationHours(worstRepair.mean)}) in this view.`,
    });
  }
  if (bestResp?.mean != null) {
    out.push({
      tone: "success",
      icon: "✅",
      text: `${bestResp.label} shows the best average response time (${formatDurationHours(bestResp.mean)}) among categories with enough volume.`,
    });
  }

  const reopenCurr = current.filter((r) => r.reopeningMinutes != null && Number.isFinite(r.reopeningMinutes)).length;
  const reopenPrev = previous.filter((r) => r.reopeningMinutes != null && Number.isFinite(r.reopeningMinutes)).length;
  const rateCurr = current.length ? reopenCurr / current.length : 0;
  const ratePrev = previous.length ? reopenPrev / previous.length : 0;
  if (range !== "all" && previous.length >= 3) {
    const pp = (rateCurr - ratePrev) * 100;
    if (pp >= 5) {
      out.push({
        tone: "danger",
        icon: "🚨",
        text: `Reopening rate vs prior period increased by about ${Math.round(pp * 10) / 10} percentage points — review recent reopens.`,
      });
    } else if (pp <= -5) {
      out.push({
        tone: "success",
        icon: "📉",
        text: `Reopening rate improved vs the prior period (≈${Math.round(Math.abs(pp) * 10) / 10} pp lower).`,
      });
    }
  }

  const poorResp = current.filter((r) => isPoorSla(r.responseCategory)).length;
  if (poorResp > 0 && poorResp / current.length >= 0.15) {
    out.push({
      tone: "danger",
      icon: "⏱️",
      text: `${Math.round((poorResp / current.length) * 100)}% of incidents show poor response-time SLA — prioritize dispatch assignment.`,
    });
  }

  if (out.length < 2) {
    out.push({
      tone: "success",
      icon: "✨",
      text: "Tip: Use category + date filters to compare incident types and focus follow-up where SLA risk clusters.",
    });
  }

  return out.slice(0, 6);
}

/** Daily means for incidents opened on that calendar day (UTC). */
export function dailyRepairCompletionSeries(
  rows: EnrichedIncidentRow[],
  maxDays = 14
): { labels: string[]; repair: number[]; completion: number[] } {
  const dayMap = new Map<string, { rep: number[]; comp: number[] }>();
  for (const r of rows) {
    const iso = r.openCaseDate;
    if (!iso) continue;
    const day = iso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!dayMap.has(day)) dayMap.set(day, { rep: [], comp: [] });
    const b = dayMap.get(day)!;
    if (r.repairHours != null && Number.isFinite(r.repairHours)) b.rep.push(r.repairHours);
    if (r.completionHours != null && Number.isFinite(r.completionHours)) b.comp.push(r.completionHours);
  }
  const days = Array.from(dayMap.keys()).sort();
  const tail = days.slice(-maxDays);
  const labels = tail;
  const repair = tail.map((d) => mean(dayMap.get(d)!.rep) ?? 0);
  const completion = tail.map((d) => mean(dayMap.get(d)!.comp) ?? 0);
  return { labels, repair, completion };
}

export type CategoryBarRow = { categoryKey: string; label: string; hours: number; count: number };

/** Top N incident categories by mean repair time (higher = more problematic). */
export function topProblematicCategories(rows: EnrichedIncidentRow[], n = 5): CategoryBarRow[] {
  const scores = CHART_CATEGORY_ORDER.map((k) => {
    const subset = rows.filter((r) => r.categoryKey === k);
    const nums = subset.map((r) => r.repairHours).filter((v): v is number => v != null && Number.isFinite(v));
    const m = mean(nums) ?? 0;
    return { categoryKey: k, label: categoryKeyDisplayLabel(k), hours: m, count: subset.length };
  }).filter((x) => x.count > 0 && x.hours > 0);
  return scores.sort((a, b) => b.hours - a.hours).slice(0, n);
}

export function reopeningRateByCategory(rows: EnrichedIncidentRow[]): { labels: string[]; rates: number[] } {
  const keys = [...CHART_CATEGORY_ORDER];
  const labels = keys.map((k) => categoryKeyDisplayLabel(k));
  const rates = keys.map((key) => {
    const subset = rows.filter((r) => r.categoryKey === key);
    if (!subset.length) return 0;
    const reopened = subset.filter((r) => r.reopeningMinutes != null && Number.isFinite(r.reopeningMinutes)).length;
    return Math.round((reopened / subset.length) * 1000) / 10;
  });
  return { labels, rates };
}
