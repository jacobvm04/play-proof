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

// A synthetic trace bundle posted as a video + input events.
function fakeVideo(seed: number, size = 200 * 1024): Blob {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 53 + seed * 101) & 0xff;
  return new Blob([b], { type: "video/webm" });
}
function fakeEvents(n: number) {
  const ev: any[] = [];
  for (let i = 0; i < n; i++) {
    ev.push({ t: i * 100, type: i % 3 === 0 ? "keydown" : i % 3 === 1 ? "mousemove" : "click", key: "a", x: i, y: i });
  }
  return ev;
}

async function analyze(seed: number, bountyId: number, contributor: string, events = 40) {
  const fd = new FormData();
  fd.append("video", fakeVideo(seed), "screen.webm");
  fd.append("events", JSON.stringify(fakeEvents(events)));
  fd.append("bountyId", String(bountyId));
  fd.append("contributor", contributor);
  fd.append("screenW", "1280");
  fd.append("screenH", "720");
  fd.append("startedAt", "1000");
  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd });
  return res.json();
}

describe("full-stack on-chain e2e", () => {
  it("analyze() assembles a bundle, uploads to 0G Storage, returns a root hash + trace pre-score", async () => {
    if (!ready) return;
    const d = await analyze(Math.floor(Date.now() % 90000), 0, wallets[3].address, 60);
    expect(d.ok).toBe(true);
    expect(d.storage.rootHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d.analysis.hasTrace).toBe(true); // input events present
    expect(d.analysis.labels.taskType).toBe("web_form");
    expect(d.analysis.proofOfPlay.total).toBeGreaterThan(0);
    expect(d.manifest.events.count).toBe(60);
  });

  it("penalizes video-only bundles vs full traces on the pre-score", async () => {
    if (!ready) return;
    const seed = Math.floor((Date.now() + 1) % 90000);
    const withTrace = await analyze(seed, 0, wallets[3].address, 80);
    // same video bytes, but no events
    const fd = new FormData();
    fd.append("video", fakeVideo(seed), "screen.webm");
    fd.append("events", "[]");
    fd.append("bountyId", "0");
    fd.append("contributor", wallets[4].address);
    const videoOnly = await (await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd })).json();
    expect(videoOnly.analysis.hasTrace).toBe(false);
    expect(withTrace.analysis.proofOfPlay.breakdown.completeness).toBeGreaterThan(
      videoOnly.analysis.proofOfPlay.breakdown.completeness
    );
  });

  it("runs the FULL lifecycle: submit → aiscore → 3 reviews → finalize(approve) → claim", async () => {
    if (!ready) return;
    const contributor = wallets[3];
    const reviewers = [wallets[4], wallets[5], wallets[6]];

    // 1. Contribute: analyze + upload bundle.
    const d = await analyze(Math.floor((Date.now() + 2) % 90000), 0, contributor.address, 70);
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
        sizeBytes: d.sizeBytes, analysis: d.analysis,
        review: { positiveReviews: 0, totalReviews: 0, requiredReviews: 3 },
      }),
    });

    // 3. Oracle posts AI pre-score via the server.
    const ai = await fetch(`${BASE}/api/aiscore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: subId, score: d.analysis.proofOfPlay.total, storageRootHash: root }),
    }).then((r) => r.json());
    expect(ai.ok).toBe(true);
    expect(Number((await contract(contributor).getSubmission(subId)).aiPreScore)).toBe(d.analysis.proofOfPlay.total);

    // 4. Three reviewers vote on-chain: approve, approve, reject → 2/3.
    for (const [i, rev] of reviewers.entries()) {
      await (await contract(rev).submitReview(subId, i < 2)).wait();
      await fetch(`${BASE}/api/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: subId, storageRootHash: root }),
      });
    }
    const sAfter = await contract(contributor).getSubmission(subId);
    expect(Number(sAfter.totalReviews)).toBe(3);
    expect(Number(sAfter.positiveReviews)).toBe(2);

    // 5. Finalize via the server → approved (2/3 > 50%).
    const fin = await fetch(`${BASE}/api/finalize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: subId, storageRootHash: root }),
    }).then((r) => r.json());
    expect(fin.ok).toBe(true);
    expect(fin.status).toBe("approved");

    // 6. Contributor claims the reward on-chain.
    const balPre = await provider.getBalance(contributor.address);
    const claimRc = await (await contract(contributor).claimReward(subId)).wait();
    const gas = claimRc.gasUsed * claimRc.gasPrice;
    const balPost = await provider.getBalance(contributor.address);
    expect(balPost).toBe(balPre + ethers.parseEther("0.01") - gas);

    // index reflects approved + the dataset manifest includes the bundle.
    const man = await fetch(`${BASE}/api/dataset?bountyId=0`).then((r) => r.json());
    const inDataset = man.manifest.bundles.find((b: any) => b.submissionId === subId);
    expect(inDataset).toBeTruthy();
    expect(inDataset.storageRootHash).toBe(root);
    expect(inDataset.humanReview.positiveReviews).toBe(2);
  });

  it("dataset manifest carries provenance for every approved bundle", async () => {
    if (!ready) return;
    const r = await fetch(`${BASE}/api/dataset?bountyId=0`).then((x) => x.json());
    expect(r.ok).toBe(true);
    expect(r.manifest.dataset.network).toBeTruthy();
    expect(r.manifest.dataset.verification).toContain("review");
    for (const b of r.manifest.bundles) {
      expect(b.storageRootHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(b.humanReview.totalReviews).toBeGreaterThanOrEqual(b.humanReview.requiredReviews);
    }
  });
});
