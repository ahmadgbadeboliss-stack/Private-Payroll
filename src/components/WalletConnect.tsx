import { useState } from "react";

import { type ConnectionStatus, type CallState } from "../hooks/useMidnight.js";

export type WalletConnectProps = {
  status: ConnectionStatus;
  callState: CallState;
  displayAddress: string | null;
  isBusy: boolean;
  onDeploy: () => void;
  onJoin: (address: string) => void;
};

/** Detects a Midnight-capable wallet extension without touching it. */
function hasMidnightWallet(): boolean {
  return typeof window !== "undefined" && !!(window as { midnight?: unknown }).midnight;
}

export function WalletConnect(props: WalletConnectProps) {
  const { status, displayAddress, isBusy, onDeploy, onJoin } = props;
  const [joinAddress, setJoinAddress] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const walletPresent = hasMidnightWallet();

  const connected = status.phase === "connected";

  return (
    <section className="card" aria-label="Wallet connection">
      <div className="card-head">
        <h2>Wallet</h2>
        {connected ? (
          <span className="pill pill-ok" title={status.address}>
            ● {displayAddress}
          </span>
        ) : (
          <span className={`pill ${walletPresent ? "pill-warn" : "pill-bad"}`}>
            {walletPresent ? "Lace detected" : "Lace not detected"}
          </span>
        )}
      </div>

      {!connected && (
        <>
          <p className="muted">
            Connect your Midnight Lace wallet to {status.phase === "deploying" ? "deploy" : "deploy or join"} the
            payroll contract on <strong>preview</strong>. Deployment makes your wallet the first administrator.
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={onDeploy} disabled={isBusy}>
              {status.phase === "deploying" ? "Deploying…" : "Connect & Deploy"}
            </button>
            <button className="btn" onClick={() => setShowJoin((v) => !v)} disabled={isBusy}>
              {showJoin ? "Hide join" : "Join existing…"}
            </button>
          </div>
          {showJoin && (
            <div className="row join-row">
              <input
                className="input"
                placeholder="Contract address (hex)"
                value={joinAddress}
                onChange={(e) => setJoinAddress(e.target.value)}
              />
              <button className="btn" onClick={() => onJoin(joinAddress)} disabled={isBusy || !joinAddress.trim()}>
                Join
              </button>
            </div>
          )}
          {!walletPresent && (
            <p className="hint">
              No Midnight wallet extension found. Install the Lace browser extension, enable it for this site, and
              reload.
            </p>
          )}
        </>
      )}

      {connected && (
        <p className="muted">
          Connected. Your identity inside this contract is a <strong>zero-knowledge root</strong> derived from your
          wallet's private state — the chain never sees your secret or your address in circuit logic.
        </p>
      )}
    </section>
  );
}
