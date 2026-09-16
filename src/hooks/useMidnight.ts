// React hook that owns the wallet connection and contract lifecycle:
// connect → deploy or join → subscribe to ledger state → call circuits.
// All circuit calls flow through this hook so the UI gets uniform
// loading / error handling.
import { useCallback, useEffect, useRef, useState } from "react";
import { type Subscription } from "rxjs";

import { shortAddress } from "../config/index.js";
import {
  deployPayroll,
  joinPayroll,
  type LedgerSnapshot,
  type Logger,
  type PayrollAPI
} from "../api/index.js";

export type ConnectionStatus =
  | { phase: "disconnected" }
  | { phase: "connecting" }
  | { phase: "deploying" }
  | { phase: "joining" }
  | { phase: "connected"; api: PayrollAPI; address: string };

export type CallState =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | { kind: "error"; message: string };

const logger: Logger = {
  info: (o, m) => console.info(m ?? "", o),
  error: (o, m) => console.error(m ?? "", o)
};

export function useMidnight() {
  const [status, setStatus] = useState<ConnectionStatus>({ phase: "disconnected" });
  const [callState, setCallState] = useState<CallState>({ kind: "idle" });
  const [ledger, setLedger] = useState<LedgerSnapshot>();
  const subscriptionRef = useRef<Subscription | undefined>(undefined);

  useEffect(() => {
    return () => subscriptionRef.current?.unsubscribe();
  }, []);

  // Keep the ledger snapshot fresh while connected.
  useEffect(() => {
    if (status.phase !== "connected") return;
    const sub = status.api.state$.subscribe({
      next: setLedger,
      error: (err: unknown) =>
        setCallState({
          kind: "error",
          message: `Lost contact with the network indexer: ${err instanceof Error ? err.message : String(err)}`
        })
    });
    subscriptionRef.current = sub;
    return () => sub.unsubscribe();
  }, [status]);

  /** Connect the Lace wallet and deploy a fresh payroll contract. */
  const connectAndDeploy = useCallback(async () => {
    try {
      setStatus({ phase: "connecting" });
      setStatus({ phase: "deploying" });
      const api = await deployPayroll(logger);
      setStatus({ phase: "connected", api, address: api.deployedContractAddress });
    } catch (err) {
      setStatus({ phase: "disconnected" });
      setCallState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, []);

  /** Connect the Lace wallet and join an existing contract by address. */
  const connectAndJoin = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!/^[0-9a-fA-F]{20,80}$/.test(trimmed)) {
      setCallState({ kind: "error", message: "That does not look like a contract address (hex string expected)." });
      return;
    }
    try {
      setStatus({ phase: "connecting" });
      setStatus({ phase: "joining" });
      const api = await joinPayroll(trimmed, logger);
      setStatus({ phase: "connected", api, address: api.deployedContractAddress });
    } catch (err) {
      setStatus({ phase: "disconnected" });
      setCallState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, []);

  /** Wrap a circuit call with loading + error state. */
  const runCall = useCallback(
    async (label: string, action: (api: PayrollAPI) => Promise<void>): Promise<boolean> => {
      if (status.phase !== "connected") {
        setCallState({ kind: "error", message: "Connect a wallet first." });
        return false;
      }
      setCallState({ kind: "loading", label });
      try {
        await action(status.api);
        setCallState({ kind: "idle" });
        return true;
      } catch (err) {
        setCallState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err)
        });
        return false;
      }
    },
    [status]
  );

  const resetError = useCallback(() => setCallState({ kind: "idle" }), []);

  return {
    status,
    displayAddress: status.phase === "connected" ? shortAddress(status.address) : null,
    ledger,
    callState,
    connectAndDeploy,
    connectAndJoin,
    runCall,
    resetError,
    isBusy: callState.kind === "loading" || status.phase === "connecting" || status.phase === "deploying" || status.phase === "joining"
  };
}
