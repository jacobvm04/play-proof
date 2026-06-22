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
    let score = 0, ms = 0, events = 0;
    for (const s of submissions) {
      for (const a of s.analysis.labels.actions) labels[a] = (labels[a] ?? 0) + 1;
      score += s.analysis.proofOfPlay.total;
      ms += s.manifest?.durationMs ?? 0;
      events += s.manifest?.events.count ?? 0;
    }
    const contributors = new Set(submissions.map((s) => s.contributor)).size;
    return {
      labels,
      contributors,
      minutes: (ms / 60000).toFixed(1),
      events,
      avg: submissions.length ? Math.round(score / submissions.length) : 0,
    };
  }, [submissions]);

  const name = bounty.title.replace(/[^a-zA-Z0-9]+/g, " ").trim();

  return (
    <div className="card relative overflow-hidden">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/20 blur-3xl" />
      <div className="mb-1 flex items-center justify-between">
        <span className="chip border-brand/40 text-brand2">Dataset Card</span>
        <span className="chip">{bounty.taskType}</span>
      </div>
      <h3 className="text-lg font-bold">{name}</h3>
      <div className="mt-1 text-xs text-muted">
        human-verified · {bounty.requiredReviews}× review consensus · bounty #{bounty.id}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <Stat n={submissions.length} l="bundles" />
        <Stat n={stats.contributors} l="contributors" />
        <Stat n={stats.minutes} l="minutes" />
        <Stat n={stats.avg} l="avg AI" accent />
      </div>

      <div className="mt-3 text-center text-xs text-muted">
        {stats.events.toLocaleString()} synced input events captured
      </div>

      <div className="mt-4">
        <div className="label mb-1">Action distribution</div>
        {Object.keys(stats.labels).length === 0 ? (
          <p className="text-xs text-muted">No approved bundles yet.</p>
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
        <a href={`/api/dataset?bountyId=${bounty.id}&download=1`} className="btn-ghost py-1.5 text-xs" download>
          ⬇ download manifest
        </a>
      </div>
      {submissions.length > 0 && <div className="mt-2 text-[11px] text-good">✓ Ready for computer-use agent training</div>}
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

const PRESETS = [
  { taskType: "web_form", title: "Fill out a multi-step web form" },
  { taskType: "spreadsheet", title: "Navigate & edit a spreadsheet to a target state" },
  { taskType: "web_research", title: "Research a question across multiple browser tabs" },
  { taskType: "email_triage", title: "Triage an email inbox: label, archive, reply" },
  { taskType: "game_fps", title: "Game: FPS aim-correction sequences" },
];

function CreateBounty({ address, onCreated }: { address: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState("web_form");
  const [reward, setReward] = useState("0.01");
  const [revReward, setRevReward] = useState("0.001");
  const [reviews, setReviews] = useState(3);
  const [count, setCount] = useState(12);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const perSub = (Number(reward) + Number(revReward) * reviews) || 0;

  async function submit() {
    setMsg("");
    if (!address) return setMsg("Connect your wallet first.");
    if (!title || !taskType) return setMsg("Title and task type are required.");
    setBusy(true);
    try {
      await createBountyOnChain(title, taskType, reward, revReward, reviews, count);
      setMsg("✓ Bounty created and funded on 0G Chain.");
      setTitle("");
      onCreated();
      setOpen(false);
    } catch (e: any) {
      setMsg(e?.shortMessage || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Dataset Buyer (AI team)</div>
          <h3 className="text-lg font-bold">Post a computer-use data bounty</h3>
          <p className="text-sm text-muted">
            Escrow {OG.currency} per approved bundle plus per-review rewards. You get verified,
            provenance-tracked, human-reviewed training traces.
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "+ New bounty"}</button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Task type">
            <select
              className="inp"
              value={taskType}
              onChange={(e) => {
                setTaskType(e.target.value);
                const p = PRESETS.find((x) => x.taskType === e.target.value);
                if (p && !title) setTitle(p.title);
              }}
            >
              {["web_form", "spreadsheet", "web_research", "email_triage", "file_management", "game_fps", "game_parkour"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input className="inp" placeholder="Fill out a multi-step web form" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={`Reward per approved bundle (${OG.currency})`}>
            <input className="inp" type="number" step="0.001" value={reward} onChange={(e) => setReward(e.target.value)} />
          </Field>
          <Field label={`Reward per review (${OG.currency})`}>
            <input className="inp" type="number" step="0.001" value={revReward} onChange={(e) => setRevReward(e.target.value)} />
          </Field>
          <Field label="Reviewers per submission (N)">
            <input className="inp" type="number" min={1} max={9} value={reviews} onChange={(e) => setReviews(Number(e.target.value))} />
          </Field>
          <Field label="Submissions to fund">
            <input className="inp" type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          <div className="sm:col-span-2 flex items-center justify-between">
            <span className="text-xs text-muted">
              Escrow total: <b className="text-white">{(perSub * count).toFixed(4)} {OG.currency}</b>{" "}
              <span className="opacity-60">({perSub.toFixed(4)}/submission × {count})</span>
            </span>
            <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? "Confirm in wallet…" : "Create & fund"}</button>
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
        :global(.inp:focus) { outline: none; border-color: #7c5cff; }
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
