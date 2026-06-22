# ▰ PlayProof

**Onchain Gameplay Data Marketplace for AI Training.**

> PlayProof is a decentralized data-collection network where gamers earn onchain
> rewards for contributing verified gameplay clips used to train gaming AI agents.

AI gaming agents need real human gameplay data — today it's scraped, unverified,
and unpaid. PlayProof is the decentralized alternative: **gamers complete data
bounties, AI verifies the clips, 0G stores the datasets, and contributors get
paid onchain.** We're building the data layer for the next generation of
game-playing AI.

---

## How 0G does real work here

PlayProof is AI-native and uses all three 0G primitives in a non-bolt-on way:

| Layer | Role in PlayProof |
|------|-------------------|
| **0G Storage** | Canonical home for gameplay clip bytes. Every upload returns a tamper-resistant **merkle root hash** that becomes the clip's provenance on-chain. |
| **0G Compute** | The **AI quality + labeling** layer. Detects whether a clip is real gameplay, auto-labels player actions, scores quality, and rejects duplicates/blank footage. |
| **0G Chain** | The **settlement + provenance** layer. The `PlayProof` contract records the contributor wallet, the 0G Storage root hash, the bounty answered, the AI quality score, approval status, and pays the reward. |

The "Proof-of-Play" score = **uniqueness + task relevance + gameplay quality +
human action density**, computed from the clip and the 0G Compute output.

---

## The loop

1. **Connect wallet** — MetaMask on 0G Galileo testnet (auto-added).
2. **Pick a mission** — e.g. *"Collect parkour failure recovery clips — 0.005 0G/clip"*.
3. **Upload a clip** — drag-drop an `.mp4`/`.webm`.
4. **Watch the live pipeline:**
   - clip → **0G Storage** (root hash)
   - **0G Compute** labels actions + assigns a Proof-of-Play score
   - `submitClip(bountyId, rootHash)` → **0G Chain**
   - oracle `approveSubmission(id, score)` → **0G Chain**
   - `claimReward(id)` → **0G** lands in your wallet
5. **Leaderboard** updates; the clip joins a growing **dataset card** in the buyer dashboard.

---

## Quick start

```bash
npm install

# 1. Compile the bounty contract → src/contracts/PlayProof.json
npm run compile

# 2. Configure env
cp .env.example .env.local
#    set OG_SERVER_PRIVATE_KEY to a funded 0G testnet account
#    (faucet: https://faucet.0g.ai)

# 3. Deploy PlayProof to 0G Galileo testnet
#    (auto-writes NEXT_PUBLIC_PLAYPROOF_CONTRACT into .env.local)
npm run deploy

# 4. Seed the demo dataset bounties
npm run seed

# 5. Run
npm run dev   # → http://localhost:3000
```

> **No testnet account yet?** The app still boots and the full pipeline runs:
> 0G Storage computes real root hashes locally and 0G Compute (mock provider)
> labels + scores clips. You just can't persist bytes or settle on-chain until
> you fund `OG_SERVER_PRIVATE_KEY` and deploy the contract.

---

## Configuration (`.env.local`)

| Var | Purpose |
|-----|---------|
| `NEXT_PUBLIC_OG_CHAIN_ID` | `16602` (0G Galileo) |
| `NEXT_PUBLIC_OG_RPC` | `https://evmrpc-testnet.0g.ai` |
| `OG_STORAGE_INDEXER` | `https://indexer-storage-testnet-turbo.0g.ai` |
| `OG_SERVER_PRIVATE_KEY` | Pays 0G Storage uploads **and** acts as the on-chain oracle/treasury |
| `NEXT_PUBLIC_PLAYPROOF_CONTRACT` | Deployed contract address (set by `npm run deploy`) |
| `OG_COMPUTE_ENABLED` | `true` to route AI labeling through live 0G Compute |
| `OG_COMPUTE_PROVIDER` / `OG_COMPUTE_PRIVATE_KEY` | 0G Compute provider address + funded account |

### 0G Compute: live vs. mock

The labeling pipeline is one interface, two implementations (`src/lib/compute.ts`):

- **Live** — when `OG_COMPUTE_ENABLED=true` and a provider/key are set, it routes
  inference through the 0G Compute Network via `createZGComputeNetworkBroker`
  (`@0glabs/0g-serving-broker`). Install that package to enable it.
- **Mock** — a deterministic, **content-derived** analyzer (same bytes → same
  labels + score) so the demo runs end-to-end with zero external dependencies.

Either way the UI shows the `ComputeProvenance` (provider, model, endpoint), so
the 0G Compute integration point is always visible.

---

## Architecture

```
Browser (Next.js + Tailwind, ethers v6 + MetaMask)
│
├─ Player signs:  submitClip(), claimReward()      ─┐
├─ Buyer signs:   createBounty()                    │   0G Chain
│                                                    │   (PlayProof.sol)
│                                                    ─┘
└─ API routes (Node):
     /api/analyze     clip → 0G Storage upload → 0G Compute analysis
     /api/approve     oracle → approveSubmission(id, score) on 0G Chain
     /api/submissions index cache for dashboards
     /api/dataset     downloadable dataset manifest (provenance)
```

- **Canonical truth**: clip bytes on 0G Storage, provenance + payout on 0G Chain.
- **Index** (`data/db.json`): a fast read cache for the leaderboard/dataset views.
  Swap for Supabase/SQLite in production — the shape in `src/lib/db.ts` is identical.

### Smart contract (`contracts/PlayProof.sol`)

```solidity
createBounty(title, requiredLabel, rewardPerClip)  payable  // buyer escrows budget
submitClip(bountyId, storageRootHash)                        // player records provenance
approveSubmission(submissionId, qualityScore)      onlyOracle // AI verdict on-chain
rejectSubmission(submissionId)                     onlyOracle
claimReward(submissionId)                                    // player gets paid
```

Reward budget is **reserved at approval time** so a later claim is always solvent.

---

## Demo script (90 seconds)

1. Open PlayProof, connect wallet (network auto-adds).
2. Pick **"Collect parkour failure recovery clips."**
3. Drop a short gameplay clip → **Start Mission**.
4. Watch it upload to **0G Storage** (root hash links to the storage explorer).
5. **0G Compute** reveals the AI output: game, actions, Proof-of-Play score, reasoning.
6. Submission is written to **0G Chain**; oracle approves with the score.
7. Click is automatic → **Claim Reward**, 0G hits the wallet (tx links to explorer).
8. Switch to **Leaderboard** — you're on the board.
9. Switch to **Datasets & Buyers** — your clip is in a live **dataset card**; hit
   **download manifest** for the provenance-tracked training set.

---

## Tests

```bash
npm test        # unit tests — Proof-of-Play scoring core (no server needed)
npm run test:e2e   # boots a dev server, runs unit + live API integration tests
npm run test:all   # unit + integration against an already-running server
```

- **`tests/scoring.test.ts`** — the pure scoring core in `src/lib/scoring.ts`:
  deterministic `det()` bounds + stability, action-vocabulary selection, the
  Proof-of-Play breakdown (caps, on-label > off-label, size→quality), duplicate
  and blank-footage collapse, training-value bands, and a regression test for the
  `>>>` operator-precedence bug. 22 tests.
- **`tests/api.integration.test.ts`** — drives the live API: a real **0G Storage**
  upload returns a valid `0x…64hex` merkle root, deterministic re-uploads match,
  blank/duplicate clips are rejected, and the dataset manifest only contains
  approved clips with provenance hashes. Skips gracefully if no server is up.

## Tech stack

Next.js 14 (App Router) · Tailwind · ethers v6 + MetaMask · Solidity (solc) ·
`@0glabs/0g-ts-sdk` (0G Storage) · `@0glabs/0g-serving-broker` (0G Compute, optional) ·
file-backed JSON index (Supabase/SQLite-ready).
