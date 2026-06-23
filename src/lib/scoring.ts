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

// Below this the recording is treated as blank / not a real session.
export const BLANK_BYTES_THRESHOLD = 8 * 1024;
// A usable recording should be at least this long to be a meaningful example.
export const MIN_DURATION_MS = 3000;
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

/** Deterministically pick a subset of a task's action vocabulary for a recording. */
export function pickActions(contentHash: string, taskType: string): string[] {
  const pool = TASK_ACTIONS[resolveTask(taskType)];
  const chosen = pool.filter((_, i) => det(contentHash, "act" + i) > 0.35);
  return chosen.length >= 2 ? chosen : pool.slice(0, 3);
}

export type ScoreInput = {
  contentHash: string; // sha256 of the recording bytes
  sizeBytes: number;
  taskType: string;
  actions: string[];
  durationMs: number; // recording length
};

/**
 * AI pre-screen score = uniqueness + task relevance + visual quality + duration.
 * A signal that helps reviewers and filters obvious junk; humans decide approval.
 */
export function scoreProofOfPlay(
  input: ScoreInput,
  isDuplicate: boolean,
  isBlank: boolean
): ProofOfPlay {
  if (isBlank || isDuplicate) {
    return {
      total: isBlank ? 3 : 8,
      breakdown: {
        uniqueness: isDuplicate ? 0 : 2,
        taskRelevance: 0,
        visualQuality: isBlank ? 0 : 5,
        duration: 0,
      },
    };
  }

  // Uniqueness (0..25): novel recording.
  const uniqueness = clamp(18 + det(input.contentHash, "uniq") * 7, 0, 25);

  // Task relevance (0..30): how many actions match the task vocabulary.
  const wanted = TASK_ACTIONS[resolveTask(input.taskType)];
  const overlap = input.actions.filter((a) => wanted.includes(a)).length;
  const taskRelevance = clamp((overlap / Math.max(1, wanted.length)) * 30, 0, 30);

  // Visual quality (0..25): proxy from resolution/bitrate ≈ file size, capped.
  const sizeMB = input.sizeBytes / (1024 * 1024);
  const visualQuality = clamp(8 + Math.log2(1 + sizeMB) * 4, 0, 25);

  // Duration (0..20): enough footage to be a usable example, with diminishing
  // returns past ~1 minute.
  const seconds = input.durationMs / 1000;
  const duration = clamp(Math.log2(1 + seconds) * 4, 0, 20);

  const total = Math.round(uniqueness + taskRelevance + visualQuality + duration);
  return {
    total: clamp(total, 0, 100),
    breakdown: {
      uniqueness: Math.round(uniqueness),
      taskRelevance: Math.round(taskRelevance),
      visualQuality: Math.round(visualQuality),
      duration: Math.round(duration),
    },
  };
}

export function trainingValue(score: number): TraceLabels["training_value"] {
  return score >= 80 ? "high" : score >= PRESCREEN_THRESHOLD ? "medium" : "low";
}

/** Pull the scoring-relevant signals out of a recording manifest (if present). */
export function signalsFromManifest(m?: TraceManifest) {
  return { durationMs: m?.durationMs ?? 0 };
}
