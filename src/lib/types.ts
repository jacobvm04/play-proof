// Shared types across API routes, lib, and UI.

// ── Trace bundle: the actual training artifact ──
// Video alone is weak for computer-use agents — they need the *inputs* the human
// produced, synced to the screen. A trace bundle is the recorded screen video
// PLUS a timestamped stream of input events (keyboard/mouse/pointer/scroll),
// plus a manifest. The bundle (not just the video) is what gets stored on 0G
// Storage and scored.

export type InputEventType =
  | "keydown"
  | "keyup"
  | "mousedown"
  | "mouseup"
  | "mousemove"
  | "click"
  | "scroll"
  | "wheel"
  | "input"
  | "nav";

export type TraceEvent = {
  t: number; // ms since recording start (synced to the video clock)
  type: InputEventType;
  // Sparse, type-dependent payload (key, button, x, y, dx, dy, target, value…).
  [k: string]: unknown;
};

export type TraceManifest = {
  version: "playproof-trace/1";
  taskType: string;
  durationMs: number;
  startedAt: number;
  screen: { width: number; height: number };
  video: { mimeType: string; sizeBytes: number };
  events: {
    count: number;
    byType: Record<string, number>;
    keystrokes: number;
    pointerMoves: number;
    clicks: number;
  };
  contributor?: string;
};

// ── AI pre-screen output (0G Compute) ──
export type TraceLabels = {
  taskType: string;       // e.g. "web_form", "spreadsheet", "game_fps"
  actions: string[];      // high-level actions inferred from the input stream
  quality_score: number;  // 0..100
  training_value: "low" | "medium" | "high";
  reason: string;
};

export type ProofOfPlay = {
  total: number; // 0..100 — headline AI pre-score
  breakdown: {
    uniqueness: number;     // 0..25
    taskRelevance: number;  // 0..30
    inputRichness: number;  // 0..25 — keystroke + pointer density (the trace signal)
    completeness: number;   // 0..20 — has both video and synced input events
  };
};

// Where the AI pre-scoring ran — surfaced in the UI for the "0G Compute" story.
export type ComputeProvenance = {
  provider: "0g-compute" | "mock";
  model: string;
  endpoint: string;
  note?: string;
};

export type AnalysisResult = {
  labels: TraceLabels;
  proofOfPlay: ProofOfPlay;
  compute: ComputeProvenance;
  // AI pre-screen verdict (a signal). Final approval is decided by human review.
  preApproved: boolean;
  duplicate: boolean;
  hasTrace: boolean; // bundle included synced input events (not video-only)
};

// On-chain review state mirrored for the UI.
export type ReviewState = {
  positiveReviews: number;
  totalReviews: number;
  requiredReviews: number;
};

// Indexed submission record (mirrors on-chain + adds off-chain UX metadata).
export type SubmissionRecord = {
  id: number; // on-chain submission id (or -1 if not yet on-chain)
  bountyId: number;
  contributor: string;
  storageRootHash: string;   // 0G Storage root of the trace BUNDLE
  storageTxHash?: string;
  videoUrl?: string;         // local preview of the screen recording
  manifest?: TraceManifest;
  fileName: string;
  sizeBytes: number;
  durationMs?: number;
  analysis: AnalysisResult;
  status: "pending" | "approved" | "rejected";
  review: ReviewState;
  submitTxHash?: string;
  aiScoreTxHash?: string;
  finalizeTxHash?: string;
  paid: boolean;
  claimTxHash?: string;
  createdAt: number;
};

export type Bounty = {
  id: number;
  creator: string;
  title: string;
  taskType: string;
  rewardPerClipWei: string;
  rewardPerClip: string;     // formatted native token
  reviewerRewardWei: string;
  reviewerReward: string;    // formatted
  requiredReviews: number;
  remainingBudget: string;   // formatted
  approvedCount: number;
  active: boolean;
};
