// ────────────────────────────────────────────────────────────────────────────
// Trace bundle assembly (server-side).
//
// A PlayProof trace bundle is what gets stored on 0G Storage and trained on:
//   bundle.json  — { manifest, events }   (the synced input trace)
//   video        — the screen recording bytes (referenced by the manifest)
//
// The client posts the screen video + the raw input-event stream. The server
// derives the canonical manifest (durations, event histogram, screen size),
// concatenates [manifest+events JSON][video] into one bundle buffer, and that
// single buffer is what we hash + upload to 0G Storage. Keeping it one buffer
// means the 0G Storage root hash covers the WHOLE bundle (video + trace), so the
// on-chain provenance is tamper-evident for the entire training artifact.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import type { TraceEvent, TraceManifest } from "./types";

const MAGIC = "PPTB1"; // PlayProof Trace Bundle v1

export function buildManifest(args: {
  taskType: string;
  events: TraceEvent[]; // empty for the web (screen-only) flow
  durationMs: number;
  videoMime: string;
  videoSize: number;
  screen: { width: number; height: number };
  startedAt: number;
  contributor?: string;
}): TraceManifest {
  const { events } = args;
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  // Prefer the recording's own duration; fall back to the last event timestamp.
  const durationMs = args.durationMs || (events.length ? Math.max(...events.map((e) => e.t)) : 0);
  return {
    version: "playproof-trace/1",
    taskType: args.taskType,
    durationMs,
    startedAt: args.startedAt,
    screen: args.screen,
    video: { mimeType: args.videoMime, sizeBytes: args.videoSize },
    events: { count: events.length, byType },
    contributor: args.contributor,
  };
}

/**
 * Pack manifest + events + video into one bundle buffer:
 *   [5 magic bytes]["PPTB1"][4-byte BE json length][json bytes][video bytes]
 */
export function packBundle(
  manifest: TraceManifest,
  events: TraceEvent[],
  video: Buffer
): Buffer {
  const json = Buffer.from(JSON.stringify({ manifest, events }), "utf8");
  const head = Buffer.from(MAGIC, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length, 0);
  return Buffer.concat([head, len, json, video]);
}

/** Parse a bundle buffer back into its manifest (best-effort). */
export function readManifest(bundle: Buffer): TraceManifest | undefined {
  try {
    if (bundle.subarray(0, 5).toString("ascii") !== MAGIC) return undefined;
    const len = bundle.readUInt32BE(5);
    const json = bundle.subarray(9, 9 + len).toString("utf8");
    return JSON.parse(json).manifest as TraceManifest;
  } catch {
    return undefined;
  }
}

/** Extract the screen-recording video bytes + mime from a bundle (best-effort). */
export function videoFromBundle(bundle: Buffer): { bytes: Buffer; mime: string } | null {
  try {
    if (bundle.subarray(0, 5).toString("ascii") !== MAGIC) {
      // Not a PlayProof bundle — assume the buffer is the raw video itself.
      return { bytes: bundle, mime: "video/webm" };
    }
    const len = bundle.readUInt32BE(5);
    const manifest = readManifest(bundle);
    const bytes = bundle.subarray(9 + len);
    return { bytes, mime: manifest?.video?.mimeType?.split(";")[0] || "video/webm" };
  } catch {
    return null;
  }
}
