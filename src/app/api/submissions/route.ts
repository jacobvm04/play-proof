import { NextRequest, NextResponse } from "next/server";
import { addSubmission, allSubmissions } from "@/lib/db";
import type { SubmissionRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET: list all indexed submissions (review queue / leaderboard / datasets / buyer).
export async function GET() {
  return NextResponse.json({ ok: true, submissions: allSubmissions() });
}

// POST: client records a submission in the index after signing submitClip().
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<SubmissionRecord>;
    if (!body.storageRootHash || body.bountyId === undefined || !body.contributor) {
      return NextResponse.json({ ok: false, error: "Missing required fields." }, { status: 400 });
    }
    if (!body.analysis) {
      return NextResponse.json({ ok: false, error: "Missing analysis." }, { status: 400 });
    }

    const rec: SubmissionRecord = {
      id: body.id ?? -1,
      bountyId: body.bountyId,
      contributor: body.contributor,
      storageRootHash: body.storageRootHash,
      storageTxHash: body.storageTxHash,
      videoUrl: body.videoUrl,
      manifest: body.manifest,
      fileName: body.fileName ?? "bundle.pptb",
      sizeBytes: body.sizeBytes ?? 0,
      durationMs: body.manifest?.durationMs,
      analysis: body.analysis,
      status: "pending",
      review: {
        positiveReviews: body.review?.positiveReviews ?? 0,
        totalReviews: body.review?.totalReviews ?? 0,
        requiredReviews: body.review?.requiredReviews ?? 3,
      },
      submitTxHash: body.submitTxHash,
      aiScoreTxHash: body.aiScoreTxHash,
      paid: false,
      createdAt: Date.now(),
    };
    addSubmission(rec);
    return NextResponse.json({ ok: true, submission: rec });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
