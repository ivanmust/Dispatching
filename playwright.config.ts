import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 90000,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8082",
    trace: "on-first-retry",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: "dispatcher",
      testMatch: /(?:dispatcher|incident-lifecycle)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin-ui",
      testMatch: /incident-lifecycle-admin-ui\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:8087",
      },
    },
  ],
  webServer: [
    {
      command: "cd backend && npm run dev",
      url: "http://localhost:3001/health",
      reuseExistingServer: false,
      timeout: 90000,
      env: {
        PORT: "3001",
        ETA_ROUTER_ENGINE: "fallback",
        ETA_SPEED_UNIT: "m/s",
        // Make ETA socket pushes deterministic for e2e.
        ETA_MOVEMENT_THRESHOLD_METERS: "0",
        ETA_RECOMPUTE_MIN_INTERVAL_MS: "0",
      },
    },
    {
      command: "cd dispatcher && npm run dev -- --port 8082",
      url: "http://localhost:8082",
      reuseExistingServer: false,
      timeout: 90000,
      env: {
        VITE_API_BASE: "http://localhost:3001/api",
        VITE_SOCKET_URL: "http://localhost:3001",
        // Prevent Vite from proxying to external ArcGIS endpoints during e2e.
        VITE_ESRI_VITE_PROXY: "0",
      },
    },
    {
      command: "cd admin-portal && npm run dev -- --port 8087 --strictPort",
      url: "http://localhost:8087",
      reuseExistingServer: true,
      timeout: 90000,
      env: {
        VITE_API_BASE: "http://localhost:3001/api",
      },
    },
  ] as const,
});
