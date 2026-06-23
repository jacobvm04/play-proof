"use client";

import { useRef, useState } from "react";
import type { AnalysisResult, TraceManifest } from "@/lib/types";
import { submitClipOnChain } from "@/lib/client-contract";
import { OG } from "@/lib/config";
import { TxLink, StorageRef } from "./links";
import { fetchJson } from "@/lib/fetch-json";
import TraceRecorder, { type TraceResult } from "./TraceRecorder";

type Bounty = {
  id: number;
  title: string;
  taskType: string;
  rewardPerClip: string;
  reviewerReward: string;
};

const STEPS = [
  { key: "bundle", label: "Package recording", detail: "Bundle the screen recording + task metadata" },
  { key: "upload", label: "Upload to 0G Storage", detail: "Persist the recording + merkle root hash" },
  { key: "chain", label: "Submit to 0G Chain", detail: "submitClip(bountyId, rootHash)" },
  { key: "review", label: "Awaiting verification", detail: "A trusted reviewer approves → you claim 0G" },
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
        fd.append("screenW", String(trace.screen.width));
        fd.append("screenH", String(trace.screen.height));
        fd.append("startedAt", String(trace.startedAt));
        fd.append("durationMs", String(trace.durationMs));
      } else if (fallbackFile) {
        fd.append("video", fallbackFile);
      }
      await sleep(250);
      set("bundle", "done");

      set("upload", "active");
      const result = await fetchJson<any>("/api/analyze", { method: "POST", body: fd, timeoutMs: 110_000 });
      if (!result.ok) {
        set("upload", "error");
        throw new Error(result.error);
      }
      const data = result.data;
      setStorage(data.storage);
      setVideoUrl(data.videoUrl);
      setManifest(data.manifest);
      // analysis is computed server-side (used for dedup + dataset labels) but
      // is no longer surfaced as a score to contributors.
      const a: AnalysisResult = data.analysis;
      setAnalysis(a);
      set("upload", "done");

      if (a.duplicate) {
        set("chain", "error");
        throw new Error("Duplicate recording — this exact recording was already submitted to this bounty.");
      }

      // submitClip on-chain — this IS the record. Chain is the source of truth,
      // so once it settles we just refetch; nothing to persist off-chain.
      set("chain", "active");
      const { submissionId: sid, txHash: subTx } = await submitClipOnChain(bounty.id, data.storage.rootHash);
      setSubmissionId(sid);
      addTx("chain", subTx);
      set("chain", "done");

      set("review", "active"); // now awaiting review
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
            <b className="text-bone">{bounty.rewardPerClip} {OG.currency}</b>/approved
          </span>
        </div>

        <TraceRecorder onResult={setTrace} disabled={running} />

        {/* video-only fallback */}
        {!trace && (
          <div className="mt-3">
            <button
              className="w-full rounded-deck border border-dashed border-edge bg-panel2/40 px-4 py-3 text-center text-sm text-muted hover:border-brand/60"
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
          <div className="mt-4 rounded-deck border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{err}</div>
        )}

        <div className="mt-5 space-y-2">
          {STEPS.map((s) => {
            const st = states[s.key] ?? "idle";
            return (
              <div
                key={s.key}
                className={`rounded-deck border px-4 py-3 transition ${
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
                  {txs[s.key] && <TxLink hash={txs[s.key]} className="chip hover:border-brand/60" />}
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
          <div className="mt-4 rounded-deck border border-good/40 bg-good/5 px-4 py-3 text-sm">
            ✓ Submission #{submissionId} is on-chain, awaiting verification. Once a trusted reviewer
            approves it, claim {bounty.rewardPerClip} {OG.currency} from <b>My Submissions</b>.
          </div>
        )}

        {storage?.rootHash && (
          <div className="mt-3 rounded-deck border border-edge bg-panel2/40 px-4 py-3 text-xs">
            <div className="label mb-1">0G Storage root hash</div>
            <StorageRef rootHash={storage.rootHash} uploaded={storage.uploaded} className="text-brand2" />
            <div className="mt-1 text-muted">
              {storage.uploaded ? "✓ Recording persisted on 0G Storage" : "Root hash computed locally (set OG_SERVER_PRIVATE_KEY to persist)"}
            </div>
          </div>
        )}
      </div>

      {/* Right: recording summary */}
      <div className="card">
        <div className="label mb-3">Recording</div>
        {!analysis ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-muted">
            <div className="mb-2 text-4xl opacity-40">🎬</div>
            <p className="max-w-xs text-sm">
              Record the task, then submit it. Your recording is stored on 0G and sent to trusted
              reviewers who verify it before you&apos;re paid.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {videoUrl && (
              <video src={videoUrl} controls className="max-h-56 w-full rounded-deck border border-edge bg-black object-contain" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label">Task</div>
                <div className="font-semibold">{analysis.labels.taskType}</div>
              </div>
              <div>
                <div className="label">Duration</div>
                <div className="font-semibold">
                  {manifest ? `${(manifest.durationMs / 1000).toFixed(1)}s` : "—"}
                </div>
              </div>
            </div>

            {submissionId >= 0 ? (
              <div className="rounded-deck border border-good/40 bg-good/5 p-3 text-sm text-good">
                ✓ Submitted and awaiting verification.
              </div>
            ) : (
              <div className="rounded-deck border border-edge bg-panel2/40 p-3 text-sm text-muted">
                Recording captured — submitting to 0G…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
