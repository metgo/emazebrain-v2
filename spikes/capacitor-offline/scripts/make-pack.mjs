// Generates a tiny warm-palette Peek Peek asset pack (placeholder art) and its
// pack.json manifest with sha256 per file — the same shape as the design doc's
// asset packs (§8.3). Run: pnpm make-pack
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const dir = new URL("../public/packs/peek-peek-warm/", import.meta.url);
await mkdir(dir, { recursive: true });

// Warm master palette tokens (§7.1).
const tiles = {
  "tile-covered.svg": { body: "#CB6843", edge: "#7A2420", lid: "#FFB547" },
  "tile-correct.svg": { body: "#F5C431", edge: "#7A2420", lid: "#FFF7EC" },
  "tile-wrong.svg": { body: "#B8322B", edge: "#3D1410", lid: "#FFD08A" },
};

const files = [];
for (const [name, c] of Object.entries(tiles)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <polygon points="64,4 118,34 118,94 64,124 10,94 10,34" fill="#FFF7EC" stroke="${c.edge}" stroke-width="6"/>
  <path d="M38 52 h52 l-6 44 h-40 z" fill="${c.body}" stroke="${c.edge}" stroke-width="4"/>
  <rect x="32" y="40" width="64" height="14" rx="7" fill="${c.lid}" stroke="${c.edge}" stroke-width="4"/>
</svg>\n`;
  await writeFile(new URL(name, dir), svg);
  files.push({ path: name, bytes: Buffer.byteLength(svg), sha256: createHash("sha256").update(svg).digest("hex"), type: "image/svg+xml" });
}

const manifest = { id: "peek-peek", version: "2.0.0-spike", palette: "warm", files };
await writeFile(new URL("pack.json", dir), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${files.length} files + pack.json`);
