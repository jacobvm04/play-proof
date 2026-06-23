"use client";

// In-app "burner wallet" demo mode — lets you click through the whole loop with
// NO MetaMask. The app holds a local test private key (served by /api/burner,
// local-chain only) and signs transactions directly via an ethers.Wallet.
//
// This exists purely for local demoing. On any real network /api/burner refuses
// to hand out keys, so this stays inert.

import { ethers } from "ethers";
import { OG } from "./config";

export type BurnerAccount = { address: string; privateKey: string; label: string };

const LS_KEY = "playproof.burner.address";

let _active: BurnerAccount | null = null;
let _roster: BurnerAccount[] = [];

export function burnerActive() {
  return !!_active;
}
export function activeBurner(): BurnerAccount | null {
  return _active;
}
export function burnerRoster(): BurnerAccount[] {
  return _roster;
}

export async function loadBurnerRoster(): Promise<BurnerAccount[]> {
  try {
    const r = await fetch("/api/burner").then((x) => x.json());
    _roster = r.enabled ? r.accounts : [];
  } catch {
    _roster = [];
  }
  return _roster;
}

export function selectBurner(address: string): BurnerAccount | null {
  const acct = _roster.find((a) => a.address.toLowerCase() === address.toLowerCase());
  _active = acct ?? null;
  if (typeof window !== "undefined") {
    if (acct) window.localStorage.setItem(LS_KEY, acct.address);
    else window.localStorage.removeItem(LS_KEY);
  }
  return _active;
}

export function clearBurner() {
  _active = null;
  if (typeof window !== "undefined") window.localStorage.removeItem(LS_KEY);
}

/** Restore a previously-selected burner after the roster loads (page reload). */
export function restoreBurner(): BurnerAccount | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(LS_KEY);
  if (saved) return selectBurner(saved);
  return null;
}

/** A signer for the active burner against the configured RPC. */
export function burnerSigner(): ethers.Wallet {
  if (!_active) throw new Error("No burner wallet selected.");
  const provider = new ethers.JsonRpcProvider(OG.rpc);
  provider.pollingInterval = 100; // instamine local chain → fast receipts
  return new ethers.Wallet(_active.privateKey, provider);
}
