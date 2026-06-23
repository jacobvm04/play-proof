"use client";

// Explorer-aware link helpers. On a bare local chain there's no block-explorer
// website to open, so these render plain (non-clickable) labels instead of dead
// links. On a real network (0G testnet) they become working explorer links.

import { explorerAddress, explorerTx, hasExplorer, storageLink, OG } from "@/lib/config";
import { short } from "@/lib/client-contract";

export function TxLink({
  hash,
  className = "",
  children,
}: {
  hash?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!hash) return null;
  const label = children ?? "tx ↗";
  if (!hasExplorer()) {
    return (
      <span className={className} title={`tx ${hash}`}>
        {children ?? "tx ✓"}
      </span>
    );
  }
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className={className}>
      {label}
    </a>
  );
}

export function AddressLink({
  address,
  className = "",
}: {
  address: string;
  className?: string;
}) {
  if (!hasExplorer()) return <span className={className}>{short(address)}</span>;
  return (
    <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className={className}>
      {short(address)}
    </a>
  );
}

// The 0G Storage explorer only resolves a root hash once bytes are actually
// persisted on 0G Storage (i.e. on a real network with a funded server key).
export function StorageRef({
  rootHash,
  uploaded,
  className = "",
}: {
  rootHash: string;
  uploaded?: boolean;
  className?: string;
}) {
  const linkable = uploaded && /0g\.ai/i.test(OG.storageExplorer);
  if (!linkable) return <span className={`break-all font-mono ${className}`}>{rootHash}</span>;
  return (
    <a
      href={storageLink(rootHash)}
      target="_blank"
      rel="noreferrer"
      className={`break-all font-mono hover:underline ${className}`}
    >
      {rootHash}
    </a>
  );
}
