"use client";

import { useMemo, useState } from "react";
import type { Bounty, SubmissionRecord } from "@/lib/types";
import { claimRewardOnChain } from "@/lib/client-contract";
import { OG } from "@/lib/config";
import { TxLink } from "./links";

// A contributor's own submissions and their review/claim status.
export default function MySubmissions({
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
  const mine = useMemo(
    () =>
      submissions.filter((s) => s.contributor.toLowerCase() === address.toLowerCase()),
    [submissions, address]
  );
  const bountyOf = (id: number) => bounties.find((b) => b.id === id);

  if (!address) return null;
  if (mine.length === 0) return null;

  return (
    <div className="card">
      <div className="label mb-3">My submissions</div>
      <div className="space-y-2">
        {mine.map((s) => (
          <Row key={`${s.id}-${s.storageRootHash}`} s={s} bounty={bountyOf(s.bountyId)} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}

function Row({ s, bounty, onRefresh }: { s: SubmissionRecord; bounty?: Bounty; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");

  async function claim() {
    setBusy(true);
    setMsg("");
    try {
      const h = await claimRewardOnChain(s.id);
      setTx(h);
      setMsg("✓ Claimed");
      onRefresh();
    } catch (e: any) {
      setMsg(e?.shortMessage || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const statusPill =
    s.status === "approved"
      ? "border-good/50 text-good"
      : s.status === "rejected"
      ? "border-bad/50 text-bad"
      : "border-warn/50 text-warn";

  return (
    <div className="flex items-center gap-3 rounded-deck border border-edge bg-panel2/40 px-3 py-2.5">
      <span className="chip">#{s.id}</span>
      <div className="flex-1">
        <div className="truncate text-sm font-semibold">{bounty?.title ?? `Bounty ${s.bountyId}`}</div>
        <div className="text-xs text-muted">
          {s.status === "pending"
            ? "awaiting verification"
            : s.status === "approved"
            ? "verified by a trusted reviewer"
            : "rejected by a reviewer"}
        </div>
      </div>
      <span className={`chip ${statusPill}`}>{s.status}</span>
      {s.status === "approved" && !s.paid && (
        <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={claim}>
          {busy ? "…" : `Claim ${bounty?.rewardPerClip ?? ""} ${OG.currency}`}
        </button>
      )}
      {s.paid && (
        <span className="chip border-good/50 text-good">
          paid <TxLink hash={s.claimTxHash} className="ml-1 underline">↗</TxLink>
        </span>
      )}
      {msg && <span className="text-xs text-muted">{msg} <TxLink hash={tx} className="text-brand2">↗</TxLink></span>}
    </div>
  );
}
