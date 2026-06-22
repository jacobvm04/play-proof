import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { uploadToOgStorage } from "@/lib/storage";
import { getComputeProvider } from "@/lib/compute";
import { seenHashesForBounty } from "@/lib/db";
import { fetchBounties } from "@/lib/contract";
import { buildManifest, packBundle } from "@/lib/bundle";
import type { TraceEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Pipeline stage 1: trace bundle in → 0G Storage upload → 0G Compute pre-screen.
// Accepts a screen-recording video + the synced input-event stream, assembles a
// canonical trace bundle, uploads the WHOLE bundle to 0G Storage, and returns the
// AI pre-score + labels. Does NOT write on-chain (the client signs submitClip).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const video = form.get("video");
    const bountyId = Number(form.get("bountyId"));
    const eventsRaw = form.get("events");
    const contributor = (form.get("contributor") as string) || undefined;
    const screenW = Number(form.get("screenW") || 0);
    const screenH = Number(form.get("screenH") || 0);
    const startedAt = Number(form.get("startedAt") || Date.now());

    if (!(video instanceof File)) {
      return NextResponse.json({ ok: false, error: "No screen recording provided." }, { status: 400 });
    }
    if (Number.isNaN(bountyId)) {
      return NextResponse.json({ ok: false, error: "Missing bountyId." }, { status: 400 });
    }

    let events: TraceEvent[] = [];
    try {
      events = eventsRaw ? (JSON.parse(eventsRaw as string) as TraceEvent[]) : [];
    } catch {
      events = [];
    }

    const bounties = await fetchBounties();
    const bounty = bounties.find((b) => b.id === bountyId);
    const taskType = bounty?.taskType ?? "default";
    const bountyTitle = bounty?.title ?? "Computer-use task";

    const videoBytes = Buffer.from(await video.arrayBuffer());

    // ── Build the canonical manifest + pack the full trace bundle ──
    const manifest = buildManifest({
      taskType,
      events,
      videoMime: video.type || "video/webm",
      videoSize: videoBytes.length,
      screen: { width: screenW || 1280, height: screenH || 720 },
      startedAt,
      contributor,
    });
    const bundle = packBundle(manifest, events, videoBytes);

    // ── Save a local video preview so the UI can play it back ──
    const clipsDir = path.join(process.cwd(), "public", "clips");
    fs.mkdirSync(clipsDir, { recursive: true });
    const ext = (video.type.split("/")[1] || "webm").replace(/[^a-z0-9]/gi, "");
    const safeName = `${Date.now()}-${(contributor || "anon").slice(0, 8)}.${ext}`;
    fs.writeFileSync(path.join(clipsDir, safeName), videoBytes);
    const videoUrl = `/clips/${safeName}`;

    // ── 0G Storage: upload the WHOLE bundle, get the canonical root hash ──
    const storage = await uploadToOgStorage(bundle, `${safeName}.pptb`);

    // ── 0G Compute: AI pre-screen + labeling ──
    const provider = getComputeProvider();
    const analysis = await provider.analyze({
      bytes: bundle,
      fileName: `${safeName}.pptb`,
      mimeType: "application/x-playproof-bundle",
      taskType,
      bountyTitle,
      storageRootHash: storage.rootHash,
      seenHashes: seenHashesForBounty(bountyId),
      manifest,
    });

    return NextResponse.json({
      ok: true,
      storage,
      analysis,
      manifest,
      videoUrl,
      fileName: `${safeName}.pptb`,
      sizeBytes: bundle.length,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
