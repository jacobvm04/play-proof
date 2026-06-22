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

// title, taskType, rewardPerClip, reviewerReward, requiredReviews, submissions funded
const BOUNTIES = [
  ["Fill out a multi-step web form (signup → verify → submit)", "web_form", "0.01", "0.001", 3, 15],
  ["Navigate & edit a spreadsheet to a target state", "spreadsheet", "0.012", "0.001", 3, 12],
  ["Research a question across multiple browser tabs", "web_research", "0.012", "0.001", 3, 12],
  ["Triage an email inbox: label, archive, reply", "email_triage", "0.01", "0.001", 3, 12],
  ["Game: FPS aim-correction sequences", "game_fps", "0.008", "0.001", 3, 12],
  ["Game: platformer parkour failure recovery", "game_parkour", "0.008", "0.001", 3, 12],
];

for (const [title, taskType, reward, revReward, n, count] of BOUNTIES) {
  const rewardWei = ethers.parseEther(reward);
  const revWei = ethers.parseEther(revReward);
  const perSubmission = rewardWei + revWei * BigInt(n);
  const budget = perSubmission * BigInt(count);
  process.stdout.write(`Creating "${title}" … `);
  const tx = await contract.createBounty(title, taskType, rewardWei, revWei, n, { value: budget });
  const rc = await tx.wait();
  console.log(`ok (block ${rc.blockNumber})`);
}

console.log(`\n✓ Seeded ${BOUNTIES.length} task bounties on ${ADDR} (${chain.which})`);
