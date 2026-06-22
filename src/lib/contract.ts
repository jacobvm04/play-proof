// Server-side contract helpers: read bounties/submissions and act as the oracle
// (approve/reject) using OG_SERVER_PRIVATE_KEY. The client signs its own
// submitClip/claimReward txs in the browser — see src/lib/client-contract.ts.

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
  const signer = new ethers.Wallet(pk, readProvider());
  return new ethers.Contract(OG.contract, (artifact as any).abi, signer);
}

export async function approveOnChain(submissionId: number, qualityScore: number): Promise<string> {
  const c = oracleContract();
  const tx = await c.approveSubmission(submissionId, qualityScore);
  const rc = await tx.wait();
  return rc.hash;
}

export async function rejectOnChain(submissionId: number): Promise<string> {
  const c = oracleContract();
  const tx = await c.rejectSubmission(submissionId);
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
      requiredLabel: b.requiredLabel,
      rewardPerClipWei: b.rewardPerClip.toString(),
      rewardPerClip: ethers.formatEther(b.rewardPerClip),
      remainingBudget: ethers.formatEther(b.remainingBudget),
      approvedCount: Number(b.approvedCount),
      active: b.active,
    });
  }
  return out;
}
