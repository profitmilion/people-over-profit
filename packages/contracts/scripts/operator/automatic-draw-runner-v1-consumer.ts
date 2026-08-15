import { automaticDrawExecutionMeaning } from "./automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionStorage,
} from "./automatic-draw-runner-v1-progression.js";
import {
  consumePreparedDrawIntent,
  type DrawPreSignerConsumerResult,
} from "./draw-pre-signer-consumer.js";
import type { JournalIdentity } from "./transaction-journal.js";

export interface AutomaticDrawConsumerOptions {
  logicalDrawKey: string;
  expectedProgressionRevision: number;
  expectedJournalRevision: number;
  progressionStorage: Pick<AutomaticDrawProgressionStorage, "read">;
  journalIdentity: JournalIdentity;
  readJournal(): Promise<unknown>;
}

export type AutomaticDrawConsumerResult =
  | {
      status: "CONSUMER_READY";
      consumer: DrawPreSignerConsumerResult;
      reason: string;
    }
  | {
      status: "CONFLICT" | "RECONCILIATION_REQUIRED";
      consumer: null;
      reason: string;
    };

/** Validates durable automatic evidence, then delegates to the shared reader. */
export async function consumeAutomaticDrawExecutionIntent(
  options: AutomaticDrawConsumerOptions,
): Promise<AutomaticDrawConsumerResult> {
  let read;
  try {
    read = await options.progressionStorage.read(options.logicalDrawKey);
  } catch {
    return {
      status: "RECONCILIATION_REQUIRED",
      consumer: null,
      reason: "Automatic Draw progression could not be read safely.",
    };
  }
  if (read.status === "UNKNOWN") {
    return {
      status: "RECONCILIATION_REQUIRED",
      consumer: null,
      reason: "Automatic Draw progression outcome is unknown.",
    };
  }
  if (read.status === "NOT_FOUND") {
    return {
      status: "CONFLICT",
      consumer: null,
      reason: "The expected Automatic Draw progression does not exist.",
    };
  }

  let operation;
  try {
    operation = validateAutomaticDrawStoredOperation(read.operation);
  } catch {
    return {
      status: "RECONCILIATION_REQUIRED",
      consumer: null,
      reason: "Automatic Draw progression evidence is invalid.",
    };
  }
  if (
    operation.record.logicalDrawKey !== options.logicalDrawKey ||
    operation.revision !== options.expectedProgressionRevision ||
    operation.progression.state !== "PREFLIGHT_READY"
  ) {
    return {
      status: "CONFLICT",
      consumer: null,
      reason: "Automatic Draw progression identity, revision, or state changed.",
    };
  }

  const consumer = await consumePreparedDrawIntent({
    logicalDrawKey: options.logicalDrawKey,
    expectedJournalRevision: options.expectedJournalRevision,
    journalIdentity: options.journalIdentity,
    expectedMeaning: automaticDrawExecutionMeaning(operation),
    readJournal: options.readJournal,
  });
  return consumer.status === "CONSUMER_READY"
    ? {
        status: "CONSUMER_READY",
        consumer,
        reason: consumer.reason,
      }
    : {
        status: consumer.status === "RECONCILIATION_REQUIRED"
          ? "RECONCILIATION_REQUIRED"
          : "CONFLICT",
        consumer: null,
        reason: consumer.reason,
      };
}
