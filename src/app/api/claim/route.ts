import { NextRequest, NextResponse } from "next/server";
import { updateSubmissionById, updateSubmission } from "@/lib/db";

export const dynamic = "force-dynamic";

// Client calls this after signing claimReward() to reflect payout in the index.
export async function POST(req: NextRequest) {
  try {
    const { submissionId, storageRootHash, txHash } = await req.json();
    const patch = { paid: true, claimTxHash: txHash };
    const byId =
      typeof submissionId === "number" ? updateSubmissionById(submissionId, patch) : null;
    if (!byId && storageRootHash) updateSubmission(storageRootHash, patch);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
