"use client";

// Browser screen recorder: captures a screen/window/tab recording via
// getDisplayMedia + MediaRecorder. You pick what to share, then perform the task
// anywhere — the video captures it. (Per-keystroke input capture would require a
// desktop agent or extension; a web page can't see input in other apps, so we
// record the screen only and don't pretend otherwise.)

import { useEffect, useRef, useState } from "react";

export type TraceResult = {
  video: Blob;
  screen: { width: number; height: number };
  startedAt: number;
  durationMs: number;
};

type Phase = "idle" | "recording" | "done";

export default function TraceRecorder({
  onResult,
  disabled,
}: {
  onResult: (r: TraceResult | null) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const now = () => Math.round(performance.now() - startRef.current);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      setElapsed(0);
      startRef.current = performance.now();

      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      recRef.current = rec;

      // Stop if the user ends screen-share from the browser chrome.
      stream.getVideoTracks()[0].addEventListener("ended", () => stop());

      rec.start(1000);
      setPhase("recording");
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      setErr(e?.message || "Screen capture was denied or unavailable.");
    }
  }

  async function stop() {
    const rec = recRef.current;
    const stream = streamRef.current;
    if (tickRef.current) clearInterval(tickRef.current);
    if (!rec) return;

    await new Promise<void>((res) => {
      rec.onstop = () => res();
      if (rec.state !== "inactive") rec.stop();
      else res();
    });
    stream?.getTracks().forEach((t) => t.stop());

    const durationMs = now();
    const video = new Blob(chunksRef.current, { type: "video/webm" });
    const settings = stream?.getVideoTracks()[0]?.getSettings();
    setPhase("done");
    onResult({
      video,
      screen: {
        width: settings?.width ?? window.screen.width,
        height: settings?.height ?? window.screen.height,
      },
      startedAt: Date.now() - durationMs,
      durationMs,
    });
  }

  function reset() {
    setPhase("idle");
    onResult(null);
  }

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  return (
    <div className="rounded-deck border border-rail bg-ink/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="stamp">▍ recorder</span>
        {phase === "recording" && (
          <span className="chip border-rec/60 text-rec">
            <span className="h-2 w-2 rounded-full bg-rec animate-recPulse" /> REC {fmt(elapsed)}
          </span>
        )}
      </div>

      {!supported ? (
        <p className="text-sm text-rec">
          Screen capture isn&apos;t available in this browser. Use the file upload fallback below.
        </p>
      ) : phase === "idle" ? (
        <button className="btn-rec w-full" disabled={disabled} onClick={start}>
          <span className="h-2.5 w-2.5 rounded-full bg-bone" /> Record the task — share a screen, window, or tab
        </button>
      ) : phase === "recording" ? (
        <div className="space-y-3">
          <div className="rounded-deck border border-rec/40 bg-rec/5 py-4 text-center">
            <div className="readout text-3xl font-bold text-rec">{fmt(elapsed)}</div>
            <div className="label mt-1.5">recording · perform the task now</div>
          </div>
          <button className="btn-ghost w-full border-rec/50 text-rec hover:border-rec" onClick={stop}>
            ◼ Stop &amp; finish
          </button>
          <p className="text-center text-xs text-muted">
            Switch to any window or app — the shared screen keeps recording.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-center">
          <div className="text-sm font-semibold text-phosphor">✓ Take captured · {fmt(elapsed)}</div>
          <button className="btn-ghost w-full" onClick={reset}>
            Re-record
          </button>
        </div>
      )}

      {err && <p className="mt-2 font-mono text-xs text-rec">{err}</p>}
    </div>
  );
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
