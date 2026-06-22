"use client";

import type { SubmissionRecord } from "@/lib/types";
import { short } from "@/lib/client-contract";
import { explorerAddress, OG } from "@/lib/config";

export default function Leaderboard({
  submissions,
  me,
}: {
  submissions: SubmissionRecord[];
  me: string;
}) {
  const approved = submissions.filter((s) => s.status === "approved");

  // Aggregate per contributor.
  const byPlayer = new Map<
    string,
    { player: string; clips: number; earned: number; best: number }
  >();
  for (const s of approved) {
    const e = byPlayer.get(s.player) ?? { player: s.player, clips: 0, earned: 0, best: 0 };
    e.clips += 1;
    e.best = Math.max(e.best, s.analysis.proofOfPlay.total);
    if (s.paid) e.earned += rewardOf(s); // approximate via reward lookup below
    byPlayer.set(s.player, e);
  }

  const rows = Array.from(byPlayer.values()).sort((a, b) => b.clips - a.clips || b.best - a.best);

  const topClip = [...approved].sort(
    (a, b) => b.analysis.proofOfPlay.total - a.analysis.proofOfPlay.total
  )[0];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="card lg:col-span-2">
        <div className="label mb-3">Top contributors</div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No approved clips yet — be the first on the board.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div
                key={r.player}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  r.player.toLowerCase() === me.toLowerCase()
                    ? "border-brand/60 bg-brand/5"
                    : "border-edge bg-panel2/40"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                    i === 0
                      ? "bg-warn/20 text-warn"
                      : i === 1
                      ? "bg-muted/20 text-muted"
                      : "bg-edge text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <a
                  href={explorerAddress(r.player)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 font-mono text-sm hover:text-brand2"
                >
                  {short(r.player)}
                  {r.player.toLowerCase() === me.toLowerCase() && (
                    <span className="ml-2 chip">you</span>
                  )}
                </a>
                <span className="text-sm">
                  <b>{r.clips}</b> <span className="text-muted">clips</span>
                </span>
                <span className="text-sm">
                  best <b className="text-good">{r.best}</b>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="label mb-3">Highest-quality clip</div>
        {topClip ? (
          <div className="space-y-2">
            {topClip.clipUrl && (
              <video
                src={topClip.clipUrl}
                controls
                className="max-h-32 w-full rounded-lg border border-edge bg-black object-contain"
              />
            )}
            <div className="text-3xl font-extrabold text-good">
              {topClip.analysis.proofOfPlay.total}
              <span className="text-base text-muted">/100</span>
            </div>
            <div className="text-xs text-muted">by {short(topClip.player)}</div>
            <div className="flex flex-wrap gap-1">
              {topClip.analysis.labels.actions.slice(0, 4).map((a) => (
                <span key={a} className="chip">
                  {a}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No clips yet.</p>
        )}
        <div className="mt-4 border-t border-edge pt-3 text-xs text-muted">
          Rewards paid in {OG.currency} on {OG.networkName}.
        </div>
      </div>
    </div>
  );
}

// Reward is escrowed per-bounty on-chain; for the board we treat each paid clip
// as one reward unit. The dataset/buyer view shows exact 0G amounts per bounty.
function rewardOf(_s: SubmissionRecord) {
  return 1;
}
