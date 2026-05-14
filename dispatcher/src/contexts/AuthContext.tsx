import React, { createContext, useContext, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'dispatcher';
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string, role?: 'dispatcher') => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = sessionStorage.getItem('cad_user');
    const token = sessionStorage.getItem('cad_token');
    if (!stored || !token) return null;
    return JSON.parse(stored);
  });

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { token, user: backendUser } = await api.loginDispatcher({ email, password });
      if (backendUser.role === 'responder') return false; // Responders use the responder app
      const authUser: User = {
        id: backendUser.id,
        name: backendUser.name,
        email,
        role: (backendUser.role as 'dispatcher') ?? 'dispatcher',
      };
      sessionStorage.setItem('cad_user', JSON.stringify(authUser));
      sessionStorage.setItem('cad_token', token);
      setUser(authUser);
      return true;
    } catch {
      return false;
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, role?: 'dispatcher') => {
    try {
      const { token, user: backendUser } = await api.registerDispatcher({ name, email, password, role });
      const authUser: User = {
        id: backendUser.id,
        name: backendUser.name,
        email,
        role: (backendUser.role as 'dispatcher') ?? 'dispatcher',
      };
      sessionStorage.setItem('cad_user', JSON.stringify(authUser));
      sessionStorage.setItem('cad_token', token);
      setUser(authUser);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('cad_user');
    sessionStorage.removeItem('cad_token');
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
