// Full-stack e2e harness:
//   1. boot a local ganache chain (funded, shanghai)
//   2. deploy + seed PlayProof on it
//   3. start the Next dev server wired to the local chain (server key = oracle)
//   4. run the vitest suite (unit + on-chain contract + full-stack API)
//   5. tear everything down
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeServer, writeAccounts, LOCAL_PORT } from "./local-chain.mjs";
import { artifact } from "./chain-target.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = process.env.PLAYPROOF_BASE ?? "http://localhost:3000";

const cleanup = [];
async function shutdown(code) {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {}
  }
  process.exit(code ?? 0);
}

// ── 1. local chain ──
console.log("• booting local chain …");
const chain = makeServer();
await new Promise((res, rej) => chain.listen(LOCAL_PORT, (e) => (e ? rej(e) : res())));
const accounts = Object.entries(chain.provider.getInitialAccounts()).map(([address, a]) => ({
  address,
  privateKey: a.secretKey,
}));
writeAccounts(accounts);
cleanup.push(() => chain.close());

const RPC = `http://127.0.0.1:${LOCAL_PORT}`;
const provider = new ethers.JsonRpcProvider(RPC);
provider.pollingInterval = 100;
const deployer = new ethers.Wallet(accounts[0].privateKey, provider);

// ── 2. deploy + seed ──
console.log("• deploying PlayProof …");
const art = artifact();
const factory = new ethers.ContractFactory(art.abi, art.bytecode, deployer);
const contract = await factory.deploy(deployer.address);
await contract.waitForDeployment();
const ADDR = await contract.getAddress();
console.log("  deployed at", ADDR);

const c = new ethers.Contract(ADDR, art.abi, deployer);
const seed = [
  ["Fill out a multi-step web form", "web_form", "0.01", "0.001", 3, 10],
  ["Navigate & edit a spreadsheet", "spreadsheet", "0.012", "0.001", 3, 10],
  ["Game: FPS aim-correction sequences", "game_fps", "0.008", "0.001", 3, 10],
];
for (const [title, taskType, reward, rev, n, count] of seed) {
  const r = ethers.parseEther(reward);
  const rr = ethers.parseEther(rev);
  const budget = (r + rr * BigInt(n)) * BigInt(count);
  const tx = await c.createBounty(title, taskType, r, rr, n, { value: budget });
  await tx.wait();
}
console.log(`  seeded ${seed.length} bounties`);

// ── 3. dev server wired to local chain ──
// Write .env.local (Next reads this), backing up any existing one for the run.
const realEnv = path.join(root, ".env.local");
const backup = fs.existsSync(realEnv) ? fs.readFileSync(realEnv, "utf8") : null;
fs.writeFileSync(
  realEnv,
  [
    `NEXT_PUBLIC_OG_CHAIN_ID=31337`,
    `NEXT_PUBLIC_OG_RPC=${RPC}`,
    `NEXT_PUBLIC_OG_EXPLORER=http://localhost`,
    `NEXT_PUBLIC_OG_CURRENCY=ETH`,
    `NEXT_PUBLIC_PLAYPROOF_CONTRACT=${ADDR}`,
    `OG_SERVER_PRIVATE_KEY=${accounts[0].privateKey}`,
    `OG_STORAGE_INDEXER=https://indexer-storage-testnet-turbo.0g.ai`,
    `OG_COMPUTE_ENABLED=false`,
  ].join("\n") + "\n"
);
cleanup.push(() => {
  if (backup !== null) fs.writeFileSync(realEnv, backup);
  else fs.promises.unlink(realEnv).catch(() => {});
});

// Reset the index so the run starts clean.
const dbPath = path.join(root, "data", "db.json");
const prevDb = fs.existsSync(dbPath) ? fs.readFileSync(dbPath, "utf8") : null;
fs.writeFileSync(dbPath, JSON.stringify({ submissions: [] }, null, 2));
cleanup.push(() => {
  if (prevDb !== null) fs.writeFileSync(dbPath, prevDb);
});

console.log("• starting dev server …");
const server = spawn("npx", ["next", "dev"], { cwd: root, stdio: "ignore", detached: true });
cleanup.push(() => {
  try {
    process.kill(-server.pid);
  } catch {}
});

async function up() {
  try {
    const r = await fetch(`${BASE}/api/bounties`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const j = await r.json();
    return j.configured === true;
  } catch {
    return false;
  }
}
const start = Date.now();
while (Date.now() - start < 60000) {
  if (await up()) break;
  await sleep(1000);
}
if (!(await up())) {
  console.error("✗ dev server not ready / not configured in 60s");
  await shutdown(1);
}
console.log("• server ready and configured");

// Expose chain details to the test via env.
const vitest = spawn("node_modules/.bin/vitest", ["run"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYPROOF_BASE: BASE,
    E2E_RPC: RPC,
    E2E_CONTRACT: ADDR,
    E2E_ACCOUNTS: JSON.stringify(accounts),
  },
});
const code = await new Promise((res) => vitest.on("exit", res));
await shutdown(code ?? 0);
