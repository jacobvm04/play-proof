import { NextRequest, NextResponse } from "next/server";
import { approveOnChain, rejectOnChain, hasContract } from "@/lib/contract";
import { updateSubmissionById, updateSubmission } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The PlayProof oracle endpoint. After 0G Compute scores a clip, the oracle
// (server signer) writes the verdict on-chain: approveSubmission(id, score) or
// rejectSubmission(id). This is the trust bridge between AI scoring and payout.
export async function POST(req: NextRequest) {
  try {
    const { submissionId, qualityScore, approve, storageRootHash } = await req.json();

    if (typeof submissionId !== "number" || submissionId < 0) {
      return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
    }
    if (!hasContract()) {
      return NextResponse.json({ ok: false, error: "Contract not configured." }, { status: 400 });
    }

    if (approve) {
      const score = Math.max(0, Math.min(100, Math.round(qualityScore ?? 0)));
      const txHash = await approveOnChain(submissionId, score);
      patch(submissionId, storageRootHash, { status: "approved", approveTxHash: txHash, id: submissionId });
      return NextResponse.json({ ok: true, txHash, status: "approved", score });
    } else {
      const txHash = await rejectOnChain(submissionId);
      patch(submissionId, storageRootHash, { status: "rejected", approveTxHash: txHash, id: submissionId });
      return NextResponse.json({ ok: true, txHash, status: "rejected" });
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

function patch(id: number, rootHash: string | undefined, p: any) {
  const byId = updateSubmissionById(id, p);
  if (!byId && rootHash) updateSubmission(rootHash, p);
}
