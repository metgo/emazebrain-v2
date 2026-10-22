/**
 * @emb/game-sdk — the public contract between a game and the eMazeBrain host
 * (design doc §8.3). Games import ONLY this package. Types only; no runtime.
 */
import type { EndReason, SessionMode, SessionStatus } from "@emb/session-rules";

export type { EndReason, SessionMode, SessionStatus };

export type Palette = "warm" | "cold";
export type Locale = "he" | "en" | "ar" | "ru" | "fr" | "es" | "zh";

export interface GameManifest {
  id: string;
  name: Partial<Record<Locale, string>> & { en: string };
  version: string; // semver
  sdkVersion: string; // semver range, e.g. "^2.0.0"
  entry: string;
  renderer: "pixi" | "three" | "canvas2d";
  orientation: Array<"landscape" | "portrait">;
  inputs: Array<"touch" | "mouse" | "keyboard">;
  maxLevel: number;
  capabilities: {
    modes: SessionMode[];
    livesAuto: boolean;
    trialWindow: false | { minMs: number; maxMs: number; defaultMs: number | null };
    practice: boolean;
    rng: "seeded";
  };
  recommendedMode?: SessionMode;
  recommendedDurationS?: number;
  lifeLossEvents: Array<{ id: string; label: Partial<Record<Locale, string>> & { en: string } }>;
  qualifyingInteraction: string;
  paramsSchema: string;
  metrics: string;
  assetPacks: Record<Palette | "shared", string>;
  taxonomy: { skills: string[]; regions: string[] };
  sizeBytes: { core: number; warm: number; cold: number };
}

/** Platform parameters every game receives (design doc §8.2). Native params are namespaced. */
export interface PlatformParams {
  session_mode: SessionMode;
  duration_s?: number;
  lives?: number | "auto";
  difficulty: 1 | 2 | 3 | 4 | 5;
  start_level: number | "from_difficulty";
  max_level?: number;
  hemisphere: "left" | "right";
  timer_position: "left" | "right" | "hidden";
  trial_window_ms?: number | null;
  practice: "auto" | "on" | "off";
  instructions: "auto" | "always" | "short";
  scene?: string;
  lang: Locale;
  sound: "off" | "effects" | "all";
  reduce_motion: "os" | "on" | "off";
  high_contrast: boolean;
  show_score: boolean;
  context: "clinic" | "home";
  seed: number;
  input_assist: "none" | "large_hit" | "dwell_800ms" | "switch_scan";
  speed_scale: number; // 0.5–1.0
}

export type TrialOutcome = "correct" | "error" | "timeout" | "omission" | "commission";

export interface TrialEvent {
  trialId: string;
  level: number;
  stimulusOnMs: number;
  responseMs: number | null;
  outcome: TrialOutcome;
  target?: { x: number; y: number; hemifield: "L" | "R" | "C" };
  tags?: Record<string, string | number>;
}

export interface LevelHistoryRow {
  level: number;
  durationMs: number;
  scoreDelta: number;
  trials: number;
  correct: number;
  errors: number;
  livesLost: number;
  outcome: "cleared" | "failed" | "timeout";
  detail?: Record<string, unknown>;
}

/** Provided by the host. The game reports; Session Rules decides. */
export interface SessionApi {
  qualifyingInteraction(): void;
  trial(t: TrialEvent): void;
  lifeLossEvent(id: string, data?: Record<string, unknown>): void;
  levelComplete(row: LevelHistoryRow): void;
  contentExhausted(reason?: "content_exhausted" | "max_level" | "trial_cap"): void;
  log(type: string, data?: Record<string, unknown>): void;
  onLifeLost(cb: (remaining: number | null) => void): void;
  onTrialWindow(cb: (msLeft: number) => void): void;
  onEnd(cb: (status: SessionStatus) => void): void;
  readonly state: { activeMs: number; livesRemaining: number | null; mode: SessionMode; paused: boolean };
}

export interface AssetPack {
  id: string;
  version: string;
  palette: Palette;
  get(path: string): ArrayBuffer;
  tokens: Record<string, string>;
}

export interface InitContext {
  params: PlatformParams & Record<string, unknown>;
  assets: AssetPack;
  rng: () => number;
  i18n: (key: string) => string;
  session: SessionApi;
}

export type PauseReason = "app_hidden" | "manual" | "instructions" | "therapist_hold" | "focus_lost";

export interface GameModule {
  init(ctx: InitContext): Promise<void>;
  showInstructions?(): { demoAssetId: string; textKey: string };
  startPractice?(): Promise<{ trials: number }>;
  start(): void;
  pause(reason: PauseReason): void;
  resume(): void;
  end(status: SessionStatus, reason: EndReason): Record<string, number | string | object>;
  destroy(): void;
}

export type CreateGame = () => GameModule;
