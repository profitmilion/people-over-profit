import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAddress, type Address, type Hex } from "viem";

import {
  executeAutomaticDrawOneShot,
  PILOT_10_APPROVED_OPERATOR,
  type AutomaticDrawOneShotExecutionDependencies,
  type AutomaticDrawOneShotExecutionOptions,
} from "../scripts/operator/automatic-draw-runner-v1-execution.js";
import { logicalDrawKey } from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import { handoffAutomaticDrawExecutionIntent } from "../scripts/operator/automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawProgression,
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawTerminalProgression,
} from "../scripts/operator/automatic-draw-runner-v1-progression.js";
import type { AutomaticDrawExecutionReadinessResult } from "../scripts/operator/automatic-draw-runner-v1-readiness.js";
import { validateAutomaticDrawReservationRecord } from "../scripts/operator/automatic-draw-runner-v1-reservation.js";
import { JsonAutomaticDrawReservationStore } from "../scripts/operator/automatic-draw-runner-v1-state.js";
import {
  createLifecycleActionPlan,
  serializeLifecycleActionPlan,
} from "../scripts/operator/lifecycle-action-plan.js";
import {
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_OBSERVED_AT,
  makePoolFixture,
  makeRoundFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";
import {
  analyzeLifecycleSnapshot,
  type SystemSnapshot,
} from "../scripts/operator/lifecycle-supervisor.js";
import {
  JsonTransactionJournal,
  type JournalIdentity,
} from "../scripts/operator/transaction-journal.js";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_TOKEN_ADDRESS,
} from "../../../src/demo-v1/safety.js";

const CHAIN_ID = BigInt(DEMO_V1_CHAIN_ID);
const CONTRACT = DEMO_V1_CONTRACT_ADDRESS;
const TOKEN = DEMO_V1_TOKEN_ADDRESS;
const OPERATOR = PILOT_10_APPROVED_OPERATOR;
const OTHER_OPERATOR = getAddress(
  "0x0000000000000000000000000000000000000043",
);
const BLOCK = 12_345n;
const RECEIPT_BLOCK = 12_346n;
const SIMULATION_GAS = 100n;
const RUNTIME_GAS = 120n;
const BUFFERED_GAS = 150n;
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const identity: JournalIdentity = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
};
const COORDINATOR_ACCEPTS_ALTERNATE_JOURNAL:
  "journal" extends keyof AutomaticDrawOneShotExecutionOptions ? true : false =
    false;
const directories: string[] = [];

function dueSnapshot(): SystemSnapshot {
  return makeSystemFixture([
    makePoolFixture({
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL,
    }),
  ], {
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    blockNumber: BLOCK,
    source: "mocked-base-sepolia-read-only",
    metadata: {
      network: "Base Sepolia",
      rpcHost: "mocked-rpc",
      requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
      snapshotComplete: true,
      warnings: [],
    },
  });
}

function completedSnapshot(): SystemSnapshot {
  const observedAt = FIXTURE_OBSERVED_AT + 1n;
  const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL;
  const rounds = Array.from({ length: 10 }, (_, index) =>
    makeRoundFixture({
      number: BigInt(index + 1),
      lockedAt,
      observedAt,
      finalized: index === 0,
    }));
  return makeSystemFixture([
    makePoolFixture({
      status: "Drawing",
      lockedAt,
      observedAt,
      completedDrawRoundCount: 1n,
      rounds,
    }),
  ], {
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    blockNumber: RECEIPT_BLOCK,
    observedAt,
    source: "mocked-base-sepolia-read-only",
    metadata: {
      network: "Base Sepolia",
      rpcHost: "mocked-rpc",
      requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
      snapshotComplete: true,
      warnings: [],
    },
  });
}

interface Controls {
  loaderCalls: number;
  nonceReads: Array<"latest" | "pending">;
  prepareCalls: number;
  broadcastCalls: number;
  receiptWaits: number;
  semanticPostReads: number;
  preparedNonces: Array<number | undefined>;
  preparedArgs: Array<readonly [bigint, bigint]>;
  events: string[];
  latestNonce: number;
  pendingNonce: number;
  derivedAddress: Address;
  broadcastError: boolean;
  receiptError: boolean;
  receiptStatus: "success" | "reverted";
  journalPath: string;
  journalOperationId: string;
}

interface Fixture {
  options: AutomaticDrawOneShotExecutionOptions;
  controls: Controls;
  statePath: string;
  journalPath: string;
  journalOperationId: string;
}

function readiness(
  logicalKey: string,
  operationId: string,
  progressionRevision: number,
  journalRevision: number,
): AutomaticDrawExecutionReadinessResult {
  return {
    status: "READY_TO_LOAD_SIGNER",
    readyToLoadSigner: true,
    signerLoaded: false,
    nonceAcquired: false,
    transactionPrepared: false,
    broadcastAuthorized: false,
    transactionSent: false,
    reason: "Mocked read-only readiness passed.",
    evidence: {
      logicalDrawKey: logicalKey,
      journalOperationId: operationId,
      progressionRevision,
      journalRevision,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      poolId: "1",
      roundNumber: "1",
      operatorAddress: OPERATOR,
      planId: null,
      revalidationBlock: BLOCK.toString(),
      finalRevalidationBlock: BLOCK.toString(),
      simulationSucceeded: true,
      estimatedGas: SIMULATION_GAS.toString(),
      runtimeGasEstimate: RUNTIME_GAS.toString(),
      bufferedGasLimit: BUFFERED_GAS.toString(),
      balanceBlock: BLOCK.toString(),
      nativeBalanceWei: "1000000000000000000",
      feeBlock: BLOCK.toString(),
      boundedFeePerGasWei: "1",
      l2ExecutionUpperBoundWei: BUFFERED_GAS.toString(),
      l1UnsignedTransactionSizeBytes: "128",
      l1DataFeeUpperBoundWei: "1",
      operatorFeeScalar: "0",
      operatorFeeConstantWei: "0",
      operatorFeeUpperBoundWei: "0",
      totalRequiredNativeWei: (BUFFERED_GAS + 1n).toString(),
    },
  };
}

function dependencies(controls: Controls): AutomaticDrawOneShotExecutionDependencies {
  return {
    async readSnapshot(blockNumber) {
      if (blockNumber === RECEIPT_BLOCK) {
        controls.semanticPostReads += 1;
        return completedSnapshot();
      }
      const snapshot = dueSnapshot();
      return blockNumber === undefined
        ? snapshot
        : { ...snapshot, blockNumber };
    },
    async readPublicIdentity() {
      return {
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        hasBytecode: true,
      };
    },
    async getLatestBlockNumber() {
      return BLOCK;
    },
    async simulateDraw() {
      return { result: 7n, gasEstimate: SIMULATION_GAS };
    },
    async estimateDraw() {
      return RUNTIME_GAS;
    },
    async readNativeBalance() {
      return { blockNumber: BLOCK, nativeBalanceWei: 1_000_000n };
    },
    async readDrawNativeFeeUpperBounds() {
      return {
        blockNumber: BLOCK,
        boundedFeePerGasWei: 1n,
        l1UnsignedTransactionSizeBytes: 128n,
        l1DataFeeUpperBoundWei: 1n,
        operatorFeeScalar: 0n,
        operatorFeeConstantWei: 0n,
        operatorFeeUpperBoundWei: 0n,
      };
    },
    async getTransactionCount(_address, blockTag) {
      controls.nonceReads.push(blockTag);
      return blockTag === "latest"
        ? controls.latestNonce
        : controls.pendingNonce;
    },
    async loadExecutionClient() {
      controls.loaderCalls += 1;
      return {
        chainId: CHAIN_ID,
        account: controls.derivedAddress,
        contractAddress: CONTRACT,
        async prepareDraw(input) {
          controls.prepareCalls += 1;
          controls.preparedNonces.push(input.nonce);
          controls.preparedArgs.push(input.args);
          controls.events.push("prepare");
          return {
            gasLimit: input.gasLimit,
            async broadcast() {
              controls.broadcastCalls += 1;
              controls.events.push("broadcast");
              if (controls.broadcastError) {
                throw new Error("mocked ambiguous broadcast failure");
              }
              return TX_HASH;
            },
          };
        },
      };
    },
    async waitForReceipt(transactionHash) {
      controls.receiptWaits += 1;
      const parsed = JSON.parse(await readFile(controls.journalPath, "utf8")) as {
        operations: Array<{
          operationId: string;
          status: string;
          transactionHash: string | null;
        }>;
      };
      const operation = parsed.operations.find(
        (candidate) => candidate.operationId === controls.journalOperationId,
      );
      assert.equal(operation?.status, "pending");
      assert.equal(operation?.transactionHash, TX_HASH);
      controls.events.push("receipt-wait-after-hash-persisted");
      if (controls.receiptError) {
        throw new Error("mocked receipt RPC uncertainty");
      }
      return {
        transactionHash,
        status: controls.receiptStatus,
        blockNumber: RECEIPT_BLOCK,
      };
    },
  };
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-execution-"));
  directories.push(directory);
  const statePath = join(directory, "runner.automatic-draw-state.json");
  const journalPath = join(directory, "transactions.operator-journal.json");
  const snapshot = dueSnapshot();
  const plan = createLifecycleActionPlan(
    snapshot,
    analyzeLifecycleSnapshot(snapshot),
    1n,
    { sourceReference: "base-sepolia" },
  );
  const key = logicalDrawKey({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    poolId: 1n,
    roundNumber: 1n,
  });
  const record = validateAutomaticDrawReservationRecord({
    schemaVersion: 1,
    logicalDrawKey: key,
    action: "Draw",
    chainId: CHAIN_ID.toString(),
    contractAddress: CONTRACT,
    poolId: "1",
    roundNumber: "1",
    state: "RESERVED",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    sourceBlock: BLOCK.toString(),
    scheduledAt: "1800000000",
    invocationId: "123e4567-e89b-42d3-a456-426614174000",
  });
  const store = new JsonAutomaticDrawReservationStore(statePath);
  assert.equal((await store.reserveIfAbsent(record)).status, "CREATED");
  const preflight = validateAutomaticDrawProgression({
    schemaVersion: 1,
    state: "PREFLIGHT_READY",
    updatedAt: "2026-08-15T10:01:00.000Z",
    preflight: {
      phase3Status: "READY_FOR_EXECUTION",
      planId: plan.planId,
      revalidationBlock: BLOCK.toString(),
      publicOperatorAddress: OPERATOR,
      gasEstimate: SIMULATION_GAS.toString(),
      runtimeGasEstimate: RUNTIME_GAS.toString(),
      bufferedGasLimit: BUFFERED_GAS.toString(),
      completedAt: "2026-08-15T10:01:00.000Z",
      dryRunOnly: true,
      transactionAuthorized: false,
      transactionSent: false,
    },
    manualReview: null,
  }) as AutomaticDrawTerminalProgression;
  const transitioned = await store.transitionIfCurrent({
    logicalDrawKey: key,
    expectedRevision: 1,
    expectedState: "RESERVED",
    next: preflight,
  });
  assert.equal(transitioned.status, "UPDATED");
  const stored = validateAutomaticDrawStoredOperation(transitioned.operation);
  const journal = await JsonTransactionJournal.open(journalPath, identity);
  const handoff = await handoffAutomaticDrawExecutionIntent({
    logicalDrawKey: key,
    expectedProgressionRevision: stored.revision,
    progressionStorage: store,
    journal,
  });
  assert.equal(handoff.status, "HANDOFF_READY");
  assert.ok(handoff.journalOperation);
  const controls: Controls = {
    loaderCalls: 0,
    nonceReads: [],
    prepareCalls: 0,
    broadcastCalls: 0,
    receiptWaits: 0,
    semanticPostReads: 0,
    preparedNonces: [],
    preparedArgs: [],
    events: [],
    latestNonce: 7,
    pendingNonce: 7,
    derivedAddress: OPERATOR,
    broadcastError: false,
    receiptError: false,
    receiptStatus: "success",
    journalPath,
    journalOperationId: handoff.journalOperation.operationId,
  };
  const ready = readiness(
    key,
    handoff.journalOperation.operationId,
    stored.revision,
    journal.snapshot().revision,
  );
  ready.evidence.planId = plan.planId;
  return {
    controls,
    statePath,
    journalPath,
    journalOperationId: handoff.journalOperation.operationId,
    options: {
      readiness: ready,
      durable: {
        automaticDrawStatePath: statePath,
        transactionJournalPath: journalPath,
        journalIdentity: identity,
        expectedProgressionRevision: stored.revision,
        expectedJournalRevision: journal.snapshot().revision,
        logicalDrawKey: key,
      },
      planJson: serializeLifecycleActionPlan(plan),
      operatorAddress: OPERATOR,
      dependencies: dependencies(controls),
      now: "2026-08-15T10:02:00.000Z",
    },
  };
}

async function journalOperation(test: Fixture) {
  const journal = await JsonTransactionJournal.openExisting(
    test.journalPath,
    identity,
  );
  const operation = journal.find(test.journalOperationId);
  assert.ok(operation);
  return operation;
}

describe("Automatic Draw V1 one-shot execution", function () {
  afterEach(async function () {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("1. stops before every transaction capability when readiness is not ready", async function () {
    const test = await fixture();
    test.options.readiness = {
      ...test.options.readiness,
      status: "SAFE_STOP",
      readyToLoadSigner: false,
    };
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(test.controls.loaderCalls, 0);
    assert.deepEqual(test.controls.nonceReads, []);
    assert.equal(test.controls.prepareCalls, 0);
    assert.equal(test.controls.broadcastCalls, 0);
  });

  it("2. rejects an unapproved configured operator before signer loading", async function () {
    const test = await fixture();
    test.options.operatorAddress = OTHER_OPERATOR;
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(test.controls.loaderCalls, 0);
  });

  it("3. rejects a signer-derived address mismatch before nonce ownership", async function () {
    const test = await fixture();
    test.controls.derivedAddress = OTHER_OPERATOR;
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(test.controls.loaderCalls, 1);
    assert.deepEqual(test.controls.nonceReads, []);
    assert.equal(test.controls.prepareCalls, 0);
    assert.equal(test.controls.broadcastCalls, 0);
  });

  it("4. fails closed when latest and pending nonces differ", async function () {
    const test = await fixture();
    test.controls.pendingNonce = 8;
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.deepEqual(test.controls.nonceReads.sort(), ["latest", "pending"]);
    assert.equal(test.controls.prepareCalls, 0);
    assert.equal(test.controls.broadcastCalls, 0);
  });

  it("5. claims the exact operation and passes its nonce to existing preparation", async function () {
    const test = await fixture();
    test.options.operatorAddress = OPERATOR.toLowerCase();
    test.options.readiness.evidence.operatorAddress =
      OPERATOR.toLowerCase() as Address;
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "CONFIRMED");
    assert.deepEqual(test.controls.preparedNonces, [7]);
    assert.deepEqual(test.controls.preparedArgs, [[1n, 1n]]);
    const operation = await journalOperation(test);
    assert.equal(operation.nonce, 7);
    assert.equal(operation.status, "confirmed");
  });

  it("6. exposes exactly one broadcast call per invocation", async function () {
    const test = await fixture();
    assert.equal((await executeAutomaticDrawOneShot(test.options)).status, "CONFIRMED");
    assert.equal(test.controls.prepareCalls, 1);
    assert.equal(test.controls.broadcastCalls, 1);
  });

  it("7. treats a pre-hash broadcast error as reconciliation without retry", async function () {
    const test = await fixture();
    test.controls.broadcastError = true;
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(test.controls.broadcastCalls, 1);
    const operation = await journalOperation(test);
    assert.equal(operation.status, "requires_manual_review");
    assert.equal(operation.nonce, 7);
    assert.equal(operation.transactionHash, null);
  });

  it("8. persists the transaction hash before receipt waiting", async function () {
    const test = await fixture();
    assert.equal((await executeAutomaticDrawOneShot(test.options)).status, "CONFIRMED");
    assert.deepEqual(test.controls.events.slice(0, 3), [
      "prepare",
      "broadcast",
      "receipt-wait-after-hash-persisted",
    ]);
  });

  it("9. confirms journal, semantic post-check, and durable progression", async function () {
    const test = await fixture();
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "CONFIRMED");
    assert.equal(outcome.guardedOutcome?.postCheckStatus, "PASSED");
    assert.equal(test.controls.semanticPostReads, 1);
    assert.equal(outcome.progression?.progression.state, "EXECUTION_CONFIRMED");
  });

  it("10. records a reverted receipt and never resends", async function () {
    const test = await fixture();
    test.controls.receiptStatus = "reverted";
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "REVERTED");
    assert.equal(test.controls.broadcastCalls, 1);
    assert.equal((await journalOperation(test)).status, "failed");
    assert.equal(outcome.progression?.progression.state, "MANUAL_REVIEW_REQUIRED");
  });

  it("11. retains a known hash on receipt uncertainty without resend", async function () {
    const test = await fixture();
    test.controls.receiptError = true;
    const outcome = await executeAutomaticDrawOneShot(test.options);
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(test.controls.broadcastCalls, 1);
    const operation = await journalOperation(test);
    assert.equal(operation.status, "requires_manual_review");
    assert.equal(operation.transactionHash, TX_HASH);
  });

  it("12. never rebroadcasts a confirmed journal after progression persistence fails", async function () {
    const test = await fixture();
    const store = new JsonAutomaticDrawReservationStore(test.statePath);
    const failingStorage: AutomaticDrawProgressionStorage = {
      read: (key) => store.read(key),
      transitionIfCurrent: async () => ({ status: "UNKNOWN" }),
    };
    const first = await executeAutomaticDrawOneShot({
      ...test.options,
      progressionStorage: failingStorage,
    });
    assert.equal(first.status, "RECONCILIATION_REQUIRED");
    assert.equal((await journalOperation(test)).status, "confirmed");
    const second = await executeAutomaticDrawOneShot(test.options);
    assert.equal(second.status, "RECONCILIATION_REQUIRED");
    assert.equal(second.journalOperation?.status, "confirmed");
    assert.equal(test.controls.broadcastCalls, 1);
  });

  it("13. permits at most one concurrent owner and one broadcast", async function () {
    const test = await fixture();
    const [left, right] = await Promise.all([
      executeAutomaticDrawOneShot(test.options),
      executeAutomaticDrawOneShot(test.options),
    ]);
    assert.ok([left.status, right.status].includes("CONFIRMED"));
    assert.equal(test.controls.broadcastCalls, 1);
    assert.equal((await journalOperation(test)).status, "confirmed");
  });

  it("14. exposes no alternate transaction-journal injection API", function () {
    assert.equal(COORDINATOR_ACCEPTS_ALTERNATE_JOURNAL, false);
  });
});
