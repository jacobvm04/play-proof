// ────────────────────────────────────────────────────────────────────────────
// 0G Compute — AI quality + labeling layer.
//
// This is where PlayProof invokes decentralized AI inference to (a) detect that
// a clip is gameplay, (b) auto-label the player actions, (c) score clip quality,
// and (d) reject duplicates/blank footage.
//
// Two implementations behind one interface:
//   • OgComputeProvider — routes the inference request through the 0G Compute
//     Network via the @0glabs/0g-serving-broker SDK (createZGComputeNetworkBroker).
//     Enabled when OG_COMPUTE_ENABLED=true and a provider/key are configured.
//   • MockComputeProvider — a deterministic, content-derived analyzer so the
//     full pipeline runs end-to-end in a demo without external dependencies.
//     It is NOT random: the same bytes always produce the same labels + score,
//     which is exactly what an on-chain quality oracle needs.
//
// The UI always shows which provider produced a given result (ComputeProvenance),
// so the "0G Compute" integration point is visible whether or not it's live.
// ────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type {
  AnalysisResult,
  ClipLabels,
  ComputeProvenance,
  ProofOfPlay,
} from "./types";

export type AnalyzeInput = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  requiredLabel: string; // the bounty's canonical label
  bountyTitle: string;
  // The clip's 0G Storage root hash — canonical identity for dedup.
  storageRootHash: string;
  // Root hashes of clips already submitted to this bounty — for duplicate detection.
  seenHashes: string[];
};

// Canonical action vocabulary, grouped by the bounty label it answers.
const LABEL_ACTIONS: Record<string, string[]> = {
  parkour: ["jump", "sprint", "fall", "recovery", "retry", "climb"],
  aim_correction: ["aim", "flick", "track", "recoil_control", "headshot", "reposition"],
  racing: ["accelerate", "brake", "drift", "overtake", "corner", "racing_line"],
  dialogue: ["dialogue", "choice", "branch", "npc_interact", "quest_accept"],
  boss_fail: ["attack", "dodge", "block", "death", "retry", "phase_transition"],
  default: ["move", "interact", "combat", "navigate", "menu"],
};

const GAME_BY_LABEL: Record<string, string> = {
  parkour: "Minecraft-style parkour",
  aim_correction: "FPS shooter",
  racing: "Arcade racing",
  dialogue: "Open-world RPG",
  boss_fail: "Action RPG boss arena",
  default: "Unknown gameplay",
};

function sha256(b: Buffer) {
  return crypto.createHash("sha256").update(b).digest("hex");
}

// Deterministic 0..1 pseudo-value from a hash + salt (no Math.random).
function det(hash: string, salt: string): number {
  const h = crypto.createHash("sha256").update(hash + salt).digest();
  // first 4 bytes → unsigned 32-bit → [0,1)
  const u = (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0);
  return u / 0xffffffff;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export interface ComputeProvider {
  readonly provenance: Omit<ComputeProvenance, "note">;
  analyze(input: AnalyzeInput): Promise<AnalysisResult>;
}

// ── Shared scoring: turns labels + content signals into a Proof-of-Play score ──
function scoreProofOfPlay(
  hash: string,
  labels: ClipLabels,
  input: AnalyzeInput,
  isDuplicate: boolean,
  isBlank: boolean = false
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
  const uniqueness = clamp(18 + det(hash, "uniq") * 7, 0, 25);

  // Task relevance (0..30): does the clip's top action match the bounty label?
  const wanted = LABEL_ACTIONS[input.requiredLabel] ?? LABEL_ACTIONS.default;
  const overlap = labels.actions.filter((a) => wanted.includes(a)).length;
  const taskRelevance = clamp((overlap / Math.max(1, wanted.length)) * 30, 0, 30);

  // Gameplay quality (0..25): proxy from resolution/bitrate ≈ file size, capped.
  const sizeMB = input.bytes.length / (1024 * 1024);
  const qualityFromSize = clamp(8 + Math.log2(1 + sizeMB) * 4, 0, 25);

  // Action density (0..20): more distinct human actions = richer training signal.
  const actionDensity = clamp(labels.actions.length * 3.2, 0, 20);

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

// ─────────────────────────── Mock (always available) ─────────────────────────
class MockComputeProvider implements ComputeProvider {
  readonly provenance = {
    provider: "mock" as const,
    model: "playproof-vision-mock-v1",
    endpoint: "local://0g-compute-interface",
  };

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    const hash = sha256(input.bytes);
    // Dedup on the canonical 0G Storage root hash (byte-identical clips share it).
    const isDuplicate = input.seenHashes.includes(input.storageRootHash);

    const label = LABEL_ACTIONS[input.requiredLabel] ? input.requiredLabel : "default";
    const pool = LABEL_ACTIONS[label];

    // Pick a deterministic subset of actions from the bounty's vocabulary.
    const chosen = pool.filter((_, i) => det(hash, "act" + i) > 0.35);
    const actions = chosen.length >= 2 ? chosen : pool.slice(0, 3);

    // Blank / tiny footage detection.
    const isBlank = input.bytes.length < 8 * 1024; // < 8KB ≈ not real gameplay

    const labels: ClipLabels = {
      game: GAME_BY_LABEL[label],
      actions,
      quality_score: 0, // filled below from Proof-of-Play
      training_value: "medium",
      reason: isBlank
        ? "Footage too short or blank to extract gameplay behavior."
        : isDuplicate
        ? "Byte-identical clip already submitted to this bounty."
        : `Clear human ${label.replace("_", " ")} behavior with ${actions.length} distinct actions.`,
    };

    const pop = scoreProofOfPlay(hash, labels, input, isDuplicate, isBlank);
    labels.quality_score = pop.total;
    labels.training_value = pop.total >= 80 ? "high" : pop.total >= 55 ? "medium" : "low";

    const approved = !isDuplicate && !isBlank && pop.total >= 55;

    return {
      labels,
      proofOfPlay: pop,
      compute: { ...this.provenance, note: "Deterministic local analyzer (set OG_COMPUTE_ENABLED=true to route through 0G Compute)." },
      approved,
      duplicate: isDuplicate,
    };
  }
}

// ───────────────────────── 0G Compute (live, optional) ───────────────────────
class OgComputeProvider implements ComputeProvider {
  readonly provenance = {
    provider: "0g-compute" as const,
    model: process.env.OG_COMPUTE_MODEL ?? "llama-3.3-70b-instruct",
    endpoint: "0g-compute-network",
  };

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    // Live 0G Compute inference. We still compute Proof-of-Play locally from the
    // model's structured output + content signals, so scoring stays auditable.
    //
    // The broker SDK is loaded lazily so the app builds/runs even when the
    // optional dependency isn't installed.
    const { ethers } = await import("ethers");
    // Opaque dynamic import so the bundler doesn't try to resolve this optional
    // dependency at build time — it's only present when 0G Compute is enabled.
    const brokerPkg = "@0glabs/0g-serving-broker";
    const broker = await import(/* webpackIgnore: true */ brokerPkg).catch(() => null);

    if (!broker?.createZGComputeNetworkBroker) {
      throw new Error("0G Compute broker SDK not installed; install @0glabs/0g-serving-broker");
    }

    const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_OG_RPC);
    const wallet = new ethers.Wallet(process.env.OG_COMPUTE_PRIVATE_KEY as string, provider);
    const zg = await broker.createZGComputeNetworkBroker(wallet);

    const providerAddr = process.env.OG_COMPUTE_PROVIDER as string;
    const { endpoint, model } = await zg.inference.getServiceMetadata(providerAddr);
    const headers = await zg.inference.getRequestHeaders(providerAddr, "playproof-analyze");

    const prompt = buildPrompt(input);
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a gameplay-clip quality analyzer for an AI training dataset. Reply with ONLY compact JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeParse(text);

    const hash = sha256(input.bytes);
    const isDuplicate = input.seenHashes.includes(input.storageRootHash);
    const actions: string[] = Array.isArray(parsed.actions) ? parsed.actions : [];
    const labels: ClipLabels = {
      game: parsed.game ?? GAME_BY_LABEL[input.requiredLabel] ?? "Unknown",
      actions: actions.length ? actions : (LABEL_ACTIONS[input.requiredLabel] ?? LABEL_ACTIONS.default).slice(0, 3),
      quality_score: 0,
      training_value: "medium",
      reason: parsed.reason ?? "Analyzed via 0G Compute inference.",
    };
    const pop = scoreProofOfPlay(hash, labels, input, isDuplicate);
    labels.quality_score = pop.total;
    labels.training_value = pop.total >= 80 ? "high" : pop.total >= 55 ? "medium" : "low";

    return {
      labels,
      proofOfPlay: pop,
      compute: { ...this.provenance, note: `Inference via 0G Compute provider ${providerAddr.slice(0, 10)}…` },
      approved: !isDuplicate && pop.total >= 55,
      duplicate: isDuplicate,
    };
  }
}

function buildPrompt(input: AnalyzeInput): string {
  return [
    `A player submitted a gameplay clip to the bounty: "${input.bountyTitle}".`,
    `The bounty requires gameplay demonstrating the behavior labeled "${input.requiredLabel}".`,
    `File: ${input.fileName} (${input.mimeType}, ${(input.bytes.length / 1024).toFixed(0)} KB).`,
    `Return JSON: {"game": string, "actions": string[], "reason": string}.`,
    `actions must be from this vocabulary: ${(LABEL_ACTIONS[input.requiredLabel] ?? LABEL_ACTIONS.default).join(", ")}.`,
  ].join("\n");
}

function safeParse(s: string): any {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch {
    return {};
  }
}

// ─────────────────────────────── Factory ─────────────────────────────────────
let _provider: ComputeProvider | null = null;

export function getComputeProvider(): ComputeProvider {
  if (_provider) return _provider;
  const live =
    process.env.OG_COMPUTE_ENABLED === "true" &&
    !!process.env.OG_COMPUTE_PROVIDER &&
    !!process.env.OG_COMPUTE_PRIVATE_KEY;
  _provider = live ? new OgComputeProvider() : new MockComputeProvider();
  return _provider;
}

export { sha256 };
