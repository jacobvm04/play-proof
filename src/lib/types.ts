// Shared types across API routes, lib, and UI.

export type ClipLabels = {
  game: string;
  actions: string[];
  quality_score: number; // 0..100
  training_value: "low" | "medium" | "high";
  reason: string;
};

export type ProofOfPlay = {
  total: number; // 0..100 — the headline Proof-of-Play score
  breakdown: {
    uniqueness: number; // 0..25
    taskRelevance: number; // 0..30
    gameplayQuality: number; // 0..25
    actionDensity: number; // 0..20
  };
};

// Where the AI labeling ran — surfaced in the UI for the "0G Compute" story.
export type ComputeProvenance = {
  provider: "0g-compute" | "mock";
  model: string;
  endpoint: string;
  note?: string;
};

export type AnalysisResult = {
  labels: ClipLabels;
  proofOfPlay: ProofOfPlay;
  compute: ComputeProvenance;
  approved: boolean;
  duplicate: boolean;
};

// Indexed submission record (mirrors on-chain + adds off-chain UX metadata).
export type SubmissionRecord = {
  id: number; // on-chain submission id (or -1 if not yet on-chain)
  bountyId: number;
  player: string;
  storageRootHash: string;
  storageTxHash?: string;
  clipUrl?: string; // local preview URL
  fileName: string;
  sizeBytes: number;
  durationSec?: number;
  analysis: AnalysisResult;
  status: "pending" | "approved" | "rejected";
  approveTxHash?: string;
  submitTxHash?: string;
  paid: boolean;
  claimTxHash?: string;
  createdAt: number;
};

export type Bounty = {
  id: number;
  creator: string;
  title: string;
  requiredLabel: string;
  rewardPerClipWei: string;
  rewardPerClip: string; // formatted 0G
  remainingBudget: string; // formatted 0G
  approvedCount: number;
  active: boolean;
};
