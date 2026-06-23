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
import { isTrustedReviewer } from "@/lib/trusted";
import { fetchJson } from "@/lib/fetch-json";

type Tab = "contribute" | "review" | "leaderboard" | "datasets";

export default function Home() {
  const { address, connect, err, roster, isBurner, useBurner, disconnect, wallets } = useWallet();
  const [tab, setTab] = useState<Tab>("contribute");
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [active, setActive] = useState<Bounty | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [bRes, sRes] = await Promise.all([
      fetchJson<any>("/api/bounties"),
      fetchJson<any>("/api/submissions"),
    ]);
    if (bRes.ok) {
      setBounties(bRes.data.bounties ?? []);
      setConfigured(bRes.data.configured);
    }
    if (sRes.ok) setSubmissions(sRes.data.submissions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approved = submissions.filter((s) => s.status === "approved");
  const pendingReview = submissions.filter((s) => s.status === "pending" && s.id >= 0).length;

  // Reviewing is restricted to trusted wallets and not surfaced to normal users.
  const canReview = isTrustedReviewer(address);
  // Don't strand a non-trusted wallet on the (now hidden) review tab.
  const effectiveTab: Tab = tab === "review" && !canReview ? "contribute" : tab;

  const minutes = approved.reduce((m, s) => m + (s.manifest?.durationMs ?? 0) / 60000, 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      {/* ── Masthead: the deck nameplate + transport + live counters ── */}
      <header className="mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="mt-1 inline-block h-3 w-3 rounded-full bg-rec shadow-rec animate-recPulse" aria-hidden />
            <div>
              <h1 className="font-mono text-2xl font-bold uppercase tracking-stamp text-bone">
                Play<span className="text-phosphor">Proof</span>
              </h1>
              <p className="mt-1 max-w-md text-sm text-muted">
                A capture deck for the human recordings that train computer-use agents. Record a take,
                get it verified, earn <span className="text-phosphor">0G</span>.
              </p>
            </div>
          </div>
          <WalletBar
            address={address}
            onConnect={connect}
            roster={roster}
            isBurner={isBurner}
            onUseBurner={useBurner}
            onDisconnect={disconnect}
            wallets={wallets}
          />
        </div>

        {/* Signature: a live transport rail with a sweeping playhead + counters. */}
        <div className="mt-5 rounded-deck border border-edge bg-deck p-4 shadow-inset">
          <div className="flex items-center justify-between">
            <span className="stamp">▍ transport · {OG.networkName}</span>
            <span className="stamp text-phosphor/80">REC-READY</span>
          </div>
          <div className="transport mt-3">
            <div className="playhead animate-playhead" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Counter v={bounties.length} l="open bounties" />
            <Counter v={approved.length} l="verified takes" accent />
            <Counter v={new Set(approved.map((s) => s.contributor)).size} l="contributors" />
            <Counter v={minutes.toFixed(1)} l="minutes banked" />
          </div>
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-deck border border-rec/50 bg-rec/10 px-4 py-2 font-mono text-xs text-rec">
          {err}
        </div>
      )}

      {!configured && (
        <div className="mb-4 rounded-deck border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          No deck loaded. Run <code className="font-mono">npm run chain</code>, then{" "}
          <code className="font-mono">npm run deploy &amp;&amp; npm run seed</code> (local), or point{" "}
          <code className="font-mono">NEXT_PUBLIC_PLAYPROOF_CONTRACT</code> at 0G testnet.
        </div>
      )}

      {/* Thesis line — what this is, in the deck's voice. */}
      <p className="mb-6 max-w-3xl text-[15px] leading-relaxed text-bone/90">
        Computer-use agents need real recordings of people doing tasks. Today that data is scraped,
        unverified, and unpaid.{" "}
        <span className="text-phosphor">Here you record the take, a trusted reviewer signs off, 0G
        stores it, and you get paid onchain.</span>
      </p>

      {/* ── Channel selector (tabs as deck inputs) ── */}
      <nav className="mb-5 flex flex-wrap items-stretch gap-px overflow-hidden rounded-deck border border-edge bg-edge">
        <TabBtn on={effectiveTab === "contribute"} onClick={() => setTab("contribute")} ch="01">Record</TabBtn>
        {canReview && (
          <TabBtn on={effectiveTab === "review"} onClick={() => setTab("review")} ch="02">
            Review{pendingReview > 0 && <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rec px-1 text-[10px] font-bold text-bone">{pendingReview}</span>}
          </TabBtn>
        )}
        <TabBtn on={effectiveTab === "leaderboard"} onClick={() => setTab("leaderboard")} ch="03">Reel</TabBtn>
        <TabBtn on={effectiveTab === "datasets"} onClick={() => setTab("datasets")} ch="04">Datasets</TabBtn>
      </nav>

      {loading ? (
        <div className="card text-center text-muted">Loading from 0G Chain…</div>
      ) : effectiveTab === "contribute" ? (
        <div className="space-y-5">
          <MissionBoard bounties={bounties} activeId={active?.id ?? null} onSelect={setActive} />
          {active ? (
            address ? (
              <MissionFlow bounty={active} address={address} onComplete={refresh} />
            ) : (
              <ConnectPrompt connect={connect} />
            )
          ) : (
            <div className="card text-center text-sm text-muted">Load a bounty above to start a take.</div>
          )}
          <MySubmissions submissions={submissions} bounties={bounties} address={address} onRefresh={refresh} />
        </div>
      ) : effectiveTab === "review" ? (
        <ReviewQueue submissions={submissions} bounties={bounties} address={address} onRefresh={refresh} />
      ) : effectiveTab === "leaderboard" ? (
        <Leaderboard submissions={submissions} me={address} />
      ) : (
        <DatasetView bounties={bounties} submissions={submissions} address={address} onRefresh={refresh} />
      )}

      <footer className="mt-12 flex items-center justify-between border-t border-edge pt-4">
        <span className="stamp">PlayProof · capture deck for computer-use AI</span>
        <span className="stamp">0G · {OG.networkName}</span>
      </footer>
    </main>
  );
}

function ConnectPrompt({ connect }: { connect: () => void }) {
  return (
    <div className="card flex items-center justify-between">
      <span className="text-sm text-muted">Connect a wallet to record a take and earn {OG.currency}.</span>
      <button className="btn-primary" onClick={connect}>Connect wallet</button>
    </div>
  );
}

// A counter readout on the deck — monospace, like a tape counter.
function Counter({ v, l, accent }: { v: number | string; l: string; accent?: boolean }) {
  return (
    <div className="rounded-deck border border-edge bg-ink/50 px-3 py-2">
      <div className={`readout text-2xl font-bold leading-none ${accent ? "text-phosphor" : "text-bone"}`}>{v}</div>
      <div className="label mt-1.5">{l}</div>
    </div>
  );
}

// Channel selector — a deck input button with a channel number.
function TabBtn({
  on,
  onClick,
  children,
  ch,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ch: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${
        on ? "bg-deck text-phosphor" : "bg-ink/60 text-muted hover:text-bone"
      }`}
    >
      <span className={`font-mono text-[10px] ${on ? "text-phosphor/70" : "text-muted/60"}`}>{ch}</span>
      {children}
    </button>
  );
}
