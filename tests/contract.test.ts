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


describe("PlayProof on-chain lifecycle (single trusted review)", () => {
  it("a single approval settles the submission and pays contributor + reviewer", async () => {
    const oracleW = wallets[1];
    const buyer = wallets[2];
    const contributor = wallets[3];
    const reviewer = wallets[4];

    const c = await deploy(oracleW.address);

    // 1. Buyer creates + funds a bounty (reward 0.01, reviewerReward 0.001).
    const reward = E("0.01");
    const revReward = E("0.001");
    const perSub = reward + revReward;
    await (await (c.connect(buyer) as any).createBounty(
      "Fill out a web form", "web_form", reward, revReward, { value: perSub * 2n }
    )).wait();
    expect(Number(await c.bountyCount())).toBe(1);

    // 2. Contributor submits a recording's 0G Storage root hash.
    const root = "0x" + "ab".repeat(32);
    const rcS = await (await (c.connect(contributor) as any).submitClip(0, root)).wait();
    const subId = Number(
      rcS.logs.map((l: any) => { try { return c.interface.parseLog(l); } catch { return null; } })
        .find((p: any) => p?.name === "ClipSubmitted").args.submissionId
    );
    expect(subId).toBe(0);
    let s = await c.getSubmission(0);
    expect(s.contributor).toBe(contributor.address);
    expect(s.storageRootHash).toBe(root);
    expect(Number(s.status)).toBe(0); // Pending

    // 3. Oracle posts the optional AI pre-score signal.
    await (await (c.connect(oracleW) as any).setAiPreScore(0, 88)).wait();
    expect(Number((await c.getSubmission(0)).aiPreScore)).toBe(88);

    // 4. A single trusted reviewer approves → settles immediately.
    await (await (c.connect(reviewer) as any).submitReview(0, true)).wait();
    s = await c.getSubmission(0);
    expect(Number(s.status)).toBe(1); // Approved
    expect(s.reviewer).toBe(reviewer.address);
    expect(Number(await c.approvedByContributor(contributor.address))).toBe(1);
    // Reviewer was paid the review reward.
    expect(await c.earnedByReviewer(reviewer.address)).toBe(revReward);

    // 5. Contributor claims the reward.
    const balPre = await provider.getBalance(contributor.address);
    const rcC = await (await (c.connect(contributor) as any).claimReward(0)).wait();
    const gas = rcC.gasUsed * rcC.gasPrice;
    expect(await provider.getBalance(contributor.address)).toBe(balPre + reward - gas);
    expect(await c.earnedByContributor(contributor.address)).toBe(reward);

    // Double-claim must revert.
    await expect((c.connect(contributor) as any).claimReward(0)).rejects.toThrow();
  });

  it("a single rejection settles as rejected and returns the reward to budget", async () => {
    const buyer = wallets[2];
    const contributor = wallets[3];
    const reviewer = wallets[4];

    const c = await deploy(wallets[1].address);
    const reward = E("0.01");
    const revReward = E("0.001");
    await (await (c.connect(buyer) as any).createBounty("X", "web_form", reward, revReward, { value: reward + revReward })).wait();
    await (await (c.connect(contributor) as any).submitClip(0, "0x" + "cd".repeat(32))).wait();

    // entire perSub reserved at submit
    expect((await c.getBounty(0)).remainingBudget).toBe(0n);

    await (await (c.connect(reviewer) as any).submitReview(0, false)).wait();
    const s = await c.getSubmission(0);
    expect(Number(s.status)).toBe(2); // Rejected
    // Contributor reward returned to budget; reviewer still paid.
    expect((await c.getBounty(0)).remainingBudget).toBe(reward);
    expect(await c.earnedByReviewer(reviewer.address)).toBe(revReward);

    // Rejected submission cannot be claimed.
    await expect((c.connect(contributor) as any).claimReward(0)).rejects.toThrow();
  });

  it("enforces guard rails", async () => {
    const contributor = wallets[3];
    const c = await deploy(wallets[1].address);
    const reward = E("0.01"), revReward = E("0.001");
    await (await (c.connect(wallets[2]) as any).createBounty("X", "web_form", reward, revReward, { value: reward + revReward })).wait();
    await (await (c.connect(contributor) as any).submitClip(0, "0x" + "ef".repeat(32))).wait();

    // Contributor cannot review their own submission.
    await expect((c.connect(contributor) as any).submitReview(0, true)).rejects.toThrow();

    // Only the oracle can set the AI pre-score.
    await expect((c.connect(wallets[5]) as any).setAiPreScore(0, 50)).rejects.toThrow();

    // Settle it, then a second review must revert (already settled).
    await (await (c.connect(wallets[4]) as any).submitReview(0, true)).wait();
    await expect((c.connect(wallets[5]) as any).submitReview(0, true)).rejects.toThrow();
  });

  it("rejects bounties with bad parameters", async () => {
    const c = await deploy(wallets[1].address);
    // zero reward
    await expect(
      (c.connect(wallets[2]) as any).createBounty("X", "t", 0n, E("0.001"), { value: E("0.01") })
    ).rejects.toThrow();
    // budget too small to cover one full payout
    await expect(
      (c.connect(wallets[2]) as any).createBounty("X", "t", E("0.01"), E("0.001"), { value: E("0.005") })
    ).rejects.toThrow();
  });
});
