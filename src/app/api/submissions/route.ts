import { NextResponse } from "next/server";
import { fetchSubmissions } from "@/lib/contract";

export const dynamic = "force-dynamic";

// Stateless: the submission list is read straight from 0G Chain (source of
// truth), enriched with recording manifests from 0G Storage. No database.
export async function GET() {
  try {
    const submissions = await fetchSubmissions();
    return NextResponse.json({ ok: true, submissions });
  } catch (err: any) {
    return NextResponse.json({ ok: false, submissions: [], error: err?.message ?? String(err) }, { status: 200 });
  }
}
