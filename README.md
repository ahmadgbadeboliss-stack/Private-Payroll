# Private Payroll

![CI](https://github.com/ahmadgbadeboliss-stack/Private-Payroll/actions/workflows/ci.yml/badge.svg)

> Confidential payroll & splits on Midnight — pay many people from one pool
> without ever exposing an individual payout amount on-chain.

## Live Demo

**https://ahmadgbadeboliss-stack.github.io/Private-Payroll/**

Deployed automatically from `main` by the
[GitHub Pages workflow](https://github.com/ahmadgbadeboliss-stack/Private-Payroll/actions/workflows/pages.yml)
(same compile → test → build pipeline as CI). The app connects to the Midnight
**preview** network and the contract at the address below — viewing it requires
the Midnight Lace browser extension.

## Contract Address

| Network | Address |
|---------|---------|
| Midnight Preview | `0x4810fad0c34d8f454b1daf7d22e7dad1be6a6ecea7a61960d43ca9ef85666c04` |

> Note: per the build brief, this MVP targets Midnight **preview** for wallet
> and contract deployment (not preprod). The address above was deployed from
> this repository and verified against the Preview indexer
> (`https://indexer.preview.midnight.network`), which publicly serves the
> contract's on-chain state.

## What This Product Does

Splitting a payment between contributors on a public blockchain today means
publishing every person's income to the world. Anyone — a curious employer, a
stalker, a data broker — can read exactly what each freelancer, gig worker, or
team member received. For the people whose livelihoods depend on negotiating
from a position of privacy, that is a real and ongoing harm.

**Private Payroll** is a confidential fund-distribution tool for freelancers,
small businesses, and teams. An administrator funds a payroll pool, then
executes runs that pay up to eight recipients per transaction. The chain
verifies — through a zero-knowledge proof — that every hidden amount adds up
to exactly the declared total, that every recipient is authorized, and that
the pool can cover the payment. The individual amounts are **never** visible
to anyone, including the node operators.

Why Midnight: it is the only L2 whose data-protection model is built for
exactly this. Midnight contracts keep **private state** off-chain and let a
circuit prove statements about that state without revealing it, while the
public parts (totals, commitment roots) remain fully auditable. Private
Payroll's core primitive is a **ZK proof of correct sum over hidden values** —
the same building block that later lets a recipient prove their own payout to
a tax authority or lender via selective disclosure, without ever publishing it.

## Privacy Model

**What is PUBLIC (on-chain, anyone can see):**
- The pool balance and every deposit (`fundPool`).
- Each run's **declared total** payout, permanently recorded in `runs`.
- Each run's **commitments Merkle root** and **recipients Merkle root**
  (random-looking 32-byte hashes).
- The running total of all payouts (`totalPaidOut`).
- The set of administrator identity *roots* (hashes, not identities).

**What is PRIVATE (private witness, never on-chain):**
- Every recipient's payout amount.
- Recipient identity roots and blinding salts (they exist only inside the
  proof and the participants' private state).
- Merkle authentication paths and positions.
- The administrator's 32-byte identity secret.

**What the user PROVES without revealing:**
1. Σ(hidden amounts) == declaredTotal — the **proof of correct sum**.
2. Each amount is bound, via a salted commitment, into the published
   commitments root — and to an authorized recipient in the recipients root.
3. declaredTotal ≤ poolBalance — solvency.
4. The caller holds an administrator secret whose derived root is in the
   on-chain admins set — authorization without identity.

## Tech Stack

- **Contract:** [Compact](https://docs.midnight.network/develop/compact)
  (Midnight's ZK language) — `contracts/payroll.compact`, compiled with
  `compactc 0.31.1`.
- **Runtime:** `@midnight-ntwrk/midnight-js` 4.1.x, `compact-runtime` 0.16,
  WASM ledger.
- **Frontend:** React 19 + Vite 7, TypeScript (strict), RxJS.
- **Wallet:** Midnight Lace browser extension (dapp-connector API).
- **Tests:** Vitest running the compiled circuits directly (simulator
  pattern from the official Midnight examples).
- **CI/CD:** GitHub Actions with `midnightntwrk/setup-compact-action`.

## Prerequisites

- **Node.js ≥ 22** (Node 22 LTS recommended).
- **Docker** — runs the local proof server used when transacting.
- **Lace wallet** — the Midnight browser extension, enabled for preview.
- Linux, macOS, or Windows with **WSL** (the Compact compiler has no native
  Windows binary; the repo's compile script transparently delegates to WSL).

## Setup & Run Locally

```bash
# 1. clone and install
git clone https://github.com/ahmadgbadeboliss-stack/Private-Payroll.git
cd Private-Payroll
npm install

# 2. compile the contract (on Windows, this uses WSL automatically)
npm run compile

# 3. run the test suite (9 tests, runs the real ZK circuits)
npm test

# 4. start the local proof server (needed for any transaction)
npm run proof-server        # docker compose up -d

# 5. run the web app
npm run dev                 # http://localhost:5173
```

### Deploy to preview

Deploying needs a funded preview wallet (free tNIGHT from the preview
faucet) and its 24-word recovery phrase:

```bash
# terminal 1 — proof server (if not already running)
npm run proof-server

# terminal 2 — deploy
MIDNIGHT_WALLET_MNEMONIC="your twenty four words here ..." \
PRIVATE_STATE_PASSWORD="a local password, 16+ chars" \
npm run deploy:preview
```

The script syncs the wallet, registers DUST, deploys the contract, and
prints the **contract address**. The address of the deployment made from
this repository is recorded in the Contract Address table above; share it
with recipients ("Join existing…"). A read-only check of any deployed
address against the Preview indexer is available via `npm run verify-contract`.

## Run Tests

```bash
npm test
```

Nine tests exercise the actual compiled circuits:

1. empty-pool initialization and deployer-as-first-admin
2. identity roots are stable, secret-dependent, and domain-separated
3. public pool funding
4. a full payroll run: sum proof, Merkle inclusion, accounting
5. **rejection** when the declared total ≠ sum of hidden amounts
6. **rejection** of a non-administrator run creator
7. **rejection** when the run exceeds the pool balance
8. selective disclosure: a recipient's payout verifies against the run root
9. selective disclosure: a forged (inflated) claim is rejected

## CI/CD

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

1. install → `npm ci`
2. **Compact compile** via `midnightntwrk/setup-compact-action` (pinned
   0.31.1)
3. **tests** — the circuit test suite
4. **build** — strict typecheck plus production Vite build (zero errors
   required)

The badge at the top links to the workflow runs.

## Usage Guide

See **[docs/USAGE.md](docs/USAGE.md)** for a plain-English, step-by-step
guide (including a recipient's view and troubleshooting).

## Product X Profile

_Placeholder — X profile link will be added after the account is created._

## License

Apache-2.0
