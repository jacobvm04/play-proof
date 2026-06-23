"use client";

// Wallet provider resolution that works across MetaMask, Phantom (EVM), Rabby,
// Coinbase, etc. Uses EIP-6963 discovery (which Phantom + MetaMask both emit)
// and falls back to window.ethereum / window.phantom.ethereum.
//
// We prefer an explicit injected EVM provider so a judge's wallet — whatever it
// is — gets used, rather than guessing which one won the window.ethereum race.

type Eip1193 = {
  request: (args: { method: string; params?: any }) => Promise<any>;
  on?: (event: string, handler: (...a: any[]) => void) => void;
  removeListener?: (event: string, handler: (...a: any[]) => void) => void;
};

export type DiscoveredProvider = {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Eip1193;
};

const discovered: DiscoveredProvider[] = [];

if (typeof window !== "undefined") {
  // EIP-6963: providers announce themselves; we collect them.
  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const d = event.detail as DiscoveredProvider;
    if (d?.info?.uuid && !discovered.some((p) => p.info.uuid === d.info.uuid)) {
      discovered.push(d);
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** All EVM wallets the browser exposes, de-duplicated. */
export function listProviders(): DiscoveredProvider[] {
  const out = [...discovered];
  // Fold in legacy globals if 6963 didn't surface them.
  const legacy: { p: any; name: string; rdns: string }[] = [];
  const w = window as any;
  if (w?.phantom?.ethereum) legacy.push({ p: w.phantom.ethereum, name: "Phantom", rdns: "app.phantom" });
  if (w?.ethereum) {
    const e = w.ethereum;
    const name = e.isMetaMask ? "MetaMask" : e.isRabby ? "Rabby" : e.isCoinbaseWallet ? "Coinbase Wallet" : "Browser wallet";
    legacy.push({ p: e, name, rdns: name.toLowerCase().replace(/\s+/g, ".") });
  }
  for (const l of legacy) {
    if (!out.some((d) => d.provider === l.p)) {
      out.push({ info: { uuid: l.rdns, name: l.name, rdns: l.rdns }, provider: l.p });
    }
  }
  return out;
}

export function hasAnyWallet(): boolean {
  if (typeof window === "undefined") return false;
  return listProviders().length > 0;
}

export function isPhantom(p: Eip1193 | undefined): boolean {
  return !!p && ((p as any).isPhantom === true);
}

// The currently-selected provider for this session (chosen by the user, or the
// single available one). Defaults to the first discovered provider.
let selected: Eip1193 | null = null;

export function selectProvider(p: Eip1193) {
  selected = p;
}

export function activeProvider(): Eip1193 | null {
  if (selected) return selected;
  const all = listProviders();
  // Prefer a non-Phantom EVM wallet by default (broadest 0G compatibility), but
  // fall back to whatever exists so Phantom-only users still get a provider.
  const nonPhantom = all.find((d) => !isPhantom(d.provider));
  selected = (nonPhantom ?? all[0])?.provider ?? null;
  return selected;
}
