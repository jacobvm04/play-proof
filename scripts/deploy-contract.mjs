// Deploys PlayProof to 0G Galileo testnet using OG_SERVER_PRIVATE_KEY as both
// deployer and oracle. Prints the address to put in NEXT_PUBLIC_PLAYPROOF_CONTRACT.
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Load .env.local manually (no extra dep).
loadEnv(path.join(root, ".env.local"));

const RPC = process.env.NEXT_PUBLIC_OG_RPC || "https://evmrpc-testnet.0g.ai";
const PK = process.env.OG_SERVER_PRIVATE_KEY;

if (!PK) {
  console.error("Set OG_SERVER_PRIVATE_KEY in .env.local (a funded 0G testnet account).");
  process.exit(1);
}

const artifactPath = path.join(root, "src", "contracts", "PlayProof.json");
if (!fs.existsSync(artifactPath)) {
  console.error("Missing src/contracts/PlayProof.json — run `npm run compile` first.");
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

console.log("Deployer / oracle:", wallet.address);
const bal = await provider.getBalance(wallet.address);
console.log("Balance:", ethers.formatEther(bal), "0G");
if (bal === 0n) {
  console.error("Account has no 0G. Fund it at https://faucet.0g.ai");
  process.exit(1);
}

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
console.log("Deploying PlayProof (oracle = deployer) …");
const contract = await factory.deploy(wallet.address);
await contract.waitForDeployment();
const address = await contract.getAddress();

console.log("\n✓ PlayProof deployed at:", address);
console.log("  Explorer:", `${process.env.NEXT_PUBLIC_OG_EXPLORER || "https://chainscan-galileo.0g.ai"}/address/${address}`);
console.log("\nAdd this to .env.local:");
console.log(`NEXT_PUBLIC_PLAYPROOF_CONTRACT=${address}`);

// Helpfully patch .env.local if present.
try {
  const envPath = path.join(root, ".env.local");
  if (fs.existsSync(envPath)) {
    let txt = fs.readFileSync(envPath, "utf8");
    if (/^NEXT_PUBLIC_PLAYPROOF_CONTRACT=/m.test(txt)) {
      txt = txt.replace(/^NEXT_PUBLIC_PLAYPROOF_CONTRACT=.*$/m, `NEXT_PUBLIC_PLAYPROOF_CONTRACT=${address}`);
    } else {
      txt += `\nNEXT_PUBLIC_PLAYPROOF_CONTRACT=${address}\n`;
    }
    fs.writeFileSync(envPath, txt);
    console.log("\n(.env.local updated automatically.)");
  }
} catch {}

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
