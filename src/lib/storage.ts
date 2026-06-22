// ────────────────────────────────────────────────────────────────────────────
// 0G Storage — canonical home for gameplay clip bytes.
//
// Uploads a clip to 0G Storage via the @0glabs/0g-ts-sdk Indexer, returning the
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
    const sdk: any = await import("@0glabs/0g-ts-sdk");
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

    const [tx, uploadErr] = await indexer.upload(file, RPC, signer);
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
