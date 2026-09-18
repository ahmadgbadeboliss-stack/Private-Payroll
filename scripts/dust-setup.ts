// Register the wallet's NIGHT UTXOs for DUST generation and wait for DUST.
//
// Follows the official create-mn-app / example-counter flow exactly:
//   1. Sync the local preview wallet.
//   2. Find NIGHT UTXOs not yet registered for DUST generation.
//   3. registerNightUtxosForDustGeneration(...) -> finalize -> submit.
//      (The sign callback already produces N signatures for N inputs — the
//      recipe must NOT be signed again, or the chain rejects with
//      InputsSignaturesLengthMismatch / Custom error 192.)
//   4. Wait until the DUST balance is non-zero.
//
// Prints public info only; the phrase never leaves scripts/lib/wallet.ts.
//
// Usage: npm run dust:setup
import { firstValueFrom, throttleTime, filter, timeout as rxTimeout } from "rxjs";
import {
  createLocalWallet,
  persistChildState,
  tNightBalance,
  dustBalance,
  unregisteredCoins,
} from "./lib/wallet";

const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
const DUST_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

const log = (msg: string) =>
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${msg}\n`);

async function main() {
  log("building local wallet...");
  const ctx = await createLocalWallet();
  const { wallet, unshieldedKeystore } = ctx;

  log("waiting for full sync (resumes from saved child state when available)...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any;
  try {
    state = await firstValueFrom(
      wallet.state().pipe(
        filter((s: { isSynced: boolean }) => s.isSynced),
        rxTimeout({ first: SYNC_TIMEOUT_MS }),
      ),
    );
  } catch {
    log("sync did not complete in time — re-run `npm run dust:setup` to resume.");
    await wallet.stop();
    process.exit(1);
  }

  const tNight = tNightBalance(state);
  const dust = dustBalance(state);
  const pending = unregisteredCoins(state);
  log(`tNIGHT: ${tNight.toLocaleString()} | DUST: ${dust.toLocaleString()} | UTXOs awaiting registration: ${pending.length}`);

  if (tNight === 0n) {
    log("wallet has no tNIGHT — nothing to register. Fund it first, then re-run.");
    await persistChildState(ctx);
    await wallet.stop();
    process.exit(1);
  }

  // ── Register UTXOs for DUST generation ──────────────────────────────────
  if (pending.length > 0) {
    log(`registering ${pending.length} NIGHT UTXO(s) for DUST generation...`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      pending,
      unshieldedKeystore.getPublicKey(),
      (payload: Uint8Array) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    const txId = await wallet.submitTransaction(finalized);
    log(`registration transaction submitted (${String(txId).slice(0, 18)}...).`);
  } else if (dust === 0n) {
    log("all UTXOs already registered — waiting for DUST to generate...");
  } else {
    log("nothing to do — UTXOs registered and DUST already non-zero.");
  }

  // ── Wait until DUST balance is non-zero ─────────────────────────────────
  if (dustBalance(state) === 0n) {
    log("waiting for DUST balance > 0 (DUST accrues per block from registered NIGHT)...");
    try {
      await firstValueFrom(
        wallet.state().pipe(
          throttleTime(5000),
          filter((s: { isSynced: boolean }) => s.isSynced),
          filter((s: { dust: { balance: (d: Date) => bigint } }) => s.dust.balance(new Date()) > 0n),
          rxTimeout({ first: DUST_WAIT_TIMEOUT_MS }),
        ),
      );
    } catch {
      log(`no DUST generated within ${Math.round(DUST_WAIT_TIMEOUT_MS / 60000)} minutes.`);
      log("This is unusual once the registration tx is included; re-run `npm run dust:setup`.");
    }
  }

  // Final snapshot (best-effort — the stream may lag a block or two).
  await new Promise((r) => setTimeout(r, 3000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let finalState: any = null;
  try {
    finalState = await firstValueFrom(
      wallet.state().pipe(
        filter((s: { isSynced: boolean }) => s.isSynced),
        rxTimeout({ first: 60_000 }),
      ),
    );
  } catch {
    finalState = null;
  }

  if (finalState) {
    const finalDust = dustBalance(finalState);
    const finalTNight = tNightBalance(finalState);
    const registeredCount = (finalState.unshielded.availableCoins ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.meta?.registeredForDustGeneration === true,
    ).length;
    const totalCoins = (finalState.unshielded.availableCoins ?? []).length;
    log("");
    log("──────────── DEPLOYMENT READINESS (public info) ────────────");
    log(`tNIGHT balance:   ${finalTNight.toLocaleString()}`);
    log(`DUST balance:     ${finalDust.toLocaleString()}`);
    log(`NIGHT UTXOs:      ${totalCoins} available, ${registeredCount} registered for DUST`);
    log(
      finalDust > 0n
        ? "RESULT: wallet is deployment-ready (DUST is non-zero)."
        : "RESULT: not ready yet — re-run `npm run dust:setup` in a few minutes.",
    );
    log("─────────────────────────────────────────────────────────────");
  } else {
    log("could not take a final synced snapshot; re-run `npm run dust:setup` to confirm.");
  }

  await persistChildState(ctx);
  await wallet.stop();
  process.exit(0);
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
