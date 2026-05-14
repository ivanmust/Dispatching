import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { darkTheme, lightTheme, type ThemeTokens } from "../ui/theme";

const STORAGE_KEY = "responder_mobile_dark_mode";

type ThemePreferenceContextValue = {
  theme: ThemeTokens;
  isDark: boolean;
  setDarkMode: (next: boolean) => Promise<void>;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw === "1") setIsDark(true);
    });
  }, []);

  const setDarkMode = useCallback(async (next: boolean) => {
    setIsDark(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark]);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      theme,
      isDark,
      setDarkMode,
    }),
    [theme, isDark, setDarkMode],
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) throw new Error("useAppTheme must be used within ThemePreferenceProvider");
  return ctx;
}
