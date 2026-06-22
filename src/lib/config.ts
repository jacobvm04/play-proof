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

// MetaMask wallet_addEthereumChain payload.
export const OG_CHAIN_PARAMS = {
  chainId: OG.chainIdHex,
  chainName: OG.networkName,
  nativeCurrency: { name: OG.currency, symbol: OG.currency, decimals: 18 },
  rpcUrls: [OG.rpc],
  blockExplorerUrls: [OG.explorer],
};

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
