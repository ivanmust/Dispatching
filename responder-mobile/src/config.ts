import Constants from "expo-constants";
import { getExpoGoProjectConfig } from "expo";
import { Platform } from "react-native";

const envApiBase = typeof process !== "undefined" && process.env?.EXPO_PUBLIC_API_BASE;
const strictApiBase =
  typeof process !== "undefined" &&
  /^1|true$/i.test(String(process.env?.EXPO_PUBLIC_STRICT_API_BASE ?? "").trim());
const configApiBase = (Constants.expoConfig?.extra as any)?.apiBase as string | undefined;

function getWebApiBase(): string {
  if (typeof document !== "undefined" && typeof window !== "undefined" && window.location?.hostname) {
    const host = window.location.hostname;
    const protocol = window.location.protocol || "http:";
    return `${protocol}//${host}:3003/api`;
  }
  return "http://localhost:3003/api";
}

const isWeb = typeof document !== "undefined";

/** Host the Metro / Expo dev tools use (Expo Go already reached this for JS). */
function getDevPackagerHostname(): string | null {
  const raw =
    Constants.expoConfig?.hostUri?.trim() ?? getExpoGoProjectConfig()?.debuggerHost?.trim();
  if (!raw) return null;
  const host = raw.split(":")[0]?.trim();
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  return host;
}

function isPrivateLanHost(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** LAN http:// on dev builds: `android.usesCleartextTraffic` (see app.json). Expo Go ships with HTTP allowed. */
function resolveApiBase(): string {
  const fromEnv = envApiBase?.trim();
  const packagerHost = getDevPackagerHostname();

  if (__DEV__ && !isWeb && packagerHost && isPrivateLanHost(packagerHost)) {
    const derived = `http://${packagerHost}:3003/api`;
    if (!fromEnv) {
      return derived;
    }
    if (!strictApiBase) {
      try {
        const envHost = new URL(fromEnv).hostname;
        if (envHost !== packagerHost && isPrivateLanHost(envHost)) {
          console.warn(
            `[responder-mobile] EXPO_PUBLIC_API_BASE (${envHost}) ≠ Metro (${packagerHost}). ` +
              `Using Metro host so Expo Go can reach your PC. Update responder-mobile/.env to ${derived} or set EXPO_PUBLIC_STRICT_API_BASE=1 if the API is on another host.`
          );
          return derived;
        }
      } catch {
        /* keep fromEnv */
      }
    }
  }

  if (fromEnv) return fromEnv;

  if (isWeb) {
    return configApiBase?.trim() || getWebApiBase();
  }

  const fromExtra = configApiBase?.trim();
  if (fromExtra && !/localhost|127\.0\.0\.1/i.test(fromExtra)) {
    return fromExtra;
  }

  if (Platform.OS === "android" && !isWeb) {
    return "http://10.0.2.2:3003/api";
  }

  return "http://localhost:3003/api";
}

export const API_BASE = resolveApiBase();
export const API_BASE_CANDIDATES = (() => {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value?: string | null) => {
    const v = String(value ?? "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    candidates.push(v);
  };

  add(API_BASE);

  const fromEnv = envApiBase?.trim();
  if (fromEnv) add(fromEnv);

  const packagerHost = getDevPackagerHostname();
  if (packagerHost && isPrivateLanHost(packagerHost)) {
    add(`http://${packagerHost}:3003/api`);
  }

  if (!isWeb) {
    if (Platform.OS === "android") add("http://10.0.2.2:3003/api");
    add("http://localhost:3003/api");
    add("http://127.0.0.1:3003/api");
  }

  return candidates;
})();

const envMapUrl = typeof process !== "undefined" && process.env?.EXPO_PUBLIC_ESRI_MAP_URL;

// Same map viewer URL we use on web; override with EXPO_PUBLIC_ESRI_MAP_URL when needed.
export const ESRI_PORTAL_MAP_VIEWER_URL =
  envMapUrl ??
  "https://esrirw.rw/portal/apps/mapviewer/index.html?webmap=3e190cfba7fd4d1f8c9600cc072a6d15";


export const MAP_PROVIDER: "esri" = "esri";


export const ESRI_MAP_NAVIGATION_MINIMAL =
  String(process.env?.EXPO_PUBLIC_ESRI_MAP_NAVIGATION_MINIMAL ?? "true").toLowerCase() !== "false";

function envNum(name: string, fallback: number): number {
  const raw = process.env?.[name];
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}


export const NAV_ROUTE_REFRESH_MIN_INTERVAL_MS = envNum("EXPO_PUBLIC_NAV_ROUTE_REFRESH_MIN_INTERVAL_MS", 8000);
export const NAV_OFF_ROUTE_METERS = envNum("EXPO_PUBLIC_NAV_MAPMATCH_MAX_OFFROUTE_METERS", 90);
export const NAV_ARRIVAL_METERS = envNum("EXPO_PUBLIC_NAV_ARRIVAL_METERS", 35);
export const NAV_MANEUVER_MATCH_METERS = envNum("EXPO_PUBLIC_NAV_MANEUVER_MATCH_METERS", 180);


export const NAV_DEBUG_DISTANCE_CHECK =
  String(process.env?.EXPO_PUBLIC_NAV_DEBUG_DISTANCE_CHECK ?? "false").toLowerCase() === "true";
