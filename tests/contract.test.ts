import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import Ganache from "ganache";
import fs from "node:fs";
import path from "node:path";

// On-chain e2e against a fresh in-process local chain. Exercises the FULL
// lifecycle on real EVM state: createBounty → submitClip → setAiPreScore →
// N submitReview → finalize (consensus) → claimReward, plus the rejection path
// and the guard rails (no self-review, no double-review, no early finalize).

const artifact = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src", "contracts", "PlayProof.json"), "utf8")
);

const MNEMONIC = "test test test test test test test test test test test junk";
const E = (n: string) => ethers.parseEther(n);

let provider: ethers.BrowserProvider;
let wallets: ethers.Wallet[];

async function deploy(oracle: string) {
  const deployer = wallets[0];
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const c = await factory.deploy(oracle);
  await c.waitForDeployment();
  return new ethers.Contract(await c.getAddress(), artifact.abi, provider);
}

beforeAll(async () => {
  // In-process EIP-1193 provider — no network listen, no µWS native binary,
  // no HTTP round-trips. ethers wraps it via BrowserProvider. Much faster than
  // a listening ganache server on Node 22 (where µWS falls back to slow JS).
  const eip1193 = Ganache.provider({
    wallet: { mnemonic: MNEMONIC, totalAccounts: 12, defaultBalance: 1000 },
    chain: { chainId: 31337, networkId: 31337, hardfork: "shanghai" },
    logging: { quiet: true },
  });
  provider = new ethers.BrowserProvider(eip1193 as any);
  provider.pollingInterval = 50; // instamine local chain → receipts are immediate
  wallets = [];
  for (let i = 0; i < 8; i++) {
    const w = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
    wallets.push(new ethers.Wallet(w.privateKey, provider) as unknown as ethers.Wallet);
  }
}, 30000);

describe("PlayProof on-chain lifecycle", () => {
  it("approves a submission when a strict majority of reviewers approve, then pays out", async () => {
    const oracleW = wallets[1];
    const buyer = wallets[2];
    const contributor = wallets[3];
    const reviewers = [wallets[4], wallets[5], wallets[6]]; // N=3

    const c = await deploy(oracleW.address);

    // 1. Buyer creates + funds a bounty (reward 0.01, reviewerReward 0.001, N=3).
    const reward = E("0.01");
    const revReward = E("0.001");
    const N = 3;
    const perSub = reward + revReward * BigInt(N);
    const txB = await (c.connect(buyer) as any).createBounty(
      "Fill out a web form", "web_form", reward, revReward, N, { value: perSub * 2n }
    );
    await txB.wait();
    expect(Number(await c.bountyCount())).toBe(1);

    // 2. Contributor submits a trace bundle's 0G Storage root hash.
    const root = "0x" + "ab".repeat(32);
    const txS = await (c.connect(contributor) as any).submitClip(0, root);
    const rcS = await txS.wait();
    const subId = Number(
      rcS.logs.map((l: any) => { try { return c.interface.parseLog(l); } catch { return null; } })
        .find((p: any) => p?.name === "ClipSubmitted").args.submissionId
    );
    expect(subId).toBe(0);
    let s = await c.getSubmission(0);
    expect(s.contributor).toBe(contributor.address);
    expect(s.storageRootHash).toBe(root);
    expect(Number(s.status)).toBe(0); // Pending

    // 3. Oracle posts the 0G Compute AI pre-score.
    await (await (c.connect(oracleW) as any).setAiPreScore(0, 88)).wait();
    s = await c.getSubmission(0);
    expect(Number(s.aiPreScore)).toBe(88);

    // 4. Three independent reviewers vote: approve, approve, reject → 2/3 positive.
    const balBefore = await provider.getBalance(reviewers[0].address);
    await (await (c.connect(reviewers[0]) as any).submitReview(0, true)).wait();
    await (await (c.connect(reviewers[1]) as any).submitReview(0, true)).wait();
    await (await (c.connect(reviewers[2]) as any).submitReview(0, false)).wait();
    s = await c.getSubmission(0);
    expect(Number(s.totalReviews)).toBe(3);
    expect(Number(s.positiveReviews)).toBe(2);
    // Reviewer got paid the review reward (minus gas, so net change is positive-ish:
    // assert the contract credited earnedByReviewer regardless of gas).
    expect(await c.earnedByReviewer(reviewers[0].address)).toBe(revReward);

    // 5. Anyone finalizes; 2/3 > 50% → Approved.
    await (await (c.connect(wallets[7]) as any).finalize(0)).wait();
    s = await c.getSubmission(0);
    expect(Number(s.status)).toBe(1); // Approved
    expect(Number(await c.approvedByContributor(contributor.address))).toBe(1);

    // 6. Contributor claims the reward.
    const balPre = await provider.getBalance(contributor.address);
    const txC = await (c.connect(contributor) as any).claimReward(0);
    const rcC = await txC.wait();
    const gas = rcC.gasUsed * rcC.gasPrice;
    const balPost = await provider.getBalance(contributor.address);
    expect(balPost).toBe(balPre + reward - gas);
    expect(await c.earnedByContributor(contributor.address)).toBe(reward);

    // Double-claim must revert.
    await expect((c.connect(contributor) as any).claimReward(0)).rejects.toThrow();
  });

  it("rejects a submission when the majority rejects, and returns reward to budget", async () => {
    const oracleW = wallets[1];
    const buyer = wallets[2];
    const contributor = wallets[3];
    const reviewers = [wallets[4], wallets[5], wallets[6]];

    const c = await deploy(oracleW.address);
    const reward = E("0.01");
    const revReward = E("0.001");
    const N = 3;
    const perSub = reward + revReward * BigInt(N);
    await (await (c.connect(buyer) as any).createBounty("X", "web_form", reward, revReward, N, { value: perSub })).wait();
    await (await (c.connect(contributor) as any).submitClip(0, "0x" + "cd".repeat(32))).wait();

    const budgetAfterSubmit = (await c.getBounty(0)).remainingBudget;
    expect(budgetAfterSubmit).toBe(0n); // entire perSub reserved

    // 1 approve, 2 reject → minority positive → Rejected.
    await (await (c.connect(reviewers[0]) as any).submitReview(0, true)).wait();
    await (await (c.connect(reviewers[1]) as any).submitReview(0, false)).wait();
    await (await (c.connect(reviewers[2]) as any).submitReview(0, false)).wait();
    await (await (c.connect(wallets[7]) as any).finalize(0)).wait();

    const s = await c.getSubmission(0);
    expect(Number(s.status)).toBe(2); // Rejected
    // The contributor reward is returned to the bounty budget (reviewers keep theirs).
    expect((await c.getBounty(0)).remainingBudget).toBe(reward);

    // Rejected submission cannot be claimed.
    await expect((c.connect(contributor) as any).claimReward(0)).rejects.toThrow();
  });

  it("enforces review guard rails", async () => {
    const oracleW = wallets[1];
    const contributor = wallets[3];
    const c = await deploy(oracleW.address);
    const reward = E("0.01"), revReward = E("0.001"), N = 3;
    await (await (c.connect(wallets[2]) as any).createBounty("X", "web_form", reward, revReward, N, {
      value: (reward + revReward * BigInt(N)),
    })).wait();
    await (await (c.connect(contributor) as any).submitClip(0, "0x" + "ef".repeat(32))).wait();

    // Contributor cannot review their own submission.
    await expect((c.connect(contributor) as any).submitReview(0, true)).rejects.toThrow();

    // Cannot finalize before N reviews are in.
    await expect((c.connect(wallets[7]) as any).finalize(0)).rejects.toThrow();

    // A reviewer cannot review twice.
    await (await (c.connect(wallets[4]) as any).submitReview(0, true)).wait();
    await expect((c.connect(wallets[4]) as any).submitReview(0, true)).rejects.toThrow();

    // Only the oracle can set the AI pre-score.
    await expect((c.connect(wallets[5]) as any).setAiPreScore(0, 50)).rejects.toThrow();
  });

  it("rejects bounties with bad parameters", async () => {
    const c = await deploy(wallets[1].address);
    // requiredReviews = 0
    await expect(
      (c.connect(wallets[2]) as any).createBounty("X", "t", E("0.01"), E("0.001"), 0, { value: E("0.01") })
    ).rejects.toThrow();
    // budget too small to cover one full payout
    await expect(
      (c.connect(wallets[2]) as any).createBounty("X", "t", E("0.01"), E("0.001"), 3, { value: E("0.005") })
    ).rejects.toThrow();
  });
});
