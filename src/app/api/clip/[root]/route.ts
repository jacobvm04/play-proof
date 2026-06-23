import { NextRequest, NextResponse } from "next/server";
import { getBundle } from "@/lib/storage";
import { videoFromBundle } from "@/lib/bundle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Streams a recording's screen-capture video, pulled from its 0G Storage bundle
// (cached in memory, or downloaded from 0G on a miss). Keeps the app stateless —
// no local clip folder — so it runs on a read-only serverless filesystem.
export async function GET(_req: NextRequest, { params }: { params: { root: string } }) {
  const root = params.root;
  if (!/^0x[0-9a-fA-F]{64}$/.test(root)) {
    return NextResponse.json({ ok: false, error: "Bad root hash." }, { status: 400 });
  }

  const bundle = await getBundle(root);
  if (!bundle) {
    return NextResponse.json({ ok: false, error: "Recording not available." }, { status: 404 });
  }

  const video = videoFromBundle(bundle);
  if (!video) {
    return NextResponse.json({ ok: false, error: "Could not read recording." }, { status: 422 });
  }

  return new NextResponse(new Uint8Array(video.bytes), {
    headers: {
      "Content-Type": video.mime,
      "Content-Length": String(video.bytes.length),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
