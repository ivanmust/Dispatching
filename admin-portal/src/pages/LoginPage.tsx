import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: "70px auto" }} className="card">
      <h1>Admin Login</h1>
      <p style={{ marginTop: -6, color: "#64748b", fontSize: 13 }}>Sign in to manage web and mobile operations.</p>
      <p style={{ marginTop: 2, color: "#64748b", fontSize: 12 }}>
        Default local credentials: <strong>admin</strong> / <strong>Admin@12345</strong>
      </p>
      <form onSubmit={onSubmit}>
        <div style={{ marginBottom: 10 }}>
          <label htmlFor="admin-login-username">Username</label>
          <input
            id="admin-login-username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label htmlFor="admin-login-password">Password</label>
          <input
            id="admin-login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}

