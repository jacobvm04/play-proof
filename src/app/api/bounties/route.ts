import { NextResponse } from "next/server";
import { fetchBounties, hasContract } from "@/lib/contract";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bounties = await fetchBounties();
    return NextResponse.json({ ok: true, configured: hasContract(), bounties });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, configured: hasContract(), bounties: [], error: err?.message ?? String(err) },
      { status: 200 }
    );
  }
}
