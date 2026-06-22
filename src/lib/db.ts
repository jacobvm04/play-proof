// Tiny file-backed JSON index. Canonical truth lives on 0G Storage (clip bytes)
// and 0G Chain (provenance/payout); this is a fast read cache for the dashboards
// (leaderboard, dataset cards, buyer view) so we don't re-scan the chain on every
// page load. Swap for Supabase/SQLite in production — the shape is identical.

import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { SubmissionRecord } from "./types";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "db.json");

type DB = { submissions: SubmissionRecord[] };

function ensure(): DB {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ submissions: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { submissions: [] };
  }
}

function write(db: DB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function allSubmissions(): SubmissionRecord[] {
  return ensure().submissions.sort((a, b) => b.createdAt - a.createdAt);
}

export function submissionsForBounty(bountyId: number): SubmissionRecord[] {
  return ensure().submissions.filter((s) => s.bountyId === bountyId);
}

export function seenHashesForBounty(bountyId: number): string[] {
  return submissionsForBounty(bountyId).map((s) => s.storageRootHash);
}

export function addSubmission(rec: SubmissionRecord) {
  const db = ensure();
  db.submissions.push(rec);
  write(db);
}

export function updateSubmission(
  storageRootHash: string,
  patch: Partial<SubmissionRecord>
): SubmissionRecord | null {
  const db = ensure();
  const idx = db.submissions.findIndex((s) => s.storageRootHash === storageRootHash);
  if (idx === -1) return null;
  db.submissions[idx] = { ...db.submissions[idx], ...patch };
  write(db);
  return db.submissions[idx];
}

export function updateSubmissionById(
  id: number,
  patch: Partial<SubmissionRecord>
): SubmissionRecord | null {
  const db = ensure();
  const idx = db.submissions.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  db.submissions[idx] = { ...db.submissions[idx], ...patch };
  write(db);
  return db.submissions[idx];
}
