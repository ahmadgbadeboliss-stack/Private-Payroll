// Deploy the Private Payroll contract to the Midnight **preview** network.
//
// Prerequisites (see README "Deploy to preview"):
//   1. Docker running (the local proof server runs in Docker).
//   2. .env.local (gitignored) with MIDNIGHT_WALLET_MNEMONIC (funded preview
//      wallet, UTXOs registered for DUST) and PRIVATE_STATE_PASSWORD.
//   3. `npm run compile` must have been run.
//
// Usage:
//   npm run deploy:preview
//
// On success this prints the **contract address** to paste into README.md.
// Secrets are read from .env.local only and are never printed.
import { WebSocket } from "ws";
import * as Rx from "rxjs";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { createLocalWallet, persistChildState, dustBalance, unregisteredCoins } from "./lib/wallet";

// @ts-expect-error wallet sync needs the ws global
globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, "..", "contracts", "managed", "payroll");

const DUST_WAIT_TIMEOUT_MS = 5 * 60_000;

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

/**
 * Work around a wallet-SDK signing bug (documented in the official
 * example-counter): signRecipe hardcodes the 'pre-proof' marker when cloning
 * intents, but proven (UnboundTransaction) intents carry 'proof' data, which
 * yields signatures over the wrong bytes and the chain rejects the
 * transaction with `1010: Invalid Transaction: Custom error: 170`.
 * We sign each intent manually with the correct proof marker instead.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, unknown> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: "proof" | "pre-proof",
): void => {
  const intents = tx.intents;
  if (!intents || intents.size === 0) return;

  for (const segment of Array.from(intents.keys())) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const intent = intents.get(segment) as any;
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<
      ledger.SignatureEnabled,
      ledger.Proofish,
      ledger.PreBinding
    >("signature", proofMarker, "pre-binding", intent.serialize());

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: unknown, i: number) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cloned.fallibleUnshieldedOffer as any).signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: unknown, i: number) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cloned.guaranteedUnshieldedOffer as any).signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    intents.set(segment, cloned);
  }
};

async function waitForProofServer(maxAttempts = 60, delayMs = 2_000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch("http://127.0.0.1:6300", { signal: AbortSignal.timeout(3_000) });
      return;
    } catch (err) {
      const code =
        (err as { code?: string; cause?: { code?: string } })?.cause?.code ??
        (err as { code?: string })?.code;
      if (code !== "ECONNREFUSED" && code !== "UND_ERR_CONNECT_TIMEOUT" && code !== "UND_ERR_SOCKET")
        return;
    }
    process.stdout.write(`\r  waiting for proof server… (${attempt}/${maxAttempts})   `);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  fail(
    "Proof server not reachable on http://127.0.0.1:6300.\n  Start it:  npm run proof-server\n  (Docker Desktop must be running.)"
  );
}

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log("  Private Payroll — deploy to Midnight preview");
  console.log("════════════════════════════════════════════════\n");

  if (!fs.existsSync(path.join(zkConfigPath, "contract", "index.js"))) {
    fail("Contract not compiled. Run `npm run compile` first.");
  }

  console.log("── Proof server ───────────────────────────────");
  await waitForProofServer();
  console.log("\n  ✓ proof server responding on http://127.0.0.1:6300");

  console.log("── Wallet ─────────────────────────────────────");
  const ctx = await createLocalWallet();
  const { wallet, unshieldedKeystore, shieldedSecretKeys, dustSecretKey } = ctx;
  console.log("  syncing with preview… (minutes; RPC hiccups are normal)");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any;
  try {
    state = await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.filter((s: { isSynced: boolean }) => s.isSynced),
        Rx.timeout({ first: 20 * 60_000 }),
      ),
    );
  } catch {
    await persistChildState(ctx);
    await wallet.stop();
    fail("Wallet did not sync within 20 minutes. Re-run `npm run deploy:preview` to resume.");
  }

  const address = unshieldedKeystore.getBech32Address().toString();
  const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`  address: ${address}`);
  console.log(`  tNIGHT : ${balance.toLocaleString()}`);
  if (balance === 0n) {
    await persistChildState(ctx);
    await wallet.stop();
    fail(
      "Wallet has no tNIGHT. Fund it at the preview faucet first:\n  https://faucet.preview.midnight.network  (address above)"
    );
  }

  console.log("── DUST ───────────────────────────────────────");
  const pending = unregisteredCoins(state);
  if (pending.length > 0) {
    console.log(`  registering ${pending.length} NIGHT UTXOs for DUST…`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      pending,
      unshieldedKeystore.getPublicKey(),
      (payload: Uint8Array) => unshieldedKeystore.signData(payload),
    );
    await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    console.log("  registration submitted; waiting for DUST…");
  }
  if (dustBalance(state) === 0n) {
    try {
      await Rx.firstValueFrom(
        wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s: { isSynced: boolean }) => s.isSynced),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Rx.filter((s: any) => s.dust.balance(new Date()) > 0n),
          Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS }),
        ),
      );
    } catch {
      await persistChildState(ctx);
      await wallet.stop();
      fail("No DUST generated within 5 minutes. Check the faucet funding and retry.");
    }
  }
  console.log("  ✓ DUST ready");

  console.log("── Deploy ─────────────────────────────────────");
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletProvider: any = {
    getCoinPublicKey: () => shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => shieldedSecretKeys.encryptionPublicKey,
    // balanceUnboundTransaction -> sign intents (with the correct proof
    // markers, see signTransactionIntents above) -> finalizeRecipe.
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await wallet.balanceUnboundTransaction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx as any,
        { shieldedSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => unshieldedKeystore.signData(payload);
      signTransactionIntents(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recipe.baseTransaction as any,
        signFn,
        "proof",
      );
      if (recipe.balancingTransaction) {
        signTransactionIntents(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recipe.balancingTransaction as any,
          signFn,
          "pre-proof",
        );
      }
      return wallet.finalizeRecipe(recipe);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitTx: (tx: any) => wallet.submitTransaction(tx),
  };

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "private-payroll-deploy",
      accountId: address,
      privateStoragePasswordProvider: () =>
        process.env.PRIVATE_STATE_PASSWORD?.trim() ||
        fail("Set PRIVATE_STATE_PASSWORD (≥16 chars) to encrypt local private state."),
    }),
    publicDataProvider: indexerPublicDataProvider(
      "https://indexer.preview.midnight.network/api/v4/graphql",
      "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider("http://127.0.0.1:6300", zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  const { CompiledPayroll, createPayrollPrivateState } = await import("../contracts/index.js");
  console.log("  proving + submitting deployment transaction…");
  const deployed = await deployContract(providers as never, {
    compiledContract: CompiledPayroll,
    privateStateId: "payrollPrivateState",
    initialPrivateState: createPayrollPrivateState(),
  });
  const contractAddress = deployed.deployTxData.public.contractAddress;

  await persistChildState(ctx);
  await wallet.stop();
  console.log("\n════════════════════════════════════════════════");
  console.log("  ✅ DEPLOYED");
  console.log(`  contract address: ${contractAddress}`);
  console.log("  → paste this into README.md (Contract Address) ");
  console.log("════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
