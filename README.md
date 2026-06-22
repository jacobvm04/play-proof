# ▰ PlayProof

**Onchain marketplace for verified human computer-use data — the traces that train AI agents.**

> PlayProof is a decentralized network where people get paid to contribute
> verified recordings of real computer-use tasks (screen **+ synced
> keyboard/mouse input**), used to train computer-use AI agents.

Computer-use AI agents need real human task traces — today that data is scraped,
video-only, unverified, and unpaid. PlayProof is the decentralized alternative:
**people record tasks, AI pre-screens them, humans verify by review consensus, 0G
stores the bundles, and everyone gets paid onchain.** Games (FPS, parkour) are
just one task category among many (form-filling, spreadsheets, web research,
email triage…).

---

## Why a *trace bundle*, not a video

Video alone is weak training data for computer-use agents — agents learn from the
**inputs a human produced** against what was on screen. So a PlayProof submission
is a **trace bundle**:

```
bundle = [magic]["PPTB1"][manifest+events JSON][screen-recording video]
```

- **screen video** (getDisplayMedia + MediaRecorder)
- **synced input event stream** — every keydown/keyup, mousemove (throttled),
  click, scroll, wheel, timestamped against the video clock
- **manifest** — durations, event histogram, screen size

The *whole bundle* is hashed and stored on 0G Storage, so the on-chain root hash
is tamper-evident provenance for the entire training artifact — not just the
video. Video-only uploads are accepted as a fallback but score lower (the AI
pre-score's `completeness` and `inputRichness` dimensions penalize missing input).

---

## How 0G does real work here

| Layer | Role |
|------|------|
| **0G Storage** | Canonical home for trace bundles. Every upload returns a tamper-resistant merkle **root hash** written on-chain as provenance. |
| **0G Compute** | The **AI pre-screen + labeling** layer — detects the task, labels actions from the input stream, scores quality, flags duplicates/blank. A *signal*, not the verdict. |
| **0G Chain** | Settlement + provenance + **decentralized human review consensus**: bounties, submissions, the AI pre-score, every reviewer's verdict, the >50% outcome, and payouts. |

### Trust model: AI pre-screen + human review consensus

1. A **dataset buyer** posts a task bounty and escrows: a reward per approved
   bundle + a small reward per review, and sets `requiredReviews = N`.
2. A **contributor** records a task, the bundle uploads to 0G Storage, and they
   sign `submitClip(bountyId, rootHash)`. The oracle posts the 0G Compute
   `aiPreScore` on-chain (a signal for reviewers).
3. **N independent reviewers** each play back the trace and sign
   `submitReview(id, approve)` — paid the per-review reward for participating.
4. Once N reviews are in, anyone calls `finalize(id)`: the contract approves iff
   a **strict majority (>50%)** voted positive — computed trustlessly on-chain.
5. On approval the contributor signs `claimReward(id)`.

So as long as >50% of reviewers are honest on any given sample, the label is
trustworthy — and no single party (not even the AI) decides approval.

---

## Quick start (local chain — no faucet needed)

```bash
npm install
npm run compile          # contracts/PlayProof.sol → src/contracts/PlayProof.json

# 1. Local EVM chain with funded accounts (stays running)
npm run chain            # http://127.0.0.1:8545, chainId 31337

# 2. In another shell: deploy + seed the demo task bounties
npm run deploy           # CHAIN defaults to local; auto-fills the contract addr
npm run seed

# 3. Point the app at the local chain in .env.local:
#    NEXT_PUBLIC_OG_CHAIN_ID=31337
#    NEXT_PUBLIC_OG_RPC=http://127.0.0.1:8545
#    OG_SERVER_PRIVATE_KEY=<first key from data/local-accounts.json>  (the oracle)
#    (NEXT_PUBLIC_PLAYPROOF_CONTRACT was set by `npm run deploy`)

npm run dev              # → http://localhost:3000
```

Add the local chain to MetaMask (RPC `http://127.0.0.1:8545`, chainId `31337`)
and import a couple of the funded keys from `data/local-accounts.json` to play
contributor + reviewer.

### Deploy to real 0G Galileo testnet

```bash
# Fund OG_SERVER_PRIVATE_KEY at https://faucet.0g.ai, set the 0G values in
# .env.local (chainId 16602, rpc https://evmrpc-testnet.0g.ai), then:
CHAIN=0g npm run deploy
CHAIN=0g npm run seed
```

On 0G, trace bundles are actually persisted to 0G Storage; on the local chain we
stop at the (real) merkle root hash since there's no 0G indexer to pay.

---

## The loop (demo)

1. **Connect wallet** (network auto-adds).
2. **Contribute** → pick a task (e.g. "Fill out a multi-step web form").
3. **⏺ Record** — grant screen share, do the task; keystrokes/clicks/moves are
   captured live and synced to the video.
4. Watch the pipeline: bundle → **0G Storage** → **0G Compute** pre-screen
   (task, actions, score, input-trace check) → `submitClip` on **0G Chain** →
   oracle posts the AI pre-score → **awaiting human review**.
5. **Review** tab (as another wallet) → play back a trace, **👍/👎** on-chain,
   earn the per-review reward. After N reviews, `finalize` runs automatically.
6. **My Submissions** → once >50% approve, **Claim** the reward.
7. **Datasets & Buyers** → the bundle joins a live **dataset card**; download the
   provenance-tracked manifest. Buyers can post new bounties here.

---

## Architecture

```
Browser (Next.js + Tailwind, ethers v6 + MetaMask)
├─ TraceRecorder: getDisplayMedia + MediaRecorder + global input listeners
├─ Contributor signs: submitClip(), claimReward()
├─ Reviewer signs:    submitReview()
├─ Buyer signs:       createBounty()
│
└─ API routes (Node):
     /api/analyze      bundle → 0G Storage upload → 0G Compute pre-screen
     /api/aiscore      oracle → setAiPreScore(id, score) on 0G Chain
     /api/review       mirror on-chain review tally into the index
     /api/finalize     trigger finalize(); read >50% outcome from chain
     /api/dataset      downloadable, provenance-tracked dataset manifest
```

- **Canonical truth**: trace bundles on 0G Storage, provenance + review consensus
  + payouts on 0G Chain. `data/db.json` is a fast read cache for the dashboards
  (swap for Supabase/SQLite — the shape in `src/lib/db.ts` is identical).

### Smart contract (`contracts/PlayProof.sol`)

```solidity
createBounty(title, taskType, rewardPerClip, reviewerReward, requiredReviews) payable
submitClip(bountyId, storageRootHash)            // contributor — reserves full payout
setAiPreScore(submissionId, score)   onlyOracle  // 0G Compute signal
submitReview(submissionId, approve)              // reviewer — one vote, paid per review
finalize(submissionId)                           // anyone — approves iff >50% positive
claimReward(submissionId)                        // contributor — on approval
```

Compiled with `evmVersion: shanghai`. The full per-submission cost (contributor
reward + all reviewer rewards) is reserved at `submitClip` time, so reviews and
the final claim are always solvent; a rejected submission returns the
contributor reward to the bounty budget.

---

## Tests

```bash
npm run test:unit   # pure scoring core + on-chain contract lifecycle (in-process chain)
npm run test:e2e    # boots local chain + deploy + seed + dev server, runs EVERYTHING
```

- **`tests/scoring.test.ts`** (17) — the pure AI pre-screen scoring core:
  deterministic `det()` bounds + a regression test for the `>>>` precedence bug,
  task-vocab selection, the 4-dimension breakdown (input-richness rewards rich
  traces, completeness penalizes video-only), duplicate/blank collapse.
- **`tests/contract.test.ts`** (4) — the FULL on-chain lifecycle against an
  in-process EVM: createBounty → submitClip → setAiPreScore → N submitReview →
  finalize (majority **approve** AND **reject** paths) → claimReward with exact
  balance assertions, plus guard rails (no self-review, no double-review, no
  early finalize, oracle-only pre-score, bad bounty params).
- **`tests/api.integration.test.ts`** (4) — full-stack on-chain e2e through the
  live API + real wallets: analyze→0G Storage→submitClip→aiscore→3 reviews→
  finalize→claim, video-only penalty, and dataset-manifest provenance.

25 tests, ~12s end to end. The harness (`scripts/run-e2e.mjs`) spins up the chain,
deploys, seeds, wires a dev server to it, and tears everything down.

> Perf note: the local JS EVM is slow on receipt polling; tests set
> `provider.pollingInterval` low (instamine → receipts are immediate), which
> took the on-chain suite from ~85s to ~6s.

---

## Tech stack

Next.js 14 (App Router) · Tailwind · ethers v6 + MetaMask · Solidity (solc,
shanghai) · ganache (local chain) · `@0glabs/0g-ts-sdk` (0G Storage) ·
`@0glabs/0g-serving-broker` (0G Compute, optional) · vitest · file-backed JSON
index (Supabase/SQLite-ready).
