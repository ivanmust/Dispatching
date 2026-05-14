import { useEffect } from "react";
import { useTheme } from "../theme";

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  width = 720,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  width?: number;
}) {
  const { theme } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const overlayBg = theme === "light" ? "rgba(15, 23, 42, 0.35)" : "rgba(2, 6, 23, 0.72)";
  const closeBg = theme === "light" ? "#e5e7eb" : "#334155";
  const closeText = theme === "light" ? "#0f172a" : "#e5e7eb";
  const dividerBg = theme === "light" ? "#e5e7eb" : "#111827";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: overlayBg,
        display: "grid",
        placeItems: "center",
        padding: 14,
        zIndex: 60,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "min(96vw, " + width + "px)",
          boxShadow: "0 24px 80px rgba(0,0,0,.45)",
        }}
      >
        <div className="cardHeaderRow" style={{ marginBottom: 8 }}>
          <div>
            <h3 className="cardTitle" style={{ fontSize: 15 }}>
              {title}
            </h3>
            <div className="cardSub">Press Esc to close.</div>
          </div>
          <button
            className="dangerBtn"
            style={{
              background: closeBg,
              color: closeText,
            }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="cardDivider" style={{ background: dividerBg }} />
        <div>{children}</div>
        {footer ? (
          <>
            <div className="cardDivider" style={{ background: dividerBg }} />
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              {footer}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

