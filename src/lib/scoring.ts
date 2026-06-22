// ────────────────────────────────────────────────────────────────────────────
// AI pre-screen scoring core — pure, framework-agnostic, directly unit-testable.
//
// Scores a recorded computer-use TRACE BUNDLE (screen video + synced input
// events). This is the 0G Compute pre-screen — a signal that helps reviewers and
// filters obvious junk. Final approval is decided by on-chain human review.
//
// No Next.js / server-only coupling, so it's exercised in isolation by tests and
// reused by both the mock and live 0G Compute providers.
// ────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type { TraceLabels, ProofOfPlay, TraceManifest } from "./types";

// Canonical action vocabulary per computer-use task type. Games are one category.
export const TASK_ACTIONS: Record<string, string[]> = {
  web_form: ["focus_field", "type", "tab_next", "select_option", "click_submit", "validate"],
  spreadsheet: ["select_cell", "type_value", "copy", "paste", "apply_formula", "navigate"],
  web_research: ["open_tab", "search", "click_link", "scroll_read", "copy_text", "switch_tab"],
  email_triage: ["open_email", "label", "archive", "reply", "delete", "mark_read"],
  file_management: ["open_folder", "rename", "move", "drag_drop", "delete", "create"],
  game_fps: ["aim", "flick", "track", "recoil_control", "fire", "reposition"],
  game_parkour: ["jump", "sprint", "fall", "recovery", "retry", "climb"],
  default: ["click", "type", "scroll", "navigate", "select"],
};

export const TASK_LABELS: Record<string, string> = {
  web_form: "Web form completion",
  spreadsheet: "Spreadsheet editing",
  web_research: "Multi-tab web research",
  email_triage: "Email inbox triage",
  file_management: "File management",
  game_fps: "FPS aiming",
  game_parkour: "Platformer parkour",
  default: "General computer-use task",
};

// Below this the bundle is treated as blank / not a real session.
export const BLANK_BYTES_THRESHOLD = 8 * 1024;
// A usable trace needs at least this many input events to carry signal.
export const MIN_TRACE_EVENTS = 10;
// AI pre-screen pass bar (a signal — humans decide final approval).
export const PRESCREEN_THRESHOLD = 50;

export function sha256(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

/** Deterministic 0..1 pseudo-value from a hash + salt (no Math.random). */
export function det(hash: string, salt: string): number {
  const h = crypto.createHash("sha256").update(hash + salt).digest();
  const u = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  return u / 0xffffffff;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function resolveTask(taskType: string): string {
  return TASK_ACTIONS[taskType] ? taskType : "default";
}

/** Deterministically pick a subset of a task's action vocabulary for a bundle. */
export function pickActions(contentHash: string, taskType: string): string[] {
  const pool = TASK_ACTIONS[resolveTask(taskType)];
  const chosen = pool.filter((_, i) => det(contentHash, "act" + i) > 0.35);
  return chosen.length >= 2 ? chosen : pool.slice(0, 3);
}

export type ScoreInput = {
  contentHash: string; // sha256 of the bundle bytes
  sizeBytes: number;
  taskType: string;
  actions: string[];
  // Trace signal — from the manifest. Absent for video-only uploads.
  eventCount: number;
  keystrokes: number;
  pointerMoves: number;
  clicks: number;
  hasVideo: boolean;
};

/**
 * AI pre-screen score = uniqueness + task relevance + input richness + completeness.
 * Input richness and completeness reward bundles that actually contain the synced
 * human inputs that make a recording useful for training computer-use agents.
 */
export function scoreProofOfPlay(
  input: ScoreInput,
  isDuplicate: boolean,
  isBlank: boolean
): ProofOfPlay {
  const hasTrace = input.eventCount >= MIN_TRACE_EVENTS;

  if (isBlank || isDuplicate) {
    return {
      total: isBlank ? 3 : 8,
      breakdown: {
        uniqueness: isDuplicate ? 0 : 2,
        taskRelevance: 0,
        inputRichness: 0,
        completeness: 0,
      },
    };
  }

  // Uniqueness (0..25): novel session.
  const uniqueness = clamp(18 + det(input.contentHash, "uniq") * 7, 0, 25);

  // Task relevance (0..30): how many actions match the task vocabulary.
  const wanted = TASK_ACTIONS[resolveTask(input.taskType)];
  const overlap = input.actions.filter((a) => wanted.includes(a)).length;
  const taskRelevance = clamp((overlap / Math.max(1, wanted.length)) * 30, 0, 30);

  // Input richness (0..25): density of human input — the key training signal.
  // Keystrokes + meaningful pointer activity. Video-only bundles score ~0 here.
  const inputUnits = input.keystrokes + input.clicks * 2 + Math.min(input.pointerMoves, 200) * 0.05;
  const inputRichness = clamp(Math.log2(1 + inputUnits) * 4.5, 0, 25);

  // Completeness (0..20): full marks only when BOTH a video and a real input
  // trace are present. Video-only or trace-only is penalized.
  let completeness = 0;
  if (input.hasVideo) completeness += 8;
  if (hasTrace) completeness += 12;

  const total = Math.round(uniqueness + taskRelevance + inputRichness + completeness);
  return {
    total: clamp(total, 0, 100),
    breakdown: {
      uniqueness: Math.round(uniqueness),
      taskRelevance: Math.round(taskRelevance),
      inputRichness: Math.round(inputRichness),
      completeness: Math.round(completeness),
    },
  };
}

export function trainingValue(score: number): TraceLabels["training_value"] {
  return score >= 80 ? "high" : score >= PRESCREEN_THRESHOLD ? "medium" : "low";
}

/** Pull the scoring-relevant signals out of a trace manifest (if present). */
export function signalsFromManifest(m?: TraceManifest) {
  if (!m) return { eventCount: 0, keystrokes: 0, pointerMoves: 0, clicks: 0, hasVideo: true };
  return {
    eventCount: m.events.count,
    keystrokes: m.events.keystrokes,
    pointerMoves: m.events.pointerMoves,
    clicks: m.events.clicks,
    hasVideo: (m.video?.sizeBytes ?? 0) > 0,
  };
}
