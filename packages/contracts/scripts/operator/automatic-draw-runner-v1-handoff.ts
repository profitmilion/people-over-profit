import {
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawStoredOperation,
} from "./automatic-draw-runner-v1-progression.js";
import type {
  JournalOperation,
  LogicalDrawTransactionJournal,
  OperationMeaning,
} from "./transaction-journal.js";

export type AutomaticDrawExecutionHandoffStatus =
  | "HANDOFF_READY"
  | "EXISTING"
  | "CONFLICT"
  | "RECONCILIATION_REQUIRED";

export interface AutomaticDrawExecutionHandoffOptions {
  logicalDrawKey: string;
  expectedProgressionRevision: number;
  progressionStorage: Pick<AutomaticDrawProgressionStorage, "read">;
  journal: LogicalDrawTransactionJournal;
}

export interface AutomaticDrawExecutionHandoffResult {
  status: AutomaticDrawExecutionHandoffStatus;
  logicalDrawKey: string;
  progressionRevision: number;
  journalOperation: JournalOperation | null;
  journalIntentClaimed: boolean;
  nonceAcquired: false;
  transactionPreparedForBroadcast: false;
  transactionAuthorized: false;
  transactionSent: false;
  reason: string;
}

function result(
  options: AutomaticDrawExecutionHandoffOptions,
  status: AutomaticDrawExecutionHandoffStatus,
  reason: string,
  journalOperation: JournalOperation | null = null,
): AutomaticDrawExecutionHandoffResult {
  return {
    status,
    logicalDrawKey: options.logicalDrawKey,
    progressionRevision: options.expectedProgressionRevision,
    journalOperation,
    journalIntentClaimed: status === "HANDOFF_READY" || status === "EXISTING",
    nonceAcquired: false,
    transactionPreparedForBroadcast: false,
    transactionAuthorized: false,
    transactionSent: false,
    reason,
  };
}

export function automaticDrawExecutionMeaning(
  operation: AutomaticDrawStoredOperation,
): OperationMeaning {
  if (operation.progression.state !== "PREFLIGHT_READY") {
    throw new Error("Automatic Draw handoff requires PREFLIGHT_READY progression.");
  }
  const { record, progression, revision } = operation;
  const round = Number(BigInt(record.roundNumber));
  if (!Number.isSafeInteger(round)) {
    throw new Error("Automatic Draw round is outside the journal's safe integer range.");
  }
  return {
    action: "draw",
    scope: record.logicalDrawKey,
    walletAddress: progression.preflight.publicOperatorAddress,
    chainId: BigInt(record.chainId),
    contractAddress: record.contractAddress,
    poolId: BigInt(record.poolId),
    round,
    parameters: {
      version: 1,
      functionName: "executeDraw",
      args: [record.poolId, record.roundNumber],
      logicalDrawKey: record.logicalDrawKey,
      progressionRevision: revision,
      planId: progression.preflight.planId,
      revalidationBlock: progression.preflight.revalidationBlock,
      gasEstimate: progression.preflight.gasEstimate,
      runtimeGasEstimate: progression.preflight.runtimeGasEstimate,
      bufferedGasLimit: progression.preflight.bufferedGasLimit,
      preflightCompletedAt: progression.preflight.completedAt,
      dryRunOnly: true,
      transactionAuthorized: false,
      transactionSent: false,
    },
  };
}

/**
 * Atomically binds one validated PREFLIGHT_READY Draw to the existing journal.
 * The resulting prepared journal operation is an intent only: no signer, nonce,
 * transaction preparation, broadcast, or receipt work occurs here.
 */
export async function handoffAutomaticDrawExecutionIntent(
  options: AutomaticDrawExecutionHandoffOptions,
): Promise<AutomaticDrawExecutionHandoffResult> {
  let read;
  try {
    read = await options.progressionStorage.read(options.logicalDrawKey);
  } catch {
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "Automatic Draw progression could not be read safely.",
    );
  }
  if (read.status === "UNKNOWN") {
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "Automatic Draw progression outcome is unknown; reconcile before execution.",
    );
  }
  if (read.status === "NOT_FOUND") {
    return result(
      options,
      "CONFLICT",
      "The expected Automatic Draw progression does not exist.",
    );
  }

  let operation: AutomaticDrawStoredOperation;
  try {
    operation = validateAutomaticDrawStoredOperation(read.operation);
  } catch {
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "Automatic Draw progression evidence is invalid or incomplete.",
    );
  }
  if (
    operation.record.logicalDrawKey !== options.logicalDrawKey ||
    operation.revision !== options.expectedProgressionRevision ||
    operation.progression.state !== "PREFLIGHT_READY"
  ) {
    return result(
      options,
      "CONFLICT",
      "Automatic Draw progression identity, revision, or state changed before handoff.",
    );
  }

  try {
    const claim = await options.journal.claimPreparedDraw(
      automaticDrawExecutionMeaning(operation),
    );
    if (claim.status === "CLAIMED") {
      return result(
        options,
        "HANDOFF_READY",
        "One prepared journal intent was durably claimed; execution remains unauthorized.",
        claim.operation,
      );
    }
    if (claim.status === "EXISTING") {
      return result(
        options,
        "EXISTING",
        "This logical Draw already has a journal intent; no second intent was created.",
        claim.operation,
      );
    }
    if (claim.status === "CONFLICT") {
      return result(
        options,
        "CONFLICT",
        "The logical Draw or journal revision conflicts with the requested handoff.",
        claim.operation,
      );
    }
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "The journal could not prove whether the logical Draw intent was claimed.",
    );
  } catch {
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "The logical Draw journal handoff failed validation or could not be completed safely.",
    );
  }
}
