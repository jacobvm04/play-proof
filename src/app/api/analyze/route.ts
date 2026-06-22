import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { uploadToOgStorage } from "@/lib/storage";
import { getComputeProvider } from "@/lib/compute";
import { seenHashesForBounty } from "@/lib/db";
import { fetchBounties } from "@/lib/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stage 1 of the pipeline: clip bytes in → 0G Storage upload → 0G Compute
// analysis (labels + Proof-of-Play) out. Does NOT write on-chain or to the
// index — the client signs submitClip itself, then calls /api/submissions.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("clip");
    const bountyId = Number(form.get("bountyId"));

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No clip file provided." }, { status: 400 });
    }
    if (Number.isNaN(bountyId)) {
      return NextResponse.json({ ok: false, error: "Missing bountyId." }, { status: 400 });
    }

    const bounties = await fetchBounties();
    const bounty = bounties.find((b) => b.id === bountyId);
    const requiredLabel = bounty?.requiredLabel ?? "default";
    const bountyTitle = bounty?.title ?? "Gameplay dataset";

    const bytes = Buffer.from(await file.arrayBuffer());

    // ── Save a local preview copy so the UI can play the clip back ──
    const clipsDir = path.join(process.cwd(), "public", "clips");
    fs.mkdirSync(clipsDir, { recursive: true });
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    fs.writeFileSync(path.join(clipsDir, safeName), bytes);
    const clipUrl = `/clips/${safeName}`;

    // ── 0G Storage: upload bytes, get canonical root hash ──
    const storage = await uploadToOgStorage(bytes, file.name);

    // ── 0G Compute: AI quality + labeling ──
    const provider = getComputeProvider();
    const analysis = await provider.analyze({
      bytes,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      requiredLabel,
      bountyTitle,
      storageRootHash: storage.rootHash,
      seenHashes: seenHashesForBounty(bountyId),
    });

    return NextResponse.json({
      ok: true,
      storage,
      analysis,
      clipUrl,
      fileName: file.name,
      sizeBytes: bytes.length,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
