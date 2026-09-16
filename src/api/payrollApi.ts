// Contract API wrapper: builds the Midnight providers from the user's
// Lace wallet, deploys or joins the payroll contract, and exposes typed
// circuit calls. Mirrors the official example-bboard pattern.
import {
  deployContract,
  findDeployedContract,
  type FoundContract
} from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import type {
  MidnightProviders,
  UnboundTransaction
} from "@midnight-ntwrk/midnight-js-types";
import {
  Binding,
  FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  TransactionId
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { fromHex } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import semver from "semver";
import { firstValueFrom, interval, map, throwError, timeout, type Observable } from "rxjs";
import { catchError, concatMap, filter, take, tap } from "rxjs/operators";

import { APP_CONFIG } from "../config/index.js";
import {
  CompiledPayroll,
  createPayrollPrivateState,
  type Contract as PayrollContract,
  type PayrollPrivateState,
  type RunWitnessData
} from "../../contracts/index.js";
import * as PayrollGenerated from "../../contracts/managed/payroll/contract/index.js";
import { inMemoryPrivateStateProvider } from "./privateState.js";

export const COMPATIBLE_CONNECTOR_API_VERSION = "4.x";

export type PayrollCircuitKeys = Exclude<
  keyof PayrollContract<PayrollPrivateState>["impureCircuits"],
  number | symbol
>;

export type PayrollProviders = MidnightProviders<
  PayrollCircuitKeys,
  "payrollPrivateState",
  PayrollPrivateState
>;

export type RunSummary = {
  id: bigint;
  declaredTotal: bigint;
  commitmentsRoot: string;
  recipientsRoot: string;
};

export type LedgerSnapshot = {
  poolBalance: bigint;
  totalPaidOut: bigint;
  runs: RunSummary[];
};

export type PayrollAPI = {
  readonly deployedContractAddress: string;
  readonly state$: Observable<LedgerSnapshot>;
  fundPool(amount: bigint): Promise<void>;
  executeRun(
    runId: bigint,
    declaredTotal: bigint,
    commitmentsRoot: Uint8Array,
    recipientsRoot: Uint8Array,
    witnessData: RunWitnessData
  ): Promise<void>;
  addAdmin(newAdminRoot: Uint8Array): Promise<void>;
};

// Minimal structural type for the pino-style logger we pass around.
export type Logger = { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };

/** Build the wallet-facing providers (bboard pattern). */
async function buildProviders(logger: Logger): Promise<PayrollProviders> {
  setNetworkId(APP_CONFIG.networkId);
  const connector = await connectToWallet(logger);
  const zkConfigProvider = new FetchZkConfigProvider<PayrollCircuitKeys>(
    window.location.origin,
    fetch.bind(window)
  );
  const config = await connector.getConfiguration();
  const shielded = await connector.getShieldedAddresses();
  const privateStateProvider = inMemoryPrivateStateProvider<"payrollPrivateState", PayrollPrivateState>();
  return {
    privateStateProvider,
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri!, zkConfigProvider),
    publicDataProvider: indexerPublicDataProvider(APP_CONFIG.indexer, APP_CONFIG.indexerWs),
    walletProvider: {
      getCoinPublicKey(): string {
        return shielded.shieldedCoinPublicKey;
      },
      getEncryptionPublicKey(): string {
        return shielded.shieldedEncryptionPublicKey;
      },
      balanceTx: async (tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> => {
        void ttl;
        const serialized = toHex(tx.serialize());
        const received = await connector.balanceUnsealedTransaction(serialized);
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          "signature",
          "proof",
          "binding",
          fromHex(received.tx)
        ) as unknown as FinalizedTransaction;
      }
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connector.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      }
    }
  };
}

/** Wait for a compatible Midnight wallet extension and connect. */
async function connectToWallet(logger: Logger): Promise<ConnectedAPI> {
  return firstValueFrom(
    interval(100).pipe(
      map(() => getFirstCompatibleWallet()),
      tap((w) => logger.info(!!w, "checking for wallet connector")),
      filter((w): w is InitialAPI => !!w),
      take(1),
      timeout({
        first: 2_000,
        with: () =>
          throwError(
            () => new Error("Midnight Lace wallet not found. Is the extension installed and enabled?")
          )
      }),
      concatMap(async (initial) => {
        const connected = await initial.connect(APP_CONFIG.networkId);
        const status = await connected.getConnectionStatus();
        logger.info(status, "wallet connection status");
        return connected;
      }),
      timeout({
        first: 8_000,
        with: () => throwError(() => new Error("Wallet did not respond to the connection request."))
      }),
      catchError((err) => throwError(() => (err instanceof Error ? err : new Error(String(err)))))
    )
  );
}

function getFirstCompatibleWallet(): InitialAPI | undefined {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === "object" &&
      "apiVersion" in wallet &&
      semver.satisfies((wallet as InitialAPI).apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
  );
}

/** Deploys a fresh payroll contract (administrator = deployer). */
export async function deployPayroll(logger: Logger): Promise<PayrollAPI> {
  const providers = await buildProviders(logger);
  const deployed = await deployContract(providers, {
    compiledContract: CompiledPayroll,
    privateStateId: "payrollPrivateState",
    initialPrivateState: createPayrollPrivateState()
  });
  return new PayrollAPIImpl(deployed, providers, logger);
}

/** Joins an existing payroll contract by address (recipient / auditor). */
export async function joinPayroll(address: string, logger: Logger): Promise<PayrollAPI> {
  const providers = await buildProviders(logger);
  const deployed = await findDeployedContract<PayrollContract<PayrollPrivateState>>(providers, {
    contractAddress: address,
    compiledContract: CompiledPayroll,
    privateStateId: "payrollPrivateState",
    initialPrivateState: createPayrollPrivateState()
  });
  return new PayrollAPIImpl(deployed, providers, logger);
}

class PayrollAPIImpl implements PayrollAPI {
  readonly deployedContractAddress: string;
  readonly state$: Observable<LedgerSnapshot>;

  constructor(
    private readonly deployed: FoundContract<PayrollContract<PayrollPrivateState>>,
    private readonly providers: PayrollProviders,
    private readonly logger: Logger
  ) {
    this.deployedContractAddress = deployed.deployTxData.public.contractAddress;
    this.state$ = this.providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: "latest" })
      .pipe(map((contractState) => toSnapshot(contractState.data)));
  }

  async fundPool(amount: bigint): Promise<void> {
    this.logger.info({ amount: amount.toString() }, "fundPool");
    await this.deployed.callTx.fundPool(amount);
  }

  async executeRun(
    runId: bigint,
    declaredTotal: bigint,
    commitmentsRoot: Uint8Array,
    recipientsRoot: Uint8Array,
    witnessData: RunWitnessData
  ): Promise<void> {
    this.logger.info({ runId: runId.toString() }, "executeRun");
    // The per-run witness data must be present in the caller's private
    // state while the circuit executes. It is consumed by the witnesses
    // and never leaves the browser. The identity secret is preserved.
    const current = await this.providers.privateStateProvider.get("payrollPrivateState");
    const secretKey = current?.secretKey ?? createPayrollPrivateState().secretKey;
    await this.providers.privateStateProvider.set("payrollPrivateState", {
      secretKey,
      pendingRun: witnessData
    });    await this.deployed.callTx.executeRun(runId, declaredTotal, commitmentsRoot, recipientsRoot);
  }

  async addAdmin(newAdminRoot: Uint8Array): Promise<void> {
    this.logger.info({}, "addAdmin");
    await this.deployed.callTx.addAdmin(newAdminRoot);
  }
}

/** Convert raw on-chain state into the typed UI snapshot. */
function toSnapshot(data: unknown): LedgerSnapshot {
  const l = PayrollGenerated.ledger(data as Parameters<typeof PayrollGenerated.ledger>[0]);
  const runs: RunSummary[] = [];
  for (const [id, run] of l.runs) {
    runs.push({
      id,
      declaredTotal: run.declaredTotal,
      commitmentsRoot: toHex(run.commitmentsRoot),
      recipientsRoot: toHex(run.recipientsRoot)
    });
  }
  return {
    poolBalance: l.poolBalance,
    totalPaidOut: l.totalPaidOut,
    runs: runs.reverse() // newest first
  };
}
