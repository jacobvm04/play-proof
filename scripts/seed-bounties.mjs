// Seeds the deployed PlayProof contract with the demo dataset bounties so the
// mission board is populated for a live demo. Uses OG_SERVER_PRIVATE_KEY as the
// dataset buyer and escrows a small budget per bounty.
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
loadEnv(path.join(root, ".env.local"));

const RPC = process.env.NEXT_PUBLIC_OG_RPC || "https://evmrpc-testnet.0g.ai";
const PK = process.env.OG_SERVER_PRIVATE_KEY;
const ADDR = process.env.NEXT_PUBLIC_PLAYPROOF_CONTRACT;

if (!PK || !ADDR) {
  console.error("Need OG_SERVER_PRIVATE_KEY and NEXT_PUBLIC_PLAYPROOF_CONTRACT in .env.local.");
  process.exit(1);
}

const artifact = JSON.parse(
  fs.readFileSync(path.join(root, "src", "contracts", "PlayProof.json"), "utf8")
);

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);
const contract = new ethers.Contract(ADDR, artifact.abi, wallet);

// title, requiredLabel, rewardPerClip (0G), clips funded
const BOUNTIES = [
  ["Collect parkour failure recovery clips", "parkour", "0.005", 20],
  ["FPS human aim-correction examples", "aim_correction", "0.006", 20],
  ["Racing-game cornering & overtakes", "racing", "0.004", 20],
  ["NPC dialogue choice interactions", "dialogue", "0.004", 20],
  ["Failed boss-fight attempts", "boss_fail", "0.007", 15],
];

for (const [title, label, reward, clips] of BOUNTIES) {
  const rewardWei = ethers.parseEther(reward);
  const budget = rewardWei * BigInt(clips);
  process.stdout.write(`Creating "${title}" … `);
  const tx = await contract.createBounty(title, label, rewardWei, { value: budget });
  const rc = await tx.wait();
  console.log(`ok (block ${rc.blockNumber})`);
}

console.log(`\n✓ Seeded ${BOUNTIES.length} bounties on ${ADDR}`);

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
