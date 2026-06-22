"use client";

import { useMemo } from "react";
import type { SubmissionRecord } from "@/lib/types";
import { short } from "@/lib/client-contract";
import { explorerAddress, OG } from "@/lib/config";

export default function Leaderboard({ submissions, me }: { submissions: SubmissionRecord[]; me: string }) {
  const approved = submissions.filter((s) => s.status === "approved");

  const contributors = useMemo(() => {
    const m = new Map<string, { who: string; bundles: number; best: number }>();
    for (const s of approved) {
      const e = m.get(s.contributor) ?? { who: s.contributor, bundles: 0, best: 0 };
      e.bundles += 1;
      e.best = Math.max(e.best, s.analysis.proofOfPlay.total);
      m.set(s.contributor, e);
    }
    return Array.from(m.values()).sort((a, b) => b.bundles - a.bundles || b.best - a.best);
  }, [approved]);

  const topBundle = useMemo(
    () => [...approved].sort((a, b) => b.analysis.proofOfPlay.total - a.analysis.proofOfPlay.total)[0],
    [approved]
  );

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card lg:col-span-2">
        <div className="label mb-3">Top contributors</div>
        {contributors.length === 0 ? (
          <p className="text-sm text-muted">No human-approved bundles yet — be the first on the board.</p>
        ) : (
          <div className="space-y-2">
            {contributors.map((r, i) => (
              <div
                key={r.who}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  r.who.toLowerCase() === me.toLowerCase() ? "border-brand/60 bg-brand/5" : "border-edge bg-panel2/40"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                    i === 0 ? "bg-warn/20 text-warn" : i === 1 ? "bg-muted/20 text-muted" : "bg-edge text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <a href={explorerAddress(r.who)} target="_blank" rel="noreferrer" className="flex-1 font-mono text-sm hover:text-brand2">
                  {short(r.who)}
                  {r.who.toLowerCase() === me.toLowerCase() && <span className="ml-2 chip">you</span>}
                </a>
                <span className="text-sm"><b>{r.bundles}</b> <span className="text-muted">bundles</span></span>
                <span className="text-sm">best <b className="text-good">{r.best}</b></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="label mb-3">Highest-rated bundle</div>
        {topBundle ? (
          <div className="space-y-2">
            {topBundle.videoUrl && (
              <video src={topBundle.videoUrl} controls className="max-h-32 w-full rounded-lg border border-edge bg-black object-contain" />
            )}
            <div className="text-3xl font-extrabold text-good">
              {topBundle.analysis.proofOfPlay.total}
              <span className="text-base text-muted">/100</span>
            </div>
            <div className="text-xs text-muted">by {short(topBundle.contributor)} · {topBundle.analysis.labels.taskType}</div>
            <div className="flex flex-wrap gap-1">
              {topBundle.analysis.labels.actions.slice(0, 4).map((a) => (
                <span key={a} className="chip">{a}</span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No bundles yet.</p>
        )}
        <div className="mt-4 border-t border-edge pt-3 text-xs text-muted">
          Rewards paid in {OG.currency} on {OG.networkName}. Human-verified by review consensus.
        </div>
      </div>
    </div>
  );
}
