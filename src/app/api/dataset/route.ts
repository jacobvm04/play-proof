import { NextRequest, NextResponse } from "next/server";
import { allSubmissions } from "@/lib/db";
import { fetchBounties } from "@/lib/contract";
import { OG } from "@/lib/config";

export const dynamic = "force-dynamic";

// Builds a downloadable dataset manifest for a bounty: every approved clip's 0G
// Storage root hash, contributor, labels, and Proof-of-Play score. This is the
// artifact an AI team actually consumes — transparent provenance, decentralized
// access, tamper-resistant contributor records.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bountyId = Number(searchParams.get("bountyId"));
  const download = searchParams.get("download") === "1";

  const bounties = await fetchBounties();
  const bounty = bounties.find((b) => b.id === bountyId);
  const subs = allSubmissions().filter(
    (s) => s.bountyId === bountyId && s.status === "approved"
  );

  const labelCounts: Record<string, number> = {};
  let totalScore = 0;
  for (const s of subs) {
    for (const a of s.analysis.labels.actions) labelCounts[a] = (labelCounts[a] ?? 0) + 1;
    totalScore += s.analysis.proofOfPlay.total;
  }
  const contributors = Array.from(new Set(subs.map((s) => s.player)));

  const manifest = {
    dataset: {
      name: datasetName(bounty?.title ?? `Bounty ${bountyId}`),
      version: "0.1",
      bountyId,
      requiredLabel: bounty?.requiredLabel ?? null,
      network: OG.networkName,
      storageIndexer: OG.storageExplorer,
      contract: OG.contract || null,
    },
    stats: {
      clips: subs.length,
      contributors: contributors.length,
      avgProofOfPlay: subs.length ? Math.round(totalScore / subs.length) : 0,
      labelDistribution: labelCounts,
    },
    clips: subs.map((s) => ({
      submissionId: s.id,
      contributor: s.player,
      storageRootHash: s.storageRootHash,
      storageTxHash: s.storageTxHash ?? null,
      labels: s.analysis.labels.actions,
      game: s.analysis.labels.game,
      proofOfPlay: s.analysis.proofOfPlay.total,
      trainingValue: s.analysis.labels.training_value,
      approveTxHash: s.approveTxHash ?? null,
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
