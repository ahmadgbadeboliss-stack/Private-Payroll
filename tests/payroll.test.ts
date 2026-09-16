// Tests for the Private Payroll contract.
//
// Runs the compiled circuits directly (the official "simulator" pattern,
// as used by Midnight's example contracts): the contract executes for real
// in this process — private witnesses are served from a local private-state
// object — so these tests exercise the actual ZK statements the chain will
// verify, without needing a network.
import { describe, expect, it } from "vitest";

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type Witnesses
} from "../contracts/managed/payroll/contract/index.js";
import {
  createPayrollPrivateState,
  type PayrollPrivateState,
  type RunWitnessData
} from "../contracts/witnesses.js";
import {
  buildTree,
  payoutLeafOf,
  deriveAdminRootOffChain,
  deriveRecipientRootOffChain
} from "../contracts/merkle.js";
import { witnesses } from "../contracts/witnesses.js";

// ── Test plumbing ───────────────────────────────────────────────────────────

type PS = PayrollPrivateState & { pendingRun?: RunWitnessData };

const secret = (n: number): Uint8Array => {
  const s = new Uint8Array(32);
  s[0] = n;
  return s;
};

const zeroBytes = (): Uint8Array => new Uint8Array(32);

const zeroAmounts = (): bigint[] => Array.from({ length: 8 }, () => 0n);
const zeroBytes8 = (): Uint8Array[] => Array.from({ length: 8 }, zeroBytes);
const zeroIndexes = (): bigint[] => Array.from({ length: 8 }, () => 0n);
const zeroBytes24 = (): Uint8Array[] => Array.from({ length: 24 }, zeroBytes);

// The witnesses live in contracts/witnesses.ts; the simulator's private
// state is replaced directly to inject per-run data (setPrivateState).

function makeSimulator(initial: PayrollPrivateState) {
  const contract = new Contract<PS>(witnesses as Witnesses<PS>);
  const { currentPrivateState, currentContractState, currentZswapLocalState } =
    contract.initialState(createConstructorContext(initial, "0".repeat(64)));
  let ctx: CircuitContext<PS> = createCircuitContext(
    sampleContractAddress(),
    currentZswapLocalState,
    currentContractState,
    currentPrivateState
  );
  return {
    call(name: "fundPool" | "executeRun" | "addAdmin", ...args: unknown[]): void {
      const fn = contract.impureCircuits[name] as unknown as (
        c: CircuitContext<PS>,
        ...a: unknown[]
      ) => { context: CircuitContext<PS> };
      const result = fn(ctx, ...args);
      ctx = result.context;
    },
    // Replace the whole private state (e.g. to simulate a different,
    // non-admin caller or to inject per-run witness data).
    setPrivateState(next: PS): void {
      ctx = { ...ctx, currentPrivateState: next };
    },
    ledger(): Ledger {
      return ledger(ctx.currentQueryContext.state);
    }
  };
}

// Build a complete, internally consistent payroll run for the given hidden
// amounts: commitment tree, recipient-authorization tree, Merkle paths.
function buildRun(amounts: bigint[]): {
  run: RunWitnessData;
  commitmentsRoot: Uint8Array;
  recipientsRoot: Uint8Array;
} {
  if (amounts.length !== 8) throw new Error("tests always build 8-recipient runs");
  const recipients = Array.from({ length: 8 }, (_, i) =>
    deriveRecipientRootOffChain(secret(10 + i))
  );
  const salts = Array.from({ length: 8 }, () => crypto.getRandomValues(new Uint8Array(32)));
  const leaves = amounts.map((amt, i) => payoutLeafOf(recipients[i], amt, salts[i]));
  const commitmentTree = buildTree(leaves);
  const recipientTree = buildTree(recipients);
  return {
    run: {
      amounts,
      salts,
      recipients,
      commitmentSiblings: commitmentTree.siblings.flat(),
      commitmentSiblingIsLeft: commitmentTree.siblingIsLeft.flat(),
      recipientSiblings: recipientTree.siblings.flat(),
      recipientSiblingIsLeft: recipientTree.siblingIsLeft.flat()
    },
    commitmentsRoot: commitmentTree.root,
    recipientsRoot: recipientTree.root
  };
}

const FUNDING = 1_000_000n;

function fundedSim() {
  const sim = makeSimulator(createPayrollPrivateState(secret(1)));
  sim.call("fundPool", FUNDING);
  return { sim };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Payroll contract", () => {
  it("initializes an empty pool and registers the deployer as first admin", () => {
    const adminSecret = secret(1);
    const sim = makeSimulator(createPayrollPrivateState(adminSecret));
    const l = sim.ledger();
    expect(l.poolBalance).toBe(0n);
    expect(l.totalPaidOut).toBe(0n);
    expect(l.admins.size()).toBe(1n);
    expect(l.admins.member(deriveAdminRootOffChain(adminSecret))).toBe(true);
  });

  it("derives stable, secret-dependent, domain-separated identity roots", () => {
    const a1 = pureCircuits.deriveAdminRoot(secret(7));
    const a2 = pureCircuits.deriveAdminRoot(secret(7));
    expect(Buffer.from(a1).equals(Buffer.from(a2))).toBe(true);

    const other = pureCircuits.deriveAdminRoot(secret(8));
    expect(Buffer.from(a1).equals(Buffer.from(other))).toBe(false);

    // Different domain tag => different root for the same secret.
    const asRecipient = pureCircuits.deriveRecipientRoot(secret(7));
    expect(Buffer.from(asRecipient).equals(Buffer.from(a1))).toBe(false);
  });

  it("funds the pool publicly (auditable deposits)", () => {
    const sim = makeSimulator(createPayrollPrivateState(secret(1)));
    sim.call("fundPool", 5_000_000n);
    expect(sim.ledger().poolBalance).toBe(5_000_000n);
    sim.call("fundPool", 2_500_000n);
    expect(sim.ledger().poolBalance).toBe(7_500_000n);
  });

  it("executes a payroll run: proves the sum, Merkle inclusion, and updates accounting", () => {
    const { sim } = fundedSim();
    const amounts = [1_000n, 2_000n, 3_000n, 0n, 0n, 0n, 0n, 0n];
    const { run, commitmentsRoot, recipientsRoot } = buildRun(amounts);

    sim.setPrivateState({ secretKey: secret(1), pendingRun: run });
    sim.call("executeRun", 1n, 6_000n, commitmentsRoot, recipientsRoot);

    const l = sim.ledger();
    expect(l.poolBalance).toBe(FUNDING - 6_000n);
    expect(l.totalPaidOut).toBe(6_000n);
    expect(l.runs.size()).toBe(1n);
    const entry = l.runs.lookup(1n);
    expect(entry.declaredTotal).toBe(6_000n);
    expect(Buffer.from(entry.commitmentsRoot).equals(Buffer.from(commitmentsRoot))).toBe(true);
    expect(Buffer.from(entry.recipientsRoot).equals(Buffer.from(recipientsRoot))).toBe(true);
  });

  it("rejects a run whose declared total differs from the sum of hidden amounts", () => {
    const { sim } = fundedSim();
    const { run, commitmentsRoot, recipientsRoot } = buildRun([
      1_000n, 2_000n, 3_000n, 0n, 0n, 0n, 0n, 0n
    ]);
    sim.setPrivateState({ secretKey: secret(1), pendingRun: run });
    // One unit off: the zero-knowledge proof of correct sum must fail.
    expect(() =>
      sim.call("executeRun", 1n, 6_001n, commitmentsRoot, recipientsRoot)
    ).toThrow();
  });

  it("rejects a run creator whose identity is not an administrator", () => {
    const { sim } = fundedSim();
    const { run, commitmentsRoot, recipientsRoot } = buildRun([
      6_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n
    ]);
    // The caller's private state holds a secret whose derived root is not
    // in the admins set — the circuit must refuse.
    sim.setPrivateState({ secretKey: secret(99), pendingRun: run });
    expect(() =>
      sim.call("executeRun", 1n, 6_000n, commitmentsRoot, recipientsRoot)
    ).toThrow();
  });

  it("rejects a run that would exceed the pool balance (solvency)", () => {
    const sim = makeSimulator(createPayrollPrivateState(secret(1)));
    sim.call("fundPool", 10_000n);
    const { run, commitmentsRoot, recipientsRoot } = buildRun([
      10_500n, 0n, 0n, 0n, 0n, 0n, 0n, 0n
    ]);
    sim.setPrivateState({ secretKey: secret(1), pendingRun: run });
    // Sum proof is valid (10,500 = 10,500) but the pool only holds 10,000.
    expect(() =>
      sim.call("executeRun", 1n, 10_500n, commitmentsRoot, recipientsRoot)
    ).toThrow();
  });

  it("lets a recipient prove their payout to a third party (selective disclosure)", () => {
    const amounts = [7_000n, 3_000n, 0n, 0n, 0n, 0n, 0n, 0n];
    const { run, commitmentsRoot } = buildRun(amounts);
    const leaf = payoutLeafOf(run.recipients[0], 7_000n, run.salts[0]);
    expect(
      pureCircuits.verifyPayoutCommitment(
        commitmentsRoot,
        leaf,
        run.commitmentSiblings.slice(0, 3),
        run.commitmentSiblingIsLeft.slice(0, 3)
      )
    ).toBe(true);
  });

  it("rejects a forged selective-disclosure claim (amount does not match)", () => {
    const amounts = [7_000n, 3_000n, 0n, 0n, 0n, 0n, 0n, 0n];
    const { run, commitmentsRoot } = buildRun(amounts);
    // Claimed leaf overstates the amount by one unit — must not verify.
    const forged = payoutLeafOf(run.recipients[0], 7_001n, run.salts[0]);
    expect(
      pureCircuits.verifyPayoutCommitment(
        commitmentsRoot,
        forged,
        run.commitmentSiblings.slice(0, 3),
        run.commitmentSiblingIsLeft.slice(0, 3)
      )
    ).toBe(false);
  });
});
