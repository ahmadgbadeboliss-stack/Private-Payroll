// Barrel export for the contract package: the generated bindings, the
// private-state witnesses, and the compiled-contract wrapper that
// Midnight.js needs for deploy / join.
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

export * from "./managed/payroll/contract/index.js";
export * from "./witnesses";

import * as CompiledPayrollContract from "./managed/payroll/contract/index.js";
import * as WitnessModule from "./witnesses";

export const CompiledPayroll = CompiledContract.make<CompiledPayrollContract.Contract<WitnessModule.PayrollPrivateState>>(
  "payroll",
  CompiledPayrollContract.Contract<WitnessModule.PayrollPrivateState>
).pipe(
  CompiledContract.withWitnesses(WitnessModule.witnesses),
  CompiledContract.withCompiledFileAssets("./managed/payroll")
);
