import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../api";
import { useAuth } from "../auth";
import { DashboardKpiGrid } from "../components/dashboard/DashboardKpiGrid";
import { DashboardHighlights } from "../components/dashboard/DashboardHighlights";
import { DashboardInsightCharts } from "../components/dashboard/DashboardInsightCharts";
import { DashboardIncidentsTable } from "../components/dashboard/DashboardIncidentsTable";
import {
  buildSmartInsights,
  computeExecutiveKpis,
  filterByGlobal,
  filterByGlobalPrevious,
  type DateRangePreset,
} from "../lib/dashboardAggregates";
import { CHART_CATEGORY_ORDER, enrichAll, type DashboardIncident, categoryKeyDisplayLabel } from "../lib/dashboardMetrics";
import { formatDashboardDateTime, formatDurationMinutes } from "../lib/dashboardTimeFormat";

type IncidentsResponse = { items: DashboardIncident[]; total: number } | DashboardIncident[];

function normalizeIncidents(data: IncidentsResponse): DashboardIncident[] {
  return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
}

function formatOpenDate(iso: string | undefined): string {
  return formatDashboardDateTime(iso);
}

/** Delay between lifecycle milestones (minutes → hr / min / sec). */
function fmtDeltaMinutes(m: number | null): string {
  return formatDurationMinutes(m);
}

async function fetchAllAdminIncidents(): Promise<DashboardIncident[]> {
  const pageSize = 500;
  let offset = 0;
  const all: DashboardIncident[] = [];
  let total = Number.POSITIVE_INFINITY;

  while (offset < total && all.length < 200_000) {
    const res = await request<IncidentsResponse>(`/admin/incidents?limit=${pageSize}&offset=${offset}`);
    const items = normalizeIncidents(res);
    if (!Array.isArray(res) && typeof res.total === "number") {
      total = res.total;
    } else if (items.length < pageSize) {
      total = offset + items.length;
    }
    all.push(...items);
    if (items.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export function DashboardPage() {
  const { token } = useAuth();
  const [rawIncidents, setRawIncidents] = useState<DashboardIncident[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRangePreset>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [detailSearch, setDetailSearch] = useState("");

  const reload = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const inc = await fetchAllAdminIncidents();
      setRawIncidents(inc);
    } catch (e) {
      setLoadError(String((e as Error)?.message || e));
      setRawIncidents([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void reload();
    const t = setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, [reload, token]);

  const enrichedAll = useMemo(() => enrichAll(rawIncidents), [rawIncidents]);

  const filterOpts = useMemo(
    () => ({ range, category: categoryFilter, status: statusFilter }),
    [range, categoryFilter, statusFilter]
  );

  const baseRows = useMemo(() => filterByGlobal(enrichedAll, filterOpts), [enrichedAll, filterOpts]);
  const prevRows = useMemo(() => filterByGlobalPrevious(enrichedAll, filterOpts), [enrichedAll, filterOpts]);

  const kpis = useMemo(() => computeExecutiveKpis(baseRows), [baseRows]);
  const kpisPrev = useMemo(() => {
    if (range === "all" || prevRows.length === 0) return null;
    return computeExecutiveKpis(prevRows);
  }, [prevRows, range]);

  const insights = useMemo(() => buildSmartInsights(baseRows, prevRows, range), [baseRows, prevRows, range]);

  const detailRows = useMemo(() => {
    const q = detailSearch.trim().toLowerCase();
    if (!q) return baseRows;
    return baseRows.filter((r) => {
      const t = `${r.incident.title} ${r.incident.id} ${r.category} ${r.categoryKey}`.toLowerCase();
      return t.includes(q);
    });
  }, [baseRows, detailSearch]);

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    enrichedAll.forEach((r) => seen.add(r.categoryKey));
    const order = [...CHART_CATEGORY_ORDER];
    const orderSet = new Set(order);
    const head = order.filter((k) => seen.has(k));
    const extra = Array.from(seen)
      .filter((k) => !orderSet.has(k))
      .sort((a, b) => a.localeCompare(b));
    return [...head, ...extra];
  }, [enrichedAll]);

  return (
    <div className="page execDashboard">
      <div className="execGlobalFilters">
        <div className="execFilterGroup">
          <label htmlFor="dash-range">Date range</label>
          <select id="dash-range" value={range} onChange={(e) => setRange(e.target.value as DateRangePreset)}>
            <option value="all">All time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
        <div className="execFilterGroup">
          <label htmlFor="dash-category">Category</label>
          <select id="dash-category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="ALL">All categories</option>
            {categoryOptions.map((k) => (
              <option key={k} value={k}>
                {categoryKeyDisplayLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="execFilterGroup">
          <label htmlFor="dash-status">Status</label>
          <select id="dash-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="NEW">Unassigned</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Completed</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>

      {loadError ? <div className="errorBanner">{loadError}</div> : null}

      <section className="execKpiSection" aria-label="Key performance indicators">
        <h2 className="execSectionTitle execSrOnly">KPI summary</h2>
        <DashboardKpiGrid current={kpis} previous={kpisPrev} loading={loading} />
      </section>

      {!loading && baseRows.length > 0 ? (
        <>
          <DashboardInsightCharts rows={baseRows} />
          <DashboardHighlights items={insights} />
        </>
      ) : !loading && baseRows.length === 0 ? (
        rawIncidents.length === 0 && !loadError ? (
          <div className="execEmptyState execEmptyStateRealData muted">
            <p>
              <strong>No incidents in the database yet.</strong> Charts and KPIs here are built only from live{" "}
              <code className="execInlineCode">/admin/incidents</code> data—nothing is fabricated in the UI.
            </p>
            <ol className="execEmptySteps">
              <li>
                In <Link to="/settings">Settings</Link>, enable dispatcher/responder incident creation if your workflow uses those apps to open cases.
              </li>
              <li>
                In <Link to="/users">Users</Link>, add or activate dispatchers and responders (or use self-registration if it is enabled).
              </li>
              <li>
                On the dispatcher console, create real incidents, assign responders, and complete the lifecycle—rows will show here on refresh.
              </li>
            </ol>
          </div>
        ) : (
          <p className="execEmptyState muted">
            No incidents match the current filters. Try <strong>All time</strong> for date range, set category and status to{" "}
            <strong>All</strong>, or clear the table search.
          </p>
        )
      ) : null}

      <DashboardIncidentsTable
        rows={detailRows}
        formatOpenDate={formatOpenDate}
        fmtDeltaMinutes={fmtDeltaMinutes}
        search={detailSearch}
        onSearchChange={setDetailSearch}
      />
    </div>
  );
}
