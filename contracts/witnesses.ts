// Private state for the Private Payroll contract.
//
// Every participant (administrator or recipient) holds a single 32-byte
// secret in their private state. All on-chain identity in this contract is
// derived from that secret inside the ZK circuits — the secret itself never
// leaves private state, and never appears in any transaction.
// See contracts/payroll.compact for the full privacy model.
//
// `pendingRun` carries the per-run witness data an administrator assembles
// off-chain before calling `executeRun` (amounts, salts, Merkle paths). It
// is consumed by the witnesses during proof generation and never published.
export type RunWitnessData = {
  readonly amounts: bigint[];
  readonly salts: Uint8Array[];
  readonly recipients: Uint8Array[];
  readonly commitmentSiblings: Uint8Array[];
  /** true = the sibling hash is the LEFT operand at that level. */
  readonly commitmentSiblingIsLeft: boolean[];
  readonly recipientSiblings: Uint8Array[];
  readonly recipientSiblingIsLeft: boolean[];
};

export type PayrollPrivateState = {
  readonly secretKey: Uint8Array;
  readonly pendingRun?: RunWitnessData;
};

// Generates the private state used at contract deployment / join time.
// `secretKey` may be omitted (a cryptographically secure random secret is
// generated) — callers that need a deterministic state (tests) pass one in.
export function createPayrollPrivateState(
  secretKey?: Uint8Array
): PayrollPrivateState {
  if (secretKey && secretKey.length !== 32) {
    throw new Error("secretKey must be exactly 32 bytes");
  }
  return {
    secretKey: secretKey ?? crypto.getRandomValues(new Uint8Array(32))
  };
}

// The witnesses read values from (and thread through) the private state —
// the standard Midnight pattern. Note `privateState` is a *property* of the
// WitnessContext, not a method.
export const witnesses = {
  getUserSecret(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },
  getRunAmounts(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, bigint[]] {
    return [context.privateState, context.privateState.pendingRun?.amounts ?? []];
  },
  getRunSalts(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, Uint8Array[]] {
    return [context.privateState, context.privateState.pendingRun?.salts ?? []];
  },
  getRunRecipients(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, Uint8Array[]] {
    return [context.privateState, context.privateState.pendingRun?.recipients ?? []];
  },
  getRunCommitmentSiblings(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, Uint8Array[]] {
    return [context.privateState, context.privateState.pendingRun?.commitmentSiblings ?? []];
  },
  getRunCommitmentSiblingIsLeft(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, boolean[]] {
    return [context.privateState, context.privateState.pendingRun?.commitmentSiblingIsLeft ?? []];
  },
  getRunRecipientSiblings(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, Uint8Array[]] {
    return [context.privateState, context.privateState.pendingRun?.recipientSiblings ?? []];
  },
  getRunRecipientSiblingIsLeft(context: { readonly privateState: PayrollPrivateState }): [PayrollPrivateState, boolean[]] {
    return [context.privateState, context.privateState.pendingRun?.recipientSiblingIsLeft ?? []];
  }
};
