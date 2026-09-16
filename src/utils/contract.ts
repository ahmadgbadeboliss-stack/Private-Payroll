// Contract interaction helpers.
//
// The administrator assembles a payroll run entirely off-chain here:
// hidden amounts + salts + recipient identity roots → commitment leaves →
// Merkle trees → the witness data the ZK circuit will consume. Only the
// two Merkle roots and the declared total are published.
import { pureCircuits } from "../../contracts/managed/payroll/contract/index.js";
import type { RunWitnessData } from "../../contracts/witnesses.js";
import { deriveRecipientRootOffChain } from "../../contracts/merkle.js";

export const MAX_RECIPIENTS = 8;

export type PayoutInput = {
  /** Recipient's 32-byte identity root (from their wallet's private state). */
  recipientRoot: Uint8Array;
  /** Payout amount in the smallest currency unit. */
  amount: bigint;
};

export type AssembledRun = {
  witnessData: RunWitnessData;
  commitmentsRoot: Uint8Array;
  recipientsRoot: Uint8Array;
  declaredTotal: bigint;
};

function buildSiblings(
  leaves: Uint8Array[],
  combine: (l: Uint8Array, r: Uint8Array) => Uint8Array
): {
  root: Uint8Array;
  flatSiblings: Uint8Array[];
  flatIsLeft: boolean[];
} {
  let level = leaves;
  const siblingLevels: Uint8Array[][] = [];
  const isLeftLevels: boolean[][] = [];
  for (let d = 0; d < 3; d++) {
    const next: Uint8Array[] = [];
    const sibs: Uint8Array[] = [];
    const isLeft: boolean[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(combine(level[i], level[i + 1]));
      sibs.push(level[i + 1], level[i]);
      isLeft.push(false, true);
    }
    siblingLevels.push(sibs);
    isLeftLevels.push(isLeft);
    level = next;
  }
  const flatSiblings: Uint8Array[] = [];
  const flatIsLeft: boolean[] = [];
  for (let i = 0; i < MAX_RECIPIENTS; i++) {
    flatSiblings.push(siblingLevels[0][i], siblingLevels[1][i >> 1], siblingLevels[2][i >> 2]);
    flatIsLeft.push(isLeftLevels[0][i], isLeftLevels[1][i >> 1], isLeftLevels[2][i >> 2]);
  }
  return { root: level[0], flatSiblings, flatIsLeft };
}

function assertBytes(b: Uint8Array, n: number, what: string): void {
  if (b.length !== n) throw new Error(`${what} must be ${n} bytes`);
}

/**
 * Derive a recipient identity root from their 32-byte secret using the
 * contract's own pure circuit. Recipients share this secret with the
 * administrator out-of-band (it is their identity commitment, not a
 * spend key).
 */
export function recipientRootFromSecret(secret: Uint8Array): Uint8Array {
  assertBytes(secret, 32, "recipient secret");
  return deriveRecipientRootOffChain(secret);
}

/**
 * Build all Merkle material for a payroll run:
 *  - leaves H(recipient || amount || salt) via the contract's pure circuit
 *  - a 3-level tree (8 leaves) with canonical left-first ordering
 *  - per-leaf sibling paths, flattened for the circuit witnesses
 */
export function assembleRun(payouts: PayoutInput[]): AssembledRun {
  if (payouts.length === 0 || payouts.length > MAX_RECIPIENTS) {
    throw new Error(`a run supports 1–${MAX_RECIPIENTS} recipients`);
  }
  // Pad to the circuit's fixed arity of 8 with zero-amount slots.
  const padded: PayoutInput[] = [...payouts];
  while (padded.length < MAX_RECIPIENTS) {
    padded.push({ recipientRoot: new Uint8Array(32), amount: 0n });
  }

  const salts = Array.from({ length: MAX_RECIPIENTS }, () =>
    crypto.getRandomValues(new Uint8Array(32))
  );
  const leaves = padded.map((p, i) =>
    pureCircuits.payoutLeaf(p.recipientRoot, p.amount, salts[i])
  );

  const commitments = buildSiblings(leaves, pureCircuits.hashPair);
  const recipients = buildSiblings(
    padded.map((p) => p.recipientRoot),
    pureCircuits.hashPair
  );

  const declaredTotal = payouts.reduce((acc, p) => acc + p.amount, 0n);

  return {
    witnessData: {
      amounts: padded.map((p) => p.amount),
      salts,
      recipients: padded.map((p) => p.recipientRoot),
      commitmentSiblings: commitments.flatSiblings,
      commitmentSiblingIsLeft: commitments.flatIsLeft,
      recipientSiblings: recipients.flatSiblings,
      recipientSiblingIsLeft: recipients.flatIsLeft
    },
    commitmentsRoot: commitments.root,
    recipientsRoot: recipients.root,
    declaredTotal
  };
}

/** Hex helpers for form inputs / display. */
export function toHexStr(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHexStr(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error("not a hex string");
  if (clean.length % 2 !== 0) throw new Error("hex string must have even length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
