import { getAddress } from "ethers";

import { logicalDrawKey } from "./automatic-draw-runner-v1-decision.js";
import {
  operationIdFor,
  parameterDigestFor,
  validateJournal,
  type JournalIdentity,
  type JournalOperation,
  type OperationMeaning,
} from "./transaction-journal.js";

export type DrawPreSignerConsumerStatus =
  | "CONSUMER_READY"
  | "INVALID_INTENT"
  | "CONFLICT"
  | "EXISTING_NOT_READY"
  | "MANUAL_REVIEW_REQUIRED"
  | "RECONCILIATION_REQUIRED";

export interface DrawPreSignerConsumerOptions {
  logicalDrawKey: string;
  expectedJournalRevision: number;
  journalIdentity: JournalIdentity;
  expectedMeaning: OperationMeaning;
  readJournal(): Promise<unknown>;
}

export interface DrawPreSignerConsumerResult {
  status: DrawPreSignerConsumerStatus;
  logicalDrawKey: string;
  journalRevision: number | null;
  operation: JournalOperation | null;
  existingIntentRequired: true;
  intentCreated: false;
  executionAuthorized: false;
  nonceAcquired: false;
  transactionPrepared: false;
  transactionSent: false;
  reason: string;
}

function result(
  options: DrawPreSignerConsumerOptions,
  status: DrawPreSignerConsumerStatus,
  reason: string,
  journalRevision: number | null = null,
  operation: JournalOperation | null = null,
): DrawPreSignerConsumerResult {
  return {
    status,
    logicalDrawKey: options.logicalDrawKey,
    journalRevision,
    operation,
    existingIntentRequired: true,
    intentCreated: false,
    executionAuthorized: false,
    nonceAcquired: false,
    transactionPrepared: false,
    transactionSent: false,
    reason,
  };
}

function validateExpectation(options: DrawPreSignerConsumerOptions): {
  operationId: string;
  parameterDigest: string;
} {
  const meaning = options.expectedMeaning;
  if (
    meaning.action !== "draw" ||
    meaning.poolId === undefined ||
    meaning.round === undefined ||
    !Number.isSafeInteger(meaning.round)
  ) {
    throw new Error("Expected intent must describe one exact Draw.");
  }
  const expectedKey = logicalDrawKey({
    chainId: meaning.chainId,
    contractAddress: meaning.contractAddress,
    poolId: meaning.poolId,
    roundNumber: BigInt(meaning.round),
  });
  if (
    options.logicalDrawKey !== expectedKey ||
    meaning.scope !== expectedKey ||
    meaning.chainId !== options.journalIdentity.chainId ||
    getAddress(meaning.contractAddress) !==
      getAddress(options.journalIdentity.contractAddress)
  ) {
    throw new Error("Expected Draw identity is not canonical for this journal.");
  }
  if (
    !Number.isSafeInteger(options.expectedJournalRevision) ||
    options.expectedJournalRevision < 1
  ) {
    throw new Error("Expected journal revision must identify an existing intent.");
  }
  return {
    operationId: operationIdFor(meaning),
    parameterDigest: parameterDigestFor(meaning.parameters),
  };
}

/**
 * Read-only eligibility check for an existing, prepared Draw intent. This does
 * not create, reserve, authorize, or advance any transaction-journal state.
 */
export async function consumePreparedDrawIntent(
  options: DrawPreSignerConsumerOptions,
): Promise<DrawPreSignerConsumerResult> {
  let expected: ReturnType<typeof validateExpectation>;
  try {
    expected = validateExpectation(options);
  } catch {
    return result(
      options,
      "INVALID_INTENT",
      "Expected Draw identity or evidence is invalid.",
    );
  }

  let journal;
  try {
    journal = validateJournal(
      await options.readJournal(),
      options.journalIdentity,
    );
  } catch {
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "The current transaction journal could not be read and validated safely.",
    );
  }
  if (journal.revision !== options.expectedJournalRevision) {
    return result(
      options,
      "CONFLICT",
      "The transaction journal revision changed before consumption.",
      journal.revision,
    );
  }

  const operation = journal.operations.find(
    (candidate) => candidate.operationId === expected.operationId,
  );
  if (!operation) {
    const conflicting = journal.operations.find((candidate) =>
      candidate.action === "draw" &&
      candidate.chainId === options.expectedMeaning.chainId.toString() &&
      candidate.contractAddress === getAddress(options.expectedMeaning.contractAddress) &&
      candidate.poolId === options.expectedMeaning.poolId?.toString() &&
      candidate.round === options.expectedMeaning.round
    );
    return result(
      options,
      conflicting ? "CONFLICT" : "INVALID_INTENT",
      conflicting
        ? "A different journal intent owns this logical Draw."
        : "The required prepared Draw intent does not exist.",
      journal.revision,
      conflicting ?? null,
    );
  }

  if (
    operation.action !== "draw" ||
    operation.scope !== options.logicalDrawKey ||
    operation.walletAddress !== getAddress(options.expectedMeaning.walletAddress) ||
    operation.chainId !== options.expectedMeaning.chainId.toString() ||
    operation.contractAddress !== getAddress(options.expectedMeaning.contractAddress) ||
    operation.poolId !== options.expectedMeaning.poolId?.toString() ||
    operation.round !== options.expectedMeaning.round ||
    operation.parameterDigest !== expected.parameterDigest ||
    operation.idempotencyKey !== expected.operationId
  ) {
    return result(
      options,
      "CONFLICT",
      "The prepared Draw intent no longer matches the expected identity or evidence.",
      journal.revision,
      operation,
    );
  }
  if (operation.status === "requires_manual_review") {
    return result(
      options,
      "MANUAL_REVIEW_REQUIRED",
      "The Draw intent is already marked for manual review.",
      journal.revision,
      operation,
    );
  }
  if (operation.status !== "prepared") {
    return result(
      options,
      "EXISTING_NOT_READY",
      "The Draw intent already progressed beyond the only accepted pre-execution state.",
      journal.revision,
      operation,
    );
  }
  if (
    operation.nonce !== null ||
    operation.transactionHash !== null ||
    operation.receipt !== null ||
    operation.error !== null
  ) {
    return result(
      options,
      "RECONCILIATION_REQUIRED",
      "The prepared Draw intent contains unexpected transaction evidence.",
      journal.revision,
      operation,
    );
  }
  return result(
    options,
    "CONSUMER_READY",
    "The existing prepared Draw intent is the single current POP33-controlled intent eligible for a future final authorization step.",
    journal.revision,
    operation,
  );
}
