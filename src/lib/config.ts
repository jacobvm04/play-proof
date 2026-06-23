// Centralized 0G + app configuration. NEXT_PUBLIC_* values are safe in the browser.

export const OG = {
  chainIdDec: Number(process.env.NEXT_PUBLIC_OG_CHAIN_ID ?? 16602),
  chainIdHex: "0x" + Number(process.env.NEXT_PUBLIC_OG_CHAIN_ID ?? 16602).toString(16),
  rpc: process.env.NEXT_PUBLIC_OG_RPC ?? "https://evmrpc-testnet.0g.ai",
  explorer: process.env.NEXT_PUBLIC_OG_EXPLORER ?? "https://chainscan-galileo.0g.ai",
  currency: process.env.NEXT_PUBLIC_OG_CURRENCY ?? "OG",
  storageExplorer:
    process.env.NEXT_PUBLIC_OG_STORAGE_EXPLORER ?? "https://storagescan-galileo.0g.ai",
  contract: process.env.NEXT_PUBLIC_PLAYPROOF_CONTRACT ?? "",
  networkName: "0G Galileo Testnet",
} as const;

// Reviewing is restricted to a trusted set of wallets for now (UI-gated; not
// surfaced to normal users). Configure via NEXT_PUBLIC_TRUSTED_REVIEWERS
// (comma-separated addresses). On a local demo chain, trust is resolved at
// runtime from the demo-wallet roster (see isTrustedReviewer in trusted.ts).
const TRUSTED_ENV = (process.env.NEXT_PUBLIC_TRUSTED_REVIEWERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const TRUSTED_REVIEWERS = new Set(TRUSTED_ENV);

// MetaMask wallet_addEthereumChain payload.
export const OG_CHAIN_PARAMS = {
  chainId: OG.chainIdHex,
  chainName: OG.networkName,
  nativeCurrency: { name: OG.currency, symbol: OG.currency, decimals: 18 },
  rpcUrls: [OG.rpc],
  blockExplorerUrls: [OG.explorer],
};

// A real block explorer (chainscan etc.) renders /tx and /address web pages. A
// bare local EVM node (ganache/anvil) only speaks JSON-RPC — there's no website
// at http://localhost to open — so we hide explorer links unless the configured
// explorer is a real, non-localhost host.
export function hasExplorer() {
  const e = OG.explorer || "";
  return /^https?:\/\//.test(e) && !/localhost|127\.0\.0\.1/.test(e);
}

export function explorerTx(hash: string) {
  return `${OG.explorer}/tx/${hash}`;
}
export function explorerAddress(addr: string) {
  return `${OG.explorer}/address/${addr}`;
}
export function storageLink(rootHash: string) {
  // Storage explorer file lookup by root hash.
  return `${OG.storageExplorer}/?root=${rootHash}`;
}
