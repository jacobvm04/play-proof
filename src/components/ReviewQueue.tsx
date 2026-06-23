"use client";

import { useMemo, useState } from "react";
import type { Bounty, SubmissionRecord } from "@/lib/types";
import { short, submitReviewOnChain } from "@/lib/client-contract";
import { OG } from "@/lib/config";
import { TxLink, StorageRef } from "./links";

// The trusted-reviewer queue. Reviewers play back a contributor's recording and
// vote approve/reject on-chain. Each review pays the bounty's per-review reward.
// Once N reviews are in, anyone finalizes and >50% wins.
export default function ReviewQueue({
  submissions,
  bounties,
  address,
  onRefresh,
}: {
  submissions: SubmissionRecord[];
  bounties: Bounty[];
  address: string;
  onRefresh: () => void;
}) {
  const pending = useMemo(
    () =>
      submissions.filter(
        (s) =>
          s.status === "pending" &&
          s.id >= 0 &&
          s.contributor.toLowerCase() !== address.toLowerCase()
      ),
    [submissions, address]
  );

  const bountyOf = (id: number) => bounties.find((b) => b.id === id);

  if (!address) {
    return <div className="card text-center text-muted">Connect your wallet to review submissions and earn {OG.currency}.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <div className="label">Decentralized human review</div>
          <h3 className="text-lg font-bold">Review Queue</h3>
          <p className="text-sm text-muted">
            Play back a contributor&apos;s trace and vote. Each review pays the per-review reward; a
            strict majority (&gt;50% of N reviewers) decides approval.
          </p>
        </div>
        <span className="chip">{pending.length} awaiting review</span>
      </div>

      {pending.length === 0 ? (
        <div className="card text-center text-muted">
          No submissions need your review right now. Contribute a task or check back later.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pending.map((s) => (
            <ReviewCard
              key={s.id}
              s={s}
              bounty={bountyOf(s.bountyId)}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  s,
  bounty,
  onRefresh,
}: {
  s: SubmissionRecord;
  bounty?: Bounty;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");

  async function vote(approve: boolean) {
    setMsg("");
    setBusy(approve ? "approve" : "reject");
    try {
      // A single review settles the submission on-chain (approve → approved,
      // reject → rejected) and pays the reviewer reward. Chain is the source of
      // truth, so we just refetch after the tx settles.
      const h = await submitReviewOnChain(s.id, approve);
      setTx(h);
      setMsg(approve ? "✓ Approved on-chain" : "✓ Rejected on-chain");
      onRefresh();
    } catch (e: any) {
      setMsg(e?.shortMessage || e?.message || String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <span className="chip">#{s.id} · {s.analysis.labels.taskType}</span>
        <span className="chip">{((s.manifest?.durationMs ?? 0) / 1000).toFixed(1)}s</span>
      </div>
      <div className="text-sm font-semibold">{bounty?.title ?? `Bounty ${s.bountyId}`}</div>
      <div className="mt-1 text-xs text-muted">by {short(s.contributor)}</div>

      {s.videoUrl && (
        <video src={s.videoUrl} controls className="mt-3 max-h-48 w-full rounded-deck border border-edge bg-black object-contain" />
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
        <Cell n={`${((s.manifest?.durationMs ?? 0) / 1000).toFixed(1)}s`} l="duration" />
        <Cell
          n={s.manifest ? `${s.manifest.screen.width}×${s.manifest.screen.height}` : "—"}
          l="resolution"
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>your verdict settles this submission</span>
        {bounty && (
          <span className="text-good">earn {bounty.reviewerReward} {OG.currency}</span>
        )}
      </div>

      <div className="mt-2 truncate text-[11px] text-muted">
        0G: <StorageRef rootHash={s.storageRootHash} uploaded={s.storageTxHash != null} className="text-brand2" />
      </div>

      <div className="mt-3 flex gap-2">
        <button className="btn-primary flex-1 bg-good hover:bg-good/90" disabled={!!busy} onClick={() => vote(true)}>
          {busy === "approve" ? "Confirm…" : "👍 Approve"}
        </button>
        <button className="btn-ghost flex-1 border-bad/50 text-bad" disabled={!!busy} onClick={() => vote(false)}>
          {busy === "reject" ? "Confirm…" : "👎 Reject"}
        </button>
      </div>
      {msg && (
        <div className="mt-2 text-xs text-muted">
          {msg} {tx && <TxLink hash={tx} className="text-brand2 hover:underline" />}
        </div>
      )}
    </div>
  );
}

function Cell({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="rounded-deck border border-edge bg-panel2/40 py-1.5">
      <div className="text-sm font-bold">{n}</div>
      <div className="label">{l}</div>
    </div>
  );
}
