import { describe, expect, it } from "vitest";
import { decide, type Rule, type SessionPoint } from "../src/index.ts";

const rule: Rule = { metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 };
const s = (accuracy: number | null, difficulty = 3, valid = true): SessionPoint => ({ accuracy, difficulty, valid });

describe("progression", () => {
  it("goes up after the required streak at or above the threshold", () => {
    expect(decide(rule, [s(0.85)], 3)).toMatchObject({ action: "hold", reason: "not_enough_sessions" });
    expect(decide(rule, [s(0.85), s(0.8)], 3)).toMatchObject({ action: "up", from: 3, to: 4, used: [0.8, 0.85] });
    expect(decide(rule, [s(0.9), s(0.7), s(0.95)], 3)).toMatchObject({ action: "hold", reason: "mixed" });
  });

  it("goes down after the required streak below the lower threshold", () => {
    expect(decide(rule, [s(0.9), s(0.4)], 3)).toMatchObject({ action: "down", to: 2, reason: "streak_down" });
    expect(decide({ ...rule, down_after: 2 }, [s(0.4), s(0.45)], 3)).toMatchObject({ action: "down", to: 2 });
  });

  it("restarts the streak after a difficulty change, so a harder level is judged on its own", () => {
    expect(decide(rule, [s(0.9, 3), s(0.95, 3), s(0.85, 4)], 4)).toMatchObject({ action: "hold", reason: "not_enough_sessions" });
  });

  it("ignores abandoned or invalid sessions and sessions without scored trials", () => {
    expect(decide(rule, [s(0.9), s(0.2, 3, false), s(null), s(0.85)], 3)).toMatchObject({ action: "up", used: [0.85, 0.9] });
  });

  it("stays inside 1–5", () => {
    expect(decide(rule, [s(1, 5), s(1, 5)], 5)).toMatchObject({ action: "hold", reason: "at_ceiling" });
    expect(decide(rule, [s(0.1, 1)], 1)).toMatchObject({ action: "hold", reason: "at_floor" });
  });

  it("does nothing without a rule", () => {
    expect(decide(null, [s(1), s(1)], 3)).toMatchObject({ action: "hold", reason: "no_rule" });
  });
});
