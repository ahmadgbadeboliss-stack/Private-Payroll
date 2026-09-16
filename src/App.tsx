import { useMemo } from "react";

import { Layout } from "./components/Layout.js";
import { WalletConnect } from "./components/WalletConnect.js";
import { PayrollRun } from "./components/PayrollRun.js";
import { PayrollLedger } from "./components/PayrollLedger.js";
import { useMidnight } from "./hooks/useMidnight.js";

export default function App() {
  const {
    status,
    displayAddress,
    ledger,
    callState,
    connectAndDeploy,
    connectAndJoin,
    runCall,
    resetError,
    isBusy
  } = useMidnight();

  const connected = status.phase === "connected";

  // Next run id = highest existing id + 1 (ids are unique on-chain).
  const nextRunId = useMemo(() => {
    if (!ledger || ledger.runs.length === 0) return 1n;
    return ledger.runs.reduce((max, r) => (r.id > max ? r.id : max), 0n) + 1n;
  }, [ledger]);

  return (
    <Layout callState={callState} onDismissError={resetError}>
      <WalletConnect
        status={status}
        callState={callState}
        displayAddress={displayAddress}
        isBusy={isBusy}
        onDeploy={() => void connectAndDeploy()}
        onJoin={(addr) => void connectAndJoin(addr)}
      />

      <PayrollRun
        connected={connected}
        isBusy={isBusy}
        poolBalance={ledger?.poolBalance}
        nextRunId={nextRunId}
        onFundPool={async (amount) => {
          await runCall("Funding pool", (api) => api.fundPool(amount));
        }}
        onExecuteRun={async (runId, declaredTotal, commitmentsRoot, recipientsRoot, witnessData) => {
          await runCall("Generating zero-knowledge proof", (api) =>
            api.executeRun(runId, declaredTotal, commitmentsRoot, recipientsRoot, witnessData)
          );
        }}
      />

      <PayrollLedger ledger={ledger} />
    </Layout>
  );
}
