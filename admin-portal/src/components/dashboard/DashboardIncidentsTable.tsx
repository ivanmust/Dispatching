import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { EnrichedIncidentRow } from "../../lib/dashboardMetrics";
import { statusDisplayLabel, statusProgressionText } from "../../lib/dashboardMetrics";

export type TableSortKey = "openCaseDate" | "category" | "status" | "title";

type Props = {
  rows: EnrichedIncidentRow[];
  formatOpenDate: (iso: string | undefined) => string;
  fmtDeltaMinutes: (m: number | null) => string;
  search: string;
  onSearchChange: (v: string) => void;
};

const PAGE_SIZE = 15;
const TITLE_MAX = 44;

function downloadCsv(filename: string, headers: string[], lines: string[]) {
  const bom = "\uFEFF";
  const csv = bom + [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function truncateTitle(title: string): string {
  const t = title.trim();
  if (t.length <= TITLE_MAX) return t;
  return `${t.slice(0, TITLE_MAX - 1)}…`;
}

function escape(v: unknown) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function formatStepLine(
  step: EnrichedIncidentRow["lifecycleSteps"][number],
  formatOpenDate: (iso: string | undefined) => string,
  fmtDeltaMinutes: (m: number | null) => string
): string {
  const at = step.atIso ? formatOpenDate(step.atIso) : "—";
  const lag =
    step.fromPreviousMinutes != null && Number.isFinite(step.fromPreviousMinutes)
      ? `  (+${fmtDeltaMinutes(step.fromPreviousMinutes)} from previous step)`
      : "";
  return `${step.statusLabel}: ${at}${lag}`;
}

export function DashboardIncidentsTable({
  rows,
  formatOpenDate,
  fmtDeltaMinutes,
  search,
  onSearchChange,
}: Props) {
  const [sortKey, setSortKey] = useState<TableSortKey>("openCaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [rows.length, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "category":
          cmp = a.categoryKey.localeCompare(b.categoryKey);
          break;
        case "status": {
          const la = statusDisplayLabel(a.incident.status);
          const lb = statusDisplayLabel(b.incident.status);
          cmp = la.localeCompare(lb);
          if (cmp === 0) cmp = String(a.incident.status).localeCompare(String(b.incident.status));
          break;
        }
        case "title":
          cmp = (a.incident.title || "").localeCompare(b.incident.title || "");
          break;
        case "openCaseDate":
        default:
          cmp = (new Date(a.openCaseDate).getTime() || 0) - (new Date(b.openCaseDate).getTime() || 0);
          break;
      }
      return cmp * dir;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const slice = sorted.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const toggleSort = (key: TableSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("desc");
      return key;
    });
  };

  const ind = (key: TableSortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const buildExportLines = () => {
    const headers = [
      "Incident title",
      "Incident id",
      "Created",
      "Category",
      "Current status",
      "Status progression",
      "Lifecycle detail",
    ];
    const lines = sorted.map((r) => {
      const detail = r.lifecycleSteps.map((s) => formatStepLine(s, formatOpenDate, fmtDeltaMinutes)).join(" | ");
      return [
        r.incident.title ?? "",
        r.incident.id,
        formatOpenDate(r.openCaseDate),
        r.category,
        statusDisplayLabel(r.incident.status),
        statusProgressionText(r.lifecycleSteps),
        detail,
      ]
        .map(escape)
        .join(",");
    });
    return { headers, lines };
  };

  const exportCsv = () => {
    const { headers, lines } = buildExportLines();
    downloadCsv(`incident-lifecycle-${new Date().toISOString().slice(0, 10)}.csv`, headers, lines);
  };

  const buildExportRecords = () =>
    sorted.map((r) => ({
      "Incident title": r.incident.title ?? "",
      "Incident id": r.incident.id,
      Created: formatOpenDate(r.openCaseDate),
      Category: r.category,
      "Current status": statusDisplayLabel(r.incident.status),
      "Status progression": statusProgressionText(r.lifecycleSteps),
      "Lifecycle detail": r.lifecycleSteps.map((s) => formatStepLine(s, formatOpenDate, fmtDeltaMinutes)).join("\n"),
    }));

  const exportXlsx = async () => {
    setXlsxBusy(true);
    try {
      const XLSX = await import("xlsx");
      const data = buildExportRecords();
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Incidents");
      XLSX.writeFile(wb, `incident-lifecycle-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setXlsxBusy(false);
    }
  };

  return (
    <section className="execTableSection" aria-label="Incident lifecycle table">
      <div className="execTableToolbar">
        <div>
          <h2 className="execSectionTitle">Incident lifecycle</h2>
          <p className="execSectionSub">
            {sorted.length} row{sorted.length === 1 ? "" : "s"} · page {pageSafe} / {totalPages}
          </p>
          <p className="execTableLifecycleLead muted small">
            Each row shows how the case moved through statuses, timestamps (locale date and time), and how long each step
            took in hr / min / sec. Category is the incident type from the database.
          </p>
        </div>
        <div className="execTableToolbarActions">
          <input
            type="search"
            className="perfTableSearch execTableSearch"
            placeholder="Search title or ID…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search table"
          />
          <button type="button" onClick={exportCsv}>
            Export CSV
          </button>
          <button
            type="button"
            className="perfBtnSecondary"
            onClick={() => void exportXlsx()}
            disabled={xlsxBusy || sorted.length === 0}
            title="Download Microsoft Excel workbook (.xlsx)"
          >
            {xlsxBusy ? "Preparing…" : "Export XLSX"}
          </button>
        </div>
      </div>
      <div className="perfTableScroll execTableScroll">
        <table className="perfTable execTable execTableLifecycle">
          <thead>
            <tr>
              <th>
                <button type="button" className="perfThBtn" onClick={() => toggleSort("title")}>
                  Incident{ind("title")}
                </button>
              </th>
              <th>
                <button type="button" className="perfThBtn" onClick={() => toggleSort("openCaseDate")}>
                  Created{ind("openCaseDate")}
                </button>
              </th>
              <th className="execCategoryCol">
                <button type="button" className="perfThBtn" onClick={() => toggleSort("category")}>
                  Category{ind("category")}
                </button>
              </th>
              <th>
                <button type="button" className="perfThBtn" onClick={() => toggleSort("status")}>
                  Current status{ind("status")}
                </button>
              </th>
              <th scope="col">Status progression</th>
              <th scope="col">Milestones (time + duration to next)</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.incident.id}>
                <td className="execRefCell" title={r.incident.title}>
                  <span className="execRefTitle">{truncateTitle(r.incident.title || "—")}</span>
                  <span className="muted execRefId">{r.incident.id.slice(0, 8)}…</span>
                </td>
                <td>{formatOpenDate(r.openCaseDate)}</td>
                <td className="execCategoryCell">{r.category}</td>
                <td>{statusDisplayLabel(r.incident.status)}</td>
                <td className="execProgressionCell">{statusProgressionText(r.lifecycleSteps)}</td>
                <td className="execLifecycleMilestones">
                  {r.lifecycleSteps.length === 0 ? (
                    <span className="muted">No timeline data</span>
                  ) : (
                    r.lifecycleSteps.map((s) => (
                      <div key={s.key} className="execLifecycleRow">
                        <span className="execLifecycleLabel">{s.statusLabel}</span>
                        <span className="execLifecycleAt">{s.atIso ? formatOpenDate(s.atIso) : "—"}</span>
                        {s.fromPreviousMinutes != null && Number.isFinite(s.fromPreviousMinutes) ? (
                          <span className="muted execLifecycleLag">
                            +{fmtDeltaMinutes(s.fromPreviousMinutes)} from previous
                          </span>
                        ) : null}
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="execTablePager">
        <button type="button" className="perfBtnSecondary" disabled={pageSafe <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous
        </button>
        <span className="muted">
          {sorted.length === 0
            ? "No rows"
            : `Showing ${(pageSafe - 1) * PAGE_SIZE + 1}–${Math.min(pageSafe * PAGE_SIZE, sorted.length)}`}
        </span>
        <button
          type="button"
          className="perfBtnSecondary"
          disabled={pageSafe >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
        </button>
      </div>
      <p className="muted small execTableHint">
        Open <Link to="/incidents">Incident governance</Link> for per-incident actions and full title search.
      </p>
    </section>
  );
}
