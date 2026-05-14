import React from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FileText,
  Lock,
  Moon,
  Shield,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/UsersPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { AuditPage } from "./pages/AuditPage";
import { PermissionsPage } from "./pages/PermissionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { useTheme } from "./theme";

function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  if (!user) return <Navigate to="/login" replace />;
  const links = [
    { to: "/users", label: "Users", icon: Users },
    { to: "/incidents", label: "Incidents", icon: Shield },
    { to: "/monitoring", label: "Monitor", icon: Activity },
    { to: "/permissions", label: "Permissions", icon: Lock },
    { to: "/settings", label: "Settings", icon: SlidersHorizontal },
    { to: "/audit", label: "Audit", icon: FileText },
  ] as const;

  const isActive = (to: string) => (to === "/" ? location.pathname === "/" : location.pathname.startsWith(to));
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandIcon">A</div>
          <div>
            <div className="brandSub">Dispatch Center</div>
            <div className="brandTitle">Admin Control Portal</div>
          </div>
        </div>
        <div className="topRight">
          <Breadcrumbs />
          <button
            type="button"
            className="themeToggle"
            title="Toggle light/dark mode"
            aria-label="Toggle theme"
            onClick={toggleTheme}
          >
            <span className="themeToggleIcon" aria-hidden="true">
              {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
            </span>
            <span className="themeToggleTrack" aria-hidden="true">
              <span className={theme === "dark" ? "themeToggleThumb on" : "themeToggleThumb"} />
            </span>
          </button>
          <div className="pill">{user.name}</div>
          <button className="dangerBtn" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" style={{ width: collapsed ? 72 : 240 }}>
          {links.map(({ to, label, icon: Icon }) => (
            <Link className={isActive(to) ? "active navItem" : "navItem"} key={to} to={to}>
              <span className="navIcon"><Icon size={13} /></span>
              {collapsed ? null : <span>{label}</span>}
            </Link>
          ))}
          <button
            onClick={() => setCollapsed((v) => !v)}
            style={{
              marginTop: 10,
              background: "#111827",
              border: "1px solid #1f2937",
            }}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </aside>

        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/incidents" replace />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
