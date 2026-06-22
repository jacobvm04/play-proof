import { NextRequest, NextResponse } from "next/server";
import { fetchReviewState, hasContract } from "@/lib/contract";
import { updateSubmissionById, updateSubmission } from "@/lib/db";

export const dynamic = "force-dynamic";

// Called by a reviewer's client after they sign submitReview() on-chain. Reads
// the fresh review tally from the contract and mirrors it into the index so the
// review queue + dashboards update immediately.
export async function POST(req: NextRequest) {
  try {
    const { submissionId, storageRootHash } = await req.json();
    if (typeof submissionId !== "number" || submissionId < 0) {
      return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
    }
    if (!hasContract()) {
      return NextResponse.json({ ok: false, error: "Contract not configured." }, { status: 400 });
    }
    const state = await fetchReviewState(submissionId);
    const review = {
      positiveReviews: state.positiveReviews,
      totalReviews: state.totalReviews,
      requiredReviews: state.requiredReviews,
    };
    const reviewsComplete = state.totalReviews >= state.requiredReviews;
    const patch = { id: submissionId, review };
    if (!updateSubmissionById(submissionId, patch) && storageRootHash) {
      updateSubmission(storageRootHash, patch);
    }
    return NextResponse.json({ ok: true, review, reviewsComplete });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
