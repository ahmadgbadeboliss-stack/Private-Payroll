// Shared wallet bootstrap for local scripts (status / dust setup / deploy).
//
// Mirrors the official create-mn-app hello-world template's wallet.ts, with
// two project-local differences: the recovery phrase comes from .env.local
// (gitignored, never printed) and network endpoints are preview constants.
//
// Secrets never leave this module; callers only receive wallet handles.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { Buffer } from "buffer";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  WalletFacade,
  DustWallet,
  HDWallet,
  Roles,
  ShieldedWallet,
  createKeystore,
  NoOpTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from "@midnight-ntwrk/wallet-sdk";

// Enable WebSocket for indexer GraphQL subscriptions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// __dirname here is scripts/lib → the project root is two levels up.
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export const NETWORK_ID = "preview" as const;
export const INDEXER_HTTP = "https://indexer.preview.midnight.network/api/v4/graphql";
export const INDEXER_WS = "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
export const NODE_RPC = "https://rpc.preview.midnight.network";
export const PROOF_SERVER = "http://127.0.0.1:6300";
export const STATE_DIR = path.join(PROJECT_ROOT, ".midnight-wallet-state");

const logErr = (msg: string) =>
  process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${msg}\n`);

// ── Secrets (never logged) ──────────────────────────────────────────────────
function loadEnvLocal(): void {
  const envLocalPath = path.join(PROJECT_ROOT, ".env.local");
  if (!fs.existsSync(envLocalPath)) return;
  for (const line of fs.readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

export function loadMnemonic(): string {
  loadEnvLocal();
  const mnemonic = process.env.MIDNIGHT_WALLET_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error("No MIDNIGHT_WALLET_MNEMONIC found in .env.local or environment.");
  }
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error("MIDNIGHT_WALLET_MNEMONIC is not a valid BIP-39 phrase.");
  }
  return mnemonic;
}

// ── Saved child state (fast resume across runs) ────────────────────────────
function loadSavedChildState(): Record<string, unknown> {
  const saved: Record<string, unknown> = {};
  if (!fs.existsSync(STATE_DIR)) return saved;
  for (const kind of ["shielded", "unshielded", "dust"]) {
    const p = path.join(STATE_DIR, `${kind}.json`);
    if (fs.existsSync(p)) {
      try {
        saved[kind] = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        logErr(`  could not parse saved ${kind} state; will re-sync from seed`);
      }
    }
  }
  return saved;
}

export interface WalletContext {
  wallet: Awaited<ReturnType<typeof WalletFacade.init>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unshieldedKeystore: any;
  shieldedSecretKeys: ReturnType<typeof ledger.ZswapSecretKeys.fromSeed>;
  dustSecretKey: ReturnType<typeof ledger.DustSecretKey.fromSeed>;
}

/**
 * Build and start the wallet facade (shielded + unshielded + dust children)
 * for the local preview wallet. Caller must await waitForSyncedState() and
 * should call persistChildState() + wallet.stop() when done.
 */
export async function createLocalWallet(): Promise<WalletContext> {
  const mnemonic = loadMnemonic();

  setNetworkId(NETWORK_ID);
  const hd = HDWallet.fromSeed(Buffer.from(mnemonicToSeedSync(mnemonic), "hex"));
  if (hd.type !== "seedOk") throw new Error("Invalid seed.");
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== "keysDerived") throw new Error("Key derivation failed.");
  hd.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derived.keys[Roles.NightExternal], NETWORK_ID);

  const savedState = loadSavedChildState();
  const restored = Object.keys(savedState).length;
  if (restored > 0) logErr(`  resuming from ${restored}/3 saved child states`);

  const walletConfig = {
    networkId: NETWORK_ID,
    indexerClientConnection: { indexerHttpUrl: INDEXER_HTTP, indexerWsUrl: INDEXER_WS },
    provingServerUrl: new URL(PROOF_SERVER),
    relayURL: new URL(NODE_RPC.replace(/^http/, "ws")),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const restoreOrStart = async (kind: string, cls: any, start: () => Promise<any>) => {
    if (savedState[kind] !== undefined) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = await (cls as any).restore(savedState[kind]);
        logErr(`  ${kind}: restored from saved state`);
        return w;
      } catch (err) {
        logErr(`  ${kind}: restore failed (${err instanceof Error ? err.message : err}); fresh sync`);
      }
    }
    return start();
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: async (config) =>
      restoreOrStart("shielded", ShieldedWallet(config), () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ShieldedWallet(config) as any).startWithSecretKeys(shieldedSecretKeys),
      ),
    unshielded: async (config) =>
      restoreOrStart("unshielded", UnshieldedWallet(config), () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (UnshieldedWallet(config) as any).startWithPublicKey(
          PublicKey.fromKeyStore(unshieldedKeystore),
        ),
      ),
    dust: async (config) =>
      restoreOrStart("dust", DustWallet(config), () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (DustWallet(config) as any).startWithSecretKey(
          dustSecretKey,
          ledger.LedgerParameters.initialParameters().dust,
        ),
      ),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, unshieldedKeystore, shieldedSecretKeys, dustSecretKey };
}

/** Serialize child wallets to disk so the next run resumes instead of re-scanning. */
export async function persistChildState(ctx: WalletContext): Promise<void> {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: Record<string, any> = {
      shielded: (ctx.wallet as any).shielded,
      unshielded: (ctx.wallet as any).unshielded,
      dust: (ctx.wallet as any).dust,
    };
    for (const [kind, child] of Object.entries(children)) {
      if (typeof child?.serializeState === "function") {
        const serialized = await child.serializeState();
        fs.writeFileSync(path.join(STATE_DIR, `${kind}.json`), JSON.stringify(serialized), {
          mode: 0o600,
        });
      }
    }
    logErr("child state saved for fast resume");
  } catch (err) {
    logErr(`could not save child state (${err instanceof Error ? err.message : err})`);
  }
}

// ── Convenience accessors over the synced facade state ──────────────────────

export function tNightBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
): bigint {
  return state.unshielded.balances[unshieldedToken().raw] ?? 0n;
}

export function dustBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any,
): bigint {
  return state.dust.balance(new Date());
}

/** NIGHT UTXOs available for spending, as `UtxoWithMeta[]`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function availableCoins(state: any): any[] {
  return state.unshielded.availableCoins ?? [];
}

/** NIGHT UTXOs not yet registered for DUST generation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unregisteredCoins(state: any): any[] {
  return availableCoins(state).filter((c) => c.meta?.registeredForDustGeneration !== true);
}
