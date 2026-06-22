// Deploys PlayProof. Target chain via CHAIN env:
//   CHAIN=local (default) → local ganache (deployer = first funded account)
//   CHAIN=0g              → 0G Galileo testnet (OG_SERVER_PRIVATE_KEY, funded)
// On success, writes NEXT_PUBLIC_PLAYPROOF_CONTRACT into .env.local.
import { ethers } from "ethers";
import { resolveChain, artifact, patchEnvLocal } from "./chain-target.mjs";

const chain = resolveChain();
if (!chain.privateKey) {
  if (chain.which === "local") {
    console.error("No local accounts found. Start the chain first: `npm run chain` (or use `npm run deploy:local`).");
  } else {
    console.error("Set OG_SERVER_PRIVATE_KEY in .env.local (a funded 0G testnet account: https://faucet.0g.ai).");
  }
  process.exit(1);
}

const art = artifact();
const provider = new ethers.JsonRpcProvider(chain.rpc);
const wallet = new ethers.Wallet(chain.privateKey, provider);

console.log(`Chain: ${chain.which} (${chain.rpc})`);
console.log("Deployer / oracle:", wallet.address);
const bal = await provider.getBalance(wallet.address);
console.log("Balance:", ethers.formatEther(bal));
if (bal === 0n) {
  console.error(chain.which === "0g" ? "Account has no 0G. Fund it at https://faucet.0g.ai" : "Account unfunded.");
  process.exit(1);
}

const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
console.log("Deploying PlayProof (oracle = deployer) …");
const contract = await factory.deploy(wallet.address);
await contract.waitForDeployment();
const address = await contract.getAddress();

console.log("\n✓ PlayProof deployed at:", address);
if (chain.explorer) console.log("  Explorer:", `${chain.explorer}/address/${address}`);

patchEnvLocal("NEXT_PUBLIC_PLAYPROOF_CONTRACT", address);
console.log("\n(.env.local updated: NEXT_PUBLIC_PLAYPROOF_CONTRACT)");

// Emit the address on stdout's last line for scripting.
console.log("ADDRESS=" + address);
