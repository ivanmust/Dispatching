import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MobileUser } from "../lib/storage";
import { clearCadAuth, getCadToken, getCadUser, setCadToken, setCadUser } from "../lib/storage";
import { api } from "../lib/api";

type AuthContextType = {
  user: MobileUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProviderMobile({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await getCadToken();
        const storedUser = await getCadUser();
        if (mounted) {
          setUser(token && storedUser ? storedUser : null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user: rawUser } = await api.login({ username, password });
    if (rawUser?.role !== "responder") return false;

    const mappedUser = { ...api.mapResponderUser(rawUser), username: username.trim() };
    await setCadUser(mappedUser);
    await setCadToken(token);
    setUser(mappedUser);
    return true;
  }, []);

  const logout = useCallback(async () => {
    await clearCadAuth();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: !!user,
      loading,
      login,
      logout,
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthMobile() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthMobile must be used within AuthProviderMobile");
  return ctx;
}

