import { describe, expect, it } from "vitest";
import { deltaE76, hexToLab, labToHex, oddColour, oddHex, TILE_COLOURS } from "../src/colors.ts";
import { CatchMeEngine, DELTA_E_FLOOR, quadrantOf, seeded, type Stage } from "../src/logic.ts";

const engine = (extra: Partial<ConstructorParameters<typeof CatchMeEngine>[0]> = {}) =>
  new CatchMeEngine({ difficulty: 3, palette: "warm", rng: seeded(1), ...extra });

/** Answers every board of the stage correctly (or wrongly). */
function answer(e: CatchMeEngine, s: Stage, right = true) {
  let out = null;
  for (const b of s.boards) out = e.pick(b.role, right ? b.oddIndex : (b.oddIndex + 1) % (b.size * b.size), 900);
  return out!;
}

describe("colour maths", () => {
  it("round-trips sRGB through Lab", () => {
    for (const hex of [...TILE_COLOURS.warm, ...TILE_COLOURS.cold]) {
      expect(deltaE76(hexToLab(labToHex(hexToLab(hex))), hexToLab(hex))).toBeLessThan(1);
    }
  });

  it("makes the odd tile the requested ΔE away (within rounding)", () => {
    const rng = seeded(5);
    for (const hex of TILE_COLOURS.cold) {
      for (const d of [30, 12.3, 4, 1.5]) {
        const measured = deltaE76(hexToLab(oddHex(hex, d, rng)), hexToLab(hex));
        expect(Math.abs(measured - d), `${hex} at ΔE ${d}`).toBeLessThan(1);
      }
    }
  });

  it("uses only lightness in colour-vision-deficiency mode", () => {
    const base = hexToLab("#4B0082");
    const odd = oddColour(base, 10, seeded(2), true);
    expect(odd.a).toBe(base.a);
    expect(odd.b).toBe(base.b);
    expect(Math.abs(odd.L - base.L)).toBe(10);
  });

  it("keeps warm boards free of green and cold boards free of red and orange", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      return (h * 60 + 360) % 360;
    };
    for (const c of TILE_COLOURS.warm) expect(hue(c) < 75 || hue(c) > 330).toBe(true);
    for (const c of TILE_COLOURS.cold) expect(hue(c) > 165 && hue(c) < 290).toBe(true);
  });
});

describe("stages and levels", () => {
  it("level L has L stages; stage 1 has one board, later stages add a second on the other side", () => {
    const e = engine();
    let s = e.start();
    expect(s).toMatchObject({ level: 2, stage: 1, practice: false });
    expect(s.boards.map((b) => [b.role, b.size, b.side])).toEqual([["anchor", 2, "center"]]);
    answer(e, s);
    s = e.advance().stage!;
    expect(s.stage).toBe(2);
    expect(s.boards.map((b) => b.size)).toEqual([2, 2]);
    expect(new Set(s.boards.map((b) => b.side))).toEqual(new Set(["left", "right"]));
    expect(s.boards[0]!.base).not.toBe(s.boards[1]!.base);
    answer(e, s);
    const next = e.advance();
    expect(next.levelCompleted).toBe(2);
    expect(next.stage).toMatchObject({ level: 3, stage: 1 });
  });

  it("shrinks ΔE by 5% per stage cleared and never below the floor", () => {
    const e = engine({ difficulty: 1 });
    expect(e.deltaE(1)).toBeCloseTo(30);
    expect(e.deltaE(2)).toBeCloseTo(28.5);
    expect(e.deltaE(500)).toBe(DELTA_E_FLOOR);
  });

  it("finishes after the last level and reports it", () => {
    const e = engine({ startLevel: 8, maxLevel: 9 });
    let s: Stage | null = e.start();
    let finished = false;
    let guard = 0;
    while (s && !finished && guard++ < 100) {
      expect(answer(e, s).kind).toBe("correct");
      const n = e.advance();
      finished = n.finished;
      s = n.stage;
    }
    expect(finished).toBe(true);
    expect(e.levelsCompleted).toBe(2);
    expect(e.stagesCleared).toBe(8 + 9);
    expect(e.highestLevel).toBe(9);
  });

  it("a wrong board fails the stage; the retry keeps the level and stage", () => {
    const e = engine();
    const s = e.start();
    expect(answer(e, s, false).kind).toBe("wrong");
    const r = e.retry();
    expect(r).toMatchObject({ level: 2, stage: 1, deltaE: s.deltaE });
    expect(e.lastFailedDeltaE).toBeCloseTo(s.deltaE);
  });

  it("in timed mode a wrong answer makes the next stage one step easier", () => {
    const e = engine({ staircase: true });
    let s = e.start();
    answer(e, s);
    s = e.advance().stage!; // step 2
    answer(e, s, false);
    expect(e.retry().deltaE).toBeCloseTo(e.deltaE(1));
  });

  it("ignores a second tap on a board that already has an answer", () => {
    const e = engine();
    let s = e.start();
    answer(e, s);
    s = e.advance().stage!;
    const first = s.boards[0]!;
    expect(e.pick(first.role, 0, 500)?.kind).toBe("pending");
    expect(e.pick(first.role, 1, 600)).toBeNull();
  });

  it("practice is unscored", () => {
    const e = engine();
    const p = e.practiceStage();
    expect(p).toMatchObject({ practice: true, deltaE: 40, level: 2 });
    answer(e, p);
    expect(e.stagesPlayed).toBe(0);
    expect(e.score).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const a = engine({ rng: seeded(99) }).start();
    const b = engine({ rng: seeded(99) }).start();
    expect(a).toEqual(b);
  });
});

describe("metrics", () => {
  it("reports threshold, anchor-first rate, quadrants and streaks", () => {
    const e = engine();
    let s = e.start();
    answer(e, s);
    s = e.advance().stage!;
    // Dual stage: answer the anchor first, correctly.
    const [anchor, comp] = s.boards;
    e.pick(anchor!.role, anchor!.oddIndex, 800);
    e.pick(comp!.role, comp!.oddIndex, 1200);
    s = e.advance().stage!;
    answer(e, s, false);
    const m = e.metrics();
    expect(m.stage_count).toBe(3);
    expect(m.best_streak).toBe(2);
    expect(m.anchor_first_rate).toBe(1);
    expect(m.final_jnd).toBeCloseTo(s.deltaE, 1);
    expect(Object.keys(m.quadrant_accuracy as object)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("finds quadrants like v1", () => {
    expect([0, 1, 2, 3].map((i) => quadrantOf(i, 2))).toEqual([1, 2, 3, 4]);
    expect(quadrantOf(4, 3)).toBe(1); // centre tile of 3×3 counts as top-left, as in v1
    expect(quadrantOf(8, 3)).toBe(4);
  });
});
