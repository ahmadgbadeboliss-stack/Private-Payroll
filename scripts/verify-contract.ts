// One-shot verification that a contract exists on the preview network.
// Reads only PUBLIC data from the official preview indexer.
//
// Usage: tsx scripts/verify-contract.ts <contractAddress>
import { WebSocket } from "ws";

// @ts-expect-error indexer subscription needs the ws global
globalThis.WebSocket = WebSocket;

const address = process.argv[2];
if (!address || !/^[0-9a-f]{64}$/.test(address)) {
  console.error("usage: tsx scripts/verify-contract.ts <64-hex contract address>");
  process.exit(1);
}

const INDEXER_HTTP = "https://indexer.preview.midnight.network/api/v4/graphql";

const query = `
query($address: HexEncoded!) {
  contract(address: $address) {
    address
    state
  }
}`;

try {
  const res = await fetch(INDEXER_HTTP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { address: `0x${address}` } }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as {
    data?: { contract?: { address: string; state?: unknown } | null };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    console.error("indexer query error:", json.errors.map((e) => e.message).join("; "));
    process.exit(1);
  }

  const contract = json.data?.contract;
  if (!contract) {
    console.log("NOT FOUND: no contract state at this address on preview (yet).");
    process.exit(1);
  }
  console.log("VERIFIED on preview indexer:");
  console.log(`  address: ${contract.address}`);
  if (contract.state) console.log(`  state: ${String(contract.state).slice(0, 100)}`);
  console.log("  the deployment transaction has been indexed on-chain");
} catch (err) {
  console.error("verification request failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
