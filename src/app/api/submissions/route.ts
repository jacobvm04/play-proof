import { NextRequest, NextResponse } from "next/server";
import { addSubmission, allSubmissions } from "@/lib/db";
import type { SubmissionRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET: list all indexed submissions (for leaderboard / dataset / buyer views).
export async function GET() {
  return NextResponse.json({ ok: true, submissions: allSubmissions() });
}

// POST: client records a submission in the index after signing submitClip().
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<SubmissionRecord>;
    if (!body.storageRootHash || body.bountyId === undefined || !body.player) {
      return NextResponse.json({ ok: false, error: "Missing required fields." }, { status: 400 });
    }
    if (!body.analysis) {
      return NextResponse.json({ ok: false, error: "Missing analysis." }, { status: 400 });
    }

    const rec: SubmissionRecord = {
      id: body.id ?? -1,
      bountyId: body.bountyId,
      player: body.player,
      storageRootHash: body.storageRootHash,
      storageTxHash: body.storageTxHash,
      clipUrl: body.clipUrl,
      fileName: body.fileName ?? "clip.mp4",
      sizeBytes: body.sizeBytes ?? 0,
      durationSec: body.durationSec,
      analysis: body.analysis,
      status: "pending",
      submitTxHash: body.submitTxHash,
      paid: false,
      createdAt: Date.now(),
    };
    addSubmission(rec);
    return NextResponse.json({ ok: true, submission: rec });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
