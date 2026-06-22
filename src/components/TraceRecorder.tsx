"use client";

// Browser-based trace recorder: captures a screen recording (getDisplayMedia +
// MediaRecorder) PLUS a synced stream of input events (keyboard/mouse/pointer/
// scroll), timestamped against the recording clock. Produces { video, events,
// screen, startedAt } the pipeline packs into a 0G Storage trace bundle.
//
// This is why video alone isn't enough for computer-use training: agents learn
// from the *inputs* a human produced against what was on screen. We record both.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@/lib/types";

export type TraceResult = {
  video: Blob;
  events: TraceEvent[];
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
  const [eventCount, setEventCount] = useState(0);
  const [keystrokes, setKeystrokes] = useState(0);
  const [clicks, setClicks] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const eventsRef = useRef<TraceEvent[]>([]);
  const startRef = useRef(0);
  const lastMoveRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const now = () => Math.round(performance.now() - startRef.current);

  const record = useCallback((e: TraceEvent) => {
    eventsRef.current.push(e);
    setEventCount(eventsRef.current.length);
    if (e.type === "keydown") setKeystrokes((k) => k + 1);
    if (e.type === "click") setClicks((c) => c + 1);
  }, []);

  // ── Global input listeners active only while recording ──
  useEffect(() => {
    if (phase !== "recording") return;

    const onKey = (ev: KeyboardEvent) =>
      record({ t: now(), type: "keydown", key: ev.key, code: ev.code, mod: modBits(ev) });
    const onKeyUp = (ev: KeyboardEvent) => record({ t: now(), type: "keyup", key: ev.key });
    const onDown = (ev: MouseEvent) =>
      record({ t: now(), type: "mousedown", button: ev.button, x: ev.clientX, y: ev.clientY });
    const onUp = (ev: MouseEvent) => record({ t: now(), type: "mouseup", button: ev.button });
    const onClick = (ev: MouseEvent) =>
      record({ t: now(), type: "click", x: ev.clientX, y: ev.clientY, target: targetDesc(ev.target) });
    const onMove = (ev: MouseEvent) => {
      // Throttle moves to ~20Hz to keep the trace compact.
      const t = now();
      if (t - lastMoveRef.current < 50) return;
      lastMoveRef.current = t;
      record({ t, type: "mousemove", x: ev.clientX, y: ev.clientY });
    };
    const onWheel = (ev: WheelEvent) =>
      record({ t: now(), type: "wheel", dx: Math.round(ev.deltaX), dy: Math.round(ev.deltaY) });
    const onScroll = () =>
      record({ t: now(), type: "scroll", x: window.scrollX, y: window.scrollY });

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("wheel", onWheel, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [phase, record]);

  async function start() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
      streamRef.current = stream;
      chunksRef.current = [];
      eventsRef.current = [];
      setEventCount(0);
      setKeystrokes(0);
      setClicks(0);
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
    const track = stream?.getVideoTracks()[0];
    const settings = track?.getSettings();
    setPhase("done");
    onResult({
      video,
      events: eventsRef.current,
      screen: { width: settings?.width ?? window.screen.width, height: settings?.height ?? window.screen.height },
      startedAt: Date.now() - durationMs,
      durationMs,
    });
  }

  function reset() {
    setPhase("idle");
    onResult(null);
  }

  const supported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  return (
    <div className="rounded-xl border border-edge bg-panel2/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Trace recorder · screen + synced inputs</span>
        {phase === "recording" && (
          <span className="chip border-bad/50 text-bad">
            <span className="h-2 w-2 rounded-full bg-bad animate-pulseGlow" /> REC {fmt(elapsed)}
          </span>
        )}
      </div>

      {!supported ? (
        <p className="text-sm text-bad">
          Screen capture isn&apos;t available in this browser. Use the file upload fallback below.
        </p>
      ) : phase === "idle" ? (
        <button className="btn-primary w-full" disabled={disabled} onClick={start}>
          ⏺ Record task (screen + keyboard/mouse)
        </button>
      ) : phase === "recording" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Meter n={eventCount} l="events" />
            <Meter n={keystrokes} l="keystrokes" />
            <Meter n={clicks} l="clicks" />
          </div>
          <button className="btn-ghost w-full border-bad/50 text-bad" onClick={stop}>
            ⏹ Stop & finish trace
          </button>
          <p className="text-center text-xs text-muted">
            Perform the task now — your inputs are being captured and synced to the screen video.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-center">
          <div className="text-sm text-good">✓ Trace captured</div>
          <div className="text-xs text-muted">
            {eventCount} input events recorded ({keystrokes} keys, {clicks} clicks)
          </div>
          <button className="btn-ghost w-full" onClick={reset}>
            Re-record
          </button>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}

function Meter({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-lg border border-edge bg-ink/40 py-1.5">
      <div className="text-lg font-bold tabular-nums">{n}</div>
      <div className="label">{l}</div>
    </div>
  );
}

function modBits(e: KeyboardEvent) {
  return (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
}
function targetDesc(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return "";
  return [el.tagName.toLowerCase(), el.id && `#${el.id}`, (el as any).type && `[${(el as any).type}]`]
    .filter(Boolean)
    .join("");
}
function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
