import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end: the built SPA (vite preview) talks to a real API on a fresh,
 * seeded Postgres database. Needs DATABASE_URL (an admin connection; the run
 * creates and drops its own database). Synthetic data only.
 */
const API_PORT = 8788;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // On CI the "github" reporter turns failures into annotations we can read without downloading artifacts.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "Asia/Jerusalem",
  },
  projects: [
    {
      name: "chromium",
      // Headless Chromium has no GPU; allow its software WebGL so games can render.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, launchOptions: { args: ["--enable-unsafe-swiftshader"] } },
    },
  ],
  webServer: [
    {
      command: "node --experimental-strip-types e2e/start-api.ts",
      url: `http://localhost:${API_PORT}/health`,
      env: { PORT: String(API_PORT), TRUSTED_ORIGINS: `http://localhost:${WEB_PORT}`, AUTH_RATE_LIMIT: "off" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
