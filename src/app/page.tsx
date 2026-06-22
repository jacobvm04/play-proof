"use client";

import { useCallback, useEffect, useState } from "react";
import WalletBar, { useWallet } from "@/components/WalletBar";
import MissionBoard from "@/components/MissionBoard";
import MissionFlow from "@/components/MissionFlow";
import Leaderboard from "@/components/Leaderboard";
import DatasetView from "@/components/DatasetView";
import type { Bounty, SubmissionRecord } from "@/lib/types";
import { OG } from "@/lib/config";

type Tab = "play" | "leaderboard" | "datasets";

export default function Home() {
  const { address, connect, err } = useWallet();
  const [tab, setTab] = useState<Tab>("play");
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

  const totalClips = submissions.filter((s) => s.status === "approved").length;
  const totalContributors = new Set(
    submissions.filter((s) => s.status === "approved").map((s) => s.player)
  ).size;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <span className="text-brand">▰</span> PlayProof
          </h1>
          <p className="text-sm text-muted">
            Earn onchain rewards for gameplay clips that train gaming AI.
          </p>
        </div>
        <WalletBar address={address} onConnect={connect} />
      </header>

      {err && (
        <div className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          {err}
        </div>
      )}

      {!configured && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Contract not configured. Run <code>npm run compile && npm run deploy && npm run seed</code>,
          then set <code>NEXT_PUBLIC_PLAYPROOF_CONTRACT</code> in <code>.env.local</code>.
        </div>
      )}

      {/* Pitch + live stats */}
      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <div className="card sm:col-span-2">
          <p className="text-sm">
            AI gaming agents need real human gameplay data — today it&apos;s scraped, unverified, and
            unpaid. PlayProof is the decentralized alternative:{" "}
            <b className="text-white">
              gamers complete data bounties, AI verifies clips, 0G stores datasets, and contributors
              get paid onchain.
            </b>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="chip">0G Storage · clip bytes + root hash</span>
            <span className="chip">0G Compute · quality + labeling</span>
            <span className="chip">0G Chain · provenance + payout</span>
          </div>
        </div>
        <StatCard n={bounties.length} l="active bounties" />
        <StatCard n={totalClips} l="approved clips" sub={`${totalContributors} contributors`} />
      </section>

      {/* Tabs */}
      <nav className="mb-5 flex gap-2">
        <TabBtn on={tab === "play"} onClick={() => setTab("play")}>
          🎮 Play & Earn
        </TabBtn>
        <TabBtn on={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>
          🏆 Leaderboard
        </TabBtn>
        <TabBtn on={tab === "datasets"} onClick={() => setTab("datasets")}>
          📦 Datasets & Buyers
        </TabBtn>
      </nav>

      {loading ? (
        <div className="card text-center text-muted">Loading from 0G Chain…</div>
      ) : tab === "play" ? (
        <div className="space-y-5">
          <MissionBoard
            bounties={bounties}
            activeId={active?.id ?? null}
            onSelect={(b) => setActive(b)}
          />
          {active ? (
            address ? (
              <MissionFlow bounty={active} address={address} onComplete={refresh} />
            ) : (
              <div className="card flex items-center justify-between">
                <span className="text-sm text-muted">
                  Connect your wallet to start the mission and earn {OG.currency}.
                </span>
                <button className="btn-primary" onClick={connect}>
                  Connect Wallet
                </button>
              </div>
            )
          ) : (
            <div className="card text-center text-muted">
              Pick a mission above to start contributing gameplay data.
            </div>
          )}
        </div>
      ) : tab === "leaderboard" ? (
        <Leaderboard submissions={submissions} me={address} />
      ) : (
        <DatasetView
          bounties={bounties}
          submissions={submissions}
          address={address}
          onRefresh={refresh}
        />
      )}

      <footer className="mt-10 border-t border-edge pt-4 text-center text-xs text-muted">
        PlayProof · the data layer for game-playing AI · built on 0G ({OG.networkName})
      </footer>
    </main>
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

function TabBtn({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
