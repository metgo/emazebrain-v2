// Automated check of the offline game spike in Chromium (the engine behind
// Android's WebView). Serves dist/, downloads the pack online, goes offline,
// plays, then corrupts the stored pack and confirms the launch is refused.
//
//   pnpm build && pnpm spike:test
//   (CHROMIUM_PATH=/path/to/chrome to use a preinstalled browser)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const logText = () => page.$$eval("#log li", (els) => els.map((e) => e.textContent));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); };

await page.goto(`http://localhost:${port}/`);
await page.click("#download");
await page.waitForFunction(() => document.querySelector("#log")?.textContent?.includes("Downloaded and verified"));
check("Pack downloaded and every file's sha256 verified", true);

await context.setOffline(true);
const offline = await page.evaluate(() => fetch("./packs/peek-peek-warm/pack.json").then(() => false, () => true));
check("Network really is off", offline);

await page.click("#play");
await page.waitForFunction(() => window.lastReport, null, { timeout: 15000 });
const report = await page.evaluate(() => window.lastReport);
check("Game launched offline from the stored pack", report.imagesDecoded === 3, `${report.imagesDecoded} of 3 images decoded in ${report.loadMs} ms`);
check("Game origin is opaque (sandboxed)", report.origin === "null", String(report.origin));
check("Game cannot reach the host page", report.parentAccess === false);
check("Game cannot use the network", report.networkBlocked === true);
check("Game cannot use browser storage", report.storageBlocked === true);
await page.screenshot({ path: fileURLToPath(new URL("../offline-check.png", import.meta.url)) });

await page.click("#corrupt");
await page.waitForFunction(() => document.querySelector("#log")?.textContent?.includes("Flipped one byte"));
await page.click("#play");
await page.waitForFunction(() => document.querySelector("#log")?.textContent?.includes("Pack is corrupt"));
check("Corrupted pack is refused before launch", (await logText()).some((t) => t.includes("Pack is corrupt")));
check("No page errors", errors.length === 0, errors.join("; "));

await browser.close();
server.close();

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
