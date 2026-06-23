"use client";

// Resolves whether a wallet is a trusted reviewer. Reviewing is restricted for
// now and intentionally not surfaced to normal users.
//
//   • Production: NEXT_PUBLIC_TRUSTED_REVIEWERS (comma-separated addresses).
//   • Local demo: the funded demo-wallet roster is trusted, so the Review tab
//     is reachable when demoing without extra env wiring.
//
// This is UI-gating only — it controls what the app surfaces, not what the
// contract permits. (A future on-chain allowlist would enforce it for real.)

import { TRUSTED_REVIEWERS, OG } from "./config";
import { burnerRoster } from "./burner";

function isLocal() {
  return /127\.0\.0\.1|localhost/.test(OG.rpc) || OG.chainIdDec === 31337 || OG.chainIdDec === 1337;
}

export function isTrustedReviewer(address: string): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  if (TRUSTED_REVIEWERS.has(a)) return true;
  // On the local demo chain, only a SUBSET of demo wallets are trusted reviewers
  // (roster index >= 2, i.e. "Demo wallet 3+"). This lets the demo show the
  // gating: wallets 1–2 are normal contributors and never see the Review tab.
  if (isLocal()) {
    const idx = burnerRoster().findIndex((w) => w.address.toLowerCase() === a);
    return idx >= 2;
  }
  return false;
}
