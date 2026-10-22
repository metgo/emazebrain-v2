/**
 * Tunnel Rush performance spike (design doc §9.3 [Open], §16).
 *
 * Question: does a PixiJS 8 pseudo-3D tunnel hold p50 ≥ 60 fps and p5 ≥ 45 fps
 * on low-end tablets (Galaxy Tab A9 / A8, iPad 9th gen)? If not, Tunnel Rush
 * moves to three.js. Everything is redrawn every frame on purpose: this is the
 * worst realistic case for the 2D renderer.
 *
 * Throwaway code. Not the production game.
 */
import { Application, Graphics } from "pixi.js";

type LoadLevel = 1 | 2 | 3;
interface Load { lanes: number; rings: number; obstacles: number; speed: number; particles: number; bend: number }
const LOADS: Record<LoadLevel, Load> = {
  1: { lanes: 8, rings: 24, obstacles: 12, speed: 3.0, particles: 0, bend: 200 },   // difficulty 3
  2: { lanes: 10, rings: 28, obstacles: 20, speed: 4.6, particles: 80, bend: 320 }, // difficulty 5
  3: { lanes: 12, rings: 32, obstacles: 60, speed: 5.8, particles: 400, bend: 320 }, // stress
};

// Cold "Ice Comet Run" lane tones from the design doc (§8.4).
const LANE_COLORS = [0x0a9396, 0x04303a, 0x00b4c5, 0x00566b, 0x0e7c8b, 0x062830];
const BG = 0x0e1530;
const OBSTACLE = 0xb39bff;
const SHIP = 0x6cc4e8;

const WARMUP_MS = 2000;
const RUN_MS = 30_000;
const SPACING = 1;        // world units between rings
const NEAR = 0.6;         // camera near plane
const FOCAL = 1.1;

const qs = new URLSearchParams(location.search);
let load: LoadLevel = (Number(qs.get("load")) as LoadLevel) || 1;

const app = new Application();
await app.init({
  resizeTo: window,
  background: BG,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
  preference: "webgl",
});
document.getElementById("stage")!.appendChild(app.canvas);

const tunnel = new Graphics();
const objects = new Graphics();
const fx = new Graphics();
const ship = new Graphics();
app.stage.addChild(tunnel, objects, fx, ship);

// ---------------------------------------------------------------- world state
let rng = 12345;
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296); // seeded, deterministic

interface Obstacle { lane: number; z: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number }
let obstacles: Obstacle[] = [];
let particles: Particle[] = [];
let travelled = 0;
let rotation = 0;        // visual angle (radians)
let targetLane = 0;      // logical lane facing the ship
let hits = 0;
let dodges = 0;
let time = 0;

function resetWorld() {
  rng = 12345;
  const L = LOADS[load];
  obstacles = Array.from({ length: L.obstacles }, (_, i) => ({ lane: Math.floor(rand() * L.lanes), z: 3 + i * (L.rings * SPACING / L.obstacles) }));
  particles = Array.from({ length: L.particles }, () => newParticle());
  travelled = 0; rotation = 0; targetLane = 0; hits = 0; dodges = 0; time = 0;
}
function newParticle(): Particle {
  return { x: rand() * 2 - 1, y: rand() * 2 - 1, vx: (rand() - 0.5) * 0.02, vy: (rand() - 0.5) * 0.02, life: rand() };
}

// ---------------------------------------------------------------- input
function steer(dir: -1 | 1) { targetLane = (targetLane + dir + LOADS[load].lanes) % LOADS[load].lanes; }
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "a") steer(-1);
  if (e.key === "ArrowRight" || e.key === "d") steer(1);
});
document.getElementById("left")!.addEventListener("pointerdown", () => steer(-1));
document.getElementById("right")!.addEventListener("pointerdown", () => steer(1));
let swipeX: number | null = null;
app.canvas.addEventListener("pointerdown", (e) => { swipeX = e.clientX; });
app.canvas.addEventListener("pointerup", (e) => {
  if (swipeX !== null && Math.abs(e.clientX - swipeX) >= 40) steer(e.clientX < swipeX ? -1 : 1);
  swipeX = null;
});

// ---------------------------------------------------------------- projection
function project(z: number, angle: number, w: number, h: number) {
  const L = LOADS[load];
  const s = FOCAL / (z + NEAR);
  const r = Math.min(w, h) * 0.48 * s;
  const bendX = Math.sin((travelled + z) * 0.15) * L.bend * (z / (L.rings * SPACING)) * (w / 1200);
  const bendY = Math.cos((travelled + z) * 0.11) * L.bend * 0.3 * (z / (L.rings * SPACING)) * (h / 800);
  return { x: w / 2 + bendX + Math.cos(angle) * r, y: h / 2 + bendY + Math.sin(angle) * r, s };
}

// ---------------------------------------------------------------- render loop
function frame(dtMs: number) {
  const L = LOADS[load];
  const w = app.screen.width;
  const h = app.screen.height;
  const dt = Math.min(dtMs, 50) / 1000;
  time += dt;
  travelled += L.speed * dt;

  // Ease the visual rotation toward the lane the ship is facing (bottom of the screen).
  const laneAngle = (Math.PI * 2) / L.lanes;
  const want = -targetLane * laneAngle;
  let diff = want - rotation;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  rotation += diff * Math.min(1, dt * 10);

  const frac = travelled % SPACING;
  tunnel.clear();
  for (let k = L.rings - 1; k >= 0; k--) {
    const z0 = k * SPACING - frac;
    const z1 = z0 + SPACING;
    if (z0 < 0) continue;
    const fog = 1 - Math.min(1, z0 / (L.rings * SPACING));
    for (let lane = 0; lane < L.lanes; lane++) {
      const a0 = Math.PI / 2 + rotation + lane * laneAngle - laneAngle / 2;
      const a1 = a0 + laneAngle;
      const p00 = project(z0, a0, w, h), p01 = project(z0, a1, w, h);
      const p10 = project(z1, a1, w, h), p11 = project(z1, a0, w, h);
      const color = LANE_COLORS[(lane + Math.floor(travelled + k)) % LANE_COLORS.length]!;
      tunnel.poly([p00.x, p00.y, p01.x, p01.y, p10.x, p10.y, p11.x, p11.y]).fill({ color, alpha: 0.25 + 0.75 * fog });
    }
  }

  objects.clear();
  for (const o of obstacles) {
    o.z -= L.speed * dt;
    if (o.z < 0.05) {
      // Reached the ship plane: hit if it's in the lane the ship faces.
      if (o.lane === targetLane) hits++; else dodges++;
      o.z += L.rings * SPACING;
      o.lane = Math.floor(rand() * L.lanes);
      continue;
    }
    const a = Math.PI / 2 + rotation + o.lane * laneAngle;
    const p = project(o.z, a, w, h);
    const size = Math.max(2, 26 * p.s * (Math.min(w, h) / 800));
    objects.circle(p.x, p.y, size).fill({ color: OBSTACLE, alpha: 0.95 }).stroke({ width: Math.max(1, size * 0.15), color: 0xffffff });
  }

  fx.clear();
  for (const pt of particles) {
    pt.x += pt.vx; pt.y += pt.vy; pt.life -= dt * 0.5;
    if (pt.life <= 0 || Math.abs(pt.x) > 1 || Math.abs(pt.y) > 1) Object.assign(pt, newParticle(), { life: 1 });
    fx.circle(w / 2 + pt.x * w * 0.5, h / 2 + pt.y * h * 0.5, 2).fill({ color: 0xffffff, alpha: pt.life * 0.6 });
  }

  const sp = { x: w / 2, y: h * 0.84 };
  ship.clear();
  ship.poly([sp.x, sp.y - 30, sp.x - 26, sp.y + 14, sp.x + 26, sp.y + 14]).fill({ color: SHIP }).stroke({ width: 2, color: 0xffffff });
}

// ---------------------------------------------------------------- measurement
let samples: number[] = [];
let runStart = performance.now();
const statsEl = document.getElementById("stats")!;
let lastResult: Record<string, unknown> | null = null;

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

function report(final: boolean) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50fps = sorted.length ? 1000 / percentile(sorted, 50) : 0;
  const p5fps = sorted.length ? 1000 / percentile(sorted, 95) : 0; // slowest 5% of frames
  // Most tablets cap at 60 Hz, so 58+ counts as "60".
  const pass = p50fps >= 58 && p5fps >= 45;
  const elapsed = Math.max(0, performance.now() - runStart - WARMUP_MS);
  const verdict = !final
    ? `<span class="verdict-wait">Running… ${Math.ceil((RUN_MS - elapsed) / 1000)} s left</span>`
    : pass ? `<span class="verdict-ok">PASS</span>` : `<span class="verdict-bad">FAIL</span>`;
  statsEl.innerHTML =
    `<div>${verdict}</div>` +
    `<div>p50 <b>${p50fps.toFixed(0)}</b> fps · p5 <b>${p5fps.toFixed(0)}</b> fps</div>` +
    `<small>target p50 ≥ 60, p5 ≥ 45 · ${sorted.length} frames · load ${load} · ${app.renderer.name}</small><br>` +
    `<small>dodged ${dodges} · hit ${hits}</small>`;
  if (final) {
    lastResult = {
      verdict: pass ? "PASS" : "FAIL",
      p50fps: Math.round(p50fps), p5fps: Math.round(p5fps), frames: sorted.length,
      load, ...LOADS[load], renderer: app.renderer.name,
      screen: `${screen.width}x${screen.height}`, dpr: window.devicePixelRatio,
      userAgent: navigator.userAgent, at: new Date().toISOString(),
    };
  }
}

let finished = false;
app.ticker.add((ticker) => {
  frame(ticker.deltaMS);
  const since = performance.now() - runStart;
  if (finished) return;
  if (since > WARMUP_MS) samples.push(ticker.deltaMS);
  if (since > WARMUP_MS + RUN_MS) { finished = true; report(true); return; }
  if (Math.floor(since / 500) !== Math.floor((since - ticker.deltaMS) / 500)) report(false);
});

function restart() {
  samples = []; finished = false; runStart = performance.now(); lastResult = null; resetWorld();
}
const loadSel = document.getElementById("load") as HTMLSelectElement;
loadSel.value = String(load);
loadSel.addEventListener("change", () => { load = Number(loadSel.value) as LoadLevel; restart(); });
document.getElementById("restart")!.addEventListener("click", restart);
document.getElementById("copy")!.addEventListener("click", async () => {
  const text = JSON.stringify(lastResult ?? { note: "run not finished yet" }, null, 2);
  try { await navigator.clipboard.writeText(text); statsEl.insertAdjacentHTML("beforeend", "<br><small>Copied.</small>"); }
  catch { statsEl.insertAdjacentHTML("beforeend", `<pre style="white-space:pre-wrap;font-size:11px">${text}</pre>`); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) restart(); });

resetWorld();
