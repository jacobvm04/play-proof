"use client";

import { useCallback, useEffect, useState } from "react";
import WalletBar, { useWallet } from "@/components/WalletBar";
import MissionBoard from "@/components/MissionBoard";
import MissionFlow from "@/components/MissionFlow";
import ReviewQueue from "@/components/ReviewQueue";
import MySubmissions from "@/components/MySubmissions";
import Leaderboard from "@/components/Leaderboard";
import DatasetView from "@/components/DatasetView";
import type { Bounty, SubmissionRecord } from "@/lib/types";
import { OG } from "@/lib/config";

type Tab = "contribute" | "review" | "leaderboard" | "datasets";

export default function Home() {
  const { address, connect, err } = useWallet();
  const [tab, setTab] = useState<Tab>("contribute");
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [active, setActive] = useState<Bounty | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [bRes, sRes] = await Promise.all([
      fetch("/api/bounties").then((r) => r.json()),
      fetch("/api/submissions").then((r) => r.json()),
    ]);
    setBounties(bRes.bounties ?? []);
    setConfigured(bRes.configured);
    setSubmissions(sRes.submissions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approved = submissions.filter((s) => s.status === "approved");
  const pendingReview = submissions.filter(
    (s) => s.status === "pending" && s.id >= 0 && s.review.totalReviews < s.review.requiredReviews
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <span className="text-brand">▰</span> PlayProof
          </h1>
          <p className="text-sm text-muted">
            Onchain marketplace for verified human computer-use data — the traces that train AI agents.
          </p>
        </div>
        <WalletBar address={address} onConnect={connect} />
      </header>

      {err && <div className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">{err}</div>}

      {!configured && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Contract not configured. Run <code>npm run chain</code> then{" "}
          <code>npm run deploy &amp;&amp; npm run seed</code> (local), or set{" "}
          <code>NEXT_PUBLIC_PLAYPROOF_CONTRACT</code> for 0G testnet.
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <div className="card sm:col-span-2">
          <p className="text-sm">
            Computer-use AI agents need real human task traces — today that data is scraped, video-only,
            unverified, and unpaid. PlayProof is the decentralized alternative:{" "}
            <b className="text-white">
              people record tasks (screen + synced inputs), AI pre-screens, humans verify by review
              consensus, 0G stores the bundles, and everyone gets paid onchain.
            </b>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip">0G Storage · trace bundles + root hash</span>
            <span className="chip">0G Compute · pre-screen + labeling</span>
            <span className="chip">0G Chain · review consensus + payouts</span>
          </div>
        </div>
        <StatCard n={bounties.length} l="task bounties" />
        <StatCard
          n={approved.length}
          l="verified bundles"
          sub={`${new Set(approved.map((s) => s.contributor)).size} contributors`}
        />
      </section>

      <nav className="mb-5 flex flex-wrap gap-2">
        <TabBtn on={tab === "contribute"} onClick={() => setTab("contribute")}>🖥️ Contribute</TabBtn>
        <TabBtn on={tab === "review"} onClick={() => setTab("review")}>
          🧑‍⚖️ Review {pendingReview > 0 && <span className="ml-1 rounded-full bg-bad px-1.5 text-[10px] text-white">{pendingReview}</span>}
        </TabBtn>
        <TabBtn on={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>🏆 Leaderboard</TabBtn>
        <TabBtn on={tab === "datasets"} onClick={() => setTab("datasets")}>📦 Datasets &amp; Buyers</TabBtn>
      </nav>

      {loading ? (
        <div className="card text-center text-muted">Loading from 0G Chain…</div>
      ) : tab === "contribute" ? (
        <div className="space-y-5">
          <MissionBoard bounties={bounties} activeId={active?.id ?? null} onSelect={setActive} />
          {active ? (
            address ? (
              <MissionFlow bounty={active} address={address} onComplete={refresh} />
            ) : (
              <ConnectPrompt connect={connect} />
            )
          ) : (
            <div className="card text-center text-muted">Pick a task above to start contributing data.</div>
          )}
          <MySubmissions submissions={submissions} bounties={bounties} address={address} onRefresh={refresh} />
        </div>
      ) : tab === "review" ? (
        <ReviewQueue submissions={submissions} bounties={bounties} address={address} onRefresh={refresh} />
      ) : tab === "leaderboard" ? (
        <Leaderboard submissions={submissions} me={address} />
      ) : (
        <DatasetView bounties={bounties} submissions={submissions} address={address} onRefresh={refresh} />
      )}

      <footer className="mt-10 border-t border-edge pt-4 text-center text-xs text-muted">
        PlayProof · the data layer for computer-use AI · built on 0G ({OG.networkName})
      </footer>
    </main>
  );
}

function ConnectPrompt({ connect }: { connect: () => void }) {
  return (
    <div className="card flex items-center justify-between">
      <span className="text-sm text-muted">Connect your wallet to record a task and earn {OG.currency}.</span>
      <button className="btn-primary" onClick={connect}>Connect Wallet</button>
    </div>
  );
}

function StatCard({ n, l, sub }: { n: number | string; l: string; sub?: string }) {
  return (
    <div className="card">
      <div className="stat">{n}</div>
      <div className="label">{l}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
        on ? "bg-brand text-white shadow-glow" : "border border-edge bg-panel2 text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
