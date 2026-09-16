# How to Use Private Payroll

A plain-English guide to running a confidential payroll on Midnight's preview
network. No blockchain expertise required.

## What You Need

- **The Lace wallet** — a browser extension for the Midnight network. Install
  it from the official Midnight site, then create a wallet and **write down
  the recovery phrase** (keep it offline and private — anyone who has it
  controls your funds).
- **A little test tNIGHT** — Private Payroll runs on *preview*, Midnight's
  public test network. Its tokens are free from the preview faucet; you just
  need your wallet's address to request some.
- **A modern browser** — Chrome, Edge, Firefox, or Brave.
- **Nothing else.** Amounts, proofs, and keys all live in your own browser.

## Step-by-Step Guide

### 1. Get your recipients' identity roots

Each person you pay opens their own Lace wallet and copies their *identity
root* from the recipient panel of this app (or runs the included helper).
Think of it like an IBAN for receiving confidential payroll: it identifies
where money can go, but says nothing about how much.

Send these roots to whoever runs payroll over any channel you like — email,
Slack, a form. They are safe to share; they contain no amounts.

### 2. Open the app and connect

1. Open the Private Payroll web app.
2. Click **Connect & Deploy** (first time — this creates your company's
   payroll contract) or **Join existing…** (everyone after the first person,
   pasting the contract address the deployer shared).
3. Lace will pop up asking to approve the connection. Approve it.

### 3. Fund the pool

1. In **Fund the pool**, enter the total amount you want available for
   payroll — say, `10.0`.
2. Confirm the transaction in Lace.

This step is *intentionally public*: the pool is a shared resource, and its
balance is auditable by anyone. What's protected is the split.

### 4. Run payroll

1. In **Payroll run**, add one row per recipient.
2. Paste each recipient's identity root and type their amount — for example:
   - Row 1 → `9a1c…` → `4.2`
   - Row 2 → `55e0…` → `3.8`
3. Check the **Declared total** (here `8.0`). This number *is* public.
4. Click **Prove & Execute run** and confirm in Lace.

Your browser now builds a zero-knowledge proof that:

- the hidden amounts add up to exactly the declared total,
- every recipient is on the authorized list,
- the pool can cover the payment.

The individual amounts (`4.2` and `3.8`) **never leave your browser**. The
chain sees only the total and two cryptographic commitment roots.

### 5. Check the public ledger

The **Public audit ledger** panel shows everything anyone can ever see: the
pool balance, total paid out, each run's declared total, and the commitment
roots. Compare that with a normal blockchain explorer, where every salary
would be in plain view.

### 6. (Recipients) Prove your own payout, privately

If you received a payment and need to show it — to an accountant, a lender, a
tax office — use the **selective disclosure** helper: it produces a one-off
certificate for *your own* payout only. You choose when and to whom. Nothing
goes on-chain.

## What Gets Proved (and What Stays Private)

| Anyone can verify on-chain                        | Nobody can ever see                      |
| ------------------------------------------------- | ---------------------------------------- |
| The pool balance and every deposit                | Your employees' individual payout amounts |
| Each run's **total** payout                       | Who received what                         |
| A proof that the total equals the sum of hidden amounts | How many people were paid in a run |
| A proof that every recipient was authorized       | Recipient identities (they are hashes)    |
| A proof the pool could cover the payment          | The administrator's secret identity       |
| Commitment roots (random-looking 32-byte hashes)  | Amounts behind those commitments          |

**The guarantee in one sentence:** the totals add up provably, but the parts
stay mathematically invisible.

## Troubleshooting

**"Lace not detected"**
The Lace extension isn't installed, is disabled, or needs the page
reloaded after install. Check that it's enabled for this site.

**"Midnight Lace wallet not found"** after clicking connect
The extension is installed but hasn't finished initializing. Wait a few
seconds and try again; check that Lace shows the **preview** network.

**Connect request times out**
Lace may be waiting on a hidden approval dialog. Open the extension and
approve or dismiss any pending requests, then retry.

**"Declared total exceeds the pool balance"**
Fund the pool first (Step 3), or lower the run total. The circuit refuses
runs the pool can't cover — by design.

**"Run id already used"**
Run ids must be unique. The app suggests the next free one automatically;
if you edited it manually, pick a fresh number.

**"Payout commitment is not included in the run's commitments root"** (from a
wallet error)
A recipient root was pasted incorrectly. Re-copy it from the recipient's
panel — it must be exactly 64 hex characters.

**Transaction fails in Lace with a fee/DUST error**
Your preview wallet needs a little more tNIGHT. Top up at the preview
faucet and retry.

**The app can't reach the network**
The indexer connection may be momentarily down. Reload the page; the app
reconnects automatically.
