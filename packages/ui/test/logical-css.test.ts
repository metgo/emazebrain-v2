/**
 * CLAUDE.md invariant 10: CSS logical properties only, so every screen mirrors
 * correctly in Hebrew and Arabic. Scans the CSS and TSX of every app and
 * package. A line can opt out with a `physical-ok` comment and a reason
 * (e.g. the game timer side, which is clinical and never mirrored).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const scanRoots = ["apps", "packages"].map((d) => join(root, d));
const skipDirs = new Set(["node_modules", "dist", "android", "ios", "test-results", "playwright-report"]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(css|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const cssRules: Array<[RegExp, string]> = [
  [/\b(margin|padding|border)-(left|right)\b/, "use margin/padding/border-inline-start|end"],
  [/(^|[\s;{])(left|right)\s*:/, "use inset-inline-start|end"],
  [/text-align\s*:\s*(left|right)\b/, "use text-align: start|end"],
  [/float\s*:\s*(left|right)\b/, "use float: inline-start|end"],
  [/border-(top|bottom)-(left|right)-radius/, "use border-start-start-radius etc."],
];
const tsxRules: Array<[RegExp, string]> = [
  [/\b(margin|padding)(Left|Right)\b/, "use marginInlineStart/End"],
  [/\b(left|right)\s*:\s*['"\d]/, "use insetInlineStart/End"],
  [/textAlign\s*:\s*['"](left|right)/, "use textAlign start/end"],
];

describe("logical CSS only", () => {
  it("finds no physical left/right properties", () => {
    const problems: string[] = [];
    for (const dir of scanRoots) {
      for (const file of files(dir)) {
        const rules = file.endsWith(".css") ? cssRules : tsxRules;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (line.includes("physical-ok")) return;
            for (const [re, fix] of rules) {
              if (re.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${line.trim()}  → ${fix}`);
            }
          });
      }
    }
    expect(problems).toEqual([]);
  });
});
