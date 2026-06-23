# ▰ PlayProof

**Get paid in 0G to record the human task data that trains computer-use AI agents.**

Record a task on screen, get it verified, and claim your reward — every recording stored on 0G Storage, every payout settled on 0G Chain.

**Live app → https://play-proof.vercel.app**
**Demo video → https://cap.so/s/yrrd2ye9j52jqkn**
Contract on 0G Galileo testnet → [`0x576Edfa1c1963E1E05C70441EeFA505aCb54eE50`](https://chainscan-galileo.0g.ai/address/0x576Edfa1c1963E1E05C70441EeFA505aCb54eE50)

---

## Why this matters

Computer-use agents — the AI that clicks, types, and navigates software for you — are only as good as the human demonstrations they learn from. That data is scarce, and today it's scraped, unattributed, and unpaid.

PlayProof turns it into a market. People record real tasks and get paid. AI teams buy verified data with provenance baked in. The whole loop lives on 0G.

## How it works

1. A buyer posts a bounty for a task type ("fill out a multi-step web form") and escrows a reward in 0G.
2. A contributor records the task on screen, in the browser. The recording goes to **0G Storage**; its merkle root hash becomes its fingerprint.
3. The contributor submits onchain — root hash, address, and bounty land on **0G Chain**.
4. A trusted reviewer watches it back and approves. One approval settles the submission and pays the reviewer.
5. The contributor claims their reward in 0G.

Buyers export a dataset manifest: every approved recording's 0G Storage root hash, contributor, and reviewer — provenance you can actually audit, ready to train on.

## Built on 0G

**0G Storage** holds every recording. Uploads run through the `@0gfoundation/0g-ts-sdk`, and the returned merkle root hash is the provenance written onchain. Recordings stream back from 0G for playback.

**0G Chain** runs the marketplace. The `PlayProof` contract holds every bounty, submission, review, and payout. Contributors, reviewers, and buyers all transact natively on Galileo testnet (chain `16602`), and rewards are paid in the native 0G token.

**0G Compute** powers an AI pre-screen that labels and scores each recording as a hint for reviewers — wired behind a provider interface and toggled per deployment. The verdict that pays out is always a human's, never the model's.

That last point is the design: **AI suggests, humans decide.** Every recording in a PlayProof dataset carries a human signature, which is exactly what makes it worth training on.

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
