import { NextRequest, NextResponse } from "next/server";
import { finalizeOnChain, fetchReviewState, hasContract } from "@/lib/contract";
import { updateSubmissionById, updateSubmission } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Finalize a submission once N reviews are in. The contract computes the >50%
// consensus trustlessly; we just trigger it (anyone can) and mirror the outcome
// into the index. Returns the resulting status.
export async function POST(req: NextRequest) {
  try {
    const { submissionId, storageRootHash } = await req.json();
    if (typeof submissionId !== "number" || submissionId < 0) {
      return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
    }
    if (!hasContract()) {
      return NextResponse.json({ ok: false, error: "Contract not configured." }, { status: 400 });
    }

    const txHash = await finalizeOnChain(submissionId);
    const state = await fetchReviewState(submissionId);
    const status = state.status === 1 ? "approved" : state.status === 2 ? "rejected" : "pending";

    const patch = {
      id: submissionId,
      status: status as "approved" | "rejected" | "pending",
      finalizeTxHash: txHash,
      review: {
        positiveReviews: state.positiveReviews,
        totalReviews: state.totalReviews,
        requiredReviews: state.requiredReviews,
      },
    };
    if (!updateSubmissionById(submissionId, patch) && storageRootHash) {
      updateSubmission(storageRootHash, patch);
    }
    return NextResponse.json({ ok: true, txHash, status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
