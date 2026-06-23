// Server-side contract helpers: read bounties/submissions and act as the oracle
// (post AI pre-scores, finalize once reviews are in) using OG_SERVER_PRIVATE_KEY.
// Clients sign their own submitClip / submitReview / claimReward in the browser.

import "server-only";
import { ethers } from "ethers";
import artifact from "@/contracts/PlayProof.json";
import { OG } from "./config";
import type { Bounty, SubmissionRecord } from "./types";

const RPC = OG.rpc;

export function hasContract() {
  return !!OG.contract && OG.contract.startsWith("0x") && OG.contract.length === 42;
}

export function readProvider() {
  return new ethers.JsonRpcProvider(RPC);
}

export function readContract() {
  return new ethers.Contract(OG.contract, (artifact as any).abi, readProvider());
}

export function oracleContract() {
  const pk = process.env.OG_SERVER_PRIVATE_KEY;
  if (!pk) throw new Error("OG_SERVER_PRIVATE_KEY not set — cannot act as oracle.");
  const provider = readProvider();
  const signer = new ethers.Wallet(pk, provider);
  // Instamine local chains: keep receipt polling tight.
  provider.pollingInterval = 200;
  return new ethers.Contract(OG.contract, (artifact as any).abi, signer);
}

/** Oracle: record the 0G Compute AI pre-score for a submission. */
export async function setAiPreScoreOnChain(submissionId: number, score: number): Promise<string> {
  const c = oracleContract();
  const tx = await c.setAiPreScore(submissionId, Math.max(0, Math.min(100, Math.round(score))));
  const rc = await tx.wait();
  return rc.hash;
}

export async function fetchBounties(): Promise<Bounty[]> {
  if (!hasContract()) return [];
  const c = readContract();
  const count: bigint = await c.bountyCount();
  const out: Bounty[] = [];
  for (let i = 0; i < Number(count); i++) {
    const b = await c.getBounty(i);
    out.push({
      id: Number(b.id),
      creator: b.creator,
      title: b.title,
      taskType: b.taskType,
      rewardPerClipWei: b.rewardPerClip.toString(),
      rewardPerClip: ethers.formatEther(b.rewardPerClip),
      reviewerRewardWei: b.reviewerReward.toString(),
      reviewerReward: ethers.formatEther(b.reviewerReward),
      remainingBudget: ethers.formatEther(b.remainingBudget),
      approvedCount: Number(b.approvedCount),
      active: b.active,
    });
  }
  return out;
}

/** Read a submission's settled state (a single trusted review settles it). */
export async function fetchReviewState(submissionId: number) {
  const c = readContract();
  const s = await c.getSubmission(submissionId);
  return {
    status: Number(s.status), // 0 pending, 1 approved, 2 rejected
    reviewer: s.reviewer as string,
    contributor: s.contributor as string,
    aiPreScore: Number(s.aiPreScore),
  };
}

const STATUS = ["pending", "approved", "rejected"] as const;

// Read the full submission list straight from 0G Chain (the source of truth),
// enriching each with its recording manifest from the 0G Storage bundle when
// available. No database — this is what makes the app stateless + Vercel-ready.
export async function fetchSubmissions(): Promise<SubmissionRecord[]> {
  if (!hasContract()) return [];
  const c = readContract();
  const count = Number(await c.submissionCount());
  const { getCachedBundle } = await import("./storage");
  const { readManifest } = await import("./bundle");

  const out: SubmissionRecord[] = [];
  for (let i = 0; i < count; i++) {
    const s = await c.getSubmission(i);
    const rootHash = s.storageRootHash as string;

    // Manifest (duration label) is read ONLY from the warm cache — never via a
    // 0G download — so building the list stays fast and can't time out. The
    // recording itself still streams on demand from /api/clip when played.
    let manifest: SubmissionRecord["manifest"];
    try {
      const bundle = getCachedBundle(rootHash);
      manifest = bundle ? readManifest(bundle) : undefined;
    } catch {
      manifest = undefined;
    }

    out.push({
      id: Number(s.id),
      bountyId: Number(s.bountyId),
      contributor: s.contributor,
      storageRootHash: rootHash,
      videoUrl: `/api/clip/${rootHash}`,
      manifest,
      fileName: `${rootHash.slice(0, 10)}.pptb`,
      sizeBytes: 0,
      durationMs: manifest?.durationMs,
      analysis: {
        labels: {
          taskType: manifest?.taskType ?? "task",
          actions: [],
          quality_score: Number(s.aiPreScore),
          training_value: "medium",
          reason: "",
        },
        proofOfPlay: { total: Number(s.aiPreScore), breakdown: { uniqueness: 0, taskRelevance: 0, visualQuality: 0, duration: 0 } },
        compute: { provider: "mock", model: "", endpoint: "" },
        preApproved: false,
        duplicate: false,
      },
      status: STATUS[Number(s.status)] ?? "pending",
      review: { reviewer: s.reviewer === ethers.ZeroAddress ? undefined : s.reviewer },
      paid: s.paid,
      createdAt: i, // chain order
    });
  }
  return out.reverse(); // newest first
}
