import { formatAmount, shortAddress } from "../config/index.js";
import type { LedgerSnapshot } from "../api/index.js";

export type PayrollLedgerProps = {
  ledger?: LedgerSnapshot;
};

/**
 * The public audit view: everything rendered here is intentionally
 * on-chain and visible to anyone — pool totals, run totals, and the
 * commitment Merkle roots. What is deliberately absent: any individual
 * amount or recipient identity.
 */
export function PayrollLedger({ ledger }: PayrollLedgerProps) {
  return (
    <section className="card" aria-label="Public audit ledger">
      <div className="card-head">
        <h2>Public audit ledger</h2>
        <span className="pill">on-chain · verifiable by anyone</span>
      </div>

      {!ledger ? (
        <p className="muted">Connect to a contract to see its public ledger.</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Pool balance</span>
              <span className="stat-value">{formatAmount(ledger.poolBalance)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Total paid out</span>
              <span className="stat-value">{formatAmount(ledger.totalPaidOut)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Runs executed</span>
              <span className="stat-value">{ledger.runs.length}</span>
            </div>
          </div>

          {ledger.runs.length === 0 ? (
            <p className="muted">No payroll runs yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Declared total (public)</th>
                  <th>Commitments root</th>
                  <th>Recipients root</th>
                </tr>
              </thead>
              <tbody>
                {ledger.runs.map((r) => (
                  <tr key={r.id.toString()}>
                    <td>#{r.id.toString()}</td>
                    <td>{formatAmount(r.declaredTotal)}</td>
                    <td className="mono" title={r.commitmentsRoot}>
                      {shortAddress(r.commitmentsRoot)}
                    </td>
                    <td className="mono" title={r.recipientsRoot}>
                      {shortAddress(r.recipientsRoot)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="hint">
            Individuals' payout amounts and identities are <strong>not here</strong> — by construction. Each run's
            commitments root hides every amount behind salted commitments; anyone can re-verify the totals, nobody can
            read the parts.
          </p>
        </>
      )}
    </section>
  );
}
