// ────────────────────────────────────────────────────────────────────────────
// 0G Storage — canonical home for gameplay clip bytes.
//
// Uploads a clip to 0G Storage via the @0gfoundation/0g-ts-sdk Indexer, returning the
// merkle root hash (tamper-resistant provenance written on-chain) and the
// upload tx hash. The server-side signer (OG_SERVER_PRIVATE_KEY) pays storage
// fees. Server-only module — never import into a client component.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import { ethers } from "ethers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const INDEXER = process.env.OG_STORAGE_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai";
const RPC = process.env.NEXT_PUBLIC_OG_RPC ?? "https://evmrpc-testnet.0g.ai";

export type StorageResult = {
  rootHash: string;
  txHash?: string;
  uploaded: boolean; // false when we fell back to local-only (no server key)
  indexer: string;
};

/**
 * Upload a buffer to 0G Storage. The SDK reads from a file path, so we stage the
 * bytes in a temp file, run merkleTree() for the root hash, then indexer.upload().
 */
export async function uploadToOgStorage(bytes: Buffer, fileName: string): Promise<StorageResult> {
  const pk = process.env.OG_SERVER_PRIVATE_KEY;

  // Stage to a temp file for the SDK.
  const tmp = path.join(os.tmpdir(), `pp-${crypto.randomBytes(8).toString("hex")}-${sanitize(fileName)}`);
  fs.writeFileSync(tmp, bytes);

  try {
    // Lazy import keeps the SDK out of the client bundle and lets the app build
    // even before `npm install` pulls the native deps.
    const sdk: any = await import("@0gfoundation/0g-ts-sdk");
    const { Indexer, ZgFile } = sdk;

    const file = await ZgFile.fromFilePath(tmp);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr) {
      await file.close();
      throw new Error(`merkleTree failed: ${treeErr}`);
    }
    const rootHash: string = tree.rootHash();

    // We always return the real merkle root hash (provenance). We only attempt
    // to PERSIST bytes on 0G Storage when (a) we have a funded key and (b) the
    // EVM RPC is an actual 0G endpoint — paying the 0G indexer with a local-chain
    // key would just fail, so on local/dev we stop at the root hash.
    const isOgRpc = /0g\.ai/i.test(RPC);
    if (!pk || !isOgRpc) {
      await file.close();
      return { rootHash, uploaded: false, indexer: INDEXER };
    }

    const provider = new ethers.JsonRpcProvider(RPC);
    const signer = new ethers.Wallet(pk, provider);
    const indexer = new Indexer(INDEXER);

    // finalityRequired:false — return as soon as the storage tx is submitted to
    // the Flow contract (that's the on-chain provenance + real txHash) and the
    // segments are pushed to nodes. We DON'T block waiting for full storage-node
    // finalization, which on testnet can take tens of seconds and was causing
    // the serverless function to hit its 60s timeout.
    const uploadOpts = { finalityRequired: false } as any;
    const [tx, uploadErr] = await indexer.upload(file, RPC, signer, uploadOpts);
    await file.close();
    if (uploadErr) {
      throw new Error(`0G Storage upload failed: ${uploadErr}`);
    }

    return {
      rootHash,
      txHash: typeof tx === "string" ? tx : tx?.txHash ?? tx?.hash,
      uploaded: true,
      indexer: INDEXER,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

// ────────────────────────────────────────────────────────────────────────────
// Bundle cache + download.
//
// The app is stateless (no DB, no local clip folder) so it runs on a read-only
// serverless filesystem. The canonical store is 0G: the contract holds each
// submission's bundle root hash, and the bundle bytes live on 0G Storage.
//
// To play a recording back we need its bundle bytes. We keep a small in-memory
// LRU keyed by root hash, populated when a clip is first uploaded (so it plays
// instantly in the same warm instance), and fall back to downloading from 0G
// Storage on a cache miss. Both paths use only memory + /tmp, which Vercel allows.
// ────────────────────────────────────────────────────────────────────────────

const MAX_CACHE = 24;
const bundleCache = new Map<string, Buffer>(); // rootHash -> full bundle bytes

export function cacheBundle(rootHash: string, bundle: Buffer) {
  bundleCache.set(rootHash, bundle);
  while (bundleCache.size > MAX_CACHE) {
    const oldest = bundleCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    bundleCache.delete(oldest);
  }
}

/** Cache-only lookup — never triggers a (slow) 0G download. */
export function getCachedBundle(rootHash: string): Buffer | undefined {
  return bundleCache.get(rootHash);
}

/** Get a bundle's bytes: from cache, else download from 0G Storage. */
export async function getBundle(rootHash: string): Promise<Buffer | null> {
  const cached = bundleCache.get(rootHash);
  if (cached) return cached;

  // Cache miss — download from 0G Storage via the SDK (writes to /tmp, reads back).
  const out = path.join(os.tmpdir(), `pp-dl-${crypto.randomBytes(8).toString("hex")}`);
  try {
    const sdk: any = await import("@0gfoundation/0g-ts-sdk");
    const indexer = new sdk.Indexer(INDEXER);
    const err = await indexer.download(rootHash, out, true);
    if (err) return null;
    const bytes = fs.readFileSync(out);
    cacheBundle(rootHash, bytes);
    return bytes;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(out);
    } catch {}
  }
}
