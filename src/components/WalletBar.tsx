"use client";

import { useEffect, useState } from "react";
import { connectWallet, hasWallet, short } from "@/lib/client-contract";
import { OG, explorerAddress, hasExplorer } from "@/lib/config";
import { listProviders, selectProvider, activeProvider, type DiscoveredProvider } from "@/lib/provider";
import {
  type BurnerAccount,
  burnerActive,
  clearBurner,
  loadBurnerRoster,
  restoreBurner,
  selectBurner,
} from "@/lib/burner";

export function useWallet() {
  const [address, setAddress] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [roster, setRoster] = useState<BurnerAccount[]>([]);
  const [isBurner, setIsBurner] = useState(false);
  const [wallets, setWallets] = useState<DiscoveredProvider[]>([]);

  useEffect(() => {
    // Load the burner roster (local chain only) and restore a prior selection.
    loadBurnerRoster().then((r) => {
      setRoster(r);
      const restored = restoreBurner();
      if (restored) {
        setAddress(restored.address);
        setIsBurner(true);
      }
    });

    // Discover EVM wallets (EIP-6963). Re-check shortly after mount since some
    // extensions announce a tick late.
    const refresh = () => setWallets(listProviders());
    refresh();
    const t = setTimeout(refresh, 400);

    const eth = activeProvider();
    if (eth) {
      eth
        .request({ method: "eth_accounts" })
        .then((a: string[]) => {
          if (a?.[0] && !burnerActive()) setAddress(a[0]);
        })
        .catch(() => {});
      const onAccts = (a: string[]) => {
        if (!burnerActive()) setAddress(a?.[0] ?? "");
      };
      eth.on?.("accountsChanged", onAccts);
      return () => {
        clearTimeout(t);
        eth.removeListener?.("accountsChanged", onAccts);
      };
    }
    return () => clearTimeout(t);
  }, []);

  const connect = async (chosen?: DiscoveredProvider) => {
    setErr("");
    try {
      if (chosen) selectProvider(chosen.provider);
      setAddress(await connectWallet());
      setIsBurner(false);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  };

  const useBurner = (addr: string) => {
    const acct = selectBurner(addr);
    if (acct) {
      setAddress(acct.address);
      setIsBurner(true);
      setErr("");
    }
  };

  const disconnect = () => {
    clearBurner();
    setIsBurner(false);
    setAddress("");
  };

  return { address, connect, err, roster, isBurner, useBurner, disconnect, wallets };
}

export default function WalletBar({
  address,
  onConnect,
  roster,
  isBurner,
  onUseBurner,
  onDisconnect,
  wallets,
}: {
  address: string;
  onConnect: (chosen?: DiscoveredProvider) => void;
  roster: BurnerAccount[];
  isBurner: boolean;
  onUseBurner: (addr: string) => void;
  onDisconnect: () => void;
  wallets: DiscoveredProvider[];
}) {
  const [open, setOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const hasBurner = roster.length > 0;

  return (
    <div className="relative flex items-center gap-3">
      <span className="chip">
        <span className="h-2 w-2 rounded-full bg-good animate-pulseGlow" />
        {OG.networkName}
      </span>

      {address ? (
        <div className="flex items-center gap-2">
          {hasBurner && (
            <button
              className="chip hover:border-brand/60"
              onClick={() => setOpen((o) => !o)}
              title="Switch demo wallet"
            >
              <span className="h-2 w-2 rounded-full bg-brand" />
              {short(address)}
              {isBurner && <span className="ml-1 text-[10px] text-muted">demo</span>}
              <span className="ml-1 opacity-60">▾</span>
            </button>
          )}
          {!hasBurner &&
            (hasExplorer() ? (
              <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="chip hover:border-brand/60">
                <span className="h-2 w-2 rounded-full bg-brand" />
                {short(address)}
              </a>
            ) : (
              <span className="chip">
                <span className="h-2 w-2 rounded-full bg-brand" />
                {short(address)}
              </span>
            ))}
        </div>
      ) : hasBurner ? (
        <button className="btn-primary" onClick={() => setOpen((o) => !o)}>
          Use a demo wallet ▾
        </button>
      ) : wallets.length > 1 ? (
        <button className="btn-primary" onClick={() => setPickOpen((o) => !o)}>
          Connect wallet ▾
        </button>
      ) : (
        <button className="btn-primary" onClick={() => onConnect(wallets[0])}>
          Connect wallet
        </button>
      )}

      {/* Wallet picker — judges choose whichever extension they have. */}
      {pickOpen && wallets.length > 1 && (
        <div className="absolute right-0 top-11 z-50 w-60 rounded-deck border border-edge bg-panel p-2 shadow-glow">
          <div className="label px-2 py-1">Choose a wallet</div>
          {wallets.map((w) => (
            <button
              key={w.info.uuid}
              onClick={() => {
                onConnect(w);
                setPickOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-deck px-2 py-2 text-left text-sm text-bone hover:bg-panel2"
            >
              {w.info.icon && <img src={w.info.icon} alt="" className="h-4 w-4 rounded" />}
              {w.info.name}
            </button>
          ))}
          <div className="mt-1 border-t border-edge px-2 pt-2 text-[10px] text-muted">
            0G testnet needs an EVM wallet that supports custom networks (MetaMask, Rabby).
          </div>
        </div>
      )}

      {open && hasBurner && (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-deck border border-edge bg-panel p-2 shadow-glow">
          <div className="label px-2 py-1">Demo wallets (no MetaMask)</div>
          {roster.map((a) => (
            <button
              key={a.address}
              onClick={() => {
                onUseBurner(a.address);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-deck px-2 py-2 text-left text-sm hover:bg-panel2 ${
                a.address.toLowerCase() === address.toLowerCase() ? "bg-brand/10 text-bone" : "text-muted"
              }`}
            >
              <span>{a.label}</span>
              <span className="font-mono text-xs">{short(a.address)}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-edge pt-1">
            {hasWallet() && (
              <button
                onClick={() => {
                  onConnect();
                  setOpen(false);
                }}
                className="w-full rounded-deck px-2 py-2 text-left text-sm text-muted hover:bg-panel2"
              >
                Use MetaMask instead
              </button>
            )}
            {address && (
              <button
                onClick={() => {
                  onDisconnect();
                  setOpen(false);
                }}
                className="w-full rounded-deck px-2 py-2 text-left text-sm text-bad hover:bg-panel2"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
