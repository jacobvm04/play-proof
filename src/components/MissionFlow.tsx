"use client";

import { useRef, useState } from "react";
import type { AnalysisResult, TraceManifest } from "@/lib/types";
import { submitClipOnChain } from "@/lib/client-contract";
import { explorerTx, storageLink, OG } from "@/lib/config";
import ScoreRing from "./ScoreRing";
import TraceRecorder, { type TraceResult } from "./TraceRecorder";

type Bounty = {
  id: number;
  title: string;
  taskType: string;
  rewardPerClip: string;
  reviewerReward: string;
  requiredReviews: number;
};

const STEPS = [
  { key: "bundle", label: "Assemble trace bundle", detail: "Pack screen video + synced input events" },
  { key: "upload", label: "Upload to 0G Storage", detail: "Persist the whole bundle + merkle root hash" },
  { key: "compute", label: "0G Compute: AI pre-screen", detail: "Detect task, label actions, score quality" },
  { key: "chain", label: "Submit provenance to 0G Chain", detail: "submitClip(bountyId, rootHash)" },
  { key: "aiscore", label: "Oracle posts AI pre-score", detail: "setAiPreScore(id, score) — a review signal" },
  { key: "review", label: "Awaiting human review", detail: "N reviewers vote; >50% approves → you claim" },
] as const;

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
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [fallbackFile, setFallbackFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [manifest, setManifest] = useState<TraceManifest | null>(null);
  const [storage, setStorage] = useState<any>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [txs, setTxs] = useState<Record<string, string>>({});
  const [submissionId, setSubmissionId] = useState(-1);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: StepState) => setStates((s) => ({ ...s, [k]: v }));
  const addTx = (k: string, h: string) => setTxs((t) => ({ ...t, [k]: h }));

  const hasInput = !!trace || !!fallbackFile;

  async function run() {
    if (!hasInput) return;
    setErr("");
    setRunning(true);
    setAnalysis(null);
    setStates({});
    setTxs({});
    setSubmissionId(-1);

    try {
      set("bundle", "active");
      const fd = new FormData();
      fd.append("bountyId", String(bounty.id));
      fd.append("contributor", address);
      if (trace) {
        fd.append("video", new File([trace.video], "screen.webm", { type: "video/webm" }));
        fd.append("events", JSON.stringify(trace.events));
        fd.append("screenW", String(trace.screen.width));
        fd.append("screenH", String(trace.screen.height));
        fd.append("startedAt", String(trace.startedAt));
      } else if (fallbackFile) {
        // Video-only fallback (no input trace) — the pipeline still runs but the
        // AI pre-score penalizes missing inputs (completeness/richness).
        fd.append("video", fallbackFile);
        fd.append("events", "[]");
      }
      await sleep(250);
      set("bundle", "done");

      set("upload", "active");
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Pipeline failed");
      setStorage(data.storage);
      setVideoUrl(data.videoUrl);
      setManifest(data.manifest);
      set("upload", "done");

      set("compute", "active");
      await sleep(400);
      const a: AnalysisResult = data.analysis;
      setAnalysis(a);
      set("compute", "done");

      if (a.duplicate) {
        set("chain", "error");
        throw new Error("Duplicate bundle — this exact recording was already submitted to this bounty.");
      }
      if (a.proofOfPlay.total < 30) {
        set("chain", "error");
        throw new Error(`Bundle pre-scored ${a.proofOfPlay.total}/100 — too low to submit. ${a.labels.reason}`);
      }

      // submitClip on-chain
      set("chain", "active");
      const { submissionId: sid, txHash: subTx } = await submitClipOnChain(bounty.id, data.storage.rootHash);
      setSubmissionId(sid);
      addTx("chain", subTx);
      set("chain", "done");

      // index it
      await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sid,
          bountyId: bounty.id,
          contributor: address,
          storageRootHash: data.storage.rootHash,
          storageTxHash: data.storage.txHash,
          videoUrl: data.videoUrl,
          manifest: data.manifest,
          fileName: data.fileName,
          sizeBytes: data.sizeBytes,
          analysis: a,
          submitTxHash: subTx,
          review: { positiveReviews: 0, totalReviews: 0, requiredReviews: bounty.requiredReviews },
        }),
      });

      // oracle posts AI pre-score on-chain
      set("aiscore", "active");
      const ai = await fetch("/api/aiscore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: sid, score: a.proofOfPlay.total, storageRootHash: data.storage.rootHash }),
      }).then((r) => r.json());
      if (ai.ok) addTx("aiscore", ai.txHash);
      set("aiscore", ai.ok ? "done" : "error");

      set("review", "active"); // stays active — now in the review queue
      onComplete();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Left: capture + pipeline */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="label">Active task</div>
            <h3 className="text-lg font-bold">{bounty.title}</h3>
          </div>
          <span className="chip">
            <b className="text-white">{bounty.rewardPerClip} {OG.currency}</b>/approved
          </span>
        </div>

        <TraceRecorder onResult={setTrace} disabled={running} />

        {/* video-only fallback */}
        {!trace && (
          <div className="mt-3">
            <button
              className="w-full rounded-xl border border-dashed border-edge bg-panel2/40 px-4 py-3 text-center text-sm text-muted hover:border-brand/60"
              onClick={() => fileRef.current?.click()}
            >
              {fallbackFile ? `📎 ${fallbackFile.name} (video-only)` : "or upload a screen recording (video-only fallback)"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setFallbackFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        <button className="btn-primary mt-4 w-full" disabled={running || !hasInput} onClick={run}>
          {running ? "Running pipeline…" : hasInput ? "Submit task data ▶" : "Record or upload first"}
        </button>

        {err && (
          <div className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{err}</div>
        )}

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
                    <a href={explorerTx(txs[s.key])} target="_blank" rel="noreferrer" className="chip hover:border-brand/60">
                      tx ↗
                    </a>
                  )}
                </div>
                {st === "active" && s.key !== "review" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge">
                    <div className="pipeline-fill h-full w-full animate-shimmer" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {submissionId >= 0 && (
          <div className="mt-4 rounded-xl border border-good/40 bg-good/5 px-4 py-3 text-sm">
            ✓ Submission #{submissionId} is on-chain and in the <b>Review Queue</b>. Once{" "}
            {bounty.requiredReviews} reviewers vote and &gt;50% approve, you can claim{" "}
            {bounty.rewardPerClip} {OG.currency} from <b>My Submissions</b>.
          </div>
        )}

        {storage?.rootHash && (
          <div className="mt-3 rounded-xl border border-edge bg-panel2/40 px-4 py-3 text-xs">
            <div className="label mb-1">0G Storage root hash (full bundle)</div>
            <a
              href={storageLink(storage.rootHash)}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-brand2 hover:underline"
            >
              {storage.rootHash}
            </a>
            <div className="mt-1 text-muted">
              {storage.uploaded ? "✓ Bundle persisted on 0G Storage" : "Root hash computed locally (set OG_SERVER_PRIVATE_KEY to persist)"}
            </div>
          </div>
        )}
      </div>

      {/* Right: AI pre-screen reveal */}
      <div className="card">
        <div className="label mb-3">0G Compute — AI pre-screen</div>
        {!analysis ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-muted">
            <div className="mb-2 text-4xl opacity-40">🤖</div>
            <p className="max-w-xs text-sm">
              Record a task, then watch the AI detect the task type, label your actions from the input
              trace, and assign a pre-screen score. Humans make the final call.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {videoUrl && (
              <video src={videoUrl} controls className="max-h-44 w-full rounded-xl border border-edge bg-black object-contain" />
            )}
            <div className="flex items-center gap-5">
              <ScoreRing score={analysis.proofOfPlay.total} />
              <div className="flex-1 space-y-2">
                <div>
                  <div className="label">Task</div>
                  <div className="font-semibold">{analysis.labels.taskType}</div>
                </div>
                <div>
                  <div className="label">Training value</div>
                  <ValuePill v={analysis.labels.training_value} />
                </div>
                <div>
                  <div className="label">Input trace</div>
                  {analysis.hasTrace ? (
                    <span className="chip border-good/50 text-good">
                      ✓ {manifest?.events.count ?? 0} events
                    </span>
                  ) : (
                    <span className="chip border-warn/50 text-warn">video-only</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="label mb-1">Detected actions</div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.labels.actions.map((a) => (
                  <span key={a} className="chip border-brand/40 text-white">{a}</span>
                ))}
              </div>
            </div>

            <Breakdown b={analysis.proofOfPlay.breakdown} />

            {manifest && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Mini n={manifest.events.keystrokes} l="keystrokes" />
                <Mini n={manifest.events.clicks} l="clicks" />
                <Mini n={`${(manifest.durationMs / 1000).toFixed(1)}s`} l="duration" />
              </div>
            )}

            <div className="rounded-xl border border-edge bg-panel2/40 p-3">
              <div className="label mb-1">AI reasoning</div>
              <p className="text-sm text-muted">{analysis.labels.reason}</p>
            </div>

            <details className="rounded-xl border border-edge bg-black/40">
              <summary className="cursor-pointer px-3 py-2 text-xs text-muted">
                view raw 0G Compute output ({analysis.compute.provider})
              </summary>
              <pre className="overflow-x-auto px-3 pb-3 text-[11px] leading-relaxed text-brand2">
{JSON.stringify(
  {
    task_type: analysis.labels.taskType,
    actions: analysis.labels.actions,
    ai_pre_score: analysis.proofOfPlay.total,
    training_value: analysis.labels.training_value,
    has_input_trace: analysis.hasTrace,
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
    { k: "Input richness", v: b.inputRichness, max: 25 },
    { k: "Completeness (video+trace)", v: b.completeness, max: 20 },
  ];
  return (
    <div className="space-y-2">
      <div className="label">AI pre-score breakdown</div>
      {rows.map((r) => (
        <div key={r.k}>
          <div className="flex justify-between text-xs">
            <span className="text-muted">{r.k}</span>
            <span className="font-mono">{r.v}/{r.max}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-edge">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(r.v / r.max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Mini({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel2/40 py-1.5">
      <div className="text-sm font-bold">{n}</div>
      <div className="label">{l}</div>
    </div>
  );
}

function ValuePill({ v }: { v: "low" | "medium" | "high" }) {
  const map = { high: "border-good/50 text-good", medium: "border-warn/50 text-warn", low: "border-bad/50 text-bad" } as const;
  return <span className={`chip ${map[v]}`}>{v}</span>;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <span className="text-good">✓</span>;
  if (state === "error") return <span className="text-bad">✕</span>;
  if (state === "active") return <span className="h-3 w-3 rounded-full bg-brand animate-pulseGlow" />;
  return <span className="h-3 w-3 rounded-full border border-edge" />;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
