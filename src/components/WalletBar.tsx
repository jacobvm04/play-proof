"use client";

import { useEffect, useState } from "react";
import { connectWallet, hasWallet, short } from "@/lib/client-contract";
import { OG, explorerAddress } from "@/lib/config";

export function useWallet() {
  const [address, setAddress] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!hasWallet()) return;
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((a: string[]) => a?.[0] && setAddress(a[0]))
      .catch(() => {});
    const onAccts = (a: string[]) => setAddress(a?.[0] ?? "");
    window.ethereum.on?.("accountsChanged", onAccts);
    return () => window.ethereum.removeListener?.("accountsChanged", onAccts);
  }, []);

  const connect = async () => {
    setErr("");
    try {
      setAddress(await connectWallet());
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  };

  return { address, connect, err };
}

export default function WalletBar({
  address,
  onConnect,
}: {
  address: string;
  onConnect: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="chip">
        <span className="h-2 w-2 rounded-full bg-good animate-pulseGlow" />
        {OG.networkName}
      </span>
      {address ? (
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          className="chip hover:border-brand/60"
          title="View on explorer"
        >
          <span className="h-2 w-2 rounded-full bg-brand" />
          {short(address)}
        </a>
      ) : (
        <button className="btn-primary" onClick={onConnect}>
          Connect Wallet
        </button>
      )}
    </div>
  );
}
