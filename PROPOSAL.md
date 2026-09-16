# Private Payroll / Splits — Product Proposal

> Approved idea (Level 3) — Private Payroll / Splits: a confidential fund
> distribution tool for freelancers, small businesses, and teams that need to
> pay multiple people from one pool without exposing individual payout amounts
> on-chain.

## The problem

Today, if you split a payment between contributors on a public blockchain,
anyone can see exactly what each person received — which is a privacy risk for
freelancers, gig workers, and small teams who don't want their income exposed.

## The solution

Private Payroll uses Midnight's zero-knowledge proofs so that the contract
proves the total amount distributed matches the declared payout, and that every
recipient got paid correctly — without revealing any individual's amount
publicly.

The core building block is a **ZK proof of correct sum over hidden values**:
recipients' amounts stay private, but the payout is fully auditable and
verifiable by anyone checking the total.

## Roadmap

- **MVP (this repo, Level 4)** — payroll pool + private-run proof of correct
  sum, Merkle-committed payouts, preview-network deployment, web wallet flow.
- **Selective disclosure** — a recipient proves their own payout to a third
  party (e.g. a tax authority or lender) without making it public. The pure
  circuit `verifyPayoutCommitment` already provides this primitive.
- **PayLoop integration** — builds on earlier work designing PayLoop, a
  micro-invoicing and settlement platform for freelancers: the same problem —
  fair, fast payment settlement — with the confidentiality that a privacy
  chain like Midnight makes possible.
