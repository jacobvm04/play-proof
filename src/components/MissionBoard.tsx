"use client";

import type { Bounty } from "@/lib/types";
import { OG } from "@/lib/config";

const ICON: Record<string, string> = {
  parkour: "🏃",
  aim_correction: "🎯",
  racing: "🏎️",
  dialogue: "💬",
  boss_fail: "💀",
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
        No bounties yet. Deploy the contract and run <code className="text-brand2">npm run seed</code>, or
        create one from the Dataset Buyer tab.
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {bounties.map((b) => {
        const clipsLeft = Math.floor(
          Number(b.remainingBudget) / Math.max(Number(b.rewardPerClip), 1e-9)
        );
        const active = activeId === b.id;
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            disabled={!b.active}
            className={`card text-left transition hover:border-brand/60 ${
              active ? "border-brand shadow-glow" : ""
            } ${!b.active ? "opacity-50" : ""}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xl">{ICON[b.requiredLabel] ?? "🎮"}</span>
              <span className="chip">#{b.id}</span>
            </div>
            <h3 className="text-base font-bold leading-tight">{b.title}</h3>
            <div className="mt-1 text-xs text-muted">
              label: <span className="font-mono text-brand2">{b.requiredLabel}</span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="label">reward / clip</div>
                <div className="text-lg font-bold text-good">
                  {b.rewardPerClip} {OG.currency}
                </div>
              </div>
              <div className="text-right">
                <div className="label">approved</div>
                <div className="text-lg font-bold">{b.approvedCount}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>~{clipsLeft} clips fundable</span>
              <span className={active ? "text-brand" : ""}>{active ? "selected ▸" : "start ▸"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
