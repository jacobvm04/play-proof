"use client";

import type { Bounty } from "@/lib/types";
import { OG } from "@/lib/config";

// Short task codes shown like a slate marker, derived from the task type.
const CODE: Record<string, string> = {
  web_form: "FRM",
  spreadsheet: "SHT",
  web_research: "RSH",
  email_triage: "EML",
  file_management: "FIL",
  game_fps: "FPS",
  game_parkour: "PKR",
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
      <div className="card text-center text-sm text-muted">
        No bounties loaded. Run{" "}
        <code className="font-mono text-phosphor">npm run deploy &amp;&amp; npm run seed</code>, or post one
        from the Datasets tab.
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {bounties.map((b) => {
        const perSub = Number(b.rewardPerClip) + Number(b.reviewerReward);
        const takesLeft = perSub > 0 ? Math.floor(Number(b.remainingBudget) / perSub) : 0;
        const active = activeId === b.id;
        const isGame = b.taskType.startsWith("game_");
        const code = CODE[b.taskType] ?? "TSK";
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b)}
            disabled={!b.active}
            className={`group flex flex-col rounded-deck border bg-deck text-left shadow-inset transition ${
              active ? "border-phosphor" : "border-edge hover:border-rail"
            } ${!b.active ? "opacity-40" : ""}`}
          >
            {/* slate strip */}
            <div
              className={`flex items-center justify-between border-b px-3 py-2 ${
                active ? "border-phosphor/40 bg-phosphor/10" : "border-edge bg-ink/40"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`font-mono text-sm font-bold ${active ? "text-phosphor" : "text-bone"}`}>
                  {code}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-stamp text-muted">
                  {isGame ? "game" : "task"}·{String(b.id).padStart(2, "0")}
                </span>
              </span>
              <span className="readout text-sm font-bold text-phosphor">
                {b.rewardPerClip}
                <span className="ml-1 text-[10px] text-muted">{OG.currency}</span>
              </span>
            </div>

            {/* title */}
            <div className="flex-1 px-3 pb-3 pt-3">
              <h3 className="text-[15px] font-semibold leading-snug text-bone">{b.title}</h3>
              <div className="mt-1 font-mono text-[10px] text-muted">{b.taskType}</div>
            </div>

            {/* spec row */}
            <div className="flex items-center justify-between border-t border-edge px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-stamp text-muted">
                {takesLeft} takes · 1 review
              </span>
              <span
                className={`font-mono text-[10px] font-bold uppercase tracking-stamp ${
                  active ? "text-phosphor" : "text-muted group-hover:text-bone"
                }`}
              >
                {active ? "● loaded" : "load ▸"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
