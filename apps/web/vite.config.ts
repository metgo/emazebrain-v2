import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// In development the SPA and the API share an origin through this proxy, so
// session cookies stay first-party. API_URL points at a running @emb/api.
const api = process.env.API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: true, xfwd: true },
      "/v1": { target: api, changeOrigin: true, xfwd: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: api, changeOrigin: true, xfwd: true },
      "/v1": { target: api, changeOrigin: true, xfwd: true },
    },
  },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
