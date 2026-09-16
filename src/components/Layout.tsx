import { type ReactNode } from "react";

import { APP_CONFIG } from "../config/index.js";
import type { CallState } from "../hooks/useMidnight.js";

export type LayoutProps = {
  callState: CallState;
  onDismissError: () => void;
  children: ReactNode;
};

export function Layout({ callState, onDismissError, children }: LayoutProps) {
  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            🌒
          </span>
          <div>
            <h1>Private Payroll</h1>
            <p className="muted">
              Confidential payroll &amp; splits on Midnight — pay many people from one pool without exposing anyone's
              payout.
            </p>
          </div>
        </div>
        <span className="pill pill-net">{APP_CONFIG.networkId} network</span>
      </header>

      {callState.kind === "loading" && (
        <div className="banner banner-loading" role="status">
          <span className="spinner" aria-hidden /> {callState.label} — check your wallet for prompts…
        </div>
      )}
      {callState.kind === "error" && (
        <div className="banner banner-error" role="alert">
          <span>⚠ {callState.message}</span>
          <button className="btn btn-ghost" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      <main>{children}</main>

      <footer className="footer">
        <span>
          Midnight <strong>{APP_CONFIG.networkId}</strong> · zero-knowledge payroll demo ·{" "}
          <a href="https://docs.midnight.network" target="_blank" rel="noreferrer">
            docs.midnight.network
          </a>
        </span>
      </footer>
    </div>
  );
}
