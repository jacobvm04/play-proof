import { describe, it, expect, beforeAll } from "vitest";

// Drives the live PlayProof API end-to-end against a running dev server.
// Start the server first: `npm run dev` (or `npm run test:e2e` does both).
// Skips gracefully if nothing is listening on BASE.

const BASE = process.env.PLAYPROOF_BASE ?? "http://localhost:3000";

let serverUp = false;
beforeAll(async () => {
  try {
    const r = await fetch(`${BASE}/api/bounties`, { signal: AbortSignal.timeout(2000) });
    serverUp = r.ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(`\n[integration] No server at ${BASE} — skipping API integration tests. Run \`npm run dev\` first.\n`);
  }
});

function clip(seed: number, size = 256 * 1024): Blob {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 53 + seed * 101) & 0xff;
  return new Blob([b], { type: "video/mp4" });
}

async function analyze(file: Blob, bountyId = 0, name = "clip.mp4") {
  const fd = new FormData();
  fd.append("clip", file, name);
  fd.append("bountyId", String(bountyId));
  const res = await fetch(`${BASE}/api/analyze`, { method: "POST", body: fd });
  return res.json();
}

describe("API integration (live server)", () => {
  it("GET /api/bounties responds with the expected shape", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/bounties`).then((x) => x.json());
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.bounties)).toBe(true);
    expect(typeof r.configured).toBe("boolean");
  });

  it("POST /api/analyze uploads to 0G Storage and returns a real root hash + analysis", async () => {
    if (!serverUp) return;
    const d = await analyze(clip(Math.floor(Date.now() % 100000)));
    expect(d.ok).toBe(true);
    // 0G Storage merkle root hash — 0x + 64 hex chars.
    expect(d.storage.rootHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d.storage.indexer).toContain("0g.ai");
    // 0G Compute analysis.
    expect(d.analysis.proofOfPlay.total).toBeGreaterThanOrEqual(0);
    expect(d.analysis.proofOfPlay.total).toBeLessThanOrEqual(100);
    expect(Array.isArray(d.analysis.labels.actions)).toBe(true);
    expect(["mock", "0g-compute"]).toContain(d.analysis.compute.provider);
    expect(d.clipUrl).toMatch(/^\/clips\//);
  });

  it("is deterministic: identical bytes → identical root hash + score", async () => {
    if (!serverUp) return;
    const c = clip(999);
    const a = await analyze(c);
    const b = await analyze(c);
    expect(a.storage.rootHash).toBe(b.storage.rootHash);
    expect(a.analysis.proofOfPlay.total).toBe(b.analysis.proofOfPlay.total);
  });

  it("rejects blank/tiny footage", async () => {
    if (!serverUp) return;
    const d = await analyze(clip(1, 1024)); // 1KB < blank threshold
    expect(d.ok).toBe(true);
    expect(d.analysis.approved).toBe(false);
    expect(d.analysis.proofOfPlay.total).toBeLessThan(55);
  });

  it("detects duplicates once a clip is indexed for the bounty", async () => {
    if (!serverUp) return;
    const c = clip(Math.floor((Date.now() + 7) % 100000));
    const first = await analyze(c);
    expect(first.analysis.duplicate).toBe(false);

    // Index it (as the client would after signing submitClip).
    const player = "0x000000000000000000000000000000000000dEaD";
    await fetch(`${BASE}/api/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: -1,
        bountyId: 0,
        player,
        storageRootHash: first.storage.rootHash,
        fileName: "dup.mp4",
        sizeBytes: first.sizeBytes,
        analysis: first.analysis,
      }),
    });

    const second = await analyze(c);
    expect(second.analysis.duplicate).toBe(true);
    expect(second.analysis.approved).toBe(false);
  });

  it("GET /api/dataset returns a manifest of only approved clips", async () => {
    if (!serverUp) return;
    const r = await fetch(`${BASE}/api/dataset?bountyId=0`).then((x) => x.json());
    expect(r.ok).toBe(true);
    expect(r.manifest.dataset.network).toContain("0G");
    expect(typeof r.manifest.stats.clips).toBe("number");
    // Every clip in the manifest must carry a 0G Storage root hash (provenance).
    for (const c of r.manifest.clips) {
      expect(c.storageRootHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("GET /api/dataset?download=1 sends a downloadable JSON attachment", async () => {
    if (!serverUp) return;
    const res = await fetch(`${BASE}/api/dataset?bountyId=0&download=1`);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const body = await res.json();
    expect(body.dataset).toBeTruthy();
  });
});
