import { describe, it, expect } from "vitest";
import {
  PRESCREEN_THRESHOLD,
  MIN_TRACE_EVENTS,
  TASK_ACTIONS,
  TASK_LABELS,
  clamp,
  det,
  pickActions,
  resolveTask,
  scoreProofOfPlay,
  sha256,
  trainingValue,
  signalsFromManifest,
  type ScoreInput,
} from "@/lib/scoring";
import type { TraceManifest } from "@/lib/types";

function bytesOf(seed: number, size = 512 * 1024): Buffer {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + seed * 17) & 0xff;
  return b;
}

// A strong trace bundle: novel, on-task actions, rich synced input, has video.
const strong = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  contentHash: sha256(bytesOf(1)),
  sizeBytes: 512 * 1024,
  taskType: "web_form",
  actions: ["focus_field", "type", "tab_next", "click_submit"],
  eventCount: 120,
  keystrokes: 80,
  pointerMoves: 60,
  clicks: 8,
  hasVideo: true,
  ...over,
});

describe("det() — deterministic pseudo-random", () => {
  it("is bounded in [0,1) and stable", () => {
    for (let i = 0; i < 200; i++) {
      const v = det(sha256(bytesOf(i)), "s" + i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const h = sha256(bytesOf(42));
    expect(det(h, "uniq")).toBe(det(h, "uniq"));
  });
  it("spreads across the range (regression for the >>> precedence bug)", () => {
    const s = Array.from({ length: 500 }, (_, i) => det(sha256(bytesOf(i)), "s"));
    expect(Math.max(...s)).toBeLessThan(1);
    const mean = s.reduce((a, v) => a + v, 0) / s.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
  });
});

describe("clamp / resolveTask / pickActions", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it("resolves known + unknown task types", () => {
    expect(resolveTask("spreadsheet")).toBe("spreadsheet");
    expect(resolveTask("nonsense")).toBe("default");
  });
  it("picks only on-task actions, >=2, deterministic, varied across bundles", () => {
    const h = sha256(bytesOf(3));
    for (const a of pickActions(h, "web_research")) expect(TASK_ACTIONS.web_research).toContain(a);
    expect(pickActions(h, "web_form").length).toBeGreaterThanOrEqual(2);
    expect(pickActions(h, "web_form")).toEqual(pickActions(h, "web_form"));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickActions(sha256(bytesOf(i)), "web_form").join(","));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("scoreProofOfPlay — trace bundle scoring", () => {
  it("scores a strong bundle above the pre-screen bar", () => {
    const p = scoreProofOfPlay(strong(), false, false);
    expect(p.total).toBeGreaterThanOrEqual(PRESCREEN_THRESHOLD);
    expect(p.total).toBeLessThanOrEqual(100);
  });

  it("keeps every breakdown component within its max", () => {
    const p = scoreProofOfPlay(strong(), false, false);
    expect(p.breakdown.uniqueness).toBeLessThanOrEqual(25);
    expect(p.breakdown.taskRelevance).toBeLessThanOrEqual(30);
    expect(p.breakdown.inputRichness).toBeLessThanOrEqual(25);
    expect(p.breakdown.completeness).toBeLessThanOrEqual(20);
    Object.values(p.breakdown).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  it("rewards rich input traces over sparse ones (the key signal)", () => {
    const rich = scoreProofOfPlay(strong({ keystrokes: 200, clicks: 20 }), false, false);
    const sparse = scoreProofOfPlay(strong({ keystrokes: 2, clicks: 1, pointerMoves: 2 }), false, false);
    expect(rich.breakdown.inputRichness).toBeGreaterThan(sparse.breakdown.inputRichness);
  });

  it("penalizes video-only bundles (no synced input trace) on completeness", () => {
    const full = scoreProofOfPlay(strong(), false, false);
    const videoOnly = scoreProofOfPlay(
      strong({ eventCount: 0, keystrokes: 0, pointerMoves: 0, clicks: 0 }),
      false,
      false
    );
    // completeness: full gets video(8)+trace(12)=20; video-only gets just video(8)
    expect(full.breakdown.completeness).toBeGreaterThan(videoOnly.breakdown.completeness);
    expect(videoOnly.breakdown.completeness).toBeLessThanOrEqual(8);
  });

  it("rewards on-task actions over off-task ones", () => {
    const on = scoreProofOfPlay(strong({ actions: ["focus_field", "type", "tab_next", "click_submit"] }), false, false);
    const off = scoreProofOfPlay(strong({ actions: ["aim", "flick", "fire"] }), false, false);
    expect(on.breakdown.taskRelevance).toBeGreaterThan(off.breakdown.taskRelevance);
  });

  it("collapses duplicate and blank bundles", () => {
    const dup = scoreProofOfPlay(strong(), true, false);
    expect(dup.total).toBeLessThan(PRESCREEN_THRESHOLD);
    expect(dup.breakdown.uniqueness).toBe(0);
    const blank = scoreProofOfPlay(strong({ sizeBytes: 1024 }), false, true);
    expect(blank.total).toBeLessThan(PRESCREEN_THRESHOLD);
    expect(blank.breakdown.completeness).toBe(0);
  });

  it("is deterministic and varied across bundles", () => {
    expect(scoreProofOfPlay(strong(), false, false)).toEqual(scoreProofOfPlay(strong(), false, false));
    const scores = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const h = sha256(bytesOf(i));
      scores.add(scoreProofOfPlay(strong({ contentHash: h, actions: pickActions(h, "web_form") }), false, false).total);
    }
    expect(scores.size).toBeGreaterThan(3);
  });
});

describe("signalsFromManifest", () => {
  it("returns video-only defaults when no manifest", () => {
    const s = signalsFromManifest(undefined);
    expect(s.eventCount).toBe(0);
    expect(s.hasVideo).toBe(true);
  });
  it("extracts signals from a manifest", () => {
    const m: TraceManifest = {
      version: "playproof-trace/1",
      taskType: "web_form",
      durationMs: 12000,
      startedAt: 0,
      screen: { width: 1280, height: 720 },
      video: { mimeType: "video/webm", sizeBytes: 500000 },
      events: { count: 50, byType: {}, keystrokes: 30, pointerMoves: 15, clicks: 5 },
    };
    const s = signalsFromManifest(m);
    expect(s.eventCount).toBe(50);
    expect(s.keystrokes).toBe(30);
    expect(s.clicks).toBe(5);
    expect(s.hasVideo).toBe(true);
  });
});

describe("trainingValue + thresholds + vocab integrity", () => {
  it("maps score bands", () => {
    expect(trainingValue(95)).toBe("high");
    expect(trainingValue(60)).toBe("medium");
    expect(trainingValue(40)).toBe("low");
  });
  it("every task type has a label and a non-empty action pool", () => {
    for (const k of Object.keys(TASK_ACTIONS)) {
      expect(TASK_LABELS[k], `label for ${k}`).toBeTruthy();
      expect(TASK_ACTIONS[k].length).toBeGreaterThan(0);
    }
  });
  it("MIN_TRACE_EVENTS and PRESCREEN_THRESHOLD are sane", () => {
    expect(MIN_TRACE_EVENTS).toBeGreaterThan(0);
    expect(PRESCREEN_THRESHOLD).toBeGreaterThan(0);
    expect(PRESCREEN_THRESHOLD).toBeLessThanOrEqual(100);
  });
});
