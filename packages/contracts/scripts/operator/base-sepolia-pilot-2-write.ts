import { getAddress } from "ethers";

import type {
  JournalOperation,
  OperationMeaning,
  OperationStatus,
  TransactionJournal,
  TransactionJournalData,
} from "./transaction-journal.js";
import {
  BASE_SEPOLIA_SMOKE_CHAIN_ID,
  BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
  BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  type SmokeRequestedAction,
  type SmokeWriteAction,
} from "../smoke/base-sepolia-smoke.js";

export const PILOT_2_NETWORK_CONFIRMATION = "CONFIRM POP33 BASE SEPOLIA PILOT 2";
export const PILOT_2_FLOW_CONFIRMATION =
  "CONFIRM FAUCET APPROVE JOIN WITHDRAW FOR WALLETS 0 AND 1";
export const PILOT_2_WALLET_INDICES = Object.freeze([0, 1] as const);
export const PILOT_2_POOL_ID = 1n;
export const PILOT_2_ALLOWED_ACTIONS = Object.freeze([
  "faucet",
  "approve",
  "join",
  "withdraw",
] as const satisfies readonly SmokeWriteAction[]);

const ALLOWED_ACTIONS = new Set<string>(PILOT_2_ALLOWED_ACTIONS);

export function assertPilot2WriteAuthorization(
  cliWriteRequested: boolean,
  env: NodeJS.ProcessEnv,
): void {
  if (!cliWriteRequested) {
    throw new Error("Pilot write is disabled: the explicit --write-pilot-2 CLI flag is missing.");
  }
  if (env.POP33_PILOT_2_NETWORK_CONFIRM?.trim() !== PILOT_2_NETWORK_CONFIRMATION) {
    throw new Error(`Pilot write requires exact confirmation: ${PILOT_2_NETWORK_CONFIRMATION}`);
  }
  if (env.POP33_PILOT_2_FLOW_CONFIRM?.trim() !== PILOT_2_FLOW_CONFIRMATION) {
    throw new Error(`Pilot write requires exact confirmation: ${PILOT_2_FLOW_CONFIRMATION}`);
  }
}

export function assertPilot2Action(action: SmokeRequestedAction): asserts action is SmokeWriteAction {
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`Pilot action ${action} is prohibited.`);
  }
}

export function selectPilot2Addresses(addresses: readonly string[]): readonly [string, string] {
  if (addresses.length !== 5) throw new Error("Pilot operator set must contain exactly five wallets.");
  const selected = [getAddress(addresses[0]), getAddress(addresses[1])] as const;
  if (selected[0] === selected[1]) throw new Error("Pilot wallets 0 and 1 must be distinct.");
  return selected;
}

function assertPilotOperation(
  operation: JournalOperation,
  selectedAddresses: readonly string[],
): void {
  assertPilot2Action(operation.action as SmokeRequestedAction);
  if (!selectedAddresses.includes(getAddress(operation.walletAddress))) {
    throw new Error("Pilot journal contains an operation outside wallet indices 0 and 1.");
  }
  if (operation.chainId !== BASE_SEPOLIA_SMOKE_CHAIN_ID.toString()) {
    throw new Error("Pilot journal operation has the wrong chain identity.");
  }
  if (getAddress(operation.contractAddress) !== BASE_SEPOLIA_SMOKE_POP33_ADDRESS) {
    throw new Error("Pilot journal operation has the wrong contract identity.");
  }
  if (!operation.tokenAddress || getAddress(operation.tokenAddress) !== BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS) {
    throw new Error("Pilot journal operation has the wrong token identity.");
  }
  if (operation.poolId !== PILOT_2_POOL_ID.toString()) {
    throw new Error("Pilot journal operation is not bound to pool #1.");
  }
  const expectedScope = operation.action === "withdraw"
    ? /^base-sepolia-smoke-v1:withdraw:pool-1:position-[1-9]\d*$/
    : new RegExp(`^base-sepolia-smoke-v1:${operation.action}:pool-1$`);
  if (!expectedScope.test(operation.scope)) {
    throw new Error("Pilot journal operation has an invalid action scope.");
  }
}

export function assertPilot2JournalScope(
  data: TransactionJournalData,
  selectedAddresses: readonly string[],
): void {
  const selected = selectedAddresses.map(getAddress);
  const seen = new Set<string>();
  for (const operation of data.operations) {
    assertPilotOperation(operation, selected);
    const key = `${getAddress(operation.walletAddress)}:${operation.action}`;
    if (seen.has(key)) throw new Error(`Pilot journal contains duplicate operation ${key}.`);
    seen.add(key);
  }
}

export function assertPilot2SequentialState(
  data: TransactionJournalData,
  selectedAddresses: readonly [string, string],
): void {
  assertPilot2JournalScope(data, selectedAddresses);
  const terminalStop = data.operations.find((operation) =>
    ["failed", "replaced", "cancelled", "requires_manual_review"].includes(operation.status),
  );
  if (terminalStop) {
    throw new Error(
      `Pilot journal operation ${terminalStop.operationId} is ${terminalStop.status}; manual recovery review is required.`,
    );
  }
  const first = data.operations.filter(
    (operation) => getAddress(operation.walletAddress) === getAddress(selectedAddresses[0]),
  );
  const second = data.operations.filter(
    (operation) => getAddress(operation.walletAddress) === getAddress(selectedAddresses[1]),
  );
  if (
    second.length > 0 &&
    (first.length !== PILOT_2_ALLOWED_ACTIONS.length || first.some((operation) => operation.status !== "confirmed"))
  ) {
    throw new Error("Pilot journal contains wallet 1 work before wallet 0 completed and was confirmed.");
  }
}

export class WalletScopedTransactionJournal implements TransactionJournal {
  readonly runId: string;

  constructor(
    private readonly journal: TransactionJournal,
    private readonly walletAddress: string,
    private readonly selectedAddresses: readonly string[],
  ) {
    this.walletAddress = getAddress(walletAddress);
    this.runId = journal.runId;
    assertPilot2JournalScope(journal.snapshot(), selectedAddresses);
  }

  snapshot(): TransactionJournalData {
    assertPilot2JournalScope(this.journal.snapshot(), this.selectedAddresses);
    const data = structuredClone(this.journal.snapshot());
    data.operations = data.operations.filter(
      (operation) => getAddress(operation.walletAddress) === this.walletAddress,
    );
    return data;
  }

  async prepare(meaning: OperationMeaning): Promise<JournalOperation> {
    assertPilot2Action(meaning.action as SmokeRequestedAction);
    if (getAddress(meaning.walletAddress) !== this.walletAddress) {
      throw new Error("Scoped pilot journal refuses an operation for another wallet.");
    }
    if (meaning.chainId !== BASE_SEPOLIA_SMOKE_CHAIN_ID || meaning.poolId !== PILOT_2_POOL_ID) {
      throw new Error("Scoped pilot journal refuses an operation outside Base Sepolia pool #1.");
    }
    if (getAddress(meaning.contractAddress) !== BASE_SEPOLIA_SMOKE_POP33_ADDRESS) {
      throw new Error("Scoped pilot journal refuses a different contract.");
    }
    if (!meaning.tokenAddress || getAddress(meaning.tokenAddress) !== BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS) {
      throw new Error("Scoped pilot journal refuses a different token.");
    }
    return this.journal.prepare(meaning);
  }

  async transition(
    operationId: string,
    status: OperationStatus,
    update?: Partial<Pick<JournalOperation, "nonce" | "transactionHash" | "receipt" | "error">>,
  ): Promise<JournalOperation> {
    const operation = this.journal.find(operationId);
    if (!operation || getAddress(operation.walletAddress) !== this.walletAddress) {
      throw new Error("Scoped pilot journal refuses to transition another wallet operation.");
    }
    return this.journal.transition(operationId, status, update);
  }

  find(operationId: string): JournalOperation | undefined {
    const operation = this.journal.find(operationId);
    return operation && getAddress(operation.walletAddress) === this.walletAddress
      ? operation
      : undefined;
  }
}
