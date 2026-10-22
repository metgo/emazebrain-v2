import { defineConfig } from "vite";

// base "./" so the built folder works from any URL (a test server, an artifact, a phone).
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});
