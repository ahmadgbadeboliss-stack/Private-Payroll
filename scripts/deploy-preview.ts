// Deploy the Private Payroll contract to the Midnight **preview** network.
//
// Prerequisites (see README "Deploy to preview"):
//   1. Docker running (the local proof server runs in Docker).
//   2. A funded preview wallet: paste your Lace recovery phrase into
//      MIDNIGHT_WALLET_MNEMONIC when running this script. The wallet needs
//      a small tNIGHT balance (preview faucet) to pay fees.
//   3. `npm run compile` must have been run.
//
// Usage:
//   MIDNIGHT_WALLET_MNEMONIC="twenty four words ..." npm run deploy:preview
//
// On success this prints the **contract address** to paste into README.md.
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
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  DustWallet,
  HDWallet,
  NoOpTransactionHistoryStorage,
  PublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletFacade,
  createKeystore
} from "@midnight-ntwrk/wallet-sdk";
import { Buffer } from "buffer";

// @ts-expect-error wallet sync needs the ws global
globalThis.WebSocket = WebSocket;

const NETWORK = "preview" as const;
const INDEXER = "https://indexer.preview.midnight.network/api/v4/graphql";
const INDEXER_WS = "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
const NODE_WS = "wss://rpc.preview.midnight.network";
const PROOF_SERVER = "http://127.0.0.1:6300";

const DUST_WAIT_TIMEOUT_MS = 5 * 60_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, "..", "contracts", "managed", "payroll");

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

// ── Wallet (Lace-compatible BIP-39) ─────────────────────────────────────────

function deriveKeys(seedHex: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
  if (hd.type !== "seedOk") fail("Invalid seed.");
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== "keysDerived") fail("Key derivation failed.");
  hd.hdWallet.clear();
  return derived.keys;
}

async function createWallet(seedHex: string) {
  setNetworkId(NETWORK);
  const keys = deriveKeys(seedHex);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore = createKeystore(keys[Roles.NightExternal], NETWORK);

  const wallet = await WalletFacade.init({
    configuration: {
      networkId: NETWORK,
      indexerClientConnection: { indexerHttpUrl: INDEXER, indexerWsUrl: INDEXER_WS },
      provingServerUrl: new URL(PROOF_SERVER),
      relayURL: new URL(NODE_WS),
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 }
    },
    shielded: async (config) => ShieldedWallet(config).startWithSecretKeys(shieldedSecretKeys),
    unshielded: async (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: async (config) =>
      DustWallet(config).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust
      )
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, keystore };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════");
  console.log("  Private Payroll — deploy to Midnight preview");
  console.log("════════════════════════════════════════════════\n");

  if (!fs.existsSync(path.join(zkConfigPath, "contract", "index.js"))) {
    fail("Contract not compiled. Run `npm run compile` first.");
  }

  const mnemonic = process.env.MIDNIGHT_WALLET_MNEMONIC?.trim();
  if (!mnemonic) {
    fail(
      'Set MIDNIGHT_WALLET_MNEMONIC to a funded preview wallet recovery phrase:\n  MIDNIGHT_WALLET_MNEMONIC="..." npm run deploy:preview'
    );
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    fail("MIDNIGHT_WALLET_MNEMONIC is not a valid BIP-39 recovery phrase.");
  }
  const seedHex = Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex");

  console.log("── Proof server ───────────────────────────────");
  await waitForProofServer();
  console.log("  ✓ proof server responding on", PROOF_SERVER);

  console.log("── Wallet ─────────────────────────────────────");
  const { wallet, keystore } = await createWallet(seedHex);
  console.log("  syncing with preview… (minutes; RPC hiccups are normal)");
  const state = await wallet.waitForSyncedState();
  const address = keystore.getBech32Address().toString();
  const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`  address: ${address}`);
  console.log(`  tNIGHT : ${balance.toLocaleString()}`);
  if (balance === 0n) {
    await wallet.stop();
    fail(
      `Wallet has no tNIGHT. Fund it at the preview faucet first:\n  https://faucet.preview.midnight.network  (address above)`
    );
  }

  console.log("── DUST registration ─────────────────────────");
  const dustState = await Rx.firstValueFrom(
    wallet.state().pipe(Rx.filter((s) => s.isSynced))
  );
  const unregistered = dustState.unshielded.availableCoins.filter(
    (c: { meta?: { registeredForDustGeneration?: boolean } }) =>
      !c.meta?.registeredForDustGeneration
  );
  if (unregistered.length > 0) {
    console.log(`  registering ${unregistered.length} NIGHT UTXOs for DUST…`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      unregistered,
      keystore.getPublicKey(),
      (payload: Uint8Array) => keystore.signData(payload)
    );
    await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
  }
  if (dustState.dust.balance(new Date()) === 0n) {
    console.log("  waiting for DUST…");
    try {
      await Rx.firstValueFrom(
        wallet
          .state()
          .pipe(
            Rx.throttleTime(5_000),
            Rx.filter((s) => s.isSynced),
            Rx.filter((s) => s.dust.balance(new Date()) > 0n),
            Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS })
          )
      );
    } catch {
      await wallet.stop();
      fail("No DUST generated within 5 minutes. Check the faucet funding and retry.");
    }
  }
  console.log("  ✓ DUST ready");

  console.log("── Deploy ─────────────────────────────────────");
  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: "private-payroll-deploy",
      accountId: address,
      privateStoragePasswordProvider: () =>
        process.env.PRIVATE_STATE_PASSWORD?.trim() ||
        fail("Set PRIVATE_STATE_PASSWORD (≥16 chars) to encrypt local private state.")
    }),
    publicDataProvider: indexerPublicDataProvider(INDEXER, INDEXER_WS),
    zkConfigProvider: new NodeZkConfigProvider(zkConfigPath),
    proofProvider: httpClientProofProvider(PROOF_SERVER, new NodeZkConfigProvider(zkConfigPath))
  };

  const { CompiledPayroll, createPayrollPrivateState } = await import("../contracts/index.js");
  const deployed = await deployContract(providers as never, {
    compiledContract: CompiledPayroll,
    privateStateId: "payrollPrivateState",
    initialPrivateState: createPayrollPrivateState()
  });
  const contractAddress = deployed.deployTxData.public.contractAddress;

  await wallet.stop();
  console.log("\n════════════════════════════════════════════════");
  console.log("  ✅ DEPLOYED");
  console.log(`  contract address: ${contractAddress}`);
  console.log("  → paste this into README.md (Contract Address) ");
  console.log("════════════════════════════════════════════════\n");
}

async function waitForProofServer(maxAttempts = 60, delayMs = 2_000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(PROOF_SERVER, { signal: AbortSignal.timeout(3_000) });
      return;
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
      if (code !== "ECONNREFUSED" && code !== "UND_ERR_CONNECT_TIMEOUT" && code !== "UND_ERR_SOCKET") return;
    }
    process.stdout.write(`\r  waiting for proof server… (${attempt}/${maxAttempts})   `);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  fail(
    "Proof server not reachable on http://127.0.0.1:6300.\n  Start it:  docker compose up -d\n  (Docker Desktop must be running.)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
