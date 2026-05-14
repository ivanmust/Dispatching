import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "../api";
import { Modal } from "../components/Modal";
import { useToasts } from "../toasts";

type Row = { id: string; title: string; status: string; priority: string; assignedResponderName?: string | null };
type IncidentsResponse = { items: Row[]; total: number } | Row[];

function downloadCsv(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function IncidentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const { notify } = useToasts();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const limit = 20;
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const s = searchParams.get("status");
    const p = searchParams.get("priority");
    const c = searchParams.get("category");
    const qv = searchParams.get("q");
    if (s != null) setStatus(s);
    if (p != null) setPriority(p);
    if (c != null) setCategory(c);
    if (qv != null) setQ(qv);
    setPage(1);
  }, [searchParams]);

  const buildIncidentsQuery = (customLimit = limit, customOffset = (page - 1) * limit) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (category) params.set("category", category);
    params.set("limit", String(customLimit));
    params.set("offset", String(customOffset));
    return params.toString();
  };

  const normalizeIncidentsResponse = (data: IncidentsResponse) => {
    if (Array.isArray(data)) return { items: data, total: data.length };
    return { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total ?? 0) };
  };

  const load = () =>
    request<IncidentsResponse>(`/admin/incidents?${buildIncidentsQuery()}`)
      .then((data) => {
        const normalized = normalizeIncidentsResponse(data);
        setRows(normalized.items);
        setTotal(normalized.total);
        setError("");
      })
      .catch((e) => setError(String(e.message || e)));
  useEffect(() => {
    void load();
  }, [q, status, priority, category, page]);

  const closeIncident = async (id: string) => {
    if (!window.confirm("Force close this incident?")) return;
    try {
      await request(`/admin/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status: "CLOSED" }) });
      notify({ title: "Incident closed", message: `Incident ${id} was force-closed.`, tone: "success" });
      load();
    } catch (e: any) {
      notify({ title: "Close failed", message: String(e?.message || e), tone: "error" });
      throw e;
    }
  };

  const exportIncidentsCsv = async () => {
    try {
      const data = normalizeIncidentsResponse(await request<IncidentsResponse>(`/admin/incidents?${buildIncidentsQuery(500, 0)}`));
      downloadCsv(
        `incidents-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Title", "Status", "Priority", "Assigned"],
        data.items.map((r) => [r.title, r.status, r.priority, r.assignedResponderName ?? ""])
      );
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Incident Governance</h1>
          <p className="pageSubtitle">Enforce response operations and close/override incidents.</p>
        </div>
        <div className="toolbar">
          <input placeholder="Search title" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All status</option>
            <option value="NEW">NEW</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
          <select value={priority} onChange={(e) => { setPage(1); setPriority(e.target.value); }}>
            <option value="">All priority</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <select value={category} onChange={(e) => { setPage(1); setCategory(e.target.value); }}>
            <option value="">All category</option>
            <option value="FIRE">FIRE</option>
            <option value="MEDICAL">MEDICAL</option>
            <option value="TRAFFIC">TRAFFIC</option>
            <option value="CRIME">CRIME</option>
            <option value="OTHER">OTHER</option>
          </select>
          <button onClick={() => void exportIncidentsCsv()}>Export CSV</button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 0.85fr", gap: 12, alignItems: "start" }}>
        <div className="card">
          <table className="table">
            <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Assigned</th><th>Action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onMouseDown={() => setSelected(r)}
                  style={{ background: selected?.id === r.id ? "rgba(29,78,216,0.14)" : undefined, cursor: "pointer" }}
                  title="Click to select"
                >
                  <td>{r.title}</td><td>{r.status}</td><td>{r.priority}</td><td>{r.assignedResponderName || "-"}</td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => { setSelected(r); setDetailsOpen(true); }}>Details</button>
                      <button onClick={() => void closeIncident(r.id)}>Force Close</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 10, justifyContent: "space-between" }}>
            <span className="muted">Total incidents: {total}</span>
            <div className="toolbar">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span className="muted">Page {page}</span>
              <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="cardHeaderRow">
            <div>
              <h3 className="cardTitle">Inspector</h3>
              <div className="cardSub">Select an incident to view its details.</div>
            </div>
            <span className={`badge ${selected?.status && !["RESOLVED", "CLOSED"].includes(selected.status) ? "warn" : "ok"}`}>
              {selected ? selected.status : "No selection"}
            </span>
          </div>
          <div className="cardDivider" style={{ background: "#111827" }} />
          {selected ? (
            <>
              <div className="listRow"><span>ID</span><span className="badge">{selected.id}</span></div>
              <div className="listRow"><span>Title</span><span className="badge">{selected.title}</span></div>
              <div className="listRow"><span>Priority</span><span className="badge">{selected.priority}</span></div>
              <div className="listRow"><span>Assigned</span><span className="badge">{selected.assignedResponderName || "-"}</span></div>
              <div style={{ marginTop: 10 }} className="toolbar">
                <button onClick={() => setDetailsOpen(true)}>Open details modal</button>
                <button className="dangerBtn" onClick={() => void closeIncident(selected.id)}>Force close</button>
              </div>
              <div className="chartHintRow">
                <span className="muted">Preview panel placeholder (3D viewer equivalent).</span>
                <span className="muted">Add GIS map view next if needed.</span>
              </div>
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 12,
                  border: "1px dashed #334155",
                  padding: 12,
                  background: "rgba(2,6,23,0.35)",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>Incident Preview</div>
                <div className="muted">
                  This is a placeholder for an incident preview (map snapshot, attachments, timeline, responder route).
                </div>
              </div>
            </>
          ) : (
            <div className="muted">No incident selected.</div>
          )}
        </div>
      </div>

      <Modal
        open={detailsOpen}
        title={selected ? `Incident ${selected.id}` : "Incident"}
        onClose={() => setDetailsOpen(false)}
        footer={
          selected ? (
            <>
              <button onClick={() => setDetailsOpen(false)} style={{ background: "#334155" }}>
                Done
              </button>
              <button className="dangerBtn" onClick={() => void closeIncident(selected.id)}>
                Force close
              </button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="sectionGrid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="card" style={{ background: "rgba(2,6,23,0.25)", borderColor: "#1f2937" }}>
              <h3 className="cardTitle">Summary</h3>
              <div className="listRow"><span>Title</span><span className="badge">{selected.title}</span></div>
              <div className="listRow"><span>Status</span><span className="badge">{selected.status}</span></div>
              <div className="listRow"><span>Priority</span><span className="badge">{selected.priority}</span></div>
              <div className="listRow"><span>Assigned</span><span className="badge">{selected.assignedResponderName || "-"}</span></div>
            </div>
            <div className="card" style={{ background: "rgba(2,6,23,0.25)", borderColor: "#1f2937" }}>
              <h3 className="cardTitle">Actions</h3>
              <div className="muted">Use this space to add admin overrides (reassign, escalate, notify, attach docs).</div>
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button
                  onClick={() =>
                    notify({
                      title: "Queued",
                      message: "Placeholder action. Add a backend endpoint to make this real.",
                      tone: "info",
                    })
                  }
                  style={{ background: "#0ea5e9" }}
                >
                  Notify responder (stub)
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
