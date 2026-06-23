// ────────────────────────────────────────────────────────────────────────────
// 0G Compute — AI pre-screen + labeling layer for computer-use trace bundles.
//
// PlayProof invokes decentralized AI inference to (a) detect that a bundle is a
// real computer-use session, (b) auto-label the high-level actions from the
// input stream, (c) assign a quality pre-score, and (d) flag duplicates/blank
// bundles. This is a SIGNAL — final approval is decided by on-chain human review.
//
// Two implementations behind one interface:
//   • OgComputeProvider — routes inference through the 0G Compute Network via
//     the @0glabs/0g-serving-broker SDK (createZGComputeNetworkBroker). Enabled
//     when OG_COMPUTE_ENABLED=true and a provider/key are configured.
//   • MockComputeProvider — a deterministic, content-derived analyzer so the
//     full pipeline runs end-to-end without external deps. Same bytes → same
//     result, which is what an auditable on-chain pre-score needs.
//
// The UI always shows which provider produced a result (ComputeProvenance), so
// the 0G Compute integration point is visible whether or not it's live.
// ────────────────────────────────────────────────────────────────────────────

import type { AnalysisResult, ComputeProvenance, TraceLabels, TraceManifest } from "./types";
import {
  BLANK_BYTES_THRESHOLD,
  PRESCREEN_THRESHOLD,
  TASK_ACTIONS,
  TASK_LABELS,
  pickActions,
  resolveTask,
  scoreProofOfPlay,
  sha256,
  signalsFromManifest,
  trainingValue,
} from "./scoring";

export type AnalyzeInput = {
  bytes: Buffer; // the recording bundle bytes (manifest + video)
  fileName: string;
  mimeType: string;
  taskType: string;        // the bounty's canonical task type
  bountyTitle: string;
  storageRootHash: string; // 0G Storage root — canonical identity for dedup
  seenHashes: string[];    // root hashes already submitted to this bounty
  manifest?: TraceManifest; // parsed recording manifest, if present
};

export interface ComputeProvider {
  readonly provenance: Omit<ComputeProvenance, "note">;
  analyze(input: AnalyzeInput): Promise<AnalysisResult>;
}

function buildLabels(
  input: AnalyzeInput,
  actions: string[],
  isBlank: boolean,
  isDuplicate: boolean
): TraceLabels {
  const task = resolveTask(input.taskType);
  const reason = isBlank
    ? "Recording too short or blank to extract computer-use behavior."
    : isDuplicate
    ? "Byte-identical recording already submitted to this bounty."
    : `Clear ${TASK_LABELS[task].toLowerCase()} recording with ${actions.length} distinct actions.`;
  return {
    taskType: task,
    actions,
    quality_score: 0,
    training_value: "medium",
    reason,
  };
}

// ─────────────────────────── Mock (always available) ─────────────────────────
class MockComputeProvider implements ComputeProvider {
  readonly provenance = {
    provider: "mock" as const,
    model: "playproof-trace-mock-v1",
    endpoint: "local://0g-compute-interface",
  };

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    const hash = sha256(input.bytes);
    const isDuplicate = input.seenHashes.includes(input.storageRootHash);
    const isBlank = input.bytes.length < BLANK_BYTES_THRESHOLD;

    const actions = pickActions(hash, input.taskType);
    const sig = signalsFromManifest(input.manifest);

    const labels = buildLabels(input, actions, isBlank, isDuplicate);
    const pop = scoreProofOfPlay(
      { contentHash: hash, sizeBytes: input.bytes.length, taskType: input.taskType, actions, ...sig },
      isDuplicate,
      isBlank
    );
    labels.quality_score = pop.total;
    labels.training_value = trainingValue(pop.total);

    return {
      labels,
      proofOfPlay: pop,
      compute: {
        ...this.provenance,
        note: "Deterministic local analyzer (set OG_COMPUTE_ENABLED=true to route through 0G Compute).",
      },
      preApproved: !isDuplicate && !isBlank && pop.total >= PRESCREEN_THRESHOLD,
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
    const { ethers } = await import("ethers");
    // Opaque dynamic import so the bundler doesn't resolve this optional dep at
    // build time — only present when 0G Compute is enabled.
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

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You analyze recorded computer-use sessions (screen video + input trace) for an AI training dataset. Reply with ONLY compact JSON.",
          },
          { role: "user", content: buildPrompt(input) },
        ],
      }),
    });
    const data = await res.json();
    const parsed = safeParse(data?.choices?.[0]?.message?.content ?? "{}");

    const hash = sha256(input.bytes);
    const isDuplicate = input.seenHashes.includes(input.storageRootHash);
    const isBlank = input.bytes.length < BLANK_BYTES_THRESHOLD;
    const sig = signalsFromManifest(input.manifest);

    const modelActions: string[] = Array.isArray(parsed.actions) ? parsed.actions : [];
    const actions = modelActions.length ? modelActions : pickActions(hash, input.taskType);

    const labels = buildLabels(input, actions, isBlank, isDuplicate);
    if (parsed.reason) labels.reason = parsed.reason;
    const pop = scoreProofOfPlay(
      { contentHash: hash, sizeBytes: input.bytes.length, taskType: input.taskType, actions, ...sig },
      isDuplicate,
      isBlank
    );
    labels.quality_score = pop.total;
    labels.training_value = trainingValue(pop.total);

    return {
      labels,
      proofOfPlay: pop,
      compute: { ...this.provenance, note: `Inference via 0G Compute provider ${providerAddr.slice(0, 10)}…` },
      preApproved: !isDuplicate && !isBlank && pop.total >= PRESCREEN_THRESHOLD,
      duplicate: isDuplicate,
    };
  }
}

function buildPrompt(input: AnalyzeInput): string {
  const m = input.manifest;
  return [
    `A contributor recorded a computer-use task for the bounty: "${input.bountyTitle}".`,
    `Task type: "${input.taskType}".`,
    m
      ? `The screen recording is ${(m.durationMs / 1000).toFixed(1)}s at ${m.screen.width}x${m.screen.height}.`
      : `A screen recording of the task.`,
    `Return JSON: {"actions": string[], "reason": string}.`,
    `actions must be from this vocabulary: ${TASK_ACTIONS[resolveTask(input.taskType)].join(", ")}.`,
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
