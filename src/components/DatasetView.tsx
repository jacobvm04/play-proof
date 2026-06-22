"use client";

import { useMemo, useState } from "react";
import type { Bounty, SubmissionRecord } from "@/lib/types";
import { OG } from "@/lib/config";
import { createBountyOnChain } from "@/lib/client-contract";

export default function DatasetView({
  bounties,
  submissions,
  address,
  onRefresh,
}: {
  bounties: Bounty[];
  submissions: SubmissionRecord[];
  address: string;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6">
      <CreateBounty address={address} onCreated={onRefresh} />
      <div className="grid gap-5 lg:grid-cols-2">
        {bounties.map((b) => (
          <DatasetCard
            key={b.id}
            bounty={b}
            submissions={submissions.filter((s) => s.bountyId === b.id && s.status === "approved")}
          />
        ))}
      </div>
    </div>
  );
}

function DatasetCard({ bounty, submissions }: { bounty: Bounty; submissions: SubmissionRecord[] }) {
  const stats = useMemo(() => {
    const labels: Record<string, number> = {};
    let score = 0;
    let bytes = 0;
    for (const s of submissions) {
      for (const a of s.analysis.labels.actions) labels[a] = (labels[a] ?? 0) + 1;
      score += s.analysis.proofOfPlay.total;
      bytes += s.sizeBytes;
    }
    const contributors = new Set(submissions.map((s) => s.player)).size;
    // crude minutes estimate from size (demo): ~6MB/min of compressed gameplay
    const minutes = (bytes / (6 * 1024 * 1024)).toFixed(1);
    return {
      labels,
      contributors,
      minutes,
      avg: submissions.length ? Math.round(score / submissions.length) : 0,
    };
  }, [submissions]);

  const name = bounty.title.replace(/[^a-zA-Z0-9]+/g, " ").trim();

  return (
    <div className="card relative overflow-hidden">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/20 blur-3xl" />
      <div className="mb-1 flex items-center justify-between">
        <span className="chip border-brand/40 text-brand2">Dataset Card</span>
        <span className="chip">v0.1</span>
      </div>
      <h3 className="text-lg font-bold">{name}</h3>
      <div className="mt-1 text-xs text-muted">
        label <span className="font-mono text-brand2">{bounty.requiredLabel}</span> · bounty #{bounty.id}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Stat n={submissions.length} l="clips" />
        <Stat n={stats.contributors} l="contributors" />
        <Stat n={stats.minutes} l="minutes" />
        <Stat n={stats.avg} l="avg PoP" accent />
      </div>

      <div className="mt-4">
        <div className="label mb-1">Label distribution</div>
        {Object.keys(stats.labels).length === 0 ? (
          <p className="text-xs text-muted">No approved clips yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(stats.labels)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <span key={k} className="chip">
                  {k} <b className="ml-1 text-white">{v}</b>
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
        <span className="text-xs text-muted">Stored on 0G · {OG.networkName}</span>
        <a
          href={`/api/dataset?bountyId=${bounty.id}&download=1`}
          className="btn-ghost py-1.5 text-xs"
          download
        >
          ⬇ download manifest
        </a>
      </div>
      {submissions.length > 0 && (
        <div className="mt-2 text-[11px] text-good">✓ Ready for AI training</div>
      )}
    </div>
  );
}

function Stat({ n, l, accent }: { n: number | string; l: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-edge bg-panel2/40 py-2">
      <div className={`text-xl font-bold ${accent ? "text-good" : ""}`}>{n}</div>
      <div className="label">{l}</div>
    </div>
  );
}

function CreateBounty({ address, onCreated }: { address: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [reward, setReward] = useState("0.005");
  const [clips, setClips] = useState(20);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    if (!address) return setMsg("Connect your wallet first.");
    if (!title || !label) return setMsg("Title and label are required.");
    setBusy(true);
    try {
      await createBountyOnChain(title, label, reward, clips);
      setMsg("✓ Bounty created and funded on 0G Chain.");
      setTitle("");
      setLabel("");
      onCreated();
      setOpen(false);
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Dataset Buyer (AI team)</div>
          <h3 className="text-lg font-bold">Post a gameplay-data bounty</h3>
          <p className="text-sm text-muted">
            Escrow {OG.currency} per approved clip. Contributors get paid; you get verified,
            provenance-tracked training data.
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "+ New bounty"}
        </button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input
              className="inp"
              placeholder="200 clips of human aim correction"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Required label (snake_case)">
            <input
              className="inp"
              placeholder="aim_correction"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label={`Reward per clip (${OG.currency})`}>
            <input
              className="inp"
              type="number"
              step="0.001"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
          </Field>
          <Field label="Clips to fund">
            <input
              className="inp"
              type="number"
              value={clips}
              onChange={(e) => setClips(Number(e.target.value))}
            />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between">
            <span className="text-xs text-muted">
              Escrow total:{" "}
              <b className="text-white">
                {(Number(reward) * clips || 0).toFixed(4)} {OG.currency}
              </b>
            </span>
            <button className="btn-primary" disabled={busy} onClick={submit}>
              {busy ? "Confirm in wallet…" : "Create & fund"}
            </button>
          </div>
        </div>
      )}
      {msg && <div className="mt-3 text-sm text-muted">{msg}</div>}

      <style jsx>{`
        :global(.inp) {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #2a2a3a;
          background: #1b1b27;
          padding: 0.6rem 0.8rem;
          font-size: 0.875rem;
          color: #e7e7f0;
        }
        :global(.inp:focus) {
          outline: none;
          border-color: #7c5cff;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}
