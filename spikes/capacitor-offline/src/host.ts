/**
 * Host side of the offline game spike (design doc §8.3 sandboxing, §9.8 packs).
 *
 * 1. Download a pack while online, verify every file's sha256 against pack.json,
 *    and store the verified bytes on the device (IndexedDB).
 * 2. Offline, launch the game in an opaque-origin sandboxed iframe (srcdoc) and
 *    hand it the pack as transferable ArrayBuffers. The game never touches the
 *    network or storage itself.
 * 3. Refuse to launch if any stored file no longer matches its hash.
 */
import gameFrameHtml from "./game-frame.html?raw";

interface PackFile { path: string; bytes: number; sha256: string; type: string }
interface PackManifest { id: string; version: string; palette: "warm" | "cold"; files: PackFile[] }
interface StoredPack { key: string; manifest: PackManifest; blobs: Record<string, ArrayBuffer> }

const PACK_URL = "./packs/peek-peek-warm/";
const DB_NAME = "emb-packs";

const $ = (id: string) => document.getElementById(id)!;
const log = (text: string, kind: "ok" | "bad" | "info" = "info") => {
  const li = document.createElement("li");
  li.textContent = text;
  li.className = kind;
  $("log").appendChild(li);
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("packs", { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction("packs", mode).objectStore("packs"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function downloadPack(): Promise<StoredPack> {
  const manifest: PackManifest = await (await fetch(`${PACK_URL}pack.json`, { cache: "no-store" })).json();
  const blobs: Record<string, ArrayBuffer> = {};
  for (const f of manifest.files) {
    const buf = await (await fetch(PACK_URL + f.path, { cache: "no-store" })).arrayBuffer();
    if ((await sha256Hex(buf)) !== f.sha256) throw new Error(`Checksum mismatch on download: ${f.path}`);
    blobs[f.path] = buf;
  }
  const pack: StoredPack = { key: `${manifest.id}@${manifest.version}/${manifest.palette}`, manifest, blobs };
  await tx("readwrite", (s) => s.put(pack));
  return pack;
}

async function loadVerifiedPack(key: string): Promise<StoredPack> {
  const pack = await tx<StoredPack | undefined>("readonly", (s) => s.get(key));
  if (!pack) throw new Error("This game isn't downloaded on this device yet.");
  for (const f of pack.manifest.files) {
    const buf = pack.blobs[f.path];
    if (!buf || (await sha256Hex(buf)) !== f.sha256) throw new Error(`Pack is corrupt (${f.path}). Download it again.`);
  }
  return pack;
}

export async function launchGame(key: string): Promise<Record<string, unknown>> {
  const pack = await loadVerifiedPack(key);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts"); // no allow-same-origin → opaque origin
  frame.title = "Game";
  frame.srcdoc = gameFrameHtml;
  $("stage").replaceChildren(frame);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Game did not respond within 10 s")), 10_000); // watchdog
    window.addEventListener("message", function onMsg(e) {
      if (e.source !== frame.contentWindow || e.data?.ch !== "emb") return; // only our game
      if (e.data.type === "booted") {
        // Copies, so the stored pack stays intact; the copies are transferred (zero-copy into the game).
        const files = pack.manifest.files.map((f) => ({ path: f.path, type: f.type, data: pack.blobs[f.path]!.slice(0) }));
        frame.contentWindow!.postMessage(
          { ch: "emb", type: "init", payload: { palette: pack.manifest.palette, files } },
          "*",
          files.map((f) => f.data),
        );
      }
      if (e.data.type === "ready") {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve(e.data.payload);
      }
    });
  });
}

/** Test helper: flips one byte in a stored file to prove the integrity check. */
export async function corruptStoredPack(key: string): Promise<void> {
  const pack = await tx<StoredPack | undefined>("readonly", (s) => s.get(key));
  if (!pack) return;
  const first = pack.manifest.files[0]!.path;
  const bytes = new Uint8Array(pack.blobs[first]!.slice(0));
  bytes[10] = (bytes[10] ?? 0) ^ 0xff;
  pack.blobs[first] = bytes.buffer;
  await tx("readwrite", (s) => s.put(pack));
}

// ---- UI wiring
const KEY = "peek-peek@2.0.0-spike/warm";
let busy = false;
async function guard(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (err) { log((err as Error).message, "bad"); } finally { busy = false; }
}

$("download").addEventListener("click", () =>
  guard(async () => {
    const p = await downloadPack();
    log(`Downloaded and verified ${p.manifest.files.length} files (${p.key})`, "ok");
  }),
);
$("play").addEventListener("click", () =>
  guard(async () => {
    log(navigator.onLine ? "Launching (device online)" : "Launching (device offline)");
    const r = await launchGame(KEY);
    (window as unknown as { lastReport: unknown }).lastReport = r;
    const checks: Array<[string, boolean]> = [
      ["Game runs in an opaque sandboxed origin", r.origin === "null"],
      ["Game cannot reach the host page", r.parentAccess === false],
      ["Game cannot use the network", r.networkBlocked === true],
      ["Game cannot use browser storage", r.storageBlocked === true],
      ["All pack images decoded inside the game", r.imagesDecoded === r.filesReceived && Number(r.filesReceived) > 0],
    ];
    for (const [label, ok] of checks) log(`${ok ? "✓" : "✗"} ${label}`, ok ? "ok" : "bad");
    log(`Pack handed over and drawn in ${String(r.loadMs)} ms`);
  }),
);
$("corrupt").addEventListener("click", () => guard(async () => { await corruptStoredPack(KEY); log("Flipped one byte in the stored pack"); }));
window.addEventListener("online", () => log("Network: online"));
window.addEventListener("offline", () => log("Network: offline"));
