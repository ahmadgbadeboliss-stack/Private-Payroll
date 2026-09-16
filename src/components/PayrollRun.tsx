import { useMemo, useState } from "react";

import { formatAmount } from "../config/index.js";
import { assembleRun, type PayoutInput } from "../utils/contract.js";
import type { RunWitnessData } from "../../contracts/witnesses.js";

export type PayrollRunProps = {
  connected: boolean;
  isBusy: boolean;
  poolBalance?: bigint;
  nextRunId: bigint;
  onFundPool: (amount: bigint) => Promise<void>;
  onExecuteRun: (
    runId: bigint,
    declaredTotal: bigint,
    commitmentsRoot: Uint8Array,
    recipientsRoot: Uint8Array,
    witnessData: RunWitnessData
  ) => Promise<void>;
};

type Row = { id: number; recipient: string; amount: string };

export function PayrollRun(props: PayrollRunProps) {
  const { connected, isBusy, poolBalance, nextRunId, onFundPool, onExecuteRun } = props;

  const [rows, setRows] = useState<Row[]>([{ id: 1, recipient: "", amount: "" }]);
  const [fundAmount, setFundAmount] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [lastProof, setLastProof] = useState<string>();

  const declaredTotal = useMemo(
    () =>
      rows.reduce((acc, r) => {
        try {
          return acc + parseAmountToUnit(r.amount);
        } catch {
          return acc;
        }
      }, 0n),
    [rows]
  );

  const insufficient = poolBalance !== undefined && declaredTotal > poolBalance;

  function parseAmountToUnit(text: string): bigint {
    const trimmed = text.trim();
    if (!trimmed) return 0n;
    // Accepts decimal notation; converts to the smallest unit (6 dp).
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
      throw new Error(`invalid amount: ${text}`);
    }
    const [whole, frac = ""] = trimmed.split(".");
    return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6) || "0");
  }

  async function handleExecute() {
    setLocalError(undefined);
    const payouts: PayoutInput[] = [];
    try {
      for (const r of rows) {
        const amount = parseAmountToUnit(r.amount);
        if (amount <= 0n) continue;
        if (!/^[0-9a-fA-F]{64}$/.test(r.recipient.trim())) {
          throw new Error(
            `Row ${r.id}: recipient identity root must be 64 hex characters (32 bytes).`
          );
        }
        const bytes = new Uint8Array(32);
        const hex = r.recipient.trim().toLowerCase();
        for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        payouts.push({ recipientRoot: bytes, amount });
      }
      if (payouts.length === 0) {
        throw new Error("Add at least one recipient with an amount.");
      }
      const assembled = assembleRun(payouts);
      await onExecuteRun(nextRunId, assembled.declaredTotal, assembled.commitmentsRoot, assembled.recipientsRoot, assembled.witnessData);
      setLastProof(
        `Run #${nextRunId} proved: Σ(hidden payouts) = ${formatAmount(assembled.declaredTotal)} · commitments & recipients roots published · ${payouts.length} private amounts stayed hidden.`
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const canExecute = connected && !isBusy && declaredTotal > 0n && !insufficient;

  return (
    <section className="card" aria-label="Payroll run">
      <div className="card-head">
        <h2>Payroll run</h2>
        <span className="pill">run #{nextRunId.toString()}</span>
      </div>
      <p className="muted">
        Enter each recipient's identity root and payout amount. Amounts are <strong>never uploaded</strong> — they are
        sealed into a zero-knowledge proof of correct sum on your device, and only the totals and Merkle roots below
        become public.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Recipient identity root (32-byte hex, private delivery)</th>
            <th>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>
                <input
                  className="input mono"
                  placeholder="e.g. 9a1c… (64 hex chars)"
                  value={r.recipient}
                  onChange={(e) => updateRow(r.id, { recipient: e.target.value })}
                  disabled={!connected || isBusy}
                />
              </td>
              <td>
                <input
                  className="input amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={r.amount}
                  onChange={(e) => updateRow(r.id, { amount: e.target.value })}
                  disabled={!connected || isBusy}
                />
              </td>
              <td>
                {rows.length > 1 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    disabled={!connected || isBusy}
                    aria-label={`Remove row ${r.id}`}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row spread">
        <button
          className="btn"
          onClick={() => setRows((rs) => [...rs, { id: Math.max(...rs.map((x) => x.id)) + 1, recipient: "", amount: "" }])}
          disabled={!connected || isBusy || rows.length >= 8}
        >
          + Add recipient ({rows.length}/8)
        </button>
        <div className="total">
          <span className="muted">Declared total (public):</span>
          <strong>{formatAmount(declaredTotal)}</strong>
        </div>
      </div>

      {insufficient && (
        <p className="error-text">
          Declared total {formatAmount(declaredTotal)} exceeds the pool balance {poolBalance !== undefined ? formatAmount(poolBalance) : "—"} — the circuit will reject this run.
        </p>
      )}

      <div className="row">
        <button className="btn btn-primary" onClick={handleExecute} disabled={!canExecute}>
          {isBusy ? "Proving…" : "Prove & Execute run"}
        </button>
      </div>

      {localError && <p className="error-text">{localError}</p>}
      {lastProof && <p className="ok-text">{lastProof}</p>}

      <hr className="sep" />

      <div className="card-head">
        <h3>Fund the pool</h3>
      </div>
      <p className="muted">
        Deposits are <strong>deliberately public</strong> — the pool is a shared, auditable resource. Only individual
        payouts stay private.
      </p>
      <div className="row">
        <input
          className="input amount"
          inputMode="decimal"
          placeholder="e.g. 10.0"
          value={fundAmount}
          onChange={(e) => setFundAmount(e.target.value)}
          disabled={!connected || isBusy}
        />
        <button
          className="btn"
          disabled={!connected || isBusy || !fundAmount.trim()}
          onClick={async () => {
            try {
              setLocalError(undefined);
              await onFundPool(parseAmountToUnit(fundAmount));
              setFundAmount("");
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Fund pool
        </button>
      </div>
    </section>
  );
}
