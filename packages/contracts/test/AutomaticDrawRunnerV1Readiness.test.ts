import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getAddress } from "viem";

import {
  authorizeAutomaticDrawExecutionReadiness,
  type AutomaticDrawExecutionReadinessDependencies,
  type AutomaticDrawExecutionReadinessOptions,
} from "../scripts/operator/automatic-draw-runner-v1-readiness.js";
import { logicalDrawKey } from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import { handoffAutomaticDrawExecutionIntent } from "../scripts/operator/automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawProgression,
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawTerminalProgression,
} from "../scripts/operator/automatic-draw-runner-v1-progression.js";
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
const OPERATOR = getAddress("0x0000000000000000000000000000000000000042");
const OTHER_OPERATOR = getAddress("0x0000000000000000000000000000000000000043");
const BLOCK = 12_345n;
const SIMULATION_GAS = 100n;
const RUNTIME_GAS = 120n;
const BUFFERED_GAS = 150n;
const FEE_PER_GAS = 10n;
const L1_UNSIGNED_TRANSACTION_SIZE_BYTES = 128n;
const L1_DATA_FEE_UPPER_BOUND = 200n;
const OPERATOR_FEE_SCALAR = 0n;
const OPERATOR_FEE_CONSTANT = 30n;
const OPERATOR_FEE_UPPER_BOUND = 30n;
const L2_EXECUTION_UPPER_BOUND = BUFFERED_GAS * FEE_PER_GAS;
const REQUIRED_NATIVE =
  L2_EXECUTION_UPPER_BOUND +
  L1_DATA_FEE_UPPER_BOUND +
  OPERATOR_FEE_UPPER_BOUND;
const identity: JournalIdentity = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
};
const directories: string[] = [];

interface Controls {
  snapshot: SystemSnapshot;
  snapshotsByBlock: Map<bigint, SystemSnapshot>;
  nativeBalanceWei: bigint;
  boundedFeePerGasWei: bigint;
  l1UnsignedTransactionSizeBytes: bigint;
  l1DataFeeUpperBoundWei: bigint;
  operatorFeeScalar: bigint;
  operatorFeeConstantWei: bigint;
  operatorFeeUpperBoundWei: bigint;
  balanceBlock: bigint;
  feeBlock: bigint;
  latestBlocks: bigint[];
  failBalance: boolean;
  failFees: boolean;
  failL1Fee: boolean;
  failOperatorFee: boolean;
  failSimulation: boolean;
  failEstimate: boolean;
  loaderCalls: number;
  auditWrites: number;
}

interface Fixture {
  options: AutomaticDrawExecutionReadinessOptions;
  controls: Controls;
  statePath: string;
  journalPath: string;
  journalOperationId: string;
}

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
    source: "base-sepolia-read-only",
    metadata: {
      network: "Base Sepolia",
      rpcHost: "public-rpc",
      requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
      snapshotComplete: true,
      warnings: [],
    },
  });
}

function dependencies(controls: Controls): AutomaticDrawExecutionReadinessDependencies {
  return {
    async readSnapshot(blockNumber) {
      const snapshot = structuredClone(
        blockNumber === undefined
          ? controls.snapshot
          : controls.snapshotsByBlock.get(blockNumber) ?? controls.snapshot,
      );
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
      return controls.latestBlocks.length > 1
        ? controls.latestBlocks.shift() as bigint
        : controls.latestBlocks[0];
    },
    async simulateDraw() {
      if (controls.failSimulation) throw new Error("simulation unavailable");
      return { result: 7n, gasEstimate: SIMULATION_GAS };
    },
    async estimateDraw() {
      if (controls.failEstimate) throw new Error("estimate unavailable");
      return RUNTIME_GAS;
    },
    async readNativeBalance(input) {
      if (controls.failBalance) throw new Error("balance unavailable");
      return {
        blockNumber: controls.balanceBlock,
        nativeBalanceWei: controls.nativeBalanceWei,
      };
    },
    async readDrawNativeFeeUpperBounds() {
      if (controls.failFees) throw new Error("fees unavailable");
      if (controls.failL1Fee) throw new Error("L1 fee unavailable");
      if (controls.failOperatorFee) throw new Error("operator fee unavailable");
      return {
        blockNumber: controls.feeBlock,
        boundedFeePerGasWei: controls.boundedFeePerGasWei,
        l1UnsignedTransactionSizeBytes:
          controls.l1UnsignedTransactionSizeBytes,
        l1DataFeeUpperBoundWei: controls.l1DataFeeUpperBoundWei,
        operatorFeeScalar: controls.operatorFeeScalar,
        operatorFeeConstantWei: controls.operatorFeeConstantWei,
        operatorFeeUpperBoundWei: controls.operatorFeeUpperBoundWei,
      };
    },
    async loadExecutionClient() {
      controls.loaderCalls += 1;
      throw new Error("readiness must not load an execution client");
    },
    async writeAudit() {
      controls.auditWrites += 1;
    },
  };
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-readiness-"));
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
  const progression = validateAutomaticDrawProgression({
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
  const transition = await store.transitionIfCurrent({
    logicalDrawKey: key,
    expectedRevision: 1,
    expectedState: "RESERVED",
    next: progression,
  });
  assert.equal(transition.status, "UPDATED");
  assert.ok(transition.operation);
  const storedOperation = validateAutomaticDrawStoredOperation(
    transition.operation,
  );
  const journal = await JsonTransactionJournal.open(journalPath, identity);
  const handoff = await handoffAutomaticDrawExecutionIntent({
    logicalDrawKey: key,
    expectedProgressionRevision: storedOperation.revision,
    progressionStorage: store,
    journal,
  });
  assert.equal(handoff.status, "HANDOFF_READY");
  assert.ok(handoff.journalOperation);
  const controls: Controls = {
    snapshot,
    snapshotsByBlock: new Map(),
    nativeBalanceWei: REQUIRED_NATIVE,
    boundedFeePerGasWei: FEE_PER_GAS,
    l1UnsignedTransactionSizeBytes: L1_UNSIGNED_TRANSACTION_SIZE_BYTES,
    l1DataFeeUpperBoundWei: L1_DATA_FEE_UPPER_BOUND,
    operatorFeeScalar: OPERATOR_FEE_SCALAR,
    operatorFeeConstantWei: OPERATOR_FEE_CONSTANT,
    operatorFeeUpperBoundWei: OPERATOR_FEE_UPPER_BOUND,
    balanceBlock: BLOCK,
    feeBlock: BLOCK,
    latestBlocks: [BLOCK],
    failBalance: false,
    failFees: false,
    failL1Fee: false,
    failOperatorFee: false,
    failSimulation: false,
    failEstimate: false,
    loaderCalls: 0,
    auditWrites: 0,
  };
  return {
    controls,
    statePath,
    journalPath,
    journalOperationId: handoff.journalOperation.operationId,
    options: {
      durable: {
        automaticDrawStatePath: statePath,
        transactionJournalPath: journalPath,
        journalIdentity: identity,
        expectedProgressionRevision: storedOperation.revision,
        expectedJournalRevision: journal.snapshot().revision,
        logicalDrawKey: key,
      },
      planJson: serializeLifecycleActionPlan(plan),
      operatorAddress: OPERATOR,
      dependencies: dependencies(controls),
    },
  };
}

describe("Automatic Draw execution readiness authorization", function () {
  afterEach(async function () {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("1. returns READY_TO_LOAD_SIGNER with exact bounded evidence", async function () {
    const ready = await fixture();
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(outcome.readyToLoadSigner, true);
    assert.equal(outcome.evidence.journalOperationId, ready.journalOperationId);
    assert.equal(outcome.evidence.finalRevalidationBlock, BLOCK.toString());
    assert.equal(outcome.evidence.bufferedGasLimit, BUFFERED_GAS.toString());
    assert.equal(
      outcome.evidence.l2ExecutionUpperBoundWei,
      L2_EXECUTION_UPPER_BOUND.toString(),
    );
    assert.equal(
      outcome.evidence.l1DataFeeUpperBoundWei,
      L1_DATA_FEE_UPPER_BOUND.toString(),
    );
    assert.equal(
      outcome.evidence.operatorFeeUpperBoundWei,
      OPERATOR_FEE_UPPER_BOUND.toString(),
    );
    assert.equal(
      outcome.evidence.totalRequiredNativeWei,
      REQUIRED_NATIVE.toString(),
    );
  });

  it("2. rejects insufficient native ETH", async function () {
    const ready = await fixture();
    ready.controls.nativeBalanceWei = REQUIRED_NATIVE - 1n;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "INSUFFICIENT_NATIVE_BALANCE",
    );
  });

  it("3. rejects zero native ETH", async function () {
    const ready = await fixture();
    ready.controls.nativeBalanceWei = 0n;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "INSUFFICIENT_NATIVE_BALANCE",
    );
  });

  it("4. fails closed when the balance read fails", async function () {
    const ready = await fixture();
    ready.controls.failBalance = true;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "READ_FAILED",
    );
  });

  it("5. fails closed when fee data is unavailable", async function () {
    const ready = await fixture();
    ready.controls.failFees = true;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "READ_FAILED",
    );
  });

  it("fails closed when the L1 data-fee upper bound is unavailable", async function () {
    const ready = await fixture();
    ready.controls.failL1Fee = true;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "READ_FAILED",
    );
  });

  it("does not accept a balance that covers only L2 execution", async function () {
    const ready = await fixture();
    ready.controls.nativeBalanceWei = L2_EXECUTION_UPPER_BOUND;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "INSUFFICIENT_NATIVE_BALANCE",
    );
  });

  it("accepts an explicitly proven zero L1 data fee", async function () {
    const ready = await fixture();
    ready.controls.l1DataFeeUpperBoundWei = 0n;
    ready.controls.nativeBalanceWei =
      L2_EXECUTION_UPPER_BOUND + OPERATOR_FEE_UPPER_BOUND;
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(outcome.evidence.l1DataFeeUpperBoundWei, "0");
  });

  it("includes a nonzero configured operator-fee upper bound", async function () {
    const ready = await fixture();
    ready.controls.operatorFeeScalar = 2n;
    ready.controls.operatorFeeConstantWei = 3n;
    ready.controls.operatorFeeUpperBoundWei = 60_003n;
    ready.controls.nativeBalanceWei =
      L2_EXECUTION_UPPER_BOUND + L1_DATA_FEE_UPPER_BOUND + 60_003n;
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(outcome.evidence.operatorFeeScalar, "2");
    assert.equal(outcome.evidence.operatorFeeConstantWei, "3");
    assert.equal(outcome.evidence.operatorFeeUpperBoundWei, "60003");
  });

  it("accepts an explicitly proven zero operator fee", async function () {
    const ready = await fixture();
    ready.controls.operatorFeeConstantWei = 0n;
    ready.controls.operatorFeeUpperBoundWei = 0n;
    ready.controls.nativeBalanceWei =
      L2_EXECUTION_UPPER_BOUND + L1_DATA_FEE_UPPER_BOUND;
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(outcome.evidence.operatorFeeUpperBoundWei, "0");
  });

  it("fails closed when operator-fee configuration cannot be read", async function () {
    const ready = await fixture();
    ready.controls.failOperatorFee = true;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "READ_FAILED",
    );
  });

  it("6. fails closed when runtime gas estimation fails", async function () {
    const ready = await fixture();
    ready.controls.failEstimate = true;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "SAFE_STOP",
    );
  });

  it("7. fails closed when exact simulation fails", async function () {
    const ready = await fixture();
    ready.controls.failSimulation = true;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "SAFE_STOP",
    );
  });

  it("8. safely stops after an external Draw changes lifecycle state", async function () {
    const ready = await fixture();
    const prior = ready.controls.snapshot;
    ready.controls.snapshot = makeSystemFixture([
      makePoolFixture({
        status: "Drawing",
        lockedAt: FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL,
        completedDrawRoundCount: 1n,
      }),
    ], {
      chainId: prior.chainId,
      contractAddress: prior.contractAddress,
      blockNumber: BLOCK,
      observedAt: prior.observedAt,
      source: prior.source,
      metadata: prior.metadata,
    });
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "SAFE_STOP",
    );
  });

  it("9. rejects a stale progression revision", async function () {
    const ready = await fixture();
    ready.options.durable.expectedProgressionRevision -= 1;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "CONFLICT",
    );
  });

  it("10. rejects a stale journal revision", async function () {
    const ready = await fixture();
    ready.options.durable.expectedJournalRevision += 1;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "CONFLICT",
    );
  });

  it("11. rejects a journal intent that is no longer prepared", async function () {
    const ready = await fixture();
    const journal = await JsonTransactionJournal.openExisting(
      ready.journalPath,
      identity,
    );
    await journal.transition(ready.journalOperationId, "ready_to_broadcast", {
      nonce: 7,
    });
    ready.options.durable.expectedJournalRevision = journal.snapshot().revision;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "CONFLICT",
    );
  });

  it("12. rejects the wrong public operator", async function () {
    const ready = await fixture();
    ready.options.operatorAddress = OTHER_OPERATOR;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "CONFLICT",
    );
  });

  it("13. performs bigint-only bounded-cost arithmetic", async function () {
    const ready = await fixture();
    const largeFee = 99_999_999_999_999_999_999n;
    const largeL1Fee = 88_888_888_888_888_888_888n;
    const largeOperatorFee = 77_777_777_777_777_777_777n;
    ready.controls.boundedFeePerGasWei = largeFee;
    ready.controls.l1DataFeeUpperBoundWei = largeL1Fee;
    ready.controls.operatorFeeUpperBoundWei = largeOperatorFee;
    ready.controls.nativeBalanceWei =
      BUFFERED_GAS * largeFee + largeL1Fee + largeOperatorFee;
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(
      outcome.evidence.totalRequiredNativeWei,
      (
        BUFFERED_GAS * largeFee +
        largeL1Fee +
        largeOperatorFee
      ).toString(),
    );
  });

  it("14. accepts balance exactly equal to bounded cost", async function () {
    const ready = await fixture();
    ready.controls.nativeBalanceWei = REQUIRED_NATIVE;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "READY_TO_LOAD_SIGNER",
    );
  });

  it("15. rejects balance below bounded cost by one wei", async function () {
    const ready = await fixture();
    ready.controls.nativeBalanceWei = REQUIRED_NATIVE - 1n;
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "INSUFFICIENT_NATIVE_BALANCE");
    assert.equal(outcome.evidence.nativeBalanceWei, (REQUIRED_NATIVE - 1n).toString());
  });

  it("16-17. leaves journal and progression byte-for-byte unchanged", async function () {
    const ready = await fixture();
    const stateBefore = await readFile(ready.statePath);
    const journalBefore = await readFile(ready.journalPath);
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.deepEqual(await readFile(ready.statePath), stateBefore);
    assert.deepEqual(await readFile(ready.journalPath), journalBefore);
  });

  it("18-22. never loads or reports execution capabilities", async function () {
    const ready = await fixture();
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(ready.controls.loaderCalls, 0);
    assert.equal(ready.controls.auditWrites, 0);
    assert.equal(outcome.signerLoaded, false);
    assert.equal(outcome.nonceAcquired, false);
    assert.equal(outcome.transactionPrepared, false);
    assert.equal(outcome.broadcastAuthorized, false);
    assert.equal(outcome.transactionSent, false);
  });

  it("fails closed when balance and fee evidence are not block-bound", async function () {
    const ready = await fixture();
    ready.controls.feeBlock = BLOCK + 1n;
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "READ_FAILED",
    );
  });

  it("allows block advancement when the relevant Draw state is unchanged", async function () {
    const ready = await fixture();
    ready.controls.latestBlocks = [BLOCK, BLOCK + 1n];
    ready.controls.feeBlock = BLOCK + 1n;
    ready.controls.balanceBlock = BLOCK + 1n;
    const outcome = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(outcome.status, "READY_TO_LOAD_SIGNER");
    assert.equal(outcome.evidence.revalidationBlock, BLOCK.toString());
    assert.equal(
      outcome.evidence.finalRevalidationBlock,
      (BLOCK + 1n).toString(),
    );
    assert.equal(outcome.evidence.feeBlock, (BLOCK + 1n).toString());
    assert.equal(outcome.evidence.balanceBlock, (BLOCK + 1n).toString());
  });

  it("fails closed when an advancing head invalidates the intended Draw", async function () {
    const ready = await fixture();
    const prior = ready.controls.snapshot;
    ready.controls.latestBlocks = [BLOCK, BLOCK + 1n];
    ready.controls.feeBlock = BLOCK + 1n;
    ready.controls.balanceBlock = BLOCK + 1n;
    ready.controls.snapshotsByBlock.set(BLOCK + 1n, makeSystemFixture([
      makePoolFixture({
        status: "Drawing",
        lockedAt: FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL,
        completedDrawRoundCount: 1n,
      }),
    ], {
      chainId: prior.chainId,
      contractAddress: prior.contractAddress,
      blockNumber: BLOCK + 1n,
      observedAt: prior.observedAt,
      source: prior.source,
      metadata: prior.metadata,
    }));
    assert.equal(
      (await authorizeAutomaticDrawExecutionReadiness(ready.options)).status,
      "SAFE_STOP",
    );
  });

  it("uses the same one-shot policy for a repeated guarded/manual check", async function () {
    const ready = await fixture();
    const automatic = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    const manual = await authorizeAutomaticDrawExecutionReadiness(ready.options);
    assert.equal(automatic.status, "READY_TO_LOAD_SIGNER");
    assert.equal(manual.status, "READY_TO_LOAD_SIGNER");
    assert.equal(
      automatic.evidence.journalOperationId,
      manual.evidence.journalOperationId,
    );
  });

  it("contains no private-key, signer, nonce, transaction, or receipt capability", async function () {
    const source = await readFile(resolve(
      "scripts/operator/automatic-draw-runner-v1-readiness.ts",
    ), "utf8");
    for (const forbidden of [
      "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY",
      "privateKeyToAccount",
      "createWalletClient",
      "loadExecutionClient",
      "getTransactionCount",
      "prepareTransactionRequest",
      "signTransaction",
      "writeContract",
      "sendTransaction",
      "waitForTransactionReceipt",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
