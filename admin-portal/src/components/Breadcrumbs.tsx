import { Link, useLocation } from "react-router-dom";

const LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/users": "Users",
  "/incidents": "Incidents",
  "/monitoring": "Monitor",
  "/permissions": "Permissions",
  "/settings": "Settings",
  "/audit": "Audit",
};

export function Breadcrumbs() {
  const location = useLocation();
  const path = location.pathname || "/";
  const segments = path.split("/").filter(Boolean);
  const crumbs = segments.length
    ? segments.map((_, idx) => "/" + segments.slice(0, idx + 1).join("/"))
    : ["/"];

  return (
    <div className="toolbar" aria-label="Breadcrumbs" style={{ gap: 6 }}>
      {crumbs.map((c, i) => (
        <div key={c} className="toolbar" style={{ gap: 6 }}>
          {i > 0 ? <span className="muted">/</span> : null}
          <Link to={c} style={{ color: "#cbd5e1", fontSize: 12, textDecoration: "none" }}>
            {LABELS[c] ?? c.replace("/", "")}
          </Link>
        </div>
      ))}
    </div>
  );
}

