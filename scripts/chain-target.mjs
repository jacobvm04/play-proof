// Resolves which chain the node scripts (deploy/seed/e2e) target.
//   CHAIN=local  → local ganache (default for dev + e2e)
//   CHAIN=0g     → 0G Galileo testnet (needs OG_SERVER_PRIVATE_KEY funded)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export function loadEnv(file = ".env.local") {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function resolveChain() {
  loadEnv();
  const which = (process.env.CHAIN ?? "local").toLowerCase();
  if (which === "0g") {
    return {
      which: "0g",
      rpc: process.env.NEXT_PUBLIC_OG_RPC ?? "https://evmrpc-testnet.0g.ai",
      privateKey: process.env.OG_SERVER_PRIVATE_KEY,
      explorer: process.env.NEXT_PUBLIC_OG_EXPLORER ?? "https://chainscan-galileo.0g.ai",
    };
  }
  // local
  const accounts = readLocalAccounts();
  return {
    which: "local",
    rpc: process.env.LOCAL_RPC ?? "http://127.0.0.1:8545",
    privateKey: accounts?.[0]?.privateKey,
    accounts,
    explorer: "",
  };
}

export function readLocalAccounts() {
  const p = path.join(root, "data", "local-accounts.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function artifact() {
  return JSON.parse(
    fs.readFileSync(path.join(root, "src", "contracts", "PlayProof.json"), "utf8")
  );
}

export function patchEnvLocal(key, value) {
  const p = path.join(root, ".env.local");
  let txt = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(txt)) txt = txt.replace(re, `${key}=${value}`);
  else txt += `${txt.endsWith("\n") || txt === "" ? "" : "\n"}${key}=${value}\n`;
  fs.writeFileSync(p, txt);
}

export const ROOT = root;
