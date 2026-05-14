import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Toast = { id: string; title: string; message?: string; tone?: "info" | "success" | "warning" | "error" };

type ToastCtx = {
  notify: (t: Omit<Toast, "id"> & { ttlMs?: number }) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, number>>({});

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current[id];
    if (t) window.clearTimeout(t);
    delete timers.current[id];
  }, []);

  const notify = useCallback(
    ({ ttlMs = 3500, ...t }: Omit<Toast, "id"> & { ttlMs?: number }) => {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const toast: Toast = { id, ...t };
      setToasts((prev) => [toast, ...prev].slice(0, 4));
      timers.current[id] = window.setTimeout(() => remove(id), ttlMs);
    },
    [remove]
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          display: "grid",
          gap: 10,
          zIndex: 80,
        }}
      >
        {toasts.map((t) => {
          const border =
            t.tone === "success"
              ? "#14532d"
              : t.tone === "warning"
                ? "#92400e"
                : t.tone === "error"
                  ? "#7f1d1d"
                  : "#1e3a8a";
          const bg =
            t.tone === "success"
              ? "rgba(20, 83, 45, 0.25)"
              : t.tone === "warning"
                ? "rgba(146, 64, 14, 0.25)"
                : t.tone === "error"
                  ? "rgba(127, 29, 29, 0.25)"
                  : "rgba(30, 58, 138, 0.20)";

          return (
            <div
              key={t.id}
              style={{
                width: 340,
                borderRadius: 14,
                border: `1px solid ${border}`,
                background: bg,
                boxShadow: "0 14px 50px rgba(0,0,0,.35)",
                padding: "10px 12px",
                color: "#e5e7eb",
              }}
              onMouseDown={() => remove(t.id)}
              title="Click to dismiss"
            >
              <div style={{ fontWeight: 800, fontSize: 13 }}>{t.title}</div>
              {t.message ? <div className="muted" style={{ color: "#cbd5e1" }}>{t.message}</div> : null}
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToasts() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}

