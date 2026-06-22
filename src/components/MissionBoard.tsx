"use client";

import type { Bounty } from "@/lib/types";
import { OG } from "@/lib/config";

const ICON: Record<string, string> = {
  web_form: "📝",
  spreadsheet: "📊",
  web_research: "🔎",
  email_triage: "📧",
  file_management: "🗂️",
  game_fps: "🎯",
  game_parkour: "🏃",
};

export default function MissionBoard({
  bounties,
  activeId,
  onSelect,
}: {
  bounties: Bounty[];
  activeId: number | null;
  onSelect: (b: Bounty) => void;
}) {
  if (!bounties.length) {
    return (
      <div className="card text-center text-muted">
        No task bounties yet. Run <code className="text-brand2">npm run deploy &amp;&amp; npm run seed</code>, or
        post one from the Datasets &amp; Buyers tab.
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {bounties.map((b) => {
        const perSub = Number(b.rewardPerClip) + Number(b.reviewerReward) * b.requiredReviews;
        const subsLeft = perSub > 0 ? Math.floor(Number(b.remainingBudget) / perSub) : 0;
        const active = activeId === b.id;
        const isGame = b.taskType.startsWith("game_");
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            disabled={!b.active}
            className={`card text-left transition hover:border-brand/60 ${active ? "border-brand shadow-glow" : ""} ${!b.active ? "opacity-50" : ""}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xl">{ICON[b.taskType] ?? "🖥️"}</span>
              <span className="chip">{isGame ? "game" : "computer-use"}</span>
            </div>
            <h3 className="text-base font-bold leading-tight">{b.title}</h3>
            <div className="mt-1 text-xs text-muted">
              task: <span className="font-mono text-brand2">{b.taskType}</span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="label">reward / approved</div>
                <div className="text-lg font-bold text-good">{b.rewardPerClip} {OG.currency}</div>
              </div>
              <div className="text-right">
                <div className="label">reviews</div>
                <div className="text-lg font-bold">{b.requiredReviews}×</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>~{subsLeft} submissions fundable</span>
              <span className={active ? "text-brand" : ""}>{active ? "selected ▸" : "start ▸"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
