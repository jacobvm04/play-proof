"use client";

import { useRef, useState } from "react";
import type { AnalysisResult } from "@/lib/types";
import {
  submitClipOnChain,
  claimRewardOnChain,
} from "@/lib/client-contract";
import { explorerTx, storageLink, OG } from "@/lib/config";
import ScoreRing from "./ScoreRing";

type Bounty = {
  id: number;
  title: string;
  requiredLabel: string;
  rewardPerClip: string;
};

type Step = {
  key: string;
  label: string;
  detail: string;
};

const STEPS: Step[] = [
  { key: "upload", label: "Upload to 0G Storage", detail: "Persisting clip bytes + computing merkle root hash" },
  { key: "compute", label: "0G Compute: AI quality + labeling", detail: "Detecting gameplay, auto-labeling actions, scoring" },
  { key: "chain", label: "Write provenance to 0G Chain", detail: "submitClip(bountyId, rootHash)" },
  { key: "approve", label: "Oracle approval", detail: "approveSubmission(id, proofOfPlayScore)" },
  { key: "claim", label: "Claim reward", detail: "claimReward(id) → 0G to your wallet" },
];

type StepState = "idle" | "active" | "done" | "error";

export default function MissionFlow({
  bounty,
  address,
  onComplete,
}: {
  bounty: Bounty;
  address: string;
  onComplete: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [storage, setStorage] = useState<any>(null);
  const [clipUrl, setClipUrl] = useState<string>("");
  const [submissionId, setSubmissionId] = useState<number>(-1);
  const [txs, setTxs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: StepState) => setStates((s) => ({ ...s, [k]: v }));
  const addTx = (k: string, h: string) => setTxs((t) => ({ ...t, [k]: h }));

  async function run() {
    if (!file) {
      inputRef.current?.click();
      return;
    }
    setErr("");
    setRunning(true);
    setAnalysis(null);
    setStates({});
    setTxs({});
    setSubmissionId(-1);

    try {
      // ── Steps 1+2: upload to 0G Storage and run 0G Compute analysis ──
      set("upload", "active");
      const fd = new FormData();
      fd.append("clip", file);
      fd.append("bountyId", String(bounty.id));
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Analysis failed");

      set("upload", "done");
      setStorage(data.storage);
      setClipUrl(data.clipUrl);

      set("compute", "active");
      // small beat so the pipeline reads as live
      await sleep(450);
      const a: AnalysisResult = data.analysis;
      setAnalysis(a);
      set("compute", "done");

      if (a.duplicate) {
        set("chain", "error");
        throw new Error("Duplicate clip — this exact footage was already submitted to this bounty.");
      }
      if (!a.approved) {
        set("chain", "error");
        throw new Error(
          `Clip scored ${a.proofOfPlay.total}/100 — below the quality bar for this bounty. ${a.labels.reason}`
        );
      }

      // ── Step 3: player signs submitClip on 0G Chain ──
      set("chain", "active");
      const { submissionId: sid, txHash: subTx } = await submitClipOnChain(
        bounty.id,
        data.storage.rootHash
      );
      setSubmissionId(sid);
      addTx("chain", subTx);
      set("chain", "done");

      // record in the index for dashboards
      await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sid,
          bountyId: bounty.id,
          player: address,
          storageRootHash: data.storage.rootHash,
          storageTxHash: data.storage.txHash,
          clipUrl: data.clipUrl,
          fileName: data.fileName,
          sizeBytes: data.sizeBytes,
          analysis: a,
          submitTxHash: subTx,
        }),
      });

      // ── Step 4: oracle approves on-chain with the Proof-of-Play score ──
      set("approve", "active");
      const apRes = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: sid,
          storageRootHash: data.storage.rootHash,
          approve: true,
          qualityScore: a.proofOfPlay.total,
        }),
      });
      const ap = await apRes.json();
      if (!ap.ok) throw new Error(ap.error || "On-chain approval failed");
      addTx("approve", ap.txHash);
      set("approve", "done");

      // ── Step 5: player claims the reward ──
      set("claim", "active");
      const claimTx = await claimRewardOnChain(sid);
      addTx("claim", claimTx);
      await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: sid, storageRootHash: data.storage.rootHash, txHash: claimTx }),
      });
      set("claim", "done");

      onComplete();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Left: input + pipeline */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="label">Active mission</div>
            <h3 className="text-lg font-bold">{bounty.title}</h3>
          </div>
          <span className="chip">
            reward <b className="ml-1 text-white">{bounty.rewardPerClip} {OG.currency}</b>/clip
          </span>
        </div>

        {/* Drop / pick */}
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge bg-panel2 py-8 text-center hover:border-brand/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="text-3xl">🎮</div>
          <div className="font-semibold">{file ? file.name : "Drop a gameplay clip or click to upload"}</div>
          <div className="text-xs text-muted">
            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "MP4 / WebM — short clip recommended"}
          </div>
        </label>

        <button className="btn-primary mt-4 w-full" disabled={running} onClick={run}>
          {running ? "Running pipeline…" : file ? "Start Mission ▶" : "Choose a clip"}
        </button>

        {err && (
          <div className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {err}
          </div>
        )}

        {/* Pipeline steps */}
        <div className="mt-5 space-y-2">
          {STEPS.map((s) => {
            const st = states[s.key] ?? "idle";
            return (
              <div
                key={s.key}
                className={`rounded-xl border px-4 py-3 transition ${
                  st === "active"
                    ? "border-brand/60 bg-brand/5"
                    : st === "done"
                    ? "border-good/40 bg-good/5"
                    : st === "error"
                    ? "border-bad/40 bg-bad/5"
                    : "border-edge bg-panel2/40"
                }`}
              >
                <div className="flex items-center gap-3">
                  <StepIcon state={st} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{s.label}</div>
                    <div className="text-xs text-muted">{s.detail}</div>
                  </div>
                  {txs[s.key] && (
                    <a
                      href={explorerTx(txs[s.key])}
                      target="_blank"
                      rel="noreferrer"
                      className="chip hover:border-brand/60"
                    >
                      tx ↗
                    </a>
                  )}
                </div>
                {st === "active" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge">
                    <div className="pipeline-fill h-full w-full animate-shimmer" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {storage?.rootHash && (
          <div className="mt-4 rounded-xl border border-edge bg-panel2/40 px-4 py-3 text-xs">
            <div className="label mb-1">0G Storage root hash</div>
            <a
              href={storageLink(storage.rootHash)}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-brand2 hover:underline"
            >
              {storage.rootHash}
            </a>
            <div className="mt-1 text-muted">
              {storage.uploaded
                ? "✓ Bytes persisted on 0G Storage"
                : "Root hash computed locally (set OG_SERVER_PRIVATE_KEY to persist bytes on 0G Storage)"}
            </div>
          </div>
        )}
      </div>

      {/* Right: the "AI watches your gameplay" reveal */}
      <div className="card">
        <div className="label mb-3">0G Compute — AI analysis</div>
        {!analysis ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-muted">
            <div className="mb-2 text-4xl opacity-40">🤖</div>
            <p className="max-w-xs text-sm">
              Run the mission and watch the AI detect gameplay, label your actions, and assign a
              Proof-of-Play score.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {clipUrl && (
              <video
                src={clipUrl}
                controls
                className="max-h-44 w-full rounded-xl border border-edge bg-black object-contain"
              />
            )}
            <div className="flex items-center gap-5">
              <ScoreRing score={analysis.proofOfPlay.total} />
              <div className="flex-1 space-y-2">
                <div>
                  <div className="label">Game</div>
                  <div className="font-semibold">{analysis.labels.game}</div>
                </div>
                <div>
                  <div className="label">Training value</div>
                  <ValuePill v={analysis.labels.training_value} />
                </div>
              </div>
            </div>

            <div>
              <div className="label mb-1">Detected actions</div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.labels.actions.map((a) => (
                  <span key={a} className="chip border-brand/40 text-white">
                    {a}
                  </span>
                ))}
              </div>
            </div>

            <Breakdown b={analysis.proofOfPlay.breakdown} />

            <div className="rounded-xl border border-edge bg-panel2/40 p-3">
              <div className="label mb-1">AI reasoning</div>
              <p className="text-sm text-muted">{analysis.labels.reason}</p>
            </div>

            {/* Raw JSON — the flashy "AI output" moment */}
            <details className="rounded-xl border border-edge bg-black/40">
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted">
                view raw 0G Compute output ({analysis.compute.provider})
              </summary>
              <pre className="overflow-x-auto px-3 pb-3 text-[11px] leading-relaxed text-brand2">
{JSON.stringify(
  {
    game: analysis.labels.game,
    actions: analysis.labels.actions,
    quality_score: analysis.proofOfPlay.total,
    training_value: analysis.labels.training_value,
    reason: analysis.labels.reason,
    _compute: analysis.compute,
  },
  null,
  2
)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function Breakdown({ b }: { b: AnalysisResult["proofOfPlay"]["breakdown"] }) {
  const rows = [
    { k: "Uniqueness", v: b.uniqueness, max: 25 },
    { k: "Task relevance", v: b.taskRelevance, max: 30 },
    { k: "Gameplay quality", v: b.gameplayQuality, max: 25 },
    { k: "Action density", v: b.actionDensity, max: 20 },
  ];
  return (
    <div className="space-y-2">
      <div className="label">Proof-of-Play breakdown</div>
      {rows.map((r) => (
        <div key={r.k}>
          <div className="flex justify-between text-xs">
            <span className="text-muted">{r.k}</span>
            <span className="font-mono">
              {r.v}/{r.max}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${(r.v / r.max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ValuePill({ v }: { v: "low" | "medium" | "high" }) {
  const map = {
    high: "border-good/50 text-good",
    medium: "border-warn/50 text-warn",
    low: "border-bad/50 text-bad",
  } as const;
  return <span className={`chip ${map[v]}`}>{v}</span>;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <span className="text-good">✓</span>;
  if (state === "error") return <span className="text-bad">✕</span>;
  if (state === "active")
    return <span className="h-3 w-3 rounded-full bg-brand animate-pulseGlow" />;
  return <span className="h-3 w-3 rounded-full border border-edge" />;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
