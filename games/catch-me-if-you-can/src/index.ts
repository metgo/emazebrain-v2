/**
 * Catch Me If You Can (design doc §8.4) on the eMazeBrain Game SDK.
 * The game draws boards and reports events; Session Rules (in the runtime)
 * owns time and lives. Art is drawn in code from the warm/cold master
 * palettes until the commissioned illustrations arrive (§8.5).
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, Rectangle, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, LevelHistoryRow, PauseReason, SessionStatus } from "@emb/game-sdk";
import { CatchMeEngine, type Board, type Outcome, type Stage } from "./logic.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 84;
const EDGE = 24;

class CatchMe implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private engine!: CatchMeEngine;
  private bg = new Graphics();
  private boardsLayer = new Container();
  private fx = new Container();
  private stage: Stage | null = null;
  private shownAt = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private qualified = false;
  private inputLocked = true;
  private ended = false;
  private paused = false;
  private practiceDone: (() => void) | null = null;
  private practiceLeft = 0;
  private tileRects = new Map<string, { x: number; y: number; size: number; board: Board }>();
  private windowBar = new Graphics();
  private levelStart = { at: 0, trials: 0, correct: 0, errors: 0, livesLost: 0, score: 0 };
  private bubbles: Array<{ g: Graphics; speed: number }> = [];

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    this.engine = new CatchMeEngine({
      difficulty: p.difficulty,
      ...(typeof p.start_level === "number" ? { startLevel: p.start_level } : {}),
      ...(p.max_level ? { maxLevel: p.max_level } : {}),
      palette: ctx.palette,
      cvdMode: p["catch_me.cvd_mode"] === true,
      staircase: p.session_mode === "timed",
      rng: ctx.rng,
    });
    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.boardsLayer, this.fx);
    this.app.renderer.on("resize", () => {
      this.drawBackground();
      if (this.stage) this.drawStage(this.stage, false);
    });
    this.app.ticker.add((tk) => this.tick(tk));
    this.drawBackground();
    ctx.session.onEnd(() => {
      this.ended = true;
      this.inputLocked = true;
    });
    ctx.session.onLifeLost(() => {
      // The runtime freezes input for 400 ms after a life is lost; the game's own feedback covers that time too.
    });
  }

  async startPractice(): Promise<{ trials: number }> {
    this.practiceLeft = 3;
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.show(this.engine.practiceStage());
    });
    return { trials: 3 };
  }

  start(): void {
    this.levelStart = { at: performance.now(), trials: 0, correct: 0, errors: 0, livesLost: 0, score: 0 };
    this.show(this.engine.start());
  }

  pause(_reason: PauseReason): void {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.pausedAt !== null) this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = null;
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.inputLocked = true;
    const m = this.engine.metrics();
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)) as Record<string, number | string | object>;
  }

  destroy(): void {
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private now(): number {
    return performance.now() - this.pausedTotal - (this.pausedAt !== null ? performance.now() - this.pausedAt : 0);
  }

  private show(stage: Stage) {
    this.stage = stage;
    this.drawStage(stage, true);
    this.shownAt = this.now();
    this.inputLocked = false;
  }

  private windowMs(): number | null {
    const w = this.ctx.params.trial_window_ms;
    return typeof w === "number" && !this.stage?.practice ? w : null;
  }

  private onTap(board: Board, index: number) {
    if (this.inputLocked || this.ended || this.paused || !this.stage) return;
    const s = this.ctx.session;
    if (!this.stage.practice && !this.qualified) {
      this.qualified = true;
      s.qualifyingInteraction(); // the clock starts on the first real tap, never on load
    }
    const rt = Math.round(this.now() - this.shownAt);
    const outcome = this.engine.pick(board.role, index, rt);
    if (!outcome) return;
    this.markPick(board, index);
    if (outcome.kind === "pending") return;
    this.inputLocked = true;
    if (!this.stage.practice) this.report(outcome);
    if (outcome.kind === "correct") this.onCorrect();
    else this.onWrong(outcome);
  }

  private report(outcome: Exclude<Outcome, { kind: "pending" }>) {
    const s = this.ctx.session;
    const st = this.stage!;
    for (const p of outcome.picks) {
      const rect = this.tileRects.get(`${p.role}:${p.index}`);
      s.trial({
        trialId: `${st.level}.${st.stage}.${st.step}.${p.role}`,
        level: st.level,
        stimulusOnMs: Math.round(this.shownAt),
        responseMs: p.rtMs,
        outcome: p.correct ? "correct" : "error",
        ...(rect ? { target: { x: Math.round(rect.x), y: Math.round(rect.y), hemifield: p.hemifield } } : {}),
        tags: { delta_e: Math.round(st.deltaE * 100) / 100, board: p.role, quadrant: p.quadrant, boards: st.boards.length },
      });
      this.levelStart.trials += 1;
      if (p.correct) this.levelStart.correct += 1;
      else this.levelStart.errors += 1;
    }
  }

  private onCorrect() {
    this.celebrate();
    const st = this.stage!;
    window.setTimeout(() => {
      if (this.ended) return;
      if (st.practice) {
        this.practiceLeft -= 1;
        if (this.practiceLeft <= 0) {
          const done = this.practiceDone;
          this.practiceDone = null;
          this.clearBoards();
          done?.();
          return;
        }
        this.show(this.engine.practiceStage());
        return;
      }
      const before = this.engine.score;
      const next = this.engine.advance();
      this.levelStart.score += this.engine.score - before;
      if (next.levelCompleted !== null) {
        const row: LevelHistoryRow = {
          level: next.levelCompleted,
          durationMs: Math.round(performance.now() - this.levelStart.at),
          scoreDelta: this.levelStart.score,
          trials: this.levelStart.trials,
          correct: this.levelStart.correct,
          errors: this.levelStart.errors,
          livesLost: this.levelStart.livesLost,
          outcome: "cleared",
        };
        this.ctx.session.levelComplete(row);
        this.levelStart = { at: performance.now(), trials: 0, correct: 0, errors: 0, livesLost: 0, score: 0 };
      }
      if (next.finished) {
        this.ctx.session.contentExhausted("max_level");
        return;
      }
      if (next.stage) this.show(next.stage);
    }, this.ctx.reducedMotion ? 450 : 750);
  }

  private onWrong(outcome: Extract<Outcome, { kind: "wrong" }>) {
    const st = this.stage!;
    this.gentleMiss(outcome);
    if (!st.practice) {
      this.levelStart.livesLost += 1;
      this.ctx.session.lifeLossEvent("wrong_tile");
    }
    window.setTimeout(() => {
      if (!this.ended) this.show(this.engine.retry());
    }, 1200);
  }

  private onTimeout() {
    if (!this.stage || this.stage.practice) return;
    this.inputLocked = true;
    this.engine.timeout();
    const st = this.stage;
    this.ctx.session.trial({ trialId: `${st.level}.${st.stage}.${st.step}.timeout`, level: st.level, stimulusOnMs: Math.round(this.shownAt), responseMs: null, outcome: "timeout" });
    this.levelStart.livesLost += 1;
    this.ctx.session.lifeLossEvent("trial_timeout");
    for (const b of st.boards) this.revealOdd(b);
    window.setTimeout(() => {
      if (!this.ended) this.show(this.engine.retry());
    }, 1200);
  }

  private tick(tk: Ticker) {
    const w = this.windowMs();
    this.windowBar.clear();
    if (w && this.stage && !this.inputLocked && !this.paused && !this.ended) {
      const left = Math.max(0, w - (this.now() - this.shownAt));
      const frac = left / w;
      const b = this.boardBounds;
      if (b) {
        this.windowBar.roundRect(b.x, b.y - 14, b.w * frac, 6, 3).fill({ color: this.ctx.tokens.g700!, alpha: 0.85 });
      }
      if (left <= 0) this.onTimeout();
    }
    if (!this.ctx.reducedMotion) {
      for (const bub of this.bubbles) {
        bub.g.y -= bub.speed * tk.deltaTime;
        if (bub.g.y < -20) bub.g.y = this.app.screen.height + 20;
      }
    }
  }

  // ---------------------------------------------------------------- drawing

  private boardBounds: { x: number; y: number; w: number; h: number } | null = null;

  private drawBackground() {
    const { width: w, height: h } = this.app.screen;
    const t = this.ctx.tokens;
    const g = this.bg;
    g.clear();
    for (const b of this.bubbles) b.g.destroy();
    this.bubbles = [];
    const sky = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: this.ctx.palette === "warm"
        ? [{ offset: 0, color: t.g100! }, { offset: 1, color: t.g50! }]
        : [{ offset: 0, color: t.g50! }, { offset: 1, color: t.g200! }],
      textureSpace: "local",
    });
    g.rect(0, 0, w, h).fill(sky);
    if (this.ctx.palette === "warm") {
      // Market awning: scalloped stripes along the top.
      const stripe = Math.max(48, w / 14);
      for (let x = 0, i = 0; x < w; x += stripe, i++) {
        g.rect(x, 0, stripe, 30).fill({ color: i % 2 ? t.g50! : t.g300!, alpha: 0.9 });
        g.circle(x + stripe / 2, 30, stripe / 2).fill({ color: i % 2 ? t.g50! : t.g300!, alpha: 0.9 });
      }
      // Warm sun glow, low on the far side.
      g.circle(w * 0.85, h * 0.92, Math.max(w, h) * 0.28).fill({ color: t.accent1!, alpha: 0.12 });
      g.circle(w * 0.1, h * 1.05, Math.max(w, h) * 0.22).fill({ color: t.g300!, alpha: 0.18 });
    } else {
      // Lagoon: soft wave bands and drifting bubbles.
      for (let i = 0; i < 4; i++) {
        const y = h * (0.55 + i * 0.12);
        g.moveTo(0, y);
        for (let x = 0; x <= w; x += 40) g.lineTo(x, y + Math.sin((x / w) * Math.PI * 4 + i) * 10);
        g.lineTo(w, h).lineTo(0, h).closePath().fill({ color: t.g300!, alpha: 0.12 });
      }
      for (let i = 0; i < 14; i++) {
        const bub = new Graphics().circle(0, 0, 4 + this.ctx.rng() * 10).stroke({ width: 2, color: "#FFFFFF", alpha: 0.5 });
        bub.x = this.ctx.rng() * w;
        bub.y = this.ctx.rng() * h;
        this.bg.addChild(bub);
        this.bubbles.push({ g: bub, speed: 0.2 + this.ctx.rng() * 0.5 });
      }
    }
  }

  private clearBoards() {
    for (const c of this.boardsLayer.removeChildren()) c.destroy({ children: true });
    for (const c of this.fx.removeChildren()) c.destroy({ children: true });
    this.tileRects.clear();
    this.boardBounds = null;
  }

  private drawStage(stage: Stage, animate: boolean) {
    this.clearBoards();
    const { width: W, height: H } = this.app.screen;
    const t = this.ctx.tokens;
    const top = HUD_SPACE;
    const availW = W - EDGE * 2;
    const availH = H - top - EDGE;
    const two = stage.boards.length === 2;
    const sideBySide = !two || availW >= availH * 1.15;
    const gap = two ? Math.max(32, availW * 0.06) : 0;
    const boardMax = two ? (sideBySide ? Math.min((availW - gap) / 2, availH) : Math.min(availW, (availH - gap) / 2)) : Math.min(availW, availH);

    const ordered = [...stage.boards].sort((a, b) => (a.side === "left" ? -1 : b.side === "left" ? 1 : 0));
    ordered.forEach((board, i) => {
      // Every board in a stage has the same outer size, so neither side looks "easier" (§8.4 hemifield metrics).
      const size = Math.min(boardMax, 620);
      const cx = two ? (sideBySide ? W / 2 + (i === 0 ? -1 : 1) * (gap / 2 + size / 2) : W / 2) : W / 2;
      const cy = two && !sideBySide ? top + (i === 0 ? size / 2 : size * 1.5 + gap) : top + availH / 2;
      const x = cx - size / 2;
      const y = cy - size / 2;
      if (i === 0) this.boardBounds = { x, y, w: size, h: size };
      const frame = new Graphics();
      frame.roundRect(x + 4, y + 8, size, size, 28).fill({ color: t.g900!, alpha: 0.12 });
      frame.roundRect(x, y, size, size, 28).fill({ color: t.g50! }).stroke({ width: 6, color: t.g800!, alpha: 0.9 });
      this.boardsLayer.addChild(frame);

      const pad = size * 0.07;
      const n = board.size;
      const tileGap = Math.max(6, (size - pad * 2) * 0.05);
      const tile = (size - pad * 2 - tileGap * (n - 1)) / n;
      for (let k = 0; k < n * n; k++) {
        const col = k % n;
        const row = Math.floor(k / n);
        const tx = x + pad + col * (tile + tileGap);
        const ty = y + pad + row * (tile + tileGap);
        const g = new Graphics();
        const r = tile * 0.16;
        g.roundRect(0, tile * 0.04, tile, tile, r).fill({ color: t.g900!, alpha: 0.12 });
        g.roundRect(0, 0, tile, tile, r).fill({ color: k === board.oddIndex ? board.odd : board.base });
        // Frame: wicker basket rim (warm) or shell rim (cold).
        if (this.ctx.palette === "warm") g.roundRect(2, 2, tile - 4, tile - 4, r * 0.8).stroke({ width: 3, color: t.g800!, alpha: 0.25 });
        else g.roundRect(3, 3, tile - 6, tile - 6, r * 0.8).stroke({ width: 3, color: "#FFFFFF", alpha: 0.35 });
        g.x = tx;
        g.y = ty;
        g.eventMode = "static";
        g.cursor = "pointer";
        const forgive = Math.min(10, tileGap / 2);
        g.hitArea = new Rectangle(-forgive, -forgive, tile + forgive * 2, tile + forgive * 2);
        g.on("pointerdown", () => this.onTap(board, k));
        if (animate && !this.ctx.reducedMotion) {
          g.alpha = 0;
          const delay = (row + col) * 18;
          this.animate(220, (p) => (g.alpha = p), delay);
        }
        this.boardsLayer.addChild(g);
        this.tileRects.set(`${board.role}:${k}`, { x: tx + tile / 2, y: ty + tile / 2, size: tile, board });
      }
    });
    this.fx.addChild(this.windowBar);
  }

  private markPick(board: Board, index: number) {
    const rect = this.tileRects.get(`${board.role}:${index}`);
    if (!rect) return;
    const t = this.ctx.tokens;
    const ring = new Graphics();
    const half = rect.size / 2;
    ring.roundRect(-half - 5, -half - 5, rect.size + 10, rect.size + 10, rect.size * 0.2).stroke({ width: 4, color: "#FFFFFF" });
    ring.roundRect(-half - 9, -half - 9, rect.size + 18, rect.size + 18, rect.size * 0.24).stroke({ width: 3, color: t.g900! });
    ring.x = rect.x;
    ring.y = rect.y;
    this.fx.addChild(ring);
  }

  /** Correct: a ✓ on every odd tile, a small pop of particles (none with reduced motion). */
  private celebrate() {
    const t = this.ctx.tokens;
    for (const b of this.stage!.boards) {
      const rect = this.tileRects.get(`${b.role}:${b.oddIndex}`);
      if (!rect) continue;
      const r = Math.max(14, rect.size * 0.28);
      const mark = new Graphics();
      mark.circle(0, 0, r).fill({ color: "#FFFFFF" }).stroke({ width: 3, color: t.success! });
      mark.moveTo(-r * 0.45, 0).lineTo(-r * 0.1, r * 0.38).lineTo(r * 0.5, -r * 0.35).stroke({ width: Math.max(3, r * 0.22), color: t.success!, cap: "round", join: "round" });
      mark.x = rect.x;
      mark.y = rect.y;
      this.fx.addChild(mark);
      if (!this.ctx.reducedMotion) {
        mark.scale.set(0.4);
        this.animate(200, (p) => mark.scale.set(0.4 + 0.6 * easeOut(p)));
        for (let i = 0; i < 10; i++) {
          const dot = new Graphics().circle(0, 0, 4 + this.ctx.rng() * 4).fill({ color: i % 2 ? t.accent1! : t.accent2! });
          dot.x = rect.x;
          dot.y = rect.y;
          this.fx.addChild(dot);
          const a = (i / 10) * Math.PI * 2;
          const dist = rect.size * (0.8 + this.ctx.rng() * 0.6);
          this.animate(500, (p) => {
            dot.x = rect.x + Math.cos(a) * dist * easeOut(p);
            dot.y = rect.y + Math.sin(a) * dist * easeOut(p);
            dot.alpha = 1 - p;
          });
        }
      }
    }
  }

  /** Wrong: no red, no buzzer. A small ✕ where they tapped, a gentle wobble, and the odd tile is shown. */
  private gentleMiss(outcome: Extract<Outcome, { kind: "wrong" }>) {
    const t = this.ctx.tokens;
    for (const p of outcome.picks) {
      if (p.correct) continue;
      const rect = this.tileRects.get(`${p.role}:${p.index}`);
      if (!rect) continue;
      const r = Math.max(12, rect.size * 0.22);
      const mark = new Graphics();
      mark.circle(0, 0, r).fill({ color: "#FFFFFF", alpha: 0.9 });
      mark.moveTo(-r * 0.4, -r * 0.4).lineTo(r * 0.4, r * 0.4).moveTo(r * 0.4, -r * 0.4).lineTo(-r * 0.4, r * 0.4).stroke({ width: Math.max(3, r * 0.2), color: t.g800!, cap: "round" });
      mark.x = rect.x;
      mark.y = rect.y;
      this.fx.addChild(mark);
      if (!this.ctx.reducedMotion) this.animate(360, (q) => (mark.x = rect.x + Math.sin(q * Math.PI * 4) * 6 * (1 - q)));
    }
    for (const b of this.stage!.boards) this.revealOdd(b);
  }

  private revealOdd(b: Board) {
    const rect = this.tileRects.get(`${b.role}:${b.oddIndex}`);
    if (!rect) return;
    const half = rect.size / 2;
    const glow = new Graphics().roundRect(-half - 6, -half - 6, rect.size + 12, rect.size + 12, rect.size * 0.22).stroke({ width: 5, color: this.ctx.tokens.accent1! });
    glow.x = rect.x;
    glow.y = rect.y;
    this.fx.addChild(glow);
  }

  private animate(ms: number, step: (p: number) => void, delay = 0) {
    const start = performance.now() + delay;
    const fn = () => {
      const p = Math.min(1, Math.max(0, (performance.now() - start) / ms));
      step(p);
      if (p >= 1) this.app.ticker.remove(fn);
    };
    this.app.ticker.add(fn);
  }
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

export const catchMe: GameDefinition = { manifest, create: () => new CatchMe(), strings };
export default catchMe;
