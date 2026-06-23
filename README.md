# ▰ PlayProof

**Get paid in 0G to record the human task data that trains computer-use AI agents.**

Record a task on screen, get it verified, and claim your reward — every recording stored on 0G Storage, every payout settled on 0G Chain.

**Live app → https://play-proof.vercel.app**
**Demo video → https://cap.so/s/yrrd2ye9j52jqkn**
Contract on 0G Galileo testnet → [`0x576Edfa1c1963E1E05C70441EeFA505aCb54eE50`](https://chainscan-galileo.0g.ai/address/0x576Edfa1c1963E1E05C70441EeFA505aCb54eE50)

---

## The idea

The next wave of AI clicks, types, and navigates software the way we do. To learn that, it needs to watch people actually do it — thousands of real screen recordings of real tasks. Right now that data gets scraped off the internet with no consent, no attribution, and no payment to the people whose work it came from.

PlayProof makes it a fair trade instead. You record yourself doing a task, a reviewer confirms it's legit, and you get paid in 0G. An AI team on the other side gets a dataset where they can trace every single clip back to who made it and who checked it. Nobody's data gets taken — it gets bought.

## Walking through it

Say an AI lab needs examples of people filling out web forms. They post a bounty and put up the reward. You see it, hit record, fill out a form on screen, and submit. Your recording goes to 0G Storage, and a fingerprint of it — the merkle root hash — gets written to 0G Chain along with your address. That hash is the receipt: it proves *this* recording existed and *you* made it, and it can't be quietly swapped out later.

Then a trusted reviewer plays it back. If it's real, they approve it — one click, settled onchain, and they earn a cut for checking. You claim your reward, and the clip joins the dataset. The buyer can export the whole thing as a manifest: every approved recording, its storage hash, who recorded it, who verified it. Provenance you can audit line by line.

## Where 0G comes in

This only works because all three pieces of 0G are doing real jobs, not sitting in the pitch.

The recordings live on **0G Storage** — uploaded through the official SDK, with the root hash that comes back becoming the onchain proof. **0G Chain** is the marketplace itself: a contract that holds every bounty, submission, review, and payout, with everyone transacting natively and getting paid in 0G. And **0G Compute** runs an AI pre-screen over each clip to flag and score it, so reviewers know where to look first.

The one rule we didn't bend: the AI is allowed to *suggest*, but a human is the one who *decides*. Every clip that makes it into a dataset has a person's signature on it. That's the whole point — it's what separates this from another pile of scraped video.

## Try it in two minutes

The live app runs on **0G Galileo testnet**. Bring an EVM wallet (MetaMask or Rabby; Phantom works with Testnet Mode on) and grab testnet 0G from the [faucet](https://faucet.0g.ai). Reviewers can't approve their own work, so the full loop uses two wallets.

1. Open **https://play-proof.vercel.app** and connect.
2. **Record** → pick a bounty → screen-record the task → **Submit**. It uploads to 0G Storage and writes to 0G Chain.
3. Switch to a trusted reviewer wallet → the **Review** tab appears → play it back → **Approve**.
4. Back on the contributor wallet → **My Submissions → Claim** → 0G hits your wallet.
5. **Datasets** → watch the dataset grow and download the manifest.

## Architecture

```
Browser (Next.js · ethers v6 · multi-wallet via EIP-6963)
│
├─ Record: getDisplayMedia + MediaRecorder ──► /api/analyze
│                                               ├─ package the recording
│                                               └─ upload to 0G Storage ──► root hash + tx
│
├─ Contributor: submitClip(bountyId, rootHash)  ─┐
├─ Reviewer:    submitReview(id, approve)        ├─►  0G Chain  (PlayProof.sol)
├─ Contributor: claimReward(id)                  │
├─ Buyer:       createBounty(...)                ─┘
│
└─ Reads come straight from 0G Chain · recordings stream from 0G Storage (/api/clip)
```

No database. The contract on 0G Chain is the source of truth for every bounty, submission, and payout; recordings live on 0G Storage. The app reads both directly — which is why it runs fully serverless with nothing else to provision.

### The contract (`contracts/PlayProof.sol`)

```solidity
createBounty(title, taskType, rewardPerClip, reviewerReward)  // buyer escrows the reward
submitClip(bountyId, storageRootHash)                         // contributor records provenance
submitReview(submissionId, approve)                           // a trusted reviewer settles it
claimReward(submissionId)                                     // contributor is paid in 0G
```

One approval settles a submission: approve makes it claimable, reject returns the reward to the bounty.

## Stack

Next.js 14 · TypeScript · Tailwind · ethers v6 · `@0gfoundation/0g-ts-sdk` · Solidity · Vercel

## Run it locally

```bash
npm install
npm run compile          # contract → ABI + bytecode

# Local chain — no faucet needed, has a built-in demo wallet
npm run chain            # terminal 1: local EVM with funded test wallets
npm run deploy           # deploy + auto-fill the contract address
npm run seed             # create the demo bounties
npm run dev              # http://localhost:3000

# Or point it at real 0G Galileo testnet
cp .env.example .env.local      # set OG_SERVER_PRIVATE_KEY (funded via faucet.0g.ai)
CHAIN=0g npm run deploy && CHAIN=0g npm run seed
npm run dev
```

### Tests

```bash
npm run test:unit   # scoring core + the full onchain contract lifecycle
npm run test:e2e    # boots a chain + dev server and runs the whole flow end-to-end
```

Submit → review → claim is covered with exact balance assertions and guard rails.

### Ship it

```bash
npm run ship        # syncs env to Vercel and deploys to production
```

---

*PlayProof — the data layer for computer-use AI, built on 0G.*
