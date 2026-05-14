import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { request } from "./api";

type AuthUser = { id: string; username: string; name: string; role: string };

type AuthCtx = {
  user: AuthUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("cad_admin_token"));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const t = localStorage.getItem("cad_admin_token");
    if (!t) return null;
    const raw = localStorage.getItem("cad_admin_user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });

  // If token is missing/cleared, also clear user so the app routes to /login.
  useEffect(() => {
    if (!token && user) {
      localStorage.removeItem("cad_admin_user");
      setUser(null);
    }
  }, [token, user]);

  const login = async (username: string, password: string) => {
    const data = await request<{ token: string; user: AuthUser }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim(), password }),
    });
    localStorage.setItem("cad_admin_token", data.token);
    localStorage.setItem("cad_admin_user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem("cad_admin_token");
    localStorage.removeItem("cad_admin_user");
    setToken(null);
    setUser(null);
  };

  const value = useMemo(() => ({ user, token, login, logout }), [user, token]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Auth context missing");
  return ctx;
}
