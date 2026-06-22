// ────────────────────────────────────────────────────────────────────────────
// Proof-of-Play scoring core — pure, framework-agnostic, directly unit-testable.
//
// This module holds the gameplay-clip vocabulary and the deterministic scoring
// math used by the 0G Compute labeling layer. It deliberately has NO Next.js /
// server-only coupling so it can be exercised in isolation by the test suite and
// reused by both the mock and live 0G Compute providers.
// ────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type { ClipLabels, ProofOfPlay } from "./types";

// Canonical action vocabulary, grouped by the bounty label it answers.
export const LABEL_ACTIONS: Record<string, string[]> = {
  parkour: ["jump", "sprint", "fall", "recovery", "retry", "climb"],
  aim_correction: ["aim", "flick", "track", "recoil_control", "headshot", "reposition"],
  racing: ["accelerate", "brake", "drift", "overtake", "corner", "racing_line"],
  dialogue: ["dialogue", "choice", "branch", "npc_interact", "quest_accept"],
  boss_fail: ["attack", "dodge", "block", "death", "retry", "phase_transition"],
  default: ["move", "interact", "combat", "navigate", "menu"],
};

export const GAME_BY_LABEL: Record<string, string> = {
  parkour: "Minecraft-style parkour",
  aim_correction: "FPS shooter",
  racing: "Arcade racing",
  dialogue: "Open-world RPG",
  boss_fail: "Action RPG boss arena",
  default: "Unknown gameplay",
};

// Clips smaller than this are treated as blank / not-real-gameplay.
export const BLANK_BYTES_THRESHOLD = 8 * 1024;
// Approval bar on the Proof-of-Play score.
export const APPROVAL_THRESHOLD = 55;

export function sha256(b: Buffer): string {
  return crypto.createHash("sha256").update(b).digest("hex");
}

/** Deterministic 0..1 pseudo-value from a hash + salt (no Math.random). */
export function det(hash: string, salt: string): number {
  const h = crypto.createHash("sha256").update(hash + salt).digest();
  // first 4 bytes → unsigned 32-bit → [0,1)
  const u = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  return u / 0xffffffff;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Resolve a (possibly unknown) bounty label to a known vocabulary key. */
export function resolveLabel(requiredLabel: string): string {
  return LABEL_ACTIONS[requiredLabel] ? requiredLabel : "default";
}

/** Deterministically pick a subset of a label's action vocabulary for a clip. */
export function pickActions(contentHash: string, requiredLabel: string): string[] {
  const pool = LABEL_ACTIONS[resolveLabel(requiredLabel)];
  const chosen = pool.filter((_, i) => det(contentHash, "act" + i) > 0.35);
  return chosen.length >= 2 ? chosen : pool.slice(0, 3);
}

export type ScoreInput = {
  contentHash: string; // sha256 of the clip bytes
  sizeBytes: number;
  requiredLabel: string;
  actions: string[];
};

/**
 * Turn labels + content signals into a Proof-of-Play score.
 * Proof-of-Play = uniqueness + task relevance + gameplay quality + action density.
 */
export function scoreProofOfPlay(
  input: ScoreInput,
  isDuplicate: boolean,
  isBlank: boolean
): ProofOfPlay {
  // A blank/duplicate clip carries no training signal — collapse the score so
  // the headline number and the breakdown both tell the truth.
  if (isBlank || isDuplicate) {
    return {
      total: isBlank ? 3 : 8,
      breakdown: {
        uniqueness: isDuplicate ? 0 : 2,
        taskRelevance: 0,
        gameplayQuality: isBlank ? 0 : 5,
        actionDensity: 0,
      },
    };
  }

  // Uniqueness (0..25): full marks for novel footage.
  const uniqueness = clamp(18 + det(input.contentHash, "uniq") * 7, 0, 25);

  // Task relevance (0..30): how many actions match the bounty label's vocabulary.
  const wanted = LABEL_ACTIONS[resolveLabel(input.requiredLabel)];
  const overlap = input.actions.filter((a) => wanted.includes(a)).length;
  const taskRelevance = clamp((overlap / Math.max(1, wanted.length)) * 30, 0, 30);

  // Gameplay quality (0..25): proxy from resolution/bitrate ≈ file size, capped.
  const sizeMB = input.sizeBytes / (1024 * 1024);
  const qualityFromSize = clamp(8 + Math.log2(1 + sizeMB) * 4, 0, 25);

  // Action density (0..20): more distinct human actions = richer training signal.
  const actionDensity = clamp(input.actions.length * 3.2, 0, 20);

  const total = Math.round(uniqueness + taskRelevance + qualityFromSize + actionDensity);
  return {
    total: clamp(total, 0, 100),
    breakdown: {
      uniqueness: Math.round(uniqueness),
      taskRelevance: Math.round(taskRelevance),
      gameplayQuality: Math.round(qualityFromSize),
      actionDensity: Math.round(actionDensity),
    },
  };
}

export function trainingValue(score: number): ClipLabels["training_value"] {
  return score >= 80 ? "high" : score >= APPROVAL_THRESHOLD ? "medium" : "low";
}
