import { useEffect, useState } from "react";
import { request } from "../api";

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
  isActive: boolean;
  unit?: string | null;
};

type UsersResponse = { items: UserRow[]; total: number } | UserRow[];

const UNITS = ["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"] as const;

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

export function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [error, setError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | "dispatcher" | "responder">("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inlineRole, setInlineRole] = useState<Record<string, "dispatcher" | "responder">>({});
  const [inlineUnit, setInlineUnit] = useState<Record<string, "" | (typeof UNITS)[number]>>({});
  const [bulkRole, setBulkRole] = useState<"dispatcher" | "responder">("dispatcher");
  const [bulkUnit, setBulkUnit] = useState<"" | (typeof UNITS)[number]>("");
  const [newUser, setNewUser] = useState({
    name: "",
    username: "",
    role: "dispatcher" as "dispatcher" | "responder",
    unit: "" as "" | "EMS" | "TRAFFIC_POLICE" | "CRIME_POLICE",
    phone: "",
    password: "",
  });
  const limit = 20;

  const buildUsersQuery = (customLimit = limit, customOffset = (page - 1) * limit) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    params.set("limit", String(customLimit));
    params.set("offset", String(customOffset));
    return params.toString();
  };

  const normalizeUsersResponse = (data: UsersResponse) => {
    if (Array.isArray(data)) return { items: data, total: data.length };
    return { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total ?? 0) };
  };

  const load = () =>
    request<UsersResponse>(`/admin/users?${buildUsersQuery()}`)
      .then((data) => {
        const normalized = normalizeUsersResponse(data);
        setRows(normalized.items);
        setTotal(normalized.total);
        setSelectedIds([]);
        setError("");
      })
      .catch((e) => setError(String(e?.message || e)));

  useEffect(() => {
    load();
  }, [q, role, status, page]);

  const toggleStatus = async (user: UserRow) => {
    if (!window.confirm(`${user.isActive ? "Deactivate" : "Activate"} user ${user.username}?`)) return;
    try {
      setBusyUserId(user.id);
      await request(`/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyUserId(null);
    }
  };

  const resetPassword = async (user: UserRow) => {
    const next = window.prompt(`Enter new password for ${user.username}`);
    if (!next) return;
    try {
      setBusyUserId(user.id);
      await request(`/admin/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: next }),
      });
      alert("Password reset completed.");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyUserId(null);
    }
  };

  const updateRole = async (user: UserRow, nextRole: "dispatcher" | "responder") => {
    const unit =
      nextRole === "responder"
        ? (window.prompt("Responder unit (EMS, TRAFFIC_POLICE, CRIME_POLICE):", user.unit ?? "EMS") ?? "").toUpperCase()
        : null;
    if (nextRole === "responder" && !["EMS", "TRAFFIC_POLICE", "CRIME_POLICE"].includes(unit ?? "")) {
      setError("Responder role requires valid unit: EMS, TRAFFIC_POLICE, or CRIME_POLICE.");
      return;
    }
    if (!window.confirm(`Change role for ${user.username} to ${nextRole}?`)) return;
    try {
      setBusyUserId(user.id);
      await request(`/admin/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole, unit }),
      });
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyUserId(null);
    }
  };

  const updateRoleInline = async (user: UserRow) => {
    const nextRole = inlineRole[user.id] ?? (user.role as "dispatcher" | "responder");
    const nextUnit = nextRole === "responder" ? inlineUnit[user.id] || (user.unit as any) || "" : null;
    if (nextRole === "responder" && !UNITS.includes(nextUnit as any)) {
      setError("Responder role requires valid unit.");
      return;
    }
    if (!window.confirm(`Save role changes for ${user.username}?`)) return;
    try {
      setBusyUserId(user.id);
      await request(`/admin/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole, unit: nextUnit }),
      });
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyUserId(null);
    }
  };

  const bulkSetStatus = async (isActive: boolean) => {
    if (!selectedIds.length) return;
    if (!window.confirm(`${isActive ? "Activate" : "Deactivate"} ${selectedIds.length} selected users?`)) return;
    try {
      await request(`/admin/users/status/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ userIds: selectedIds, isActive }),
      });
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const bulkSetRole = async () => {
    if (!selectedIds.length) return;
    if (bulkRole === "responder" && !bulkUnit) {
      setError("Select a unit when assigning responder role.");
      return;
    }
    if (!window.confirm(`Set role "${bulkRole}" for ${selectedIds.length} selected users?`)) return;
    try {
      await request(`/admin/users/role/bulk`, {
        method: "PATCH",
        body: JSON.stringify({
          userIds: selectedIds,
          role: bulkRole,
          unit: bulkRole === "responder" ? bulkUnit : null,
        }),
      });
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const bulkResetPasswords = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Reset password for ${selectedIds.length} selected users and export temporary passwords?`)) return;
    try {
      const res = await request<{
        updatedCount: number;
        credentials: Array<{ id: string; username: string; temporaryPassword: string }>;
        authSessionVersion: number;
      }>(`/admin/users/reset-password/bulk`, {
        method: "POST",
        body: JSON.stringify({ userIds: selectedIds }),
      });
      downloadCsv(
        `temporary-passwords-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Username", "Temporary Password"],
        res.credentials.map((c) => [c.username, c.temporaryPassword])
      );
      alert(
        `Passwords reset for ${res.updatedCount} users. CSV downloaded. Active sessions were invalidated (v${res.authSessionVersion}).`
      );
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const exportUsersCsv = async () => {
    try {
      const all = normalizeUsersResponse(await request<UsersResponse>(`/admin/users?${buildUsersQuery(500, 0)}`));
      downloadCsv(
        `users-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Name", "Username", "Role", "Unit", "Status"],
        all.items.map((u) => [u.name, u.username, u.role, u.unit ?? "", u.isActive ? "Active" : "Inactive"])
      );
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const createUser = async () => {
    try {
      const trimmedName = newUser.name.trim();
      const trimmedUsername = newUser.username.trim();
      const trimmedPhone = newUser.phone.trim();
      const trimmedPassword = newUser.password.trim();
      if (!trimmedName) {
        setError("Name is required.");
        return;
      }
      if (trimmedUsername.length < 3) {
        setError("Username must be at least 3 characters.");
        return;
      }
      if (newUser.role === "responder" && !newUser.unit) {
        setError("Responders must select a department.");
        return;
      }
      if (trimmedPassword && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(trimmedPassword)) {
        setError("Password must be at least 8 characters and contain letters and numbers.");
        return;
      }
      const payload: Record<string, unknown> = {
        name: trimmedName,
        username: trimmedUsername,
        role: newUser.role,
        phone: trimmedPhone || undefined,
        password: trimmedPassword || undefined,
      };
      if (newUser.role === "responder") payload.unit = newUser.unit || undefined;
      const res = await request<{ temporaryPassword?: string; username: string }>("/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setShowCreate(false);
      setNewUser({ name: "", username: "", role: "dispatcher", unit: "", phone: "", password: "" });
      if (res.temporaryPassword) {
        alert(`User created. Temporary password for ${res.username}: ${res.temporaryPassword}`);
      } else {
        alert("User created successfully.");
      }
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Users & Roles</h1>
          <p className="pageSubtitle">Control account lifecycle, roles, and permission posture.</p>
        </div>
        <div className="headerControls">
          <div className="controlRow">
            <input
              className="controlGrow"
              placeholder="Search name / username / phone"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
            />
            <select
              value={role}
              onChange={(e) => {
                setPage(1);
                setRole(e.target.value as any);
              }}
            >
              <option value="">All roles</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="responder">Responder</option>
            </select>
            <select
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value as any);
              }}
            >
              <option value="">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="controlRow">
            <button disabled={!selectedIds.length} onClick={() => void bulkSetStatus(true)}>
              Activate Selected
            </button>
            <button disabled={!selectedIds.length} onClick={() => void bulkSetStatus(false)}>
              Deactivate Selected
            </button>
            <span className="controlDivider" />
            <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value as "dispatcher" | "responder")}>
              <option value="dispatcher">Bulk role: dispatcher</option>
              <option value="responder">Bulk role: responder</option>
            </select>
            {bulkRole === "responder" ? (
              <select value={bulkUnit} onChange={(e) => setBulkUnit(e.target.value as any)}>
                <option value="">Bulk unit</option>
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            ) : null}
            <button disabled={!selectedIds.length} onClick={() => void bulkSetRole()}>
              Apply Bulk Role
            </button>
            <button disabled={!selectedIds.length} onClick={() => void bulkResetPasswords()}>
              Bulk Reset Passwords
            </button>
            <span className="controlDivider" />
            <button onClick={() => void exportUsersCsv()}>Export CSV</button>
            <button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "Create user"}</button>
          </div>
        </div>
      </div>
      {showCreate ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Create User</h3>
          <div className="toolbar">
            <input placeholder="Name" value={newUser.name} onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))} />
            <input placeholder="Username" value={newUser.username} onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))} />
            <select value={newUser.role} onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value as any }))}>
              <option value="dispatcher">Dispatcher</option>
              <option value="responder">Responder</option>
            </select>
            {newUser.role === "responder" ? (
              <select value={newUser.unit} onChange={(e) => setNewUser((p) => ({ ...p, unit: e.target.value as any }))}>
                <option value="">Select unit</option>
                <option value="EMS">EMS</option>
                <option value="TRAFFIC_POLICE">TRAFFIC_POLICE</option>
                <option value="CRIME_POLICE">CRIME_POLICE</option>
              </select>
            ) : null}
            <input placeholder="Phone" value={newUser.phone} onChange={(e) => setNewUser((p) => ({ ...p, phone: e.target.value }))} />
            <input placeholder="Password (optional)" value={newUser.password} onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))} />
            <button onClick={() => void createUser()}>Save User</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <table className="table">
          <thead>
            <tr><th><input
              type="checkbox"
              checked={rows.length > 0 && selectedIds.length === rows.length}
              onChange={(e) => setSelectedIds(e.target.checked ? rows.map((r) => r.id) : [])}
            /></th><th>Name</th><th>Username</th><th>Role / Unit</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><input
                  type="checkbox"
                  checked={selectedIds.includes(u.id)}
                  onChange={(e) =>
                    setSelectedIds((prev) =>
                      e.target.checked ? Array.from(new Set([...prev, u.id])) : prev.filter((x) => x !== u.id)
                    )
                  }
                /></td>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>
                  <div className="toolbar">
                    <select
                      value={inlineRole[u.id] ?? (u.role as "dispatcher" | "responder")}
                      onChange={(e) => setInlineRole((p) => ({ ...p, [u.id]: e.target.value as any }))}
                    >
                      <option value="dispatcher">dispatcher</option>
                      <option value="responder">responder</option>
                    </select>
                    {(inlineRole[u.id] ?? u.role) === "responder" ? (
                      <select
                        value={inlineUnit[u.id] ?? (u.unit as any) ?? ""}
                        onChange={(e) => setInlineUnit((p) => ({ ...p, [u.id]: e.target.value as any }))}
                      >
                        <option value="">Select unit</option>
                        {UNITS.map((unit) => (
                          <option key={unit} value={unit}>{unit}</option>
                        ))}
                      </select>
                    ) : null}
                    <button disabled={busyUserId === u.id} onClick={() => void updateRoleInline(u)}>Save</button>
                  </div>
                </td>
                <td><span className={`badge ${u.isActive ? "ok" : "warn"}`}>{u.isActive ? "Active" : "Inactive"}</span></td>
                <td>
                  <div className="toolbar">
                    <button disabled={busyUserId === u.id} onClick={() => void toggleStatus(u)}>
                      {u.isActive ? "Deactivate" : "Activate"}
                    </button>
                    {u.role !== "dispatcher" ? (
                      <button
                        disabled={busyUserId === u.id}
                        onClick={() => void updateRole(u, u.role === "dispatcher" ? "responder" : "dispatcher")}
                      >
                        Quick Toggle Role
                      </button>
                    ) : null}
                    <button disabled={busyUserId === u.id} onClick={() => void resetPassword(u)}>
                      Reset Password
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <span className="muted">Total users: {total}</span>
          <div className="toolbar">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="muted">Page {page}</span>
            <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

