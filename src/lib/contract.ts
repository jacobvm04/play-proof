// Server-side contract helpers: read bounties/submissions and act as the oracle
// (post AI pre-scores, finalize once reviews are in) using OG_SERVER_PRIVATE_KEY.
// Clients sign their own submitClip / submitReview / claimReward in the browser.

import "server-only";
import { ethers } from "ethers";
import artifact from "@/contracts/PlayProof.json";
import { OG } from "./config";
import type { Bounty } from "./types";

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

/** Anyone (here, the server) finalizes once N reviews are in. */
export async function finalizeOnChain(submissionId: number): Promise<string> {
  const c = oracleContract();
  const tx = await c.finalize(submissionId);
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
      requiredReviews: Number(b.requiredReviews),
      remainingBudget: ethers.formatEther(b.remainingBudget),
      approvedCount: Number(b.approvedCount),
      active: b.active,
    });
  }
  return out;
}

/** Read on-chain review state for a submission (positive/total/required). */
export async function fetchReviewState(submissionId: number) {
  const c = readContract();
  const s = await c.getSubmission(submissionId);
  const b = await c.getBounty(Number(s.bountyId));
  return {
    positiveReviews: Number(s.positiveReviews),
    totalReviews: Number(s.totalReviews),
    requiredReviews: Number(b.requiredReviews),
    status: Number(s.status), // 0 pending, 1 approved, 2 rejected
    contributor: s.contributor as string,
    aiPreScore: Number(s.aiPreScore),
  };
}
