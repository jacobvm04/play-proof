// Seeds the deployed PlayProof contract with demo computer-use task bounties.
// CHAIN=local (default) or CHAIN=0g. Uses the deployer as the dataset buyer.
import { ethers } from "ethers";
import { resolveChain, artifact, loadEnv } from "./chain-target.mjs";

loadEnv();
const chain = resolveChain();
const ADDR = process.env.NEXT_PUBLIC_PLAYPROOF_CONTRACT;
if (!chain.privateKey || !ADDR) {
  console.error("Need a deployed contract (NEXT_PUBLIC_PLAYPROOF_CONTRACT) and a funded key. Deploy first.");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(chain.rpc);
const wallet = new ethers.Wallet(chain.privateKey, provider);
const contract = new ethers.Contract(ADDR, artifact().abi, wallet);

// title, taskType, rewardPerClip, reviewerReward, submissions funded.
// Sized for a faucet-funded testnet wallet (~0.5 0G): small rewards, a few
// fundable takes each, so the whole board seeds for well under the balance and
// leaves room for gas + live demo payouts.
const BOUNTIES = [
  ["Fill out a multi-step web form (signup → verify → submit)", "web_form", "0.005", "0.0005", 3],
  ["Navigate & edit a spreadsheet to a target state", "spreadsheet", "0.005", "0.0005", 3],
  ["Research a question across multiple browser tabs", "web_research", "0.005", "0.0005", 2],
  ["Triage an email inbox: label, archive, reply", "email_triage", "0.005", "0.0005", 2],
  ["Game: FPS aim-correction sequences", "game_fps", "0.004", "0.0005", 2],
  ["Game: platformer parkour failure recovery", "game_parkour", "0.004", "0.0005", 2],
];

for (const [title, taskType, reward, revReward, count] of BOUNTIES) {
  const rewardWei = ethers.parseEther(reward);
  const revWei = ethers.parseEther(revReward);
  const budget = (rewardWei + revWei) * BigInt(count);
  process.stdout.write(`Creating "${title}" … `);
  const tx = await contract.createBounty(title, taskType, rewardWei, revWei, { value: budget });
  const rc = await tx.wait();
  console.log(`ok (block ${rc.blockNumber})`);
}

console.log(`\n✓ Seeded ${BOUNTIES.length} task bounties on ${ADDR} (${chain.which})`);
