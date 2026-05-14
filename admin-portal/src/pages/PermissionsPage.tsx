import { useEffect, useState } from "react";
import { request, type PermissionMatrix } from "../api";

export function PermissionsPage() {
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [error, setError] = useState("");
  const [busyRole, setBusyRole] = useState<"dispatcher" | "responder" | null>(null);

  useEffect(() => {
    request<PermissionMatrix>("/admin/permissions")
      .then((m) => {
        setMatrix(m);
        setError("");
      })
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  const toggle = async (role: "dispatcher" | "responder", perm: string, checked: boolean) => {
    if (!matrix) return;
    const current = matrix.matrix[role] ?? [];
    const next = checked ? Array.from(new Set([...current, perm])) : current.filter((p) => p !== perm);
    try {
      setBusyRole(role);
      await request(`/admin/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ role, permissions: next }),
      });
      setMatrix((prev) =>
        prev
          ? {
              ...prev,
              matrix: { ...prev.matrix, [role]: next },
            }
          : prev
      );
      setError("");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyRole(null);
    }
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Permissions</h1>
          <p className="pageSubtitle">Control what dispatcher and responder clients are allowed to do.</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <div className="cardHeaderRow">
          <div>
            <h3 className="cardTitle">Role permission matrix</h3>
            <p className="cardSub">Toggle per-feature access for each role.</p>
          </div>
        </div>
        <div style={{ maxHeight: 420, overflow: "auto", borderRadius: 12, border: "1px solid #1f2937" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Dispatcher</th>
                <th>Responder</th>
              </tr>
            </thead>
            <tbody>
              {(matrix?.availablePermissions ?? []).map((perm) => (
                <tr key={perm}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{perm}</td>
                  <td>
                    <input
                      type="checkbox"
                      disabled={busyRole === "dispatcher"}
                      checked={Boolean(matrix?.matrix.dispatcher.includes(perm))}
                      onChange={(e) => void toggle("dispatcher", perm, e.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      disabled={busyRole === "responder"}
                      checked={Boolean(matrix?.matrix.responder.includes(perm))}
                      onChange={(e) => void toggle("responder", perm, e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

