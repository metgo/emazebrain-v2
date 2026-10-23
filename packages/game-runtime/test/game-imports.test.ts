/**
 * CLAUDE.md invariant 6: games import only @emb/game-sdk (plus their
 * renderer and their own files). No network clients, no app code, no
 * session-rules: the runtime owns time and lives.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const ALLOWED = [/^@emb\/game-sdk$/, /^pixi\.js(\/.*)?$/, /^\.\.?\//];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "dist") continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("game imports", () => {
  it("games/*/src import only the SDK, their renderer and their own files", () => {
    const bad: string[] = [];
    for (const game of readdirSync(join(root, "games"))) {
      const src = join(root, "games", game, "src");
      if (game.endsWith("-spike") || !statSync(join(root, "games", game)).isDirectory()) continue;
      for (const f of files(src)) {
        const text = readFileSync(f, "utf8");
        for (const m of text.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
          const spec = m[1] ?? m[2]!;
          if (!ALLOWED.some((re) => re.test(spec))) bad.push(`${relative(root, f)}: ${spec}`);
        }
        if (/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|indexedDB/.test(text)) bad.push(`${relative(root, f)}: uses network or storage`);
      }
    }
    expect(bad).toEqual([]);
  });
});
