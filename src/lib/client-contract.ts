"use client";

// Browser-side wallet + contract helpers. The player signs their own
// submitClip / claimReward transactions; the buyer signs createBounty.

import { ethers } from "ethers";
import artifact from "@/contracts/PlayProof.json";
import { OG, OG_CHAIN_PARAMS } from "./config";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function connectWallet(): Promise<string> {
  if (!hasWallet()) throw new Error("MetaMask not found. Install it to use PlayProof.");
  const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureOgNetwork();
  return accounts[0];
}

export async function ensureOgNetwork() {
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === OG.chainIdHex.toLowerCase()) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: OG.chainIdHex }],
    });
  } catch (err: any) {
    // 4902 = chain not added yet.
    if (err?.code === 4902 || /Unrecognized chain/i.test(err?.message ?? "")) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [OG_CHAIN_PARAMS],
      });
    } else {
      throw err;
    }
  }
}

export async function getSignerContract() {
  if (!OG.contract) throw new Error("PlayProof contract address not configured.");
  await ensureOgNetwork();
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(OG.contract, (artifact as any).abi, signer);
}

/** Player: record a clip's 0G Storage root hash on-chain. Returns submissionId + tx. */
export async function submitClipOnChain(
  bountyId: number,
  storageRootHash: string
): Promise<{ submissionId: number; txHash: string }> {
  const c = await getSignerContract();
  const tx = await c.submitClip(bountyId, storageRootHash);
  const rc = await tx.wait();
  // Parse ClipSubmitted to recover the submission id.
  let submissionId = -1;
  for (const log of rc.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed?.name === "ClipSubmitted") {
        submissionId = Number(parsed.args.submissionId);
        break;
      }
    } catch {}
  }
  return { submissionId, txHash: rc.hash };
}

/** Player: claim the reward for an approved submission. */
export async function claimRewardOnChain(submissionId: number): Promise<string> {
  const c = await getSignerContract();
  const tx = await c.claimReward(submissionId);
  const rc = await tx.wait();
  return rc.hash;
}

/** Buyer: create + fund a new dataset bounty. */
export async function createBountyOnChain(
  title: string,
  requiredLabel: string,
  rewardPerClipEth: string,
  clipCount: number
): Promise<string> {
  const c = await getSignerContract();
  const reward = ethers.parseEther(rewardPerClipEth);
  const budget = reward * BigInt(Math.max(1, clipCount));
  const tx = await c.createBounty(title, requiredLabel, reward, { value: budget });
  const rc = await tx.wait();
  return rc.hash;
}

export function short(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
