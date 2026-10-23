/**
 * Rule-based difficulty progression (design doc §5.4–5.5): "If accuracy is
 * at least 80% for 2 sessions in a row → difficulty +1; below 50% for 1
 * session → −1". Pure and deterministic; the API logs every decision.
 *
 * Only valid sessions count (not abandoned, not marked invalid), and only
 * sessions played at the current difficulty: after a change, the streak
 * starts again, so a harder level is judged on its own.
 */
export interface Rule {
  metric: "accuracy";
  up_at: number;
  up_after: number;
  down_below: number;
  down_after: number;
}

export interface SessionPoint {
  /** 0–1, or null when the session had no scored trials. */
  accuracy: number | null;
  difficulty: number;
  valid: boolean;
}

export interface Decision {
  action: "up" | "down" | "hold";
  from: number;
  to: number;
  /** The accuracies that decided it, newest first. */
  used: number[];
  reason: "streak_up" | "streak_down" | "at_ceiling" | "at_floor" | "not_enough_sessions" | "no_rule" | "mixed";
}

export const FLOOR = 1;
export const CEILING = 5;

/** `history` is oldest first and includes the session just played. */
export function decide(rule: Rule | null, history: SessionPoint[], current: number): Decision {
  const hold = (reason: Decision["reason"], used: number[] = []): Decision => ({ action: "hold", from: current, to: current, used, reason });
  if (!rule) return hold("no_rule");
  const atLevel: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i]!;
    if (s.difficulty !== current) break; // streaks restart after a difficulty change
    if (!s.valid || s.accuracy === null) continue;
    atLevel.push(s.accuracy);
  }
  const lastUp = atLevel.slice(0, rule.up_after);
  const lastDown = atLevel.slice(0, rule.down_after);
  if (lastUp.length === rule.up_after && lastUp.every((a) => a >= rule.up_at)) {
    return current >= CEILING ? hold("at_ceiling", lastUp) : { action: "up", from: current, to: current + 1, used: lastUp, reason: "streak_up" };
  }
  if (lastDown.length === rule.down_after && lastDown.every((a) => a < rule.down_below)) {
    return current <= FLOOR ? hold("at_floor", lastDown) : { action: "down", from: current, to: current - 1, used: lastDown, reason: "streak_down" };
  }
  const need = Math.max(rule.up_after, rule.down_after);
  return hold(atLevel.length < need ? "not_enough_sessions" : "mixed", atLevel.slice(0, need));
}
