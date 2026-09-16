// Merkle tree helpers shared by the admin tooling and the tests.
//
// These mirror the contract's pure circuits exactly (payoutLeaf /
// hashPair) using the generated `pureCircuits` from the compiled
// contract, so off-chain tree construction is guaranteed to match what
// the ZK circuit verifies on-chain.
import { pureCircuits } from "./managed/payroll/contract/index.js";

export const MAX_RECIPIENTS = 8;
export const TREE_DEPTH = 3; // 2^3 = 8 leaves

export type Payout = {
  /** Recipient's 32-byte identity root (derived from their private secret). */
  recipient: Uint8Array;
  /** Payout amount in the smallest currency unit. */
  amount: bigint;
};

export type Tree = {
  root: Uint8Array;
  /** One 3-element sibling path per leaf. */
  siblings: Uint8Array[][];
  /** One 3-element orientation path per leaf (true = sibling is left). */
  siblingIsLeft: boolean[][];
};

function requireLength(bytes: Uint8Array, n: number, what: string): void {
  if (bytes.length !== n) {
    throw new Error(`${what} must be exactly ${n} bytes, got ${bytes.length}`);
  }
}

/** Build one payout commitment leaf via the contract's own pure circuit. */
export function payoutLeafOf(recipient: Uint8Array, amount: bigint, salt: Uint8Array): Uint8Array {
  requireLength(recipient, 32, "recipient");
  requireLength(salt, 32, "salt");
  return pureCircuits.payoutLeaf(recipient, amount, salt);
}

/** Hash two 32-byte nodes left-to-right via the contract's own pure circuit. */
export function hashPairOf(left: Uint8Array, right: Uint8Array): Uint8Array {
  requireLength(left, 32, "left");
  requireLength(right, 32, "right");
  return pureCircuits.hashPair(left, right);
}

/**
 * Build a Merkle tree over exactly 8 leaves: the root, one sibling path
 * per leaf, and one orientation path per leaf (canonical left-first
 * hashing: position i is the left child when i is even).
 */
export function buildTree(leaves: Uint8Array[]): Tree {
  if (leaves.length !== MAX_RECIPIENTS) {
    throw new Error(`tree must have exactly ${MAX_RECIPIENTS} leaves`);
  }
  let level = leaves;
  const siblingLevels: Uint8Array[][] = []; // per level, sibling per position
  const isLeftLevels: boolean[][] = []; // per level, "sibling is left operand"
  for (let d = 0; d < TREE_DEPTH; d++) {
    const next: Uint8Array[] = [];
    const sibs: Uint8Array[] = [];
    const isLeft: boolean[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hashPairOf(level[i], level[i + 1]));
      // Position i (even): sibling is the right child -> sibling is right operand.
      // Position i+1 (odd): sibling is the left child -> sibling is left operand.
      sibs.push(level[i + 1], level[i]);
      isLeft.push(false, true);
    }
    siblingLevels.push(sibs);
    isLeftLevels.push(isLeft);
    level = next;
  }
  const siblings = leaves.map((_, i) => [
    siblingLevels[0][i],
    siblingLevels[1][i >> 1],
    siblingLevels[2][i >> 2]
  ]);
  const siblingIsLeft = leaves.map((_, i) => [
    isLeftLevels[0][i],
    isLeftLevels[1][i >> 1],
    isLeftLevels[2][i >> 2]
  ]);
  return { root: level[0], siblings, siblingIsLeft };
}

/** Convenience: build a commitments tree from payout leaves. */
export function commitmentsTree(payouts: Payout[], salts: Uint8Array[]): Tree {
  const leaves = payouts.map((p, i) => payoutLeafOf(p.recipient, p.amount, salts[i]));
  return buildTree(leaves);
}

/** Convenience: build a recipients-authorization tree. */
export function recipientsTree(recipients: Uint8Array[]): Tree {
  return buildTree(recipients);
}

/** Identity roots via the contract's own domain-separated pure circuits. */
export function deriveAdminRootOffChain(secret: Uint8Array): Uint8Array {
  return pureCircuits.deriveAdminRoot(secret);
}

export function deriveRecipientRootOffChain(secret: Uint8Array): Uint8Array {
  return pureCircuits.deriveRecipientRoot(secret);
}
