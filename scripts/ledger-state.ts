// Read-only check of the deployed payroll contract's public ledger state.
//
// Uses the same indexer public-data provider and generated codec as the web
// app (src/api/payrollApi.ts), so the output is exactly what the UI would
// show. No wallet, no secrets, no transaction.
//
// Usage: npx tsx scripts/ledger-state.ts <contract-address>   (0x prefix ok)
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { firstValueFrom } from "rxjs";

import * as PayrollGenerated from "../contracts/managed/payroll/contract/index.js";

const INDEXER = "https://indexer.preview.midnight.network/api/v4/graphql";
const INDEXER_WS = "wss://indexer.preview.midnight.network/api/v4/graphql/ws";

// Format smallest-unit (6 dp) for humans — mirrors src/config formatAmount
// (not imported: that module reads import.meta.env, unavailable in node).
function fmt(value: unknown): string {
  let unit: bigint;
  try {
    unit = typeof value === "bigint" ? value : BigInt(value as string | number);
  } catch {
    return `<unprintable:${String(value)}>`;
  }
  const whole = unit / 1_000_000n;
  const frac = unit % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

const address = (process.argv[2] ?? "").trim().replace(/^0x/, "");
if (!/^[0-9a-fA-F]{64}$/.test(address)) {
  console.error("usage: tsx scripts/ledger-state.ts <64-hex contract address>");
  process.exit(1);
}

const provider = indexerPublicDataProvider(INDEXER, INDEXER_WS);
const contractState = await firstValueFrom(
  provider.contractStateObservable(address, { type: "latest" })
);
const l = PayrollGenerated.ledger(
  contractState.data as Parameters<typeof PayrollGenerated.ledger>[0]
);

console.log("contract:", `0x${address}`);
console.log("poolBalance:  ", `${l.poolBalance}`, `(${fmt(l.poolBalance)} human)`);
console.log("totalPaidOut: ", `${l.totalPaidOut}`, `(${fmt(l.totalPaidOut)} human)`);
const runsRaw: unknown = l.runs;
const count =
  typeof (runsRaw as { size?: unknown }).size === "function"
    ? (runsRaw as unknown as { size(): number }).size()
    : ((runsRaw as { size?: number }).size ?? 0);
console.log("runs executed:", count);
const entries: [unknown, unknown][] =
  runsRaw instanceof Map
    ? [...runsRaw.entries()]
    : Object.entries((runsRaw ?? {}) as Record<string, unknown>);
for (const [id, run] of entries) {
  const r = run as { declaredTotal?: unknown };
  console.log(`  run #${String(id)}: declaredTotal=${fmt(r?.declaredTotal)} raw=${String(r?.declaredTotal)}`);
}
