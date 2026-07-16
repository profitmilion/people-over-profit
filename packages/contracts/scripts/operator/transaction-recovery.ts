import type {
  JournalOperation,
  JournalReceiptSummary,
  OperationMeaning,
  TransactionJournal,
} from "./transaction-journal.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export interface RecoveryTransaction {
  hash: string;
  from: string;
  to: string | null;
  nonce: number;
  data: string;
  value: bigint;
}

export interface RecoveryReceipt {
  hash: string;
  blockNumber: number;
  status: number | null;
  gasUsed?: bigint;
}

export interface TransactionRecoveryProvider {
  getTransaction(hash: string): Promise<RecoveryTransaction | null>;
  getTransactionReceipt(hash: string): Promise<RecoveryReceipt | null>;
  getTransactionCount(address: string, blockTag: "latest" | "pending"): Promise<number>;
  findTransactionBySenderAndNonce?(
    address: string,
    nonce: number,
  ): Promise<RecoveryTransaction | null>;
}

export interface BroadcastResponse {
  hash: string;
  nonce: number;
  wait(): Promise<RecoveryReceipt | null>;
}

export type CoordinatorFailurePoint =
  | "after_prepared"
  | "after_ready"
  | "after_broadcast_recorded"
  | "after_pending"
  | "after_receipt";

function receiptSummary(receipt: RecoveryReceipt): JournalReceiptSummary {
  return {
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status === 1 ? 1 : 0,
    gasUsed: (receipt.gasUsed ?? 0n).toString(),
  };
}

function isCancellation(transaction: RecoveryTransaction, walletAddress: string): boolean {
  return (
    transaction.to?.toLowerCase() === walletAddress.toLowerCase() &&
    transaction.from.toLowerCase() === walletAddress.toLowerCase() &&
    transaction.data === "0x" &&
    transaction.value === 0n
  );
}

export async function recoverJournalOperation(
  journal: TransactionJournal,
  operation: JournalOperation,
  provider: TransactionRecoveryProvider,
): Promise<JournalOperation> {
  if (operation.status === "confirmed") {
    if (operation.transactionHash === null || operation.nonce === null || !operation.receipt) {
      throw new Error("Confirmed journal operation is missing transaction evidence.");
    }
    const [transaction, receipt] = await Promise.all([
      provider.getTransaction(operation.transactionHash),
      provider.getTransactionReceipt(operation.transactionHash),
    ]);
    const expectedTarget = operation.action === "faucet" || operation.action === "approve"
      ? operation.tokenAddress
      : operation.contractAddress;
    if (
      !transaction ||
      !receipt ||
      transaction.hash.toLowerCase() !== operation.transactionHash.toLowerCase() ||
      transaction.from.toLowerCase() !== operation.walletAddress.toLowerCase() ||
      transaction.to?.toLowerCase() !== expectedTarget?.toLowerCase() ||
      transaction.nonce !== operation.nonce ||
      receipt.hash.toLowerCase() !== operation.transactionHash.toLowerCase() ||
      receipt.status !== 1 ||
      receipt.blockNumber !== operation.receipt.blockNumber
    ) {
      throw new Error("Confirmed journal operation cannot be verified by the provider.");
    }
    return operation;
  }
  if (["failed", "replaced", "cancelled", "requires_manual_review"].includes(operation.status)) {
    return operation;
  }
  if (operation.status === "prepared") return operation;
  if (operation.status === "ready_to_broadcast") {
    return journal.transition(operation.operationId, "requires_manual_review", {
      error: "Restart found a reserved nonce without a transaction hash; broadcast state is ambiguous.",
    });
  }
  if (operation.nonce === null || operation.transactionHash === null) {
    return journal.transition(operation.operationId, "requires_manual_review", {
      error: "Submitted operation is missing its nonce or transaction hash.",
    });
  }

  const receipt = await provider.getTransactionReceipt(operation.transactionHash);
  if (receipt) {
    const transaction = await provider.getTransaction(operation.transactionHash);
    const expectedTarget = operation.action === "faucet" || operation.action === "approve"
      ? operation.tokenAddress
      : operation.contractAddress;
    if (
      !transaction ||
      transaction.from.toLowerCase() !== operation.walletAddress.toLowerCase() ||
      transaction.to?.toLowerCase() !== expectedTarget?.toLowerCase() ||
      transaction.nonce !== operation.nonce ||
      receipt.hash.toLowerCase() !== operation.transactionHash.toLowerCase()
    ) {
      return journal.transition(operation.operationId, "requires_manual_review", {
        error: "Receipt or transaction identity does not match the journal operation.",
      });
    }
    return journal.transition(
      operation.operationId,
      receipt.status === 1 ? "confirmed" : "failed",
      {
        receipt: receiptSummary(receipt),
        error: receipt.status === 1 ? null : "Transaction receipt reports failure.",
      },
    );
  }

  const transaction = await provider.getTransaction(operation.transactionHash);
  if (transaction) {
    if (operation.status === "broadcast") {
      return journal.transition(operation.operationId, "pending");
    }
    return operation;
  }

  const replacement = await provider.findTransactionBySenderAndNonce?.(
    operation.walletAddress,
    operation.nonce,
  );
  if (replacement && replacement.hash.toLowerCase() !== operation.transactionHash.toLowerCase()) {
    const cancelled = isCancellation(replacement, operation.walletAddress);
    return journal.transition(operation.operationId, cancelled ? "cancelled" : "replaced", {
      error: cancelled
        ? "A same-nonce cancellation transaction was detected."
        : "A different same-nonce replacement transaction was detected.",
    });
  }

  const [latestNonce, pendingNonce] = await Promise.all([
    provider.getTransactionCount(operation.walletAddress, "latest"),
    provider.getTransactionCount(operation.walletAddress, "pending"),
  ]);
  const nonceMessage =
    latestNonce > operation.nonce || pendingNonce > operation.nonce
      ? "Wallet nonce advanced but the recorded transaction is unavailable; replacement or cancellation is possible."
      : "Recorded transaction is unavailable and nonce evidence is inconclusive.";
  return journal.transition(operation.operationId, "requires_manual_review", {
    error: nonceMessage,
  });
}

export async function recoverTransactionJournal(
  journal: TransactionJournal,
  provider: TransactionRecoveryProvider,
): Promise<JournalOperation[]> {
  const recovered: JournalOperation[] = [];
  for (const operation of journal.snapshot().operations) {
    recovered.push(await recoverJournalOperation(journal, operation, provider));
  }
  return recovered;
}

export interface ExecuteJournaledOperationInput {
  journal: TransactionJournal;
  meaning: OperationMeaning;
  getNonce(): Promise<number>;
  broadcast(nonce: number): Promise<BroadcastResponse>;
  failureHook?(point: CoordinatorFailurePoint): Promise<void> | void;
}

export type JournaledExecutionResult =
  | { skipped: true; operation: JournalOperation }
  | { skipped: false; operation: JournalOperation; response: BroadcastResponse; receipt: RecoveryReceipt };

export async function executeJournaledOperation(
  input: ExecuteJournaledOperationInput,
): Promise<JournaledExecutionResult> {
  let operation = await input.journal.prepare(input.meaning);
  await input.failureHook?.("after_prepared");
  if (operation.status === "confirmed") return { skipped: true, operation };
  if (operation.status !== "prepared") {
    throw new Error(`Idempotency guard blocked operation in ${operation.status} state.`);
  }

  const nonce = await input.getNonce();
  operation = await input.journal.transition(operation.operationId, "ready_to_broadcast", { nonce });
  await input.failureHook?.("after_ready");

  let response: BroadcastResponse;
  try {
    response = await input.broadcast(nonce);
  } catch (error) {
    await input.journal.transition(operation.operationId, "requires_manual_review", {
      error: `Broadcast outcome is ambiguous: ${sanitizeOperatorError(error)}`,
    });
    throw new Error("Broadcast outcome is ambiguous; operation requires manual review.");
  }
  if (response.nonce !== nonce) {
    await input.journal.transition(operation.operationId, "requires_manual_review", {
      error: "Provider returned a transaction with a nonce different from the reserved nonce.",
    });
    throw new Error("Transaction nonce mismatch; operation requires manual review.");
  }
  operation = await input.journal.transition(operation.operationId, "broadcast", {
    nonce,
    transactionHash: response.hash,
  });
  await input.failureHook?.("after_broadcast_recorded");
  operation = await input.journal.transition(operation.operationId, "pending");
  await input.failureHook?.("after_pending");

  let receipt: RecoveryReceipt | null;
  try {
    receipt = await response.wait();
  } catch (error) {
    await input.journal.transition(operation.operationId, "requires_manual_review", {
      error: `Receipt wait failed: ${sanitizeOperatorError(error)}`,
    });
    throw new Error("Receipt wait failed; operation requires manual review.");
  }
  if (!receipt) {
    await input.journal.transition(operation.operationId, "requires_manual_review", {
      error: "Provider returned no receipt.",
    });
    throw new Error("Provider returned no receipt; operation requires manual review.");
  }
  await input.failureHook?.("after_receipt");
  operation = await input.journal.transition(
    operation.operationId,
    receipt.status === 1 ? "confirmed" : "failed",
    {
      receipt: receiptSummary(receipt),
      error: receipt.status === 1 ? null : "Transaction receipt reports failure.",
    },
  );
  if (receipt.status !== 1) throw new Error("Transaction failed on-chain.");
  return { skipped: false, operation, response, receipt };
}
