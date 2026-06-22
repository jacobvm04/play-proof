import { NextRequest, NextResponse } from "next/server";
import { allSubmissions } from "@/lib/db";
import { fetchBounties } from "@/lib/contract";
import { OG } from "@/lib/config";

export const dynamic = "force-dynamic";

// Downloadable dataset manifest for a bounty: every human-approved trace bundle's
// 0G Storage root hash, contributor, task labels, AI pre-score, and review tally.
// This is the artifact an AI team consumes — transparent provenance, tamper-
// resistant contributor records, decentralized access, and human-verified labels.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bountyId = Number(searchParams.get("bountyId"));
  const download = searchParams.get("download") === "1";

  const bounties = await fetchBounties();
  const bounty = bounties.find((b) => b.id === bountyId);
  const subs = allSubmissions().filter((s) => s.bountyId === bountyId && s.status === "approved");

  const labelCounts: Record<string, number> = {};
  let totalScore = 0;
  let totalMs = 0;
  let totalEvents = 0;
  for (const s of subs) {
    for (const a of s.analysis.labels.actions) labelCounts[a] = (labelCounts[a] ?? 0) + 1;
    totalScore += s.analysis.proofOfPlay.total;
    totalMs += s.manifest?.durationMs ?? 0;
    totalEvents += s.manifest?.events.count ?? 0;
  }
  const contributors = Array.from(new Set(subs.map((s) => s.contributor)));

  const manifest = {
    dataset: {
      name: datasetName(bounty?.title ?? `Bounty ${bountyId}`),
      version: "0.1",
      bountyId,
      taskType: bounty?.taskType ?? null,
      network: OG.networkName,
      storageIndexer: OG.storageExplorer,
      contract: OG.contract || null,
      verification: "human-review-consensus (>50% of N reviewers) + 0G Compute pre-screen",
    },
    stats: {
      bundles: subs.length,
      contributors: contributors.length,
      totalMinutes: +(totalMs / 60000).toFixed(1),
      totalInputEvents: totalEvents,
      avgAiPreScore: subs.length ? Math.round(totalScore / subs.length) : 0,
      labelDistribution: labelCounts,
    },
    bundles: subs.map((s) => ({
      submissionId: s.id,
      contributor: s.contributor,
      storageRootHash: s.storageRootHash,
      storageTxHash: s.storageTxHash ?? null,
      actions: s.analysis.labels.actions,
      taskType: s.analysis.labels.taskType,
      aiPreScore: s.analysis.proofOfPlay.total,
      humanReview: s.review,
      trainingValue: s.analysis.labels.training_value,
      durationMs: s.manifest?.durationMs ?? null,
      inputEvents: s.manifest?.events ?? null,
      finalizeTxHash: s.finalizeTxHash ?? null,
    })),
  };

  if (download) {
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${manifest.dataset.name}-manifest.json"`,
      },
    });
  }
  return NextResponse.json({ ok: true, manifest });
}

function datasetName(title: string) {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
