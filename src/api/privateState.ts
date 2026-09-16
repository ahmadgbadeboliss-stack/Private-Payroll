// Minimal in-memory private-state provider for the browser session,
// following the official example-bboard implementation. Private state is
// per-contract-address and never leaves the browser tab.
import type {
  PrivateStateProvider,
  ExportPrivateStatesOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ExportSigningKeysOptions,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  SigningKeyExport
} from "@midnight-ntwrk/midnight-js-types";
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export function inMemoryPrivateStateProvider<
  PSI extends string,
  PS = unknown
>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<ContractAddress, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let contractAddress: ContractAddress | null = null;

  const requireAddress = (): ContractAddress => {
    if (contractAddress === null) {
      throw new Error("Contract address not set; cannot access private state.");
    }
    return contractAddress;
  };

  const scope = (address: ContractAddress): Map<PSI, PS> => {
    let s = states.get(address);
    if (!s) {
      s = new Map<PSI, PS>();
      states.set(address, s);
    }
    return s;
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    async set(key: PSI, state: PS): Promise<void> {
      scope(requireAddress()).set(key, state);
    },
    async get(key: PSI): Promise<PS | null> {
      return scope(requireAddress()).get(key) ?? null;
    },
    async remove(key: PSI): Promise<void> {
      scope(requireAddress()).delete(key);
    },
    async clear(): Promise<void> {
      states.delete(requireAddress());
    },
    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(address, signingKey);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return signingKeys.get(address) ?? null;
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address);
    },
    async clearSigningKeys(): Promise<void> {
      signingKeys.clear();
    },
    async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      void _options;
      throw new Error("exportPrivateStates is not supported by the in-memory provider.");
    },
    async importPrivateStates(
      _exportData: PrivateStateExport,
      _options?: ImportPrivateStatesOptions
    ): Promise<ImportPrivateStatesResult> {
      void _exportData;
      void _options;
      throw new Error("importPrivateStates is not supported by the in-memory provider.");
    },
    async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      void _options;
      throw new Error("exportSigningKeys is not supported by the in-memory provider.");
    },
    async importSigningKeys(
      _exportData: SigningKeyExport,
      _options?: ImportSigningKeysOptions
    ): Promise<ImportSigningKeysResult> {
      void _exportData;
      void _options;
      throw new Error("importSigningKeys is not supported by the in-memory provider.");
    }
  };
}
