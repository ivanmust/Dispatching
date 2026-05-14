import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Only enable the ESRI Vite proxy when explicitly requested.
  // Otherwise, unreachable networks spam `http proxy error ... ETIMEDOUT` in the dev server.
  const env = loadEnv(mode, process.cwd(), "");
  const enableEsriProxy =
    String(env.VITE_ESRI_VITE_PROXY ?? "")
      .toLowerCase()
      .trim() === "1" ||
    String(env.VITE_ESRI_VITE_PROXY ?? "")
      .toLowerCase()
      .trim() === "true";

  const esriProxyTargetOrigin = (() => {
    const portal = env.VITE_ESRI_PORTAL_URL?.trim();
    if (portal) {
      try {
        return new URL(portal).origin;
      } catch {
        /* fall through */
      }
    }
    const mapViewer = env.VITE_ESRI_MAP_VIEWER_URL?.trim();
    if (mapViewer) {
      try {
        return new URL(mapViewer).origin;
      } catch {
        /* fall through */
      }
    }
    return "https://esrirw.rw";
  })();

  return {
    server: {
      fs: {
        allow: [path.resolve(__dirname, "..")],
      },
      host: "::",
      port: 8080,
      proxy:
        mode === "development" && enableEsriProxy
          ? {
              "/portal": {
                target: esriProxyTargetOrigin,
                changeOrigin: true,
                secure: false,
                timeout: 8000,
                proxyTimeout: 8000,
              },
              "/sharing": {
                target: esriProxyTargetOrigin,
                changeOrigin: true,
                secure: false,
                timeout: 8000,
                proxyTimeout: 8000,
              },
              "/server": {
                target: esriProxyTargetOrigin,
                changeOrigin: true,
                secure: false,
                timeout: 8000,
                proxyTimeout: 8000,
              },
              "/oauth2": {
                target: esriProxyTargetOrigin,
                changeOrigin: true,
                secure: false,
                timeout: 8000,
                proxyTimeout: 8000,
              },
            }
          : undefined,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
