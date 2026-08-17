import { getAddress } from "ethers";

import {
  consumeAutomaticDrawExecutionIntent,
  type AutomaticDrawConsumerResult,
} from "./automatic-draw-runner-v1-consumer.js";
import { automaticDrawExecutionMeaning } from "./automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionReadResult,
  type AutomaticDrawStoredOperation,
} from "./automatic-draw-runner-v1-progression.js";
import {
  inspectAutomaticDrawReservationState,
} from "./automatic-draw-runner-v1-state.js";
import {
  consumePreparedDrawIntent,
  type DrawPreSignerConsumerResult,
  type DrawPreSignerConsumerStatus,
} from "./draw-pre-signer-consumer.js";
import type { GuardedDrawPreparedIntentContext } from "./guarded-single-draw.js";
import {
  inspectExistingTransactionJournal,
  readJournalPathFromEnvironment,
  type JournalIdentity,
} from "./transaction-journal.js";

const STATE_PATH_ENV = "POP33_INTERNAL_AUTOMATIC_DRAW_STATE_PATH";
const PROGRESSION_REVISION_ENV =
  "POP33_INTERNAL_AUTOMATIC_DRAW_PROGRESSION_REVISION";
const JOURNAL_REVISION_ENV = "POP33_INTERNAL_AUTOMATIC_DRAW_JOURNAL_REVISION";

export interface AutomaticDrawDurableRuntimeConfig {
  automaticDrawStatePath: string;
  transactionJournalPath: string;
  journalIdentity: JournalIdentity;
  expectedProgressionRevision: number;
  expectedJournalRevision: number;
}

export interface AutomaticDrawDurableRuntimeOptions
  extends AutomaticDrawDurableRuntimeConfig {
  logicalDrawKey: string;
}

function requirePositiveRevision(name: string, value: string | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const revision = Number(trimmed);
  if (!Number.isSafeInteger(revision)) {
    throw new Error(`${name} is outside the safe integer range.`);
  }
  return revision;
}

export function readAutomaticDrawDurableRuntimeConfig(
  env: NodeJS.ProcessEnv,
  journalIdentity: JournalIdentity,
): AutomaticDrawDurableRuntimeConfig {
  const automaticDrawStatePath = env[STATE_PATH_ENV]?.trim();
  if (!automaticDrawStatePath) {
    throw new Error(`${STATE_PATH_ENV} is required for guarded Draw execute mode.`);
  }
  return {
    automaticDrawStatePath,
    transactionJournalPath: readJournalPathFromEnvironment(env),
    journalIdentity,
    expectedProgressionRevision: requirePositiveRevision(
      PROGRESSION_REVISION_ENV,
      env[PROGRESSION_REVISION_ENV],
    ),
    expectedJournalRevision: requirePositiveRevision(
      JOURNAL_REVISION_ENV,
      env[JOURNAL_REVISION_ENV],
    ),
  };
}

async function readProgression(
  config: AutomaticDrawDurableRuntimeConfig,
  logicalDrawKey: string,
): Promise<AutomaticDrawProgressionReadResult> {
  try {
    const state = await inspectAutomaticDrawReservationState(
      config.automaticDrawStatePath,
    );
    const operation = state.operations.find(
      ({ record }) => record.logicalDrawKey === logicalDrawKey,
    );
    return operation
      ? { status: "FOUND", operation: structuredClone(operation) }
      : { status: "NOT_FOUND" };
  } catch {
    return { status: "UNKNOWN" };
  }
}

function stopped(
  logicalDrawKey: string,
  status: Exclude<DrawPreSignerConsumerStatus, "CONSUMER_READY">,
  reason: string,
  operation: AutomaticDrawStoredOperation | null = null,
): DrawPreSignerConsumerResult & {
  status: Exclude<DrawPreSignerConsumerStatus, "CONSUMER_READY">;
} {
  return {
    status,
    logicalDrawKey,
    journalRevision: null,
    operation: null,
    existingIntentRequired: true,
    intentCreated: false,
    executionAuthorized: false,
    nonceAcquired: false,
    transactionPrepared: false,
    transactionSent: false,
    reason: operation
      ? `${reason} Durable progression revision ${operation.revision} was not consumed.`
      : reason,
  };
}

async function loadExpectedProgression(
  config: AutomaticDrawDurableRuntimeConfig,
  logicalDrawKey: string,
): Promise<AutomaticDrawStoredOperation | ReturnType<typeof stopped>> {
  const read = await readProgression(config, logicalDrawKey);
  if (read.status === "UNKNOWN") {
    return stopped(
      logicalDrawKey,
      "RECONCILIATION_REQUIRED",
      "Automatic Draw progression could not be read and validated safely.",
    );
  }
  if (read.status === "NOT_FOUND") {
    return stopped(
      logicalDrawKey,
      "INVALID_INTENT",
      "The requested logical Draw does not exist in durable progression.",
    );
  }
  let operation: AutomaticDrawStoredOperation;
  try {
    operation = validateAutomaticDrawStoredOperation(read.operation);
  } catch {
    return stopped(
      logicalDrawKey,
      "RECONCILIATION_REQUIRED",
      "Automatic Draw progression evidence is invalid.",
    );
  }
  if (
    operation.revision !== config.expectedProgressionRevision ||
    operation.progression.state !== "PREFLIGHT_READY"
  ) {
    return stopped(
      logicalDrawKey,
      "CONFLICT",
      "Automatic Draw progression revision or state does not match the runtime checkpoint.",
      operation,
    );
  }
  return operation;
}

function isConsumerResult(
  value: AutomaticDrawStoredOperation | ReturnType<typeof stopped>,
): value is ReturnType<typeof stopped> {
  return "status" in value;
}

export type AutomaticDrawDurableProgressionInspection =
  | {
      status: "READY";
      operation: AutomaticDrawStoredOperation;
      reason: string;
    }
  | {
      status: Exclude<DrawPreSignerConsumerStatus, "CONSUMER_READY">;
      operation: null;
      reason: string;
    };

/** Re-reads one exact progression checkpoint without migrating or writing it. */
export async function inspectAutomaticDrawDurableProgression(
  options: AutomaticDrawDurableRuntimeOptions,
): Promise<AutomaticDrawDurableProgressionInspection> {
  const inspected = await loadExpectedProgression(
    options,
    options.logicalDrawKey,
  );
  return isConsumerResult(inspected)
    ? {
        status: inspected.status,
        operation: null,
        reason: inspected.reason,
      }
    : {
        status: "READY",
        operation: structuredClone(inspected),
        reason: "The exact durable PREFLIGHT_READY progression is current.",
      };
}

/** One-shot automatic composition over the existing durable read paths. */
export async function consumeAutomaticDrawDurableRuntime(
  options: AutomaticDrawDurableRuntimeOptions,
): Promise<AutomaticDrawConsumerResult> {
  return consumeAutomaticDrawExecutionIntent({
    logicalDrawKey: options.logicalDrawKey,
    expectedProgressionRevision: options.expectedProgressionRevision,
    expectedJournalRevision: options.expectedJournalRevision,
    progressionStorage: {
      read: (logicalDrawKey) => readProgression(options, logicalDrawKey),
    },
    journalIdentity: options.journalIdentity,
    readJournal: () => inspectExistingTransactionJournal(
      options.transactionJournalPath,
      options.journalIdentity,
    ),
  });
}

function matchesGuardedContext(
  operation: AutomaticDrawStoredOperation,
  context: GuardedDrawPreparedIntentContext,
): boolean {
  if (operation.progression.state !== "PREFLIGHT_READY") return false;
  const { record, progression } = operation;
  return (
    record.logicalDrawKey === context.logicalDrawKey &&
    record.chainId === context.chainId.toString() &&
    getAddress(record.contractAddress) === context.contractAddress &&
    record.poolId === context.poolId.toString() &&
    record.roundNumber === context.roundNumber.toString() &&
    progression.preflight.publicOperatorAddress === context.operatorAddress &&
    progression.preflight.planId === context.planId &&
    progression.preflight.revalidationBlock === context.revalidationBlock &&
    progression.preflight.gasEstimate === context.gasEstimate.toString() &&
    progression.preflight.runtimeGasEstimate ===
      context.runtimeGasEstimate.toString() &&
    progression.preflight.bufferedGasLimit === context.bufferedGasLimit.toString()
  );
}

/** Read-only guarded-manual adapter for the existing shared consumer seam. */
export function createGuardedDrawDurableRuntimeConsumer(
  config: AutomaticDrawDurableRuntimeConfig,
): (
  context: GuardedDrawPreparedIntentContext,
) => Promise<DrawPreSignerConsumerResult> {
  return async (context) => {
    const progression = await loadExpectedProgression(
      config,
      context.logicalDrawKey,
    );
    if (isConsumerResult(progression)) return progression;
    if (!matchesGuardedContext(progression, context)) {
      return stopped(
        context.logicalDrawKey,
        "CONFLICT",
        "Guarded Draw evidence does not match durable Automatic Draw progression.",
        progression,
      );
    }
    return consumePreparedDrawIntent({
      logicalDrawKey: context.logicalDrawKey,
      expectedJournalRevision: config.expectedJournalRevision,
      journalIdentity: config.journalIdentity,
      expectedMeaning: automaticDrawExecutionMeaning(progression),
      readJournal: () => inspectExistingTransactionJournal(
        config.transactionJournalPath,
        config.journalIdentity,
      ),
    });
  };
}
