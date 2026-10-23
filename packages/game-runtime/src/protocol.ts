/**
 * Messages between the host app and the game frame (design doc §8.3). The
 * frame has an opaque origin, so the host checks event.source instead of the
 * origin, and both sides check message shapes before acting on them.
 */
import type { EndReason, LevelHistoryRow, PlatformParams, SessionMode, SessionStatus, TrialEvent } from "@emb/game-sdk";

export type LaunchParams = PlatformParams & Record<string, unknown>;

export type HostToFrame =
  | { type: "launch"; sessionId: string; params: LaunchParams; demo: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "quit"; by: "therapist" };

export type FrameToHost =
  | { type: "ready"; gameId: string; version: string }
  | { type: "heartbeat"; activeMs: number; phase: string }
  | { type: "started" }
  | { type: "ended"; envelope: ResultEnvelope }
  | { type: "closed" }
  | { type: "error"; message: string };

export interface StdMetrics {
  trials_total: number;
  correct: number;
  errors: number;
  timeouts: number;
  accuracy: number | null;
  rt_mean_ms: number | null;
  rt_median_ms: number | null;
  rt_sd_ms: number | null;
  rt_min_ms: number | null;
  rt_cv: number | null;
  left_accuracy: number | null;
  right_accuracy: number | null;
  left_rt_median_ms: number | null;
  right_rt_median_ms: number | null;
}

/** Everything a finished session reports (design doc §9.8). session_id is the idempotency key. */
export interface ResultEnvelope {
  envelope_version: "1";
  session_id: string;
  game_id: string;
  game_version: string;
  demo: boolean;
  started_at: string | null;
  ended_at: string;
  status: SessionStatus;
  end_reason: EndReason;
  mode: SessionMode;
  params: LaunchParams;
  active_ms: number;
  paused_ms: number;
  lives_start: number | null;
  lives_lost: number;
  lives_remaining: number | null;
  life_loss_events: number;
  difficulty_start: number;
  levels: LevelHistoryRow[];
  std: StdMetrics;
  metrics: Record<string, unknown>;
  trials: TrialEvent[];
  practice_completed: boolean;
}

const TYPES = new Set(["ready", "heartbeat", "started", "ended", "closed", "error"]);

/** Host-side shape check for messages coming out of the frame. */
export function isFrameMessage(data: unknown): data is FrameToHost {
  return typeof data === "object" && data !== null && TYPES.has((data as { type?: unknown }).type as string);
}

export function isHostMessage(data: unknown): data is HostToFrame {
  const t = (data as { type?: unknown } | null)?.type;
  return t === "launch" || t === "pause" || t === "resume" || t === "quit";
}
