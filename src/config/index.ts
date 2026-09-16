import { NetworkId } from "@midnight-ntwrk/midnight-js-network-id";

// Network configuration.
//
// NOTE: this MVP deliberately targets Midnight **preview** (per the build
// brief: "use preview for wallet and contract deployment instead of
// preprod"). Flip VITE_NETWORK_ID when preprod is desired — all endpoints
// below follow the official Midnight examples.
export type AppConfig = {
  readonly networkId: NetworkId;
  readonly indexer: string;
  readonly indexerWs: string;
  readonly zkConfigPath: string;
};

const NETWORKS: Record<string, AppConfig> = {
  preview: {
    networkId: "preview" as NetworkId,
    indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
    indexerWs: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
    zkConfigPath: "/"
  },
  preprod: {
    networkId: "preprod" as NetworkId,
    indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
    indexerWs: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
    zkConfigPath: "/"
  }
};

const configured = import.meta.env.VITE_NETWORK_ID as string | undefined;
const networkId = configured && configured in NETWORKS ? configured : "preview";

export const APP_CONFIG: AppConfig = NETWORKS[networkId];

// Shorten a contract address for display: 0x + first6...last6.
export function shortAddress(address: string): string {
  return `0x${address.replace(/^([A-Fa-f0-9]{6}).*([A-Fa-f0-9]{6})$/g, "$1…$2")}`;
}

// Format the smallest currency unit for humans (6 decimals, "DUST-style").
export function formatAmount(unit: bigint): string {
  const whole = unit / 1_000_000n;
  const frac = unit % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
