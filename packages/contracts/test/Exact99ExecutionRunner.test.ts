import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EXACT_99_COORDINATOR_OPERATIONS,
  EXACT_99_COORDINATOR_RANGES,
  exact99CoordinatorOperationId,
  type Exact99CoordinatorCheckpointId,
  type Exact99CoordinatorOperation,
} from "../scripts/operator/exact-99-accumulation-coordinator.js";
import {
  EXACT_99_FUNDING_PURPOSE,
  buildExact99FundingPlan,
  type Exact99FundingLimits,
  type Exact99FundingPlan,
  type Exact99FundingSignerIdentity,
} from "../scripts/operator/exact-99-funding.js";
import {
  buildInitialExact99ArtifactSet,
  validateExact99Journal,
  type Exact99Checkpoint,
  type Exact99Journal,
} from "../scripts/operator/exact-99-operator-artifacts.js";
import {
  EXACT_99_RUNNER_MODES,
  EXACT_99_RUNNER_OPERATION_ORDER,
  FixtureExact99RunnerAdapter,
  assertExact99RunnerMode,
  inspectExact99ExecutionRunner,
  planExact99ExecutionRunner,
  renderExact99RunnerInspection,
  simulateExact99ExecutionRunner,
  simulateExact99RunnerStep,
  type Exact99RunnerAdapterResult,
  type Exact99RunnerArtifacts,
  type Exact99RunnerIdentity,
  type Exact99RunnerOperationPreflight,
} from "../scripts/operator/exact-99-execution-runner.js";
import type { EncryptedWalletStoreInspection } from "../scripts/operator/encrypted-wallet-store.js";

const CREATED_AT = "2026-07-27T12:00:00.000Z";
const SET_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const STORE_FINGERPRINT = `sha256:${"ab".repeat(32)}`;

function address(index: number): string {
  return `0x${(index + 30_000).toString(16).padStart(40, "0")}`;
}

function store(): EncryptedWalletStoreInspection {
  return {
    formatVersion: 1,
    storeId: STORE_ID,
    walletCount: 99,
    addresses: Array.from({ length: 99 }, (_, index) => address(index)),
    fingerprint: STORE_FINGERPRINT,
  };
}

function artifactSet() {
  return buildInitialExact99ArtifactSet(store(), CREATED_AT, SET_ID);
}

function plan(): Exact99FundingPlan {
  const fixture = artifactSet();
  const limits: Exact99FundingLimits = {
    plannedAmountPerWalletWei: "50000000000000",
    minimumTargetBalanceWei: "50000000000000",
    maximumPerWalletWei: "100000000000000",
    maximumTotalBudgetWei: "10000000000000000",
    signerReserveWei: "1000000000000000",
  };
  const signer: Exact99FundingSignerIdentity = {
    address: address(999),
    chainId: "84532",
    purpose: EXACT_99_FUNDING_PURPOSE,
    maximumBudgetWei: limits.maximumTotalBudgetWei,
    startingBalanceWei: "20000000000000000",
    requiredReserveWei: limits.signerReserveWei,
  };
  return buildExact99FundingPlan({ manifest: fixture.manifest, limits, signer });
}

function artifacts(
  checkpoint = artifactSet().checkpoint,
  journal = artifactSet().journal,
): Exact99RunnerArtifacts {
  const fixture = artifactSet();
  return {
    store: store(),
    manifest: fixture.manifest,
    checkpoint,
    journal,
    fundingPlan: plan(),
  };
}

function hash(identity: Exact99RunnerIdentity): string {
  const ordinal = EXACT_99_COORDINATOR_OPERATIONS.indexOf(identity.operation) + 1;
  return `0x${(identity.walletIndex * 10 + ordinal + 1).toString(16).padStart(64, "0")}`;
}

function poolSnapshot(count: number) {
  return {
    poolId: "1",
    cycleId: "fixture-cycle-1",
    status: "Open" as const,
    activePositionCount: count,
    expectedNextPositionIndex: count + 1,
    locked: false,
    lockedAt: null,
  };
}

function goodResult(
  request: Exact99RunnerIdentity,
  preflight: Exact99RunnerOperationPreflight,
): Exact99RunnerAdapterResult {
  const transactionHash = hash(request);
  const base = {
    identity: structuredClone(request),
    prepared: true,
    submitted: true,
    type: "confirmed" as const,
    transactionHash,
    receipt: {
      transactionHash,
      blockNumber: 10_000 + request.walletIndex * 10 +
        EXACT_99_COORDINATOR_OPERATIONS.indexOf(request.operation),
      status: 1 as const,
      gasUsed: "21000",
    },
  };
  if (request.operation === "funding") {
    return {
      ...base,
      reconciliation: {
        type: "funding",
        walletAddress: request.walletAddress,
        amountWei: "50000000000000",
        nativeBalanceBeforeWei: "0",
        nativeBalanceAfterWei: "50000000000000",
      },
    };
  }
  if (request.operation === "faucet") {
    return {
      ...base,
      reconciliation: {
        type: "faucet",
        walletAddress: request.walletAddress,
        operationId: request.operationId,
        tokenBalanceBefore: "0",
        tokenBalanceAfter: "330000000",
        receivedAmount: "330000000",
      },
    };
  }
  if (request.operation === "approve") {
    return {
      ...base,
      reconciliation: {
        type: "approve",
        walletAddress: request.walletAddress,
        operationId: request.operationId,
        tokenAddress: artifactSet().manifest.tokenAddress,
        spenderAddress: artifactSet().manifest.contractAddress,
        allowance: "33000000",
      },
    };
  }
  const before = preflight.joinPool!;
  return {
    ...base,
    reconciliation: {
      type: "join",
      walletAddress: request.walletAddress,
      operationId: request.operationId,
      poolBefore: structuredClone(before),
      poolAfter: poolSnapshot(before.activePositionCount + 1),
      positionId: before.expectedNextPositionIndex.toString(),
      positionOwner: request.walletAddress,
      positionPoolId: before.poolId,
      activePositionCountForWallet: 1,
      runnerJoinCountBefore: before.activePositionCount,
      runnerJoinCountAfter: before.activePositionCount + 1,
    },
  };
}

function adapter(input?: {
  initialJoinCount?: number;
  changePreflight?: (
    request: Exact99RunnerIdentity,
    preflight: Exact99RunnerOperationPreflight,
  ) => Exact99RunnerOperationPreflight;
  changeResult?: (
    request: Exact99RunnerIdentity,
    preflight: Exact99RunnerOperationPreflight,
    result: Exact99RunnerAdapterResult,
  ) => Exact99RunnerAdapterResult;
}) {
  let joinCount = input?.initialJoinCount ?? 0;
  return new FixtureExact99RunnerAdapter(
    (request) => {
      const preflight: Exact99RunnerOperationPreflight = {
        identity: structuredClone(request),
        ...(request.operation === "join" ? { joinPool: poolSnapshot(joinCount) } : {}),
      };
      return input?.changePreflight?.(request, preflight) ?? preflight;
    },
    (request, preflight) => {
      const result = goodResult(request, preflight);
      const changed = input?.changeResult?.(request, preflight, result) ?? result;
      if (request.operation === "join" && changed.type === "confirmed") joinCount += 1;
      return changed;
    },
  );
}

async function step(input?: {
  checkpoint?: Exact99Checkpoint;
  journal?: Exact99Journal;
  fixtureAdapter?: FixtureExact99RunnerAdapter;
  checkpointId?: Exact99CoordinatorCheckpointId;
  authorizationPhrase?: string;
  requested?: Parameters<typeof simulateExact99RunnerStep>[0]["requested"];
  startedAt?: string;
}) {
  const checkpointId = input?.checkpointId ?? "checkpoint-5";
  const range = EXACT_99_COORDINATOR_RANGES.find((candidate) => candidate.id === checkpointId)!;
  return simulateExact99RunnerStep({
    ...artifacts(input?.checkpoint, input?.journal),
    adapter: input?.fixtureAdapter ?? adapter({
      initialJoinCount: input?.checkpoint?.counters.join ?? 0,
    }),
    checkpointId,
    authorizationPhrase: input?.authorizationPhrase ?? range.authorizationPhrase,
    requested: input?.requested,
    startedAt: input?.startedAt ?? CREATED_AT,
  });
}

async function advanceOperations(count: number) {
  let checkpoint = artifactSet().checkpoint;
  let journal = artifactSet().journal;
  for (let index = 0; index < count; index += 1) {
    const result = await step({
      checkpoint,
      journal,
      fixtureAdapter: adapter({ initialJoinCount: checkpoint.counters.join }),
      startedAt: new Date(Date.parse(CREATED_AT) + index * 10_000).toISOString(),
    });
    assert.equal(result.stopped, false);
    checkpoint = result.checkpoint;
    journal = result.journal;
  }
  return { checkpoint, journal };
}

async function completeCheckpoint(
  checkpointId: Exact99CoordinatorCheckpointId,
  checkpoint: Exact99Checkpoint,
  journal: Exact99Journal,
) {
  const range = EXACT_99_COORDINATOR_RANGES.find((candidate) => candidate.id === checkpointId)!;
  return simulateExact99ExecutionRunner({
    ...artifacts(checkpoint, journal),
    adapter: adapter({ initialJoinCount: checkpoint.counters.join }),
    checkpointId,
    authorizationPhrase: range.authorizationPhrase,
    startedAt: new Date(Date.parse(CREATED_AT) + range.startIndex * 100_000).toISOString(),
  });
}

describe("exact-99 cumulative execution runner core", function () {
  this.timeout(180_000);

  it("exposes only local plan, inspect, and simulate modes", function () {
    assert.deepEqual(EXACT_99_RUNNER_MODES, ["plan", "inspect", "simulate"]);
    for (const mode of EXACT_99_RUNNER_MODES) assert.doesNotThrow(() => assertExact99RunnerMode(mode));
    for (const mode of ["execute", "live", "broadcast", "send", "fund", "base-sepolia"]) {
      assert.throws(() => assertExact99RunnerMode(mode), /plan, inspect, or simulate/);
    }
  });

  it("plans and inspects the first manifest-bound operation without mutation", function () {
    const input = artifacts();
    const beforeCheckpoint = structuredClone(input.checkpoint);
    const beforeJournal = structuredClone(input.journal);
    const planned = planExact99ExecutionRunner(input);
    const inspected = inspectExact99ExecutionRunner(input);
    assert.equal(planned.mode, "plan");
    assert.equal(inspected.mode, "inspect");
    assert.equal(inspected.nextWalletIndex, 0);
    assert.equal(inspected.nextOperation, "funding");
    assert.deepEqual(input.checkpoint, beforeCheckpoint);
    assert.deepEqual(input.journal, beforeJournal);
  });

  it("completes the full 0-4 checkpoint one wallet at a time", async function () {
    const result = await completeCheckpoint(
      "checkpoint-5",
      artifactSet().checkpoint,
      artifactSet().journal,
    );
    assert.equal(result.stopped, false);
    assert.equal(result.completedCheckpoint, "checkpoint-5");
    assert.equal(result.processedOperations, 20);
    assert.equal(result.checkpoint.confirmedWalletCount, 5);
    assert.equal(result.inspection.currentCheckpoint, "checkpoint-20");
  });

  it("enforces funding -> faucet -> approve -> join order", async function () {
    const state = await advanceOperations(4);
    const confirmed = state.journal.entries
      .filter((entry) => entry.status === "confirmed")
      .map((entry) => entry.type);
    assert.deepEqual(confirmed, EXACT_99_RUNNER_OPERATION_ORDER);
  });

  it("rejects approve before faucet", async function () {
    await assert.rejects(
      () => step({ requested: { operation: "approve" } }),
      /first manifest-bound unfinished operation/,
    );
  });

  it("rejects join before approve", async function () {
    await assert.rejects(
      () => step({ requested: { operation: "join" } }),
      /first manifest-bound unfinished operation/,
    );
  });

  it("rejects a wrong wallet address", async function () {
    await assert.rejects(
      () => step({ requested: { walletAddress: address(50) } }),
      /first manifest-bound unfinished operation/,
    );
  });

  it("rejects a wrong wallet index", async function () {
    await assert.rejects(
      () => step({ requested: { walletIndex: 1 } }),
      /first manifest-bound unfinished operation/,
    );
  });

  it("rejects a wrong operation ID", async function () {
    await assert.rejects(
      () => step({ requested: { operationId: "11111111-1111-4111-8111-111111111111" } }),
      /first manifest-bound unfinished operation/,
    );
  });

  it("rejects changing an already recorded transaction hash", async function () {
    const state = await advanceOperations(1);
    const entries = state.journal.entries.map((entry) =>
      entry.status === "confirmed"
        ? { ...entry, transactionHash: `0x${"ff".repeat(32)}` }
        : entry,
    );
    assert.throws(
      () => validateExact99Journal({ ...state.journal, entries }, artifactSet().manifest),
      /transaction hash changed/,
    );
  });

  it("turns a successful receipt without matching semantic state into ambiguous", async function () {
    const bad = adapter({
      changeResult: (request, preflight, result) => {
        if (result.type !== "confirmed" || request.operation !== "funding") return result;
        return {
          ...result,
          reconciliation: {
            type: "funding",
            walletAddress: request.walletAddress,
            amountWei: "1",
            nativeBalanceBeforeWei: "0",
            nativeBalanceAfterWei: "1",
          },
        };
      },
    });
    const result = await step({ fixtureAdapter: bad });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.ambiguous, true);
  });

  it("stops a timeout before a transaction hash for manual review", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "timeout-before-hash",
          identity: request,
          prepared: true,
          submitted: false,
          error: "fixture timeout before hash",
        }),
      }),
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.manualReview, true);
  });

  it("records timeout after a known hash as pending", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "timeout-after-hash",
          identity: request,
          prepared: true,
          submitted: true,
          transactionHash: hash(request),
          error: "fixture receipt timeout",
        }),
      }),
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.pending, true);
  });

  it("stops on pending", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "pending",
          identity: request,
          prepared: true,
          submitted: true,
          transactionHash: hash(request),
          error: "fixture pending",
        }),
      }),
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.pending, true);
  });

  it("stops on ambiguous", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "ambiguous",
          identity: request,
          prepared: true,
          submitted: true,
          transactionHash: hash(request),
          error: "fixture ambiguity",
        }),
      }),
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.ambiguous, true);
  });

  it("stops on failed", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "failed",
          identity: request,
          prepared: true,
          submitted: false,
          error: "fixture failure",
        }),
      }),
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.stage, "manual-review");
  });

  it("stops on manual review", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "manual-review",
          identity: request,
          prepared: true,
          submitted: false,
          error: "fixture manual review",
        }),
      }),
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.manualReview, true);
  });

  for (const [count, next] of [
    [1, "faucet"],
    [2, "approve"],
    [3, "join"],
    [4, "funding"],
  ] as const) {
    it(`restarts safely after ${EXACT_99_COORDINATOR_OPERATIONS[(count - 1) % 4]}`, async function () {
      const state = await advanceOperations(count);
      const report = inspectExact99ExecutionRunner(artifacts(state.checkpoint, state.journal));
      assert.equal(report.nextOperation, next);
      const resumed = await step({
        checkpoint: state.checkpoint,
        journal: state.journal,
        fixtureAdapter: adapter({ initialJoinCount: state.checkpoint.counters.join }),
        startedAt: "2026-07-27T13:00:00.000Z",
      });
      assert.equal(resumed.stopped, false);
      assert.equal(
        resumed.journal.entries.filter((entry) => entry.status === "confirmed").length,
        count + 1,
      );
    });
  }

  it("skips confirmed operations without calling the adapter for them", async function () {
    const state = await advanceOperations(2);
    const fixtureAdapter = adapter({ initialJoinCount: 0 });
    const result = await step({
      checkpoint: state.checkpoint,
      journal: state.journal,
      fixtureAdapter,
      startedAt: "2026-07-27T13:00:00.000Z",
    });
    assert.equal(result.inspection.nextOperation, "join");
    assert.equal(fixtureAdapter.calls.length, 2);
    assert.equal(fixtureAdapter.calls[0].identity.operation, "approve");
  });

  it("skips a completed wallet and starts funding the next wallet", async function () {
    const state = await advanceOperations(4);
    const report = inspectExact99ExecutionRunner(artifacts(state.checkpoint, state.journal));
    assert.equal(report.nextWalletIndex, 1);
    assert.equal(report.nextOperation, "funding");
  });

  it("stops on the first problem and never reaches the next operation or wallet", async function () {
    const fixtureAdapter = adapter({
      changeResult: (request) => ({
        type: "failed",
        identity: request,
        prepared: true,
        submitted: false,
        error: "fixture stop",
      }),
    });
    const result = await simulateExact99ExecutionRunner({
      ...artifacts(),
      adapter: fixtureAdapter,
      checkpointId: "checkpoint-5",
      authorizationPhrase: EXACT_99_COORDINATOR_RANGES[0].authorizationPhrase,
      startedAt: CREATED_AT,
    });
    assert.equal(result.processedOperations, 1);
    assert.equal(fixtureAdapter.calls.length, 2);
    assert.equal(result.journal.entries.some((entry) => entry.walletIndex === 1), false);
  });

  it("does not enter the next checkpoint without its own authorization", async function () {
    const completed = await completeCheckpoint(
      "checkpoint-5",
      artifactSet().checkpoint,
      artifactSet().journal,
    );
    await assert.rejects(
      () => simulateExact99ExecutionRunner({
        ...artifacts(completed.checkpoint, completed.journal),
        adapter: adapter({ initialJoinCount: 5 }),
        checkpointId: "checkpoint-20",
        authorizationPhrase: EXACT_99_COORDINATOR_RANGES[0].authorizationPhrase,
        startedAt: "2026-07-27T14:00:00.000Z",
      }),
      /authorization phrase/,
    );
  });

  it("rejects an operation outside the authorized range", async function () {
    await assert.rejects(
      () => step({ requested: { walletIndex: 5 } }),
      /first manifest-bound unfinished operation/,
    );
  });

  it("rejects automatic operation identity for index 99", function () {
    assert.throws(
      () => exact99CoordinatorOperationId({
        manifest: artifactSet().manifest,
        fundingPlan: plan(),
        walletIndex: 99,
        operation: "join",
      }),
      /between 0 and 98/,
    );
  });

  it("stops when the pre-join position count changed unexpectedly", async function () {
    const state = await advanceOperations(3);
    const result = await step({
      checkpoint: state.checkpoint,
      journal: state.journal,
      fixtureAdapter: adapter({
        initialJoinCount: 0,
        changePreflight: (request, preflight) => request.operation === "join"
          ? { ...preflight, joinPool: poolSnapshot(1) }
          : preflight,
      }),
      startedAt: "2026-07-27T13:00:00.000Z",
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.manualReview, true);
  });

  it("detects an external join between fixture snapshots", async function () {
    const state = await advanceOperations(3);
    const result = await step({
      checkpoint: state.checkpoint,
      journal: state.journal,
      fixtureAdapter: adapter({
        initialJoinCount: 0,
        changeResult: (request, preflight, adapterResult) => {
          if (request.operation !== "join" || adapterResult.type !== "confirmed") return adapterResult;
          const reconciliation = adapterResult.reconciliation;
          assert.equal(reconciliation.type, "join");
          return {
            ...adapterResult,
            reconciliation: {
              ...reconciliation,
              poolAfter: poolSnapshot(preflight.joinPool!.activePositionCount + 2),
            },
          };
        },
      }),
      startedAt: "2026-07-27T13:00:00.000Z",
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.ambiguous, true);
  });

  it("stops when the pool is unexpectedly locked before join", async function () {
    const state = await advanceOperations(3);
    const locked = {
      ...poolSnapshot(0),
      status: "Locked" as const,
      locked: true,
      lockedAt: "2026-07-27T12:59:00.000Z",
    };
    const result = await step({
      checkpoint: state.checkpoint,
      journal: state.journal,
      fixtureAdapter: adapter({
        changePreflight: (request, preflight) => request.operation === "join"
          ? { ...preflight, joinPool: locked }
          : preflight,
      }),
      startedAt: "2026-07-27T13:00:00.000Z",
    });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.manualReview, true);
  });

  it("rejects a wrong adapter address, index, and operation ID", async function () {
    for (const mutate of [
      (identity: Exact99RunnerIdentity) => ({ ...identity, walletAddress: address(50) }),
      (identity: Exact99RunnerIdentity) => ({ ...identity, walletIndex: 50 }),
      (identity: Exact99RunnerIdentity) => ({
        ...identity,
        operationId: "11111111-1111-4111-8111-111111111111",
      }),
    ]) {
      const result = await step({
        fixtureAdapter: adapter({
          changeResult: (_request, _preflight, adapterResult) => ({
            ...adapterResult,
            identity: mutate(adapterResult.identity),
          }),
        }),
      });
      assert.equal(result.stopped, true);
      assert.equal(result.checkpoint.recovery.ambiguous, true);
    }
  });

  it("keeps reports and sanitized adapter failures free of secrets", async function () {
    const result = await step({
      fixtureAdapter: adapter({
        changeResult: (request) => ({
          type: "manual-review",
          identity: request,
          prepared: true,
          submitted: false,
          error: ["private", "Key=fixture-sensitive-marker pass", "word=fixture-sensitive-marker"].join(""),
        }),
      }),
    });
    const rendered = renderExact99RunnerInspection(result.inspection);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(rendered, /fixture-sensitive-marker/);
    assert.doesNotMatch(serialized, /fixture-sensitive-marker/);
  });

  it("contains no provider, signer, key loading, RPC, or transaction transport", async function () {
    const source = await readFile(
      new URL("../scripts/operator/exact-99-execution-runner.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /JsonRpcProvider|BrowserProvider|Wallet\.createRandom|privateKey\s*[:=]|sendTransaction|sendRawTransaction|broadcastTransaction|writeContract|process\.env|fetch\s*\(|axios/i,
    );
    assert.deepEqual(EXACT_99_RUNNER_MODES, ["plan", "inspect", "simulate"]);
  });

  it("completes all ranges through index 98 and stops at awaiting-manual-100", async function () {
    let checkpoint = artifactSet().checkpoint;
    let journal = artifactSet().journal;
    for (const range of EXACT_99_COORDINATOR_RANGES) {
      const result = await completeCheckpoint(range.id, checkpoint, journal);
      assert.equal(result.completedCheckpoint, range.id);
      checkpoint = result.checkpoint;
      journal = result.journal;
    }
    assert.equal(checkpoint.confirmedWalletCount, 99);
    assert.equal(checkpoint.counters.join, 99);
    assert.equal(checkpoint.stage, "awaiting-manual-100");
    const report = inspectExact99ExecutionRunner(artifacts(checkpoint, journal));
    assert.equal(report.completedWalletCount, 99);
    assert.equal(report.nextWalletIndex, null);
    assert.equal(report.nextOperation, null);
    assert.equal(report.coordinator.state, "awaiting-manual-100");
  });
});
