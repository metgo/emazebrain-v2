/** Standard metrics every game reports (design doc §8.3), computed from trial events. Pure. */
import type { TrialEvent } from "@emb/game-sdk";
import type { StdMetrics } from "./protocol.ts";

const r2 = (n: number) => Math.round(n * 10000) / 10000;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function stdMetrics(trials: TrialEvent[]): StdMetrics {
  const answered = trials.filter((t) => t.outcome === "correct" || t.outcome === "error" || t.outcome === "commission");
  const correct = trials.filter((t) => t.outcome === "correct").length;
  const errors = trials.filter((t) => t.outcome === "error" || t.outcome === "commission").length;
  const timeouts = trials.filter((t) => t.outcome === "timeout" || t.outcome === "omission").length;
  const rts = trials.filter((t) => t.outcome === "correct" && typeof t.responseMs === "number").map((t) => t.responseMs!);
  const mean = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
  const sd = mean !== null && rts.length > 1 ? Math.sqrt(rts.reduce((a, b) => a + (b - mean) ** 2, 0) / (rts.length - 1)) : null;
  const side = (h: "L" | "R") => {
    const xs = answered.filter((t) => t.target?.hemifield === h);
    return {
      acc: xs.length ? r2(xs.filter((t) => t.outcome === "correct").length / xs.length) : null,
      rt: median(xs.filter((t) => t.outcome === "correct" && t.responseMs !== null).map((t) => t.responseMs!)),
    };
  };
  const L = side("L");
  const R = side("R");
  const total = correct + errors + timeouts;
  return {
    trials_total: total,
    correct,
    errors,
    timeouts,
    accuracy: total ? r2(correct / total) : null,
    rt_mean_ms: mean !== null ? Math.round(mean) : null,
    rt_median_ms: median(rts),
    rt_sd_ms: sd !== null ? Math.round(sd) : null,
    rt_min_ms: rts.length ? Math.min(...rts) : null,
    rt_cv: mean && sd !== null ? r2(sd / mean) : null,
    left_accuracy: L.acc,
    right_accuracy: R.acc,
    left_rt_median_ms: L.rt,
    right_rt_median_ms: R.rt,
  };
}

/** Child summary: 1–3 stars from accuracy (60 / 75 / 90 %). Effort always earns at least one. */
export function stars(accuracy: number | null): 1 | 2 | 3 {
  if (accuracy === null) return 1;
  return accuracy >= 0.9 ? 3 : accuracy >= 0.75 ? 2 : 1;
}
