import { NextRequest, NextResponse } from "next/server";
import { setAiPreScoreOnChain, hasContract } from "@/lib/contract";
import { updateSubmissionById, updateSubmission } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Oracle endpoint: after 0G Compute pre-screens a bundle, the oracle records the
// AI pre-score on-chain (setAiPreScore). This is a SIGNAL for reviewers — it does
// NOT approve the submission. Human review consensus decides final approval.
export async function POST(req: NextRequest) {
  try {
    const { submissionId, score, storageRootHash } = await req.json();
    if (typeof submissionId !== "number" || submissionId < 0) {
      return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
    }
    if (!hasContract()) {
      return NextResponse.json({ ok: false, error: "Contract not configured." }, { status: 400 });
    }
    const txHash = await setAiPreScoreOnChain(submissionId, score ?? 0);
    const patch = { id: submissionId, aiScoreTxHash: txHash };
    if (!updateSubmissionById(submissionId, patch) && storageRootHash) {
      updateSubmission(storageRootHash, patch);
    }
    return NextResponse.json({ ok: true, txHash });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
