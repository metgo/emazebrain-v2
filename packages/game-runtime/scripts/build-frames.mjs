// Builds dist/frames/<game-id>.js: one self-contained script per game (runtime + game + renderer),
// injected by the host into an opaque-origin sandboxed iframe. No network, no external files.
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const frames = readdirSync(join(root, "frames")).filter((f) => f.endsWith(".ts"));
for (const f of frames) {
  const id = basename(f, ".ts");
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: join(root, "dist/frames"),
      emptyOutDir: false,
      target: "es2022",
      minify: true,
      lib: { entry: join(root, "frames", f), formats: ["iife"], name: "EmbFrame", fileName: () => `${id}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  console.log(`built frame ${id}`);
}
