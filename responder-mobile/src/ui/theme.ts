const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  sheetTop: 22,
  pill: 999,
} as const;

const space = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
} as const;

const text = {
  h1: { fontSize: 28, fontWeight: "900" as const, letterSpacing: 0.2 },
  h2: { fontSize: 18, fontWeight: "900" as const },
  body: { fontSize: 14, fontWeight: "600" as const },
  sub: { fontSize: 12, fontWeight: "700" as const },
  tiny: { fontSize: 11, fontWeight: "700" as const },
} as const;

const lightColor = {
  bg: "#ffffff",
  surface: "#ffffff",
  card: "#ffffff",
  cardSolid: "#f4f6fb",
  screenMuted: "#eef1f8",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  text: "#0f172a",
  textMuted: "#64748b",
  textSubtle: "#94a3b8",
  primary: "#1d4f9e",
  primary2: "#1d4f9e",
  primarySoft: "rgba(29,79,158,0.1)",
  primarySoftStrong: "rgba(29,79,158,0.38)",
  danger: "#ef4444",
  dangerSoft: "rgba(239,68,68,0.18)",
  dangerTextSoft: "rgba(252,165,165,0.95)",
  success: "#22c55e",
  successSoft: "rgba(34,197,94,0.16)",
  warn: "#f59e0b",
  warnSoft: "rgba(245,158,11,0.2)",
  backdrop: "rgba(15,23,42,0.45)",
  backdropStrong: "rgba(0,0,0,0.88)",
  white: "#ffffff",
  black: "#000000",
  lightBg: "#ffffff",
  lightSurface: "#ffffff",
  lightBorder: "rgba(15,23,42,0.1)",
  lightBorderStrong: "rgba(15,23,42,0.14)",
  lightText: "#0f172a",
  lightTextMuted: "#475569",
  lightTextSubtle: "#64748b",
  lightPlaceholder: "#94a3b8",
  lightPrimary: "#2563eb",
  lightPrimarySoft: "rgba(37,99,235,0.12)",
  tabBarBg: "#ffffff",
  fabBg: "rgba(255,255,255,0.97)",
  fabBorder: "rgba(15,23,42,0.12)",
  sheetShelfBg: "rgba(252,253,255,0.96)",
  sheetShelfBorder: "rgba(15,23,42,0.09)",
  overlayHintBg: "rgba(255,255,255,0.88)",
  listPanelBg: "rgba(255,255,255,0.92)",
  actionPillBg: "rgba(255,255,255,0.95)",
  actionPillBorder: "rgba(15,23,42,0.15)",
  summaryCardBg: "rgba(255,255,255,0.98)",
  incidentCardBg: "rgba(255,255,255,0.98)",
  minimalRowBorder: "rgba(15,23,42,0.1)",
  listPanelBorder: "rgba(15,23,42,0.1)",
  badgeBorder: "#ffffff",
} as const;

const darkColor = {
  bg: "#0f172a",
  surface: "#1e293b",
  card: "#1e293b",
  cardSolid: "#334155",
  screenMuted: "#0f172a",
  border: "#334155",
  borderStrong: "#475569",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textSubtle: "#64748b",
  primary: "#3b82f6",
  primary2: "#60a5fa",
  primarySoft: "rgba(96,165,250,0.18)",
  primarySoftStrong: "rgba(96,165,250,0.45)",
  danger: "#f87171",
  dangerSoft: "rgba(248,113,113,0.22)",
  dangerTextSoft: "rgba(254,202,202,0.92)",
  success: "#4ade80",
  successSoft: "rgba(74,222,128,0.2)",
  warn: "#fbbf24",
  warnSoft: "rgba(251,191,36,0.22)",
  backdrop: "rgba(0,0,0,0.65)",
  backdropStrong: "rgba(0,0,0,0.92)",
  white: "#ffffff",
  black: "#000000",
  lightBg: "#0f172a",
  lightSurface: "#1e293b",
  lightBorder: "rgba(248,250,252,0.12)",
  lightBorderStrong: "rgba(248,250,252,0.2)",
  lightText: "#f1f5f9",
  lightTextMuted: "#cbd5e1",
  lightTextSubtle: "#94a3b8",
  lightPlaceholder: "#64748b",
  lightPrimary: "#60a5fa",
  lightPrimarySoft: "rgba(96,165,250,0.18)",
  tabBarBg: "#1e293b",
  fabBg: "rgba(30,41,59,0.96)",
  fabBorder: "rgba(248,250,252,0.14)",
  sheetShelfBg: "rgba(30,41,59,0.97)",
  sheetShelfBorder: "rgba(248,250,252,0.1)",
  overlayHintBg: "rgba(30,41,59,0.92)",
  listPanelBg: "rgba(30,41,59,0.95)",
  actionPillBg: "rgba(51,65,85,0.95)",
  actionPillBorder: "rgba(248,250,252,0.14)",
  summaryCardBg: "rgba(30,41,59,0.98)",
  incidentCardBg: "rgba(30,41,59,0.98)",
  minimalRowBorder: "rgba(248,250,252,0.1)",
  listPanelBorder: "rgba(248,250,252,0.12)",
  badgeBorder: "#1e293b",
} as const;

export type ThemeColor = typeof lightColor;
export type ThemeTokens = {
  color: ThemeColor;
  radius: typeof radius;
  space: typeof space;
  text: typeof text;
  shadow: {
    card: {
      shadowColor: string;
      shadowOpacity: number;
      shadowRadius: number;
      shadowOffset: { width: number; height: number };
      elevation: number;
    };
    fab: {
      shadowColor: string;
      shadowOpacity: number;
      shadowRadius: number;
      shadowOffset: { width: number; height: number };
      elevation: number;
    };
    button: {
      shadowColor: string;
      shadowOpacity: number;
      shadowRadius: number;
      shadowOffset: { width: number; height: number };
      elevation: number;
    };
  };
};

const lightShadow = {
  card: {
    shadowColor: "#0f172a",
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  fab: {
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  button: {
    shadowColor: "#1d4f9e",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;

const darkShadow = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  fab: {
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  button: {
    shadowColor: "#60a5fa",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
} as const;

export const lightTheme: ThemeTokens = {
  color: lightColor as unknown as ThemeColor,
  radius,
  space,
  text,
  shadow: lightShadow,
};

export const darkTheme: ThemeTokens = {
  color: darkColor as unknown as ThemeColor,
  radius,
  space,
  text,
  shadow: darkShadow,
};

/** Kept for gradual migration; prefers `useAppTheme().theme` for dynamic appearance. */
export const theme: ThemeTokens = lightTheme;
