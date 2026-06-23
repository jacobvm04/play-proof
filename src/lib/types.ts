// Shared types across API routes, lib, and UI.

// ── Recording bundle: the training artifact ──
// A contributor records a screen capture of a computer-use task. The recording
// (plus a small manifest) is what gets stored on 0G Storage and scored.
//
// NOTE: per-keystroke/mouse input capture needs a desktop agent or browser
// extension — a web page can't see input in other apps. So the browser recorder
// captures the screen only. The `events`/`TraceEvent` plumbing is retained so a
// future desktop recorder can attach an input trace without a schema change; the
// web flow leaves it empty.

export type TraceEvent = {
  t: number; // ms since recording start
  type: string;
  [k: string]: unknown;
};

export type TraceManifest = {
  version: "playproof-trace/1";
  taskType: string;
  durationMs: number;
  startedAt: number;
  screen: { width: number; height: number };
  video: { mimeType: string; sizeBytes: number };
  // Reserved for a future desktop recorder; the web flow records 0 events.
  events: {
    count: number;
    byType: Record<string, number>;
  };
  contributor?: string;
};

// ── AI pre-screen output (0G Compute) ──
export type TraceLabels = {
  taskType: string;       // e.g. "web_form", "spreadsheet", "game_fps"
  actions: string[];      // high-level actions inferred from the recording
  quality_score: number;  // 0..100
  training_value: "low" | "medium" | "high";
  reason: string;
};

export type ProofOfPlay = {
  total: number; // 0..100 — headline AI pre-score
  breakdown: {
    uniqueness: number;    // 0..25
    taskRelevance: number; // 0..30
    visualQuality: number; // 0..25 — resolution/bitrate proxy from file size
    duration: number;      // 0..20 — enough footage to be a usable example
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
};

// Review state mirrored for the UI (a single trusted review settles it).
export type ReviewState = {
  reviewer?: string; // who settled it
  reviewedAt?: number;
};

// Indexed submission record (mirrors on-chain + adds off-chain UX metadata).
export type SubmissionRecord = {
  id: number; // on-chain submission id (or -1 if not yet on-chain)
  bountyId: number;
  contributor: string;
  storageRootHash: string;   // 0G Storage root of the recording
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
  reviewTxHash?: string;
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
  rewardPerClip: string;     // formatted native token (0G)
  reviewerRewardWei: string;
  reviewerReward: string;    // formatted
  remainingBudget: string;   // formatted
  approvedCount: number;
  active: boolean;
};
