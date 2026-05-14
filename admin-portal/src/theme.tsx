import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "dark" | "light";

type ThemeCtx = {
  theme: Theme;
  toggleTheme: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

function applyTheme(next: Theme) {
  const root = document.documentElement;
  root.classList.remove("theme-dark", "theme-light");
  root.classList.add(next === "dark" ? "theme-dark" : "theme-light");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = (localStorage.getItem("admin_theme") as Theme | null) || "dark";
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("admin_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const value = useMemo(() => ({ theme, toggleTheme }), [theme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ThemeProvider missing");
  return ctx;
}

