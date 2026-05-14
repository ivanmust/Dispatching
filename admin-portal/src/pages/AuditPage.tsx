import { useEffect, useState } from "react";
import { request } from "../api";

type AuditRow = {
  id: string;
  action: string;
  userName?: string | null;
  createdAt: string;
};

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

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");

  const load = () =>
    request<AuditRow[]>(`/admin/audit?limit=200&action=${encodeURIComponent(action)}`)
      .then(setRows)
      .catch((e) => setError(String(e?.message || e)));

  useEffect(() => {
    load();
  }, [action]);

  const exportAuditCsv = () => {
    downloadCsv(
      `audit-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Action", "User", "Time"],
      rows.map((r) => [r.action, r.userName || "System", new Date(r.createdAt).toISOString()])
    );
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Audit & Reports</h1>
          <p className="pageSubtitle">Review critical system actions and compliance trail.</p>
        </div>
        <div className="toolbar">
          <input placeholder="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} />
          <button onClick={exportAuditCsv}>Export CSV</button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Action</th><th>User</th><th>Time</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.action}</td>
                <td>{r.userName || "System"}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

