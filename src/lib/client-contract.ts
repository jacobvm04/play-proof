"use client";

// Browser-side wallet + contract helpers. Contributors sign submitClip /
// claimReward; reviewers sign submitReview; buyers sign createBounty.

import { ethers } from "ethers";
import artifact from "@/contracts/PlayProof.json";
import { OG, OG_CHAIN_PARAMS } from "./config";
import { burnerActive, burnerSigner } from "./burner";
import { activeProvider, hasAnyWallet, isPhantom } from "./provider";

declare global {
  interface Window {
    ethereum?: any;
    phantom?: any;
  }
}

export function hasWallet() {
  return hasAnyWallet();
}

function provider() {
  const p = activeProvider();
  if (!p) throw new Error("No EVM wallet found. Install MetaMask, Rabby, or another EVM wallet.");
  return p;
}

export async function connectWallet(): Promise<string> {
  const p = provider();
  const accounts: string[] = await p.request({ method: "eth_requestAccounts" });
  await ensureOgNetwork();
  return accounts[0];
}

export async function ensureOgNetwork() {
  const p = provider();
  const current = await p.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === OG.chainIdHex.toLowerCase()) return;

  // Try to switch; if the chain is unknown, add it, then switch. We attempt the
  // add on ANY switch failure (not just code 4902) because wallets differ in the
  // error they return for an unknown chain.
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: OG.chainIdHex }] });
    return;
  } catch (switchErr: any) {
    try {
      await p.request({ method: "wallet_addEthereumChain", params: [OG_CHAIN_PARAMS] });
      // Some wallets switch automatically after adding; others need an explicit switch.
      const after = await p.request({ method: "eth_chainId" });
      if (after?.toLowerCase() !== OG.chainIdHex.toLowerCase()) {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: OG.chainIdHex }] });
      }
      return;
    } catch (addErr: any) {
      if (isPhantom(p)) {
        throw new Error(
          "Phantom couldn't switch to 0G Galileo testnet. Enable Testnet Mode in Phantom " +
            "(Settings → Developer Settings), or use MetaMask/Rabby which support adding custom EVM networks."
        );
      }
      throw new Error(
        `Couldn't switch to ${OG.networkName} (chain ${OG.chainIdDec}). ` +
          (addErr?.message || switchErr?.message || "Add it to your wallet manually.")
      );
    }
  }
}

export async function getSignerContract() {
  if (!OG.contract) throw new Error("PlayProof contract address not configured.");
  // Demo mode: sign with the in-app burner wallet (local chain only, no MetaMask).
  if (burnerActive()) {
    return new ethers.Contract(OG.contract, (artifact as any).abi, burnerSigner());
  }
  await ensureOgNetwork();
  const browserProvider = new ethers.BrowserProvider(provider() as any);
  const signer = await browserProvider.getSigner();
  return new ethers.Contract(OG.contract, (artifact as any).abi, signer);
}

/** Contributor: record a trace bundle's 0G Storage root hash on-chain. */
export async function submitClipOnChain(
  bountyId: number,
  storageRootHash: string
): Promise<{ submissionId: number; txHash: string }> {
  const c = await getSignerContract();
  const tx = await c.submitClip(bountyId, storageRootHash);
  const rc = await tx.wait();
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

/** Reviewer: cast a verdict on someone else's submission (paid the review reward). */
export async function submitReviewOnChain(submissionId: number, approve: boolean): Promise<string> {
  const c = await getSignerContract();
  const tx = await c.submitReview(submissionId, approve);
  const rc = await tx.wait();
  return rc.hash;
}

/** Contributor: claim the reward for an approved submission. */
export async function claimRewardOnChain(submissionId: number): Promise<string> {
  const c = await getSignerContract();
  const tx = await c.claimReward(submissionId);
  const rc = await tx.wait();
  return rc.hash;
}

/** Buyer: create + fund a new task-data bounty. */
export async function createBountyOnChain(
  title: string,
  taskType: string,
  rewardPerClipEth: string,
  reviewerRewardEth: string,
  submissionCount: number
): Promise<string> {
  const c = await getSignerContract();
  const reward = ethers.parseEther(rewardPerClipEth);
  const revReward = ethers.parseEther(reviewerRewardEth);
  const budget = (reward + revReward) * BigInt(Math.max(1, submissionCount));
  const tx = await c.createBounty(title, taskType, reward, revReward, { value: budget });
  const rc = await tx.wait();
  return rc.hash;
}

export function short(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}
