import { describe, it, expect } from "vitest";
import {
  APPROVAL_THRESHOLD,
  BLANK_BYTES_THRESHOLD,
  GAME_BY_LABEL,
  LABEL_ACTIONS,
  clamp,
  det,
  pickActions,
  resolveLabel,
  scoreProofOfPlay,
  sha256,
  trainingValue,
  type ScoreInput,
} from "@/lib/scoring";

// A realistic 0.5 MB "clip" of deterministic bytes.
function clipOf(seed: number, size = 512 * 1024): Buffer {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + seed * 17) & 0xff;
  return b;
}

// A strong clip: novel footage, several on-label actions, a decent file size —
// representative of what actually clears the approval bar in the demo.
const baseInput = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  contentHash: sha256(clipOf(1)),
  sizeBytes: 512 * 1024,
  requiredLabel: "parkour",
  actions: ["jump", "sprint", "fall", "recovery"],
  ...over,
});

describe("det() — deterministic pseudo-random", () => {
  it("is bounded in [0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const v = det(sha256(clipOf(i)), "salt" + i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is stable for the same (hash, salt)", () => {
    const h = sha256(clipOf(42));
    expect(det(h, "uniq")).toBe(det(h, "uniq"));
  });

  it("varies across salts and across hashes (not a constant)", () => {
    const h = sha256(clipOf(7));
    const a = det(h, "uniq");
    const b = det(h, "act0");
    const c = det(sha256(clipOf(8)), "uniq");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("spreads across the range (regression for the >>> precedence bug)", () => {
    // The old `x >>> 0 / 0xffffffff` returned huge ints; values must now be <1.
    const samples = Array.from({ length: 500 }, (_, i) => det(sha256(clipOf(i)), "s"));
    expect(Math.max(...samples)).toBeLessThan(1);
    // Mean of a uniform [0,1) should land roughly mid-range.
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
  });
});

describe("clamp()", () => {
  it("bounds correctly", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("resolveLabel()", () => {
  it("keeps known labels", () => {
    expect(resolveLabel("parkour")).toBe("parkour");
    expect(resolveLabel("aim_correction")).toBe("aim_correction");
  });
  it("falls back to default for unknown labels", () => {
    expect(resolveLabel("nonsense")).toBe("default");
    expect(resolveLabel("")).toBe("default");
  });
});

describe("pickActions()", () => {
  it("returns only vocabulary actions for the label", () => {
    const hash = sha256(clipOf(3));
    const actions = pickActions(hash, "racing");
    for (const a of actions) expect(LABEL_ACTIONS.racing).toContain(a);
  });
  it("returns at least 2 actions", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickActions(sha256(clipOf(i)), "boss_fail").length).toBeGreaterThanOrEqual(2);
    }
  });
  it("is deterministic for the same clip", () => {
    const h = sha256(clipOf(9));
    expect(pickActions(h, "parkour")).toEqual(pickActions(h, "parkour"));
  });
  it("varies across different clips (regression: not always the full pool)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickActions(sha256(clipOf(i)), "parkour").join(","));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("scoreProofOfPlay() — happy path", () => {
  it("scores a good, relevant clip above the approval bar", () => {
    const pop = scoreProofOfPlay(baseInput(), false, false);
    expect(pop.total).toBeGreaterThanOrEqual(APPROVAL_THRESHOLD);
    expect(pop.total).toBeLessThanOrEqual(100);
  });

  it("keeps every breakdown component within its max", () => {
    const pop = scoreProofOfPlay(baseInput(), false, false);
    expect(pop.breakdown.uniqueness).toBeLessThanOrEqual(25);
    expect(pop.breakdown.taskRelevance).toBeLessThanOrEqual(30);
    expect(pop.breakdown.gameplayQuality).toBeLessThanOrEqual(25);
    expect(pop.breakdown.actionDensity).toBeLessThanOrEqual(20);
    Object.values(pop.breakdown).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  });

  it("rewards on-label actions over off-label ones", () => {
    const onLabel = scoreProofOfPlay(baseInput({ actions: ["jump", "fall", "recovery", "retry"] }), false, false);
    const offLabel = scoreProofOfPlay(
      baseInput({ actions: ["accelerate", "brake", "drift", "overtake"] }),
      false,
      false
    );
    expect(onLabel.breakdown.taskRelevance).toBeGreaterThan(offLabel.breakdown.taskRelevance);
  });

  it("gives bigger files more gameplay-quality credit", () => {
    const small = scoreProofOfPlay(baseInput({ sizeBytes: 50 * 1024 }), false, false);
    const big = scoreProofOfPlay(baseInput({ sizeBytes: 20 * 1024 * 1024 }), false, false);
    expect(big.breakdown.gameplayQuality).toBeGreaterThan(small.breakdown.gameplayQuality);
  });

  it("is deterministic for identical input", () => {
    const a = scoreProofOfPlay(baseInput(), false, false);
    const b = scoreProofOfPlay(baseInput(), false, false);
    expect(a).toEqual(b);
  });

  it("produces varied scores across different clips", () => {
    const scores = new Set<number>();
    for (let i = 0; i < 30; i++) {
      scores.add(
        scoreProofOfPlay(
          baseInput({ contentHash: sha256(clipOf(i)), actions: pickActions(sha256(clipOf(i)), "parkour") }),
          false,
          false
        ).total
      );
    }
    expect(scores.size).toBeGreaterThan(3);
  });
});

describe("scoreProofOfPlay() — rejection paths", () => {
  it("collapses score for duplicates", () => {
    const pop = scoreProofOfPlay(baseInput(), true, false);
    expect(pop.total).toBeLessThan(APPROVAL_THRESHOLD);
    expect(pop.breakdown.uniqueness).toBe(0);
  });

  it("collapses score for blank footage", () => {
    const pop = scoreProofOfPlay(baseInput({ sizeBytes: 1024 }), false, true);
    expect(pop.total).toBeLessThan(APPROVAL_THRESHOLD);
    expect(pop.breakdown.gameplayQuality).toBe(0);
    expect(pop.breakdown.actionDensity).toBe(0);
  });
});

describe("trainingValue()", () => {
  it("maps score bands correctly", () => {
    expect(trainingValue(95)).toBe("high");
    expect(trainingValue(80)).toBe("high");
    expect(trainingValue(60)).toBe("medium");
    expect(trainingValue(APPROVAL_THRESHOLD)).toBe("medium");
    expect(trainingValue(40)).toBe("low");
  });
});

describe("vocabulary integrity", () => {
  it("every label has a game name and a non-empty action pool", () => {
    for (const key of Object.keys(LABEL_ACTIONS)) {
      expect(GAME_BY_LABEL[key], `game for ${key}`).toBeTruthy();
      expect(LABEL_ACTIONS[key].length).toBeGreaterThan(0);
    }
  });
  it("exposes sane thresholds", () => {
    expect(BLANK_BYTES_THRESHOLD).toBeGreaterThan(0);
    expect(APPROVAL_THRESHOLD).toBeGreaterThan(0);
    expect(APPROVAL_THRESHOLD).toBeLessThanOrEqual(100);
  });
});
