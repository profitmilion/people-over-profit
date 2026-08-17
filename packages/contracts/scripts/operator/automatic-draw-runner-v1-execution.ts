import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import { automaticDrawExecutionMeaning } from "./automatic-draw-runner-v1-handoff.js";
import {
  createAutomaticDrawExecutionConfirmedProgression,
  createAutomaticDrawExecutionManualReviewProgression,
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawStoredOperation,
  type AutomaticDrawTerminalProgression,
} from "./automatic-draw-runner-v1-progression.js";
import type {
  AutomaticDrawExecutionReadinessDependencies,
  AutomaticDrawExecutionReadinessOptions,
  AutomaticDrawExecutionReadinessResult,
} from "./automatic-draw-runner-v1-readiness.js";
import { createGuardedDrawDurableRuntimeConsumer } from "./automatic-draw-runner-v1-runtime.js";
import { JsonAutomaticDrawReservationStore } from "./automatic-draw-runner-v1-state.js";
import {
  executeGuardedSingleDraw,
  type GuardedDrawExecutionClient,
  type GuardedDrawOneShotTransactionInput,
  type GuardedDrawOneShotTransactionResult,
  type GuardedDrawOutcome,
  type GuardedDrawReceipt,
} from "./guarded-single-draw.js";
import {
  executeJournaledOperation,
  JournaledExecutionOwnershipError,
} from "./transaction-recovery.js";
import {
  JsonTransactionJournal,
  operationIdFor,
  type JournalOperation,
  type LogicalDrawTransactionJournal,
} from "./transaction-journal.js";

export const PILOT_10_APPROVED_OPERATOR = getAddress(
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB",
);

export interface AutomaticDrawOneShotExecutionDependencies
  extends AutomaticDrawExecutionReadinessDependencies {
  loadExecutionClient(
    expectedOperatorAddress: Address,
  ): Promise<GuardedDrawExecutionClient>;
  waitForReceipt(transactionHash: Hex): Promise<GuardedDrawReceipt>;
  getTransactionCount(
    address: Address,
    blockTag: "latest" | "pending",
  ): Promise<number>;
}

export interface AutomaticDrawOneShotExecutionOptions
  extends Omit<AutomaticDrawExecutionReadinessOptions, "dependencies"> {
  readiness: AutomaticDrawExecutionReadinessResult;
  dependencies: AutomaticDrawOneShotExecutionDependencies;
  progressionStorage?: AutomaticDrawProgressionStorage;
  now?: string;
}

export type AutomaticDrawOneShotExecutionStatus =
  | "CONFIRMED"
  | "REVERTED"
  | "RECONCILIATION_REQUIRED";

export interface AutomaticDrawOneShotExecutionResult {
  status: AutomaticDrawOneShotExecutionStatus;
  reason: string;
  journalOperation: JournalOperation | null;
  progression: AutomaticDrawStoredOperation | null;
  guardedOutcome: GuardedDrawOutcome | null;
}

function result(
  status: AutomaticDrawOneShotExecutionStatus,
  reason: string,
  journalOperation: JournalOperation | null = null,
  progression: AutomaticDrawStoredOperation | null = null,
  guardedOutcome: GuardedDrawOutcome | null = null,
): AutomaticDrawOneShotExecutionResult {
  return {
    status,
    reason,
    journalOperation,
    progression,
    guardedOutcome,
  };
}

function guardedReceiptFromJournal(
  operation: JournalOperation,
): GuardedDrawReceipt | null {
  if (!operation.transactionHash || !operation.receipt) return null;
  return {
    transactionHash: operation.transactionHash as Hex,
    status: operation.receipt.status === 1 ? "success" : "reverted",
    blockNumber: BigInt(operation.receipt.blockNumber),
  };
}

async function runJournaledDrawTransaction(
  journal: LogicalDrawTransactionJournal,
  operationId: string,
  meaning: ReturnType<typeof automaticDrawExecutionMeaning>,
  operatorAddress: Address,
  dependencies: AutomaticDrawOneShotExecutionDependencies,
  input: GuardedDrawOneShotTransactionInput,
): Promise<GuardedDrawOneShotTransactionResult> {
  try {
    const executed = await executeJournaledOperation({
      journal,
      meaning,
      async getNonce() {
        const [latest, pending] = await Promise.all([
          dependencies.getTransactionCount(operatorAddress, "latest"),
          dependencies.getTransactionCount(operatorAddress, "pending"),
        ]);
        if (
          !Number.isSafeInteger(latest) ||
          latest < 0 ||
          !Number.isSafeInteger(pending) ||
          pending < 0 ||
          latest !== pending
        ) {
          throw new Error(
            "Operator latest and pending nonces must be equal before one-shot execution.",
          );
        }
        return latest;
      },
      async broadcast(nonce) {
        const prepared = await input.prepare(nonce);
        const hash = await prepared.broadcast();
        return {
          hash,
          nonce,
          async wait() {
            const receipt = await input.waitForReceipt(hash);
            if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
              throw new Error("Receipt transaction hash does not match the broadcast hash.");
            }
            const blockNumber = Number(receipt.blockNumber);
            if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
              throw new Error("Receipt block number is outside the journal's safe range.");
            }
            return {
              hash,
              blockNumber,
              status: receipt.status === "success" ? 1 : 0,
            };
          },
        };
      },
    });
    const operation = executed.operation;
    const receipt = guardedReceiptFromJournal(operation);
    if (!receipt || operation.status !== "confirmed") {
      return {
        status: "RECONCILIATION_REQUIRED",
        transactionHash: operation.transactionHash as Hex | null,
        receipt: null,
        reason:
          "Journaled execution ended without complete confirmed receipt evidence; do not resend.",
      };
    }
    return {
      status: "CONFIRMED",
      transactionHash: receipt.transactionHash,
      receipt,
      reason: executed.skipped
        ? "The exact journal operation was already confirmed; no broadcast occurred."
        : "The exact journal operation was confirmed after one broadcast.",
    };
  } catch (error) {
    if (error instanceof JournaledExecutionOwnershipError) throw error;
    const operation = journal.find(operationId);
    const receipt = operation ? guardedReceiptFromJournal(operation) : null;
    if (operation?.status === "failed" && receipt?.status === "reverted") {
      return {
        status: "REVERTED",
        transactionHash: receipt.transactionHash,
        receipt,
        reason: "The one-shot Draw transaction reverted; no resend is allowed.",
      };
    }
    return {
      status: "RECONCILIATION_REQUIRED",
      transactionHash: operation?.transactionHash as Hex | null ?? null,
      receipt: null,
      reason:
        "The one-shot transaction outcome requires reconciliation; no resend is allowed.",
    };
  }
}

async function transitionExecutionProgression(
  storage: AutomaticDrawProgressionStorage,
  current: AutomaticDrawStoredOperation,
  next: AutomaticDrawTerminalProgression,
): Promise<AutomaticDrawStoredOperation | null> {
  const transition = await storage.transitionIfCurrent({
    logicalDrawKey: current.record.logicalDrawKey,
    expectedRevision: current.revision,
    expectedState: "PREFLIGHT_READY",
    next,
  });
  if (transition.status === "UNKNOWN" || transition.operation === null) {
    return null;
  }
  try {
    return validateAutomaticDrawStoredOperation(transition.operation);
  } catch {
    return null;
  }
}

/**
 * Executes at most one journal-owned Draw after a separately proven read-only
 * READY_TO_LOAD_SIGNER result. This function has no scheduler or resend path.
 */
export async function executeAutomaticDrawOneShot(
  options: AutomaticDrawOneShotExecutionOptions,
): Promise<AutomaticDrawOneShotExecutionResult> {
  if (
    options.readiness.status !== "READY_TO_LOAD_SIGNER" ||
    !options.readiness.readyToLoadSigner
  ) {
    return result(
      "RECONCILIATION_REQUIRED",
      "Automatic Draw execution stopped because readiness did not authorize late signer loading.",
    );
  }
  if (
    !isAddress(options.operatorAddress) ||
    getAddress(options.operatorAddress) !== PILOT_10_APPROVED_OPERATOR ||
    !options.readiness.evidence.operatorAddress ||
    !isAddress(options.readiness.evidence.operatorAddress) ||
    getAddress(options.readiness.evidence.operatorAddress) !==
      PILOT_10_APPROVED_OPERATOR
  ) {
    return result(
      "RECONCILIATION_REQUIRED",
      "The configured public operator is not the approved Pilot 10 operator; signer loading was not attempted.",
    );
  }

  const progressionStorage = options.progressionStorage ??
    new JsonAutomaticDrawReservationStore(
      options.durable.automaticDrawStatePath,
    );
  let stored: AutomaticDrawStoredOperation;
  try {
    const read = await progressionStorage.read(options.durable.logicalDrawKey);
    if (read.status !== "FOUND") {
      return result(
        "RECONCILIATION_REQUIRED",
        "The exact durable Automatic Draw progression could not be loaded.",
      );
    }
    stored = validateAutomaticDrawStoredOperation(read.operation);
  } catch {
    return result(
      "RECONCILIATION_REQUIRED",
      "The exact durable Automatic Draw progression could not be validated.",
    );
  }

  let journal: JsonTransactionJournal;
  try {
    journal = await JsonTransactionJournal.openExisting(
      options.durable.transactionJournalPath,
      options.durable.journalIdentity,
    );
  } catch {
    return result(
      "RECONCILIATION_REQUIRED",
      "The existing transaction journal could not be opened safely.",
      null,
      stored,
    );
  }

  const readinessOperationId = options.readiness.evidence.journalOperationId;
  if (!readinessOperationId) {
    return result(
      "RECONCILIATION_REQUIRED",
      "Readiness evidence does not identify the exact journal operation.",
      null,
      stored,
    );
  }
  const existing = journal.find(readinessOperationId) ?? null;
  if (!journal.claimReadyToBroadcast) {
    return result(
      "RECONCILIATION_REQUIRED",
      "The transaction journal cannot atomically claim one nonce owner.",
      existing,
      stored,
    );
  }
  if (stored.progression.state === "EXECUTION_CONFIRMED") {
    return existing?.status === "confirmed"
      ? result(
          "CONFIRMED",
          "Automatic Draw execution and its transaction journal are already confirmed.",
          existing,
          stored,
        )
      : result(
          "RECONCILIATION_REQUIRED",
          "Confirmed progression does not match confirmed journal evidence.",
          existing,
          stored,
        );
  }
  if (
    stored.revision !== options.durable.expectedProgressionRevision ||
    stored.progression.state !== "PREFLIGHT_READY"
  ) {
    return result(
      "RECONCILIATION_REQUIRED",
      "Automatic Draw progression changed before one-shot execution.",
      existing,
      stored,
    );
  }

  const meaning = automaticDrawExecutionMeaning(stored);
  const expectedOperationId = operationIdFor(meaning);
  if (
    readinessOperationId !== expectedOperationId ||
    !existing ||
    existing.operationId !== expectedOperationId
  ) {
    return result(
      "RECONCILIATION_REQUIRED",
      "Readiness, progression, and journal operation identities do not match.",
      existing,
      stored,
    );
  }
  if (existing.status === "confirmed") {
    return result(
      "RECONCILIATION_REQUIRED",
      "The transaction is confirmed but progression is incomplete; reconcile without broadcasting again.",
      existing,
      stored,
    );
  }
  if (
    existing.status === "failed" ||
    existing.status === "requires_manual_review" ||
    existing.status === "replaced" ||
    existing.status === "cancelled"
  ) {
    let progressed: AutomaticDrawStoredOperation | null;
    try {
      progressed = await transitionExecutionProgression(
        progressionStorage,
        stored,
        createAutomaticDrawExecutionManualReviewProgression(
          stored.progression,
          "The existing one-shot journal outcome requires manual review; no resend is allowed.",
          options.now,
        ),
      );
    } catch {
      progressed = null;
    }
    if (!progressed) {
      return result(
        "RECONCILIATION_REQUIRED",
        "The existing transaction outcome is durable, but progression reconciliation is incomplete.",
        existing,
        stored,
      );
    }
    return result(
      existing.status === "failed" && existing.receipt?.status === 0
        ? "REVERTED"
        : "RECONCILIATION_REQUIRED",
      "The existing transaction outcome was recorded in durable manual-review progression.",
      existing,
      progressed,
    );
  }
  if (existing.status !== "prepared") {
    return result(
      "RECONCILIATION_REQUIRED",
      "The exact journal operation already progressed beyond prepared; do not broadcast again.",
      existing,
      stored,
    );
  }

  let ownershipConflict = false;
  const guardedOutcome = await executeGuardedSingleDraw({
    planJson: options.planJson,
    operatorAddress: PILOT_10_APPROVED_OPERATOR,
    confirmation: {
      chainId: stored.record.chainId,
      contractAddress: stored.record.contractAddress,
      poolId: stored.record.poolId,
      roundNumber: stored.record.roundNumber,
    },
    ...(options.maxPlanAgeSeconds === undefined
      ? {}
      : { maxPlanAgeSeconds: options.maxPlanAgeSeconds }),
  }, {
    ...options.dependencies,
    consumePreparedDrawIntent: createGuardedDrawDurableRuntimeConsumer(
      options.durable,
    ),
    async executeOneDrawTransaction(input) {
      try {
        return await runJournaledDrawTransaction(
          journal,
          expectedOperationId,
          meaning,
          PILOT_10_APPROVED_OPERATOR,
          options.dependencies,
          input,
        );
      } catch (error) {
        if (error instanceof JournaledExecutionOwnershipError) {
          ownershipConflict = true;
          return {
            status: "RECONCILIATION_REQUIRED",
            transactionHash: null,
            receipt: null,
            reason:
              "Another invocation owns this exact Draw operation; this invocation did not broadcast.",
          };
        }
        throw error;
      }
    },
  });

  const finalOperation = journal.find(expectedOperationId) ?? existing;
  if (ownershipConflict) {
    return result(
      "RECONCILIATION_REQUIRED",
      "Another invocation owns this Draw; reconcile its journal outcome without resending.",
      finalOperation,
      stored,
      guardedOutcome,
    );
  }

  const confirmed =
    finalOperation.status === "confirmed" &&
    finalOperation.receipt?.status === 1 &&
    guardedOutcome.transactionHash === finalOperation.transactionHash &&
    guardedOutcome.postCheckStatus === "PASSED";
  const next = confirmed
    ? createAutomaticDrawExecutionConfirmedProgression(
        stored.progression,
        options.now,
      )
    : createAutomaticDrawExecutionManualReviewProgression(
        stored.progression,
        guardedOutcome.message,
        options.now,
      );
  let progressed: AutomaticDrawStoredOperation | null;
  try {
    progressed = await transitionExecutionProgression(
      progressionStorage,
      stored,
      next,
    );
  } catch {
    progressed = null;
  }
  if (!progressed) {
    return result(
      "RECONCILIATION_REQUIRED",
      "Transaction evidence is durable, but the final Automatic Draw progression outcome is unknown.",
      finalOperation,
      stored,
      guardedOutcome,
    );
  }
  if (
    confirmed &&
    progressed.progression.state === "EXECUTION_CONFIRMED"
  ) {
    return result(
      "CONFIRMED",
      "One Automatic Draw transaction and its semantic post-check are durably confirmed.",
      finalOperation,
      progressed,
      guardedOutcome,
    );
  }
  if (
    finalOperation.status === "failed" &&
    finalOperation.receipt?.status === 0 &&
    progressed.progression.state === "MANUAL_REVIEW_REQUIRED"
  ) {
    return result(
      "REVERTED",
      "The one-shot Draw reverted and durable manual-review evidence was recorded.",
      finalOperation,
      progressed,
      guardedOutcome,
    );
  }
  return result(
    "RECONCILIATION_REQUIRED",
    "The one-shot Draw stopped with durable manual-review evidence; no resend is allowed.",
    finalOperation,
    progressed,
    guardedOutcome,
  );
}
