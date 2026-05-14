import { useEffect, useState } from "react";
import { request } from "../api";

type Health = { api: string; db: string };

export function MonitoringPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    request<Health>("/admin/health")
      .then((h) => {
        setHealth(h);
        setError("");
      })
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Ops Monitor</h1>
          <p className="pageSubtitle">Track API and database health.</p>
        </div>
      </div>

      <div className="sectionGrid">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>API</h3>
          <div className="listRow">
            <span>Gateway</span>
            <span className={`badge ${error ? "warn" : "ok"}`}>{error ? "Degraded" : health?.api ?? "Unknown"}</span>
          </div>
          <div className="listRow">
            <span>Auth</span>
            <span className={`badge ${error ? "warn" : "ok"}`}>{error ? "Check" : "Healthy"}</span>
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Infrastructure</h3>
          <div className="listRow">
            <span>PostgreSQL</span>
            <span className={`badge ${health?.db === "connected" ? "ok" : "warn"}`}>{health?.db ?? "Unknown"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
