"use client";

import { useMemo } from "react";
import type { SubmissionRecord } from "@/lib/types";
import { short } from "@/lib/client-contract";
import { OG } from "@/lib/config";
import { AddressLink } from "./links";

export default function Leaderboard({ submissions, me }: { submissions: SubmissionRecord[]; me: string }) {
  const approved = submissions.filter((s) => s.status === "approved");

  const contributors = useMemo(() => {
    const m = new Map<string, { who: string; bundles: number; minutes: number }>();
    for (const s of approved) {
      const e = m.get(s.contributor) ?? { who: s.contributor, bundles: 0, minutes: 0 };
      e.bundles += 1;
      e.minutes += (s.manifest?.durationMs ?? 0) / 60000;
      m.set(s.contributor, e);
    }
    return Array.from(m.values()).sort((a, b) => b.bundles - a.bundles || b.minutes - a.minutes);
  }, [approved]);

  const topBundle = useMemo(
    () => [...approved].sort((a, b) => (b.manifest?.durationMs ?? 0) - (a.manifest?.durationMs ?? 0))[0],
    [approved]
  );

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card lg:col-span-2">
        <div className="label mb-3">Top contributors</div>
        {contributors.length === 0 ? (
          <p className="text-sm text-muted">No human-approved recordings yet — be the first on the board.</p>
        ) : (
          <div className="space-y-2">
            {contributors.map((r, i) => (
              <div
                key={r.who}
                className={`flex items-center gap-3 rounded-deck border px-3 py-2.5 ${
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
                <span className="flex-1 font-mono text-sm">
                  <AddressLink address={r.who} className="hover:text-brand2" />
                  {r.who.toLowerCase() === me.toLowerCase() && <span className="ml-2 chip">you</span>}
                </span>
                <span className="text-sm"><b>{r.bundles}</b> <span className="text-muted">recordings</span></span>
                <span className="text-sm"><b className="text-good">{r.minutes.toFixed(1)}</b> <span className="text-muted">min</span></span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="label mb-3">Latest verified recording</div>
        {topBundle ? (
          <div className="space-y-2">
            {topBundle.videoUrl && (
              <video src={topBundle.videoUrl} controls className="max-h-32 w-full rounded-deck border border-edge bg-black object-contain" />
            )}
            <div className="text-xs text-muted">by {short(topBundle.contributor)} · {topBundle.analysis.labels.taskType}</div>
            <div className="text-xs text-muted">
              {((topBundle.manifest?.durationMs ?? 0) / 1000).toFixed(1)}s · human-verified
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No recordings yet.</p>
        )}
        <div className="mt-4 border-t border-edge pt-3 text-xs text-muted">
          Rewards paid in {OG.currency} on {OG.networkName}. Human-verified by review consensus.
        </div>
      </div>
    </div>
  );
}
