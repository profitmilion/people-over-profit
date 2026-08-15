import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getAddress } from "viem";

import { consumeAutomaticDrawExecutionIntent } from "../scripts/operator/automatic-draw-runner-v1-consumer.js";
import { logicalDrawKey } from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import {
  automaticDrawExecutionMeaning,
  handoffAutomaticDrawExecutionIntent,
} from "../scripts/operator/automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawStoredOperation,
} from "../scripts/operator/automatic-draw-runner-v1-progression.js";
import {
  consumePreparedDrawIntent,
  type DrawPreSignerConsumerOptions,
} from "../scripts/operator/draw-pre-signer-consumer.js";
import {
  JsonTransactionJournal,
  MemoryTransactionJournal,
  type JournalIdentity,
  type LogicalDrawTransactionJournal,
  type OperationMeaning,
} from "../scripts/operator/transaction-journal.js";

const CHAIN_ID = 84_532n;
const CONTRACT = getAddress("0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F");
const TOKEN = getAddress("0xA7FA084b34c888061757d4b5FBb08a7B53fee786");
const OPERATOR = getAddress("0x0000000000000000000000000000000000000042");
const OTHER_OPERATOR = getAddress("0x0000000000000000000000000000000000000043");
const identity: JournalIdentity = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
};
const directories: string[] = [];

function readyOperation(input: {
  revision?: number;
  state?: "PREFLIGHT_READY" | "MANUAL_REVIEW_REQUIRED";
} = {}): AutomaticDrawStoredOperation {
  const key = logicalDrawKey({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    poolId: 5n,
    roundNumber: 3n,
  });
  const state = input.state ?? "PREFLIGHT_READY";
  return validateAutomaticDrawStoredOperation({
    revision: input.revision ?? 2,
    record: {
      schemaVersion: 1,
      logicalDrawKey: key,
      action: "Draw",
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      poolId: "5",
      roundNumber: "3",
      state: "RESERVED",
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-15T10:00:00.000Z",
      sourceBlock: "12345",
      scheduledAt: "1800000000",
      invocationId: "123e4567-e89b-42d3-a456-426614174000",
    },
    progression: state === "PREFLIGHT_READY"
      ? {
          schemaVersion: 1,
          state,
          updatedAt: "2026-08-15T10:01:00.000Z",
          preflight: {
            phase3Status: "READY_FOR_EXECUTION",
            planId: "lifecycle-plan:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            revalidationBlock: "12346",
            publicOperatorAddress: OPERATOR,
            gasEstimate: "100000",
            runtimeGasEstimate: "101000",
            bufferedGasLimit: "126250",
            completedAt: "2026-08-15T10:01:00.000Z",
            dryRunOnly: true,
            transactionAuthorized: false,
            transactionSent: false,
          },
          manualReview: null,
        }
      : {
          schemaVersion: 1,
          state,
          updatedAt: "2026-08-15T10:01:00.000Z",
          preflight: null,
          manualReview: {
            phase3Status: "SAFE_STOP",
            reason: "Review required.",
            recordedAt: "2026-08-15T10:01:00.000Z",
          },
        },
  });
}

function storageFor(
  operation: AutomaticDrawStoredOperation,
): Pick<AutomaticDrawProgressionStorage, "read"> {
  return {
    async read(key) {
      return key === operation.record.logicalDrawKey
        ? { status: "FOUND", operation: structuredClone(operation) }
        : { status: "NOT_FOUND" };
    },
  };
}

async function createPrepared(
  journal: LogicalDrawTransactionJournal = new MemoryTransactionJournal(identity),
  operation = readyOperation(),
) {
  const handoff = await handoffAutomaticDrawExecutionIntent({
    logicalDrawKey: operation.record.logicalDrawKey,
    expectedProgressionRevision: operation.revision,
    progressionStorage: storageFor(operation),
    journal,
  });
  assert.equal(handoff.status, "HANDOFF_READY");
  return { journal, operation, handoff };
}

function consumerOptions(
  journal: LogicalDrawTransactionJournal,
  operation: AutomaticDrawStoredOperation,
  expectedMeaning: OperationMeaning = automaticDrawExecutionMeaning(operation),
): DrawPreSignerConsumerOptions {
  return {
    logicalDrawKey: operation.record.logicalDrawKey,
    expectedJournalRevision: journal.snapshot().revision,
    journalIdentity: identity,
    expectedMeaning,
    async readJournal() {
      return journal.snapshot();
    },
  };
}

function changedMeaning(
  operation: AutomaticDrawStoredOperation,
  change: Partial<OperationMeaning>,
): OperationMeaning {
  return { ...automaticDrawExecutionMeaning(operation), ...change };
}

async function temporaryJournalPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-consumer-"));
  directories.push(directory);
  return join(directory, "transactions.operator-journal.json");
}

describe("shared Draw pre-signer consumer", function () {
  afterEach(async function () {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("1. accepts the exact existing prepared intent", async function () {
    const { journal, operation, handoff } = await createPrepared();
    const outcome = await consumePreparedDrawIntent(consumerOptions(journal, operation));
    assert.equal(outcome.status, "CONSUMER_READY");
    assert.equal(outcome.operation?.operationId, handoff.journalOperation?.operationId);
    assert.equal(outcome.intentCreated, false);
    assert.equal(outcome.executionAuthorized, false);
  });

  it("2. fails closed when the prepared intent is missing", async function () {
    const journal = new MemoryTransactionJournal(identity);
    await journal.prepare({
      action: "join",
      scope: "unrelated-join",
      walletAddress: OPERATOR,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      tokenAddress: TOKEN,
      poolId: 1n,
      parameters: { position: 1 },
    });
    const operation = readyOperation();
    const outcome = await consumePreparedDrawIntent(consumerOptions(journal, operation));
    assert.equal(outcome.status, "INVALID_INTENT");
    assert.equal(journal.snapshot().operations.length, 1);
  });

  it("3. rejects a wrong chain", async function () {
    const { journal, operation } = await createPrepared();
    const meaning = changedMeaning(operation, { chainId: 1n });
    meaning.scope = logicalDrawKey({
      chainId: 1n, contractAddress: CONTRACT, poolId: 5n, roundNumber: 3n,
    });
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation, meaning),
      logicalDrawKey: meaning.scope,
    });
    assert.notEqual(outcome.status, "CONSUMER_READY");
  });

  it("4. rejects a wrong contract", async function () {
    const { journal, operation } = await createPrepared();
    const contractAddress = getAddress("0x0000000000000000000000000000000000000099");
    const meaning = changedMeaning(operation, { contractAddress });
    meaning.scope = logicalDrawKey({
      chainId: CHAIN_ID, contractAddress, poolId: 5n, roundNumber: 3n,
    });
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation, meaning),
      logicalDrawKey: meaning.scope,
    });
    assert.notEqual(outcome.status, "CONSUMER_READY");
  });

  it("5. rejects a wrong pool", async function () {
    const { journal, operation } = await createPrepared();
    const meaning = changedMeaning(operation, { poolId: 6n });
    meaning.scope = logicalDrawKey({
      chainId: CHAIN_ID, contractAddress: CONTRACT, poolId: 6n, roundNumber: 3n,
    });
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation, meaning), logicalDrawKey: meaning.scope,
    });
    assert.equal(outcome.status, "INVALID_INTENT");
  });

  it("6. rejects a wrong round", async function () {
    const { journal, operation } = await createPrepared();
    const meaning = changedMeaning(operation, { round: 4 });
    meaning.scope = logicalDrawKey({
      chainId: CHAIN_ID, contractAddress: CONTRACT, poolId: 5n, roundNumber: 4n,
    });
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation, meaning), logicalDrawKey: meaning.scope,
    });
    assert.equal(outcome.status, "INVALID_INTENT");
  });

  it("7. rejects a non-canonical logical scope", async function () {
    const { journal, operation } = await createPrepared();
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation),
      logicalDrawKey: "pool-5-round-3",
    });
    assert.equal(outcome.status, "INVALID_INTENT");
  });

  it("8. rejects a different operator wallet", async function () {
    const { journal, operation } = await createPrepared();
    const outcome = await consumePreparedDrawIntent(consumerOptions(
      journal,
      operation,
      changedMeaning(operation, { walletAddress: OTHER_OPERATOR }),
    ));
    assert.equal(outcome.status, "CONFLICT");
  });

  it("9. rejects a changed plan or parameter digest", async function () {
    const { journal, operation } = await createPrepared();
    const meaning = automaticDrawExecutionMeaning(operation);
    meaning.parameters = { ...(meaning.parameters as object), planId: "changed-plan" };
    const outcome = await consumePreparedDrawIntent(
      consumerOptions(journal, operation, meaning),
    );
    assert.equal(outcome.status, "CONFLICT");
  });

  it("10. rejects a stale automatic progression revision", async function () {
    const { journal, operation } = await createPrepared();
    const outcome = await consumeAutomaticDrawExecutionIntent({
      logicalDrawKey: operation.record.logicalDrawKey,
      expectedProgressionRevision: operation.revision - 1,
      expectedJournalRevision: journal.snapshot().revision,
      progressionStorage: storageFor(operation),
      journalIdentity: identity,
      async readJournal() { return journal.snapshot(); },
    });
    assert.equal(outcome.status, "CONFLICT");
    assert.equal(journal.snapshot().operations.length, 1);
  });

  it("11. does not restart an intent that progressed beyond prepared", async function () {
    const { journal, operation, handoff } = await createPrepared();
    await journal.transition(
      handoff.journalOperation?.operationId as string,
      "ready_to_broadcast",
      { nonce: 7 },
    );
    const outcome = await consumePreparedDrawIntent(consumerOptions(journal, operation));
    assert.equal(outcome.status, "EXISTING_NOT_READY");
    assert.equal(journal.snapshot().operations.length, 1);
  });

  it("12. finds the same prepared intent after a filesystem restart", async function () {
    const path = await temporaryJournalPath();
    const first = await JsonTransactionJournal.open(path, identity);
    const { operation, handoff } = await createPrepared(first);
    const reopened = await JsonTransactionJournal.openExisting(path, identity);
    const outcome = await consumePreparedDrawIntent(consumerOptions(reopened, operation));
    assert.equal(outcome.status, "CONSUMER_READY");
    assert.equal(outcome.operation?.operationId, handoff.journalOperation?.operationId);
    assert.equal(reopened.snapshot().operations.length, 1);
  });

  it("13. duplicate concurrent reads do not create or mutate operations", async function () {
    const { journal, operation } = await createPrepared();
    const before = journal.snapshot();
    const outcomes = await Promise.all(Array.from({ length: 8 }, () =>
      consumePreparedDrawIntent(consumerOptions(journal, operation))));
    assert.ok(outcomes.every(({ status }) => status === "CONSUMER_READY"));
    assert.deepEqual(journal.snapshot(), before);
  });

  it("14. composes the automatic PREFLIGHT_READY path with the shared consumer", async function () {
    const { journal, operation } = await createPrepared();
    const outcome = await consumeAutomaticDrawExecutionIntent({
      logicalDrawKey: operation.record.logicalDrawKey,
      expectedProgressionRevision: operation.revision,
      expectedJournalRevision: journal.snapshot().revision,
      progressionStorage: storageFor(operation),
      journalIdentity: identity,
      async readJournal() { return journal.snapshot(); },
    });
    assert.equal(outcome.status, "CONSUMER_READY");
    assert.equal(outcome.consumer?.transactionPrepared, false);
  });

  it("15. rejects a changed journal revision", async function () {
    const { journal, operation } = await createPrepared();
    const staleRevision = journal.snapshot().revision;
    await journal.prepare({
      action: "join",
      scope: "later-join",
      walletAddress: OPERATOR,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      tokenAddress: TOKEN,
      poolId: 2n,
      parameters: { position: 2 },
    });
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation),
      expectedJournalRevision: staleRevision,
    });
    assert.equal(outcome.status, "CONFLICT");
  });

  it("16. fails closed for every mutated journal identity field", async function () {
    const { journal, operation } = await createPrepared();
    const mutations = [
      (raw: ReturnType<typeof journal.snapshot>) => { raw.operations[0].action = "join"; },
      (raw: ReturnType<typeof journal.snapshot>) => { raw.operations[0].scope = "mutated-scope"; },
      (raw: ReturnType<typeof journal.snapshot>) => { raw.operations[0].walletAddress = OTHER_OPERATOR; },
      (raw: ReturnType<typeof journal.snapshot>) => { raw.operations[0].poolId = "6"; },
      (raw: ReturnType<typeof journal.snapshot>) => { raw.operations[0].round = 4; },
      (raw: ReturnType<typeof journal.snapshot>) => {
        raw.operations[0].parameterDigest =
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      },
      (raw: ReturnType<typeof journal.snapshot>) => { raw.operations = []; },
    ];
    for (const mutate of mutations) {
      const raw = journal.snapshot();
      mutate(raw);
      const outcome = await consumePreparedDrawIntent({
        ...consumerOptions(journal, operation),
        async readJournal() { return raw; },
      });
      assert.notEqual(outcome.status, "CONSUMER_READY");
    }
  });

  it("17. fails closed when the current journal outcome is unknown", async function () {
    const { journal, operation } = await createPrepared();
    const outcome = await consumePreparedDrawIntent({
      ...consumerOptions(journal, operation),
      async readJournal() { throw new Error("unknown read outcome"); },
    });
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
  });

  it("18. contains no credential, nonce, transaction, or receipt capability", async function () {
    const sources = await Promise.all([
      "scripts/operator/draw-pre-signer-consumer.ts",
      "scripts/operator/automatic-draw-runner-v1-consumer.ts",
    ].map((path) => readFile(resolve(path), "utf8")));
    for (const forbidden of [
      "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY",
      "privateKeyToAccount",
      "createWalletClient",
      "loadExecutionClient",
      "writeContract",
      "sendTransaction",
      "wallet.writeContract",
      "getTransactionCount",
      "signTransaction",
      "waitForTransactionReceipt",
    ]) {
      assert.ok(sources.every((source) => !source.includes(forbidden)), forbidden);
    }
  });
});
