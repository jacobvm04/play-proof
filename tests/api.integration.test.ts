import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

// Full-stack on-chain e2e. Requires the e2e harness (`npm run test:e2e`) which
// boots a local chain, deploys+seeds PlayProof, and starts a dev server wired to
// it. Drives the COMPLETE lifecycle through real wallets + the live API:
//   contribute (analyze → 0G Storage → submitClip → oracle aiscore)
//   → 3 independent reviews on-chain → finalize (>50%) → claim reward.
// Skips gracefully if the harness isn't running.

const BASE = process.env.PLAYPROOF_BASE ?? "http://localhost:3000";
const RPC = process.env.E2E_RPC;
const CONTRACT = process.env.E2E_CONTRACT;
const ACCOUNTS = process.env.E2E_ACCOUNTS ? JSON.parse(process.env.E2E_ACCOUNTS) : null;

const artifact = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src", "contracts", "PlayProof.json"), "utf8")
);

let ready = false;
let provider: ethers.JsonRpcProvider;
let wallets: ethers.Wallet[] = [];

beforeAll(async () => {
  try {
    const r = await fetch(`${BASE}/api/bounties`, { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    ready = r.ok && j.configured && !!RPC && !!CONTRACT && !!ACCOUNTS;
  } catch {
    ready = false;
  }
  if (!ready) {
    console.warn("\n[e2e] Harness not running — skipping full-stack on-chain tests. Use `npm run test:e2e`.\n");
    return;
  }
  provider = new ethers.JsonRpcProvider(RPC);
  provider.pollingInterval = 100;
  wallets = ACCOUNTS.map((a: any) => new ethers.Wallet(a.privateKey, provider));
});

function contract(signer: ethers.Wallet) {
  return new ethers.Contract(CONTRACT!, artifact.abi, signer);
}

// A synthetic screen recording.
function fakeVideo(seed: number, size = 600 * 1024): Blob {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 53 + seed * 101) & 0xff;
  return new Blob([b], { type: "video/webm" });
}

async function analyze(seed: number, bountyId: number, contributor: string, durationMs = 30000) {
  const fd = new FormData();
  fd.append("video", fakeVideo(seed), "screen.webm");
  fd.append("bountyId", String(bountyId));
  fd.append("contributor", contributor);
  fd.append("screenW", "1280");
  fd.append("screenH", "720");
  fd.append("startedAt", "1000");
  fd.append("durationMs", String(durationMs));
  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd });
  return res.json();
}

describe("full-stack on-chain e2e", () => {
  it("analyze() packages a recording, uploads to 0G Storage, returns a root hash + pre-score", async () => {
    if (!ready) return;
    const d = await analyze(Math.floor(Date.now() % 90000), 0, wallets[3].address, 30000);
    expect(d.ok).toBe(true);
    expect(d.storage.rootHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d.analysis.labels.taskType).toBe("web_form");
    expect(d.analysis.proofOfPlay.total).toBeGreaterThan(0);
    expect(d.manifest.durationMs).toBe(30000);
  });

  it("rewards longer recordings on the duration dimension", async () => {
    if (!ready) return;
    const seed = Math.floor((Date.now() + 1) % 90000);
    const longer = await analyze(seed, 0, wallets[3].address, 60000);
    const shorter = await analyze(seed + 1, 0, wallets[4].address, 4000);
    expect(longer.analysis.proofOfPlay.breakdown.duration).toBeGreaterThan(
      shorter.analysis.proofOfPlay.breakdown.duration
    );
  });

  it("runs the FULL lifecycle: submit → single trusted review (approve) → claim", async () => {
    if (!ready) return;
    const contributor = wallets[3];
    const reviewers = [wallets[4], wallets[5], wallets[6]];

    // 1. Contribute: analyze + upload recording.
    const d = await analyze(Math.floor((Date.now() + 2) % 90000), 0, contributor.address, 30000);
    expect(d.ok).toBe(true);
    const root = d.storage.rootHash;

    // 2. Contributor signs submitClip on-chain.
    const cc = contract(contributor);
    const submitRc = await (await cc.submitClip(0, root)).wait();
    const subId = Number(
      submitRc.logs
        .map((l: any) => { try { return cc.interface.parseLog(l); } catch { return null; } })
        .find((p: any) => p?.name === "ClipSubmitted").args.submissionId
    );

    // index it
    await fetch(`${BASE}/api/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: subId, bountyId: 0, contributor: contributor.address,
        storageRootHash: root, storageTxHash: d.storage.txHash,
        videoUrl: d.videoUrl, manifest: d.manifest, fileName: d.fileName,
        sizeBytes: d.sizeBytes, analysis: d.analysis, review: {},
      }),
    });

    // 3. Oracle posts the optional AI pre-score signal via the server.
    const ai = await fetch(`${BASE}/api/aiscore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: subId, score: d.analysis.proofOfPlay.total, storageRootHash: root }),
    }).then((r) => r.json());
    expect(ai.ok).toBe(true);

    // 4. A single trusted reviewer approves → settles immediately.
    await (await contract(reviewers[0]).submitReview(subId, true)).wait();
    const rev = await fetch(`${BASE}/api/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: subId, storageRootHash: root, reviewTxHash: "0xabc" }),
    }).then((r) => r.json());
    expect(rev.ok).toBe(true);
    expect(rev.status).toBe("approved");

    const sAfter = await contract(contributor).getSubmission(subId);
    expect(Number(sAfter.status)).toBe(1); // Approved
    expect(sAfter.reviewer).toBe(reviewers[0].address);

    // 5. Contributor claims the reward (paid in the native 0G token). Assert the
    //    reward left the contract to the contributor and the submission is paid.
    const c = contract(contributor);
    const reward = ethers.parseEther("0.01");
    const contractBalBefore = await provider.getBalance(CONTRACT!);
    await (await c.claimReward(subId)).wait();
    expect(contractBalBefore - (await provider.getBalance(CONTRACT!))).toBe(reward);
    expect((await c.getSubmission(subId)).paid).toBe(true);

    // index reflects approved + the dataset manifest includes the recording.
    const man = await fetch(`${BASE}/api/dataset?bountyId=0`).then((r) => r.json());
    const inDataset = man.manifest.recordings.find((b: any) => b.submissionId === subId);
    expect(inDataset).toBeTruthy();
    expect(inDataset.storageRootHash).toBe(root);
    expect(inDataset.reviewedBy.toLowerCase()).toBe(reviewers[0].address.toLowerCase());
  });

  it("dataset manifest carries provenance for every approved recording", async () => {
    if (!ready) return;
    const r = await fetch(`${BASE}/api/dataset?bountyId=0`).then((x) => x.json());
    expect(r.ok).toBe(true);
    expect(r.manifest.dataset.network).toBeTruthy();
    expect(r.manifest.dataset.verification).toContain("reviewer");
    for (const b of r.manifest.recordings) {
      expect(b.storageRootHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(b.reviewedBy).toBeTruthy();
    }
  });
});
