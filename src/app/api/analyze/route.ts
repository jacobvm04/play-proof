import { NextRequest, NextResponse } from "next/server";
import { uploadToOgStorage, cacheBundle } from "@/lib/storage";
import { getComputeProvider } from "@/lib/compute";
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
    const durationMs = Number(form.get("durationMs") || 0);

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
      durationMs,
      videoMime: video.type || "video/webm",
      videoSize: videoBytes.length,
      screen: { width: screenW || 1280, height: screenH || 720 },
      startedAt,
      contributor,
    });
    const bundle = packBundle(manifest, events, videoBytes);

    // ── 0G Storage: upload the WHOLE bundle, get the canonical root hash ──
    const t0 = Date.now();
    const storage = await uploadToOgStorage(bundle, "recording.pptb");
    const tUpload = Date.now() - t0;

    // Cache the bundle in memory so it plays back instantly this session, and so
    // the chain-backed submission list can read its manifest without a download.
    cacheBundle(storage.rootHash, bundle);

    // ── 0G Compute: AI pre-screen + labeling (a signal; not surfaced as score) ──
    // Dedup against on-chain submissions is skipped here — it required scanning
    // every submission and was a needless drag on the upload path. A duplicate
    // just creates another on-chain submission, which is harmless.
    const provider = getComputeProvider();
    const analysis = await provider.analyze({
      bytes: bundle,
      fileName: "recording.pptb",
      mimeType: "application/x-playproof-bundle",
      taskType,
      bountyTitle,
      storageRootHash: storage.rootHash,
      seenHashes: [],
      manifest,
    });
    console.log(`[analyze] bytes=${videoBytes.length} upload=${tUpload}ms total=${Date.now() - t0}ms uploaded=${storage.uploaded}`);

    return NextResponse.json({
      ok: true,
      storage,
      analysis,
      manifest,
      videoUrl: `/api/clip/${storage.rootHash}`,
      fileName: "recording.pptb",
      sizeBytes: bundle.length,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
