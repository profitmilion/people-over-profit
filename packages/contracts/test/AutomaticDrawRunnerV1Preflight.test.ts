import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getAddress } from "viem";

import {
  runAutomaticDrawReservationCycle,
  type AutomaticDrawAtomicReservationStorage,
  type AutomaticDrawReservationCycleResult,
} from "../scripts/operator/automatic-draw-runner-v1-reservation.js";
import {
  runAutomaticDrawDryRun,
  type AutomaticDrawDryRunDependencies,
} from "../scripts/operator/automatic-draw-runner-v1-preflight.js";
import {
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_OBSERVED_AT,
  makePoolFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";
import {
  type LifecycleSnapshotAdapter,
  type SystemSnapshot,
} from "../scripts/operator/lifecycle-supervisor.js";
import {
  LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
} from "../scripts/operator/lifecycle-supervisor-base-sepolia.js";

const OPERATOR = getAddress("0x0000000000000000000000000000000000000042");

function dueSnapshot(overrides: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return makeSystemFixture([
    makePoolFixture({
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL,
    }),
  ], {
    chainId: 84_532n,
    contractAddress: LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
    source: "base-sepolia-read-only",
    metadata: {
      network: "Base Sepolia",
      rpcHost: "public-rpc",
      requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
      snapshotComplete: true,
      warnings: [],
    },
    ...overrides,
  });
}

function snapshotAdapter(snapshot: SystemSnapshot): LifecycleSnapshotAdapter {
  return {
    source: snapshot.source,
    async readSnapshot() {
      return structuredClone(snapshot);
    },
  };
}

const firstTimeStorage: AutomaticDrawAtomicReservationStorage = {
  async reserveIfAbsent(record) {
    return { status: "CREATED", record };
  },
};

async function reservationFor(
  snapshot: SystemSnapshot,
  storage: AutomaticDrawAtomicReservationStorage = firstTimeStorage,
): Promise<AutomaticDrawReservationCycleResult> {
  return runAutomaticDrawReservationCycle({
    scope: {
      chainId: snapshot.chainId,
      contractAddress: snapshot.contractAddress,
      poolId: 1n,
    },
    adapter: snapshotAdapter(snapshot),
    storage,
    invocationId: "123e4567-e89b-42d3-a456-426614174000",
  });
}

interface Counters {
  reads: number;
  identities: number;
  simulations: number;
  estimates: number;
  simulatedArgs: Array<readonly [bigint, bigint]>;
}

function dependencies(input: {
  source?: SystemSnapshot;
  fresh?: SystemSnapshot;
  latest?: SystemSnapshot;
  latestBlock?: bigint;
  simulationError?: Error;
  estimateError?: Error;
  simulationGasEstimate?: bigint | null;
  runtimeGasEstimate?: bigint;
  publicChainId?: bigint;
} = {}): { dependencies: AutomaticDrawDryRunDependencies; counters: Counters } {
  const source = input.source ?? dueSnapshot();
  const fresh = input.fresh ?? source;
  const latest = input.latest ?? fresh;
  const counters: Counters = {
    reads: 0,
    identities: 0,
    simulations: 0,
    estimates: 0,
    simulatedArgs: [],
  };
  return {
    counters,
    dependencies: {
      async readSnapshot(blockNumber) {
        counters.reads += 1;
        const selected = blockNumber === undefined
          ? fresh
          : blockNumber === source.blockNumber
            ? source
            : latest;
        return structuredClone(selected);
      },
      async getLatestBlockNumber() {
        return input.latestBlock ?? (fresh.blockNumber as bigint);
      },
      async readPublicIdentity() {
        counters.identities += 1;
        return {
          chainId: input.publicChainId ?? 84_532n,
          contractAddress: LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
          hasBytecode: true,
        };
      },
      async simulateDraw(call) {
        counters.simulations += 1;
        counters.simulatedArgs.push(call.args);
        if (input.simulationError) throw input.simulationError;
        return {
          result: 7n,
          gasEstimate: input.simulationGasEstimate === undefined
            ? 123_456n
            : input.simulationGasEstimate,
        };
      },
      async estimateDraw() {
        counters.estimates += 1;
        if (input.estimateError) throw input.estimateError;
        return input.runtimeGasEstimate ?? 123_456n;
      },
    },
  };
}

function existingOperation(
  first: AutomaticDrawReservationCycleResult,
): AutomaticDrawReservationCycleResult {
  if (first.status !== "RESERVED_FIRST_TIME") {
    throw new Error("Expected a first-time reservation fixture.");
  }
  return {
    ...first,
    status: "EXISTING_OPERATION",
    reconciliationRequired: true,
    reason: "Existing operation fixture.",
  };
}

describe("Automatic Draw Runner V1 Phase 3 dry-run preflight", function () {
  it("composes Phase 1, Phase 2, existing revalidation, exact simulation, and gas buffering", async function () {
    const reservation = await reservationFor(dueSnapshot());
    assert.equal(reservation.decision.status, "DRAW_DUE");
    assert.equal(reservation.status, "RESERVED_FIRST_TIME");
    const mock = dependencies();

    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });

    assert.equal(result.status, "READY_FOR_EXECUTION");
    assert.equal(result.dryRunOnly, true);
    assert.equal(result.transactionAuthorized, false);
    assert.equal(result.transactionSent, false);
    assert.equal(result.evidence.chainId, "84532");
    assert.equal(
      result.evidence.contractAddress,
      LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
    );
    assert.equal(result.evidence.poolId, "1");
    assert.equal(result.evidence.roundNumber, "1");
    assert.match(result.evidence.planId ?? "", /^lifecycle-plan:/);
    assert.equal(result.evidence.revalidationStatus, "VALID");
    assert.equal(result.evidence.simulationSucceeded, true);
    assert.equal(result.evidence.gasEstimate, "123456");
    assert.equal(result.evidence.runtimeGasEstimate, "123456");
    assert.equal(result.evidence.bufferedGasLimit, "154320");
    assert.deepEqual(mock.counters.simulatedArgs, [[1n, 1n]]);
    assert.equal(mock.counters.estimates, 1);
  });

  it("stops an existing operation before any simulation", async function () {
    const first = await reservationFor(dueSnapshot());
    assert.equal(first.status, "RESERVED_FIRST_TIME");
    const mock = dependencies();
    const result = await runAutomaticDrawDryRun({
      reservation: existingOperation(first),
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(mock.counters.simulations, 0);
    assert.equal(mock.counters.estimates, 0);
  });

  it("stops a reconciliation-required Phase 2 result before reads or simulation", async function () {
    const first = await reservationFor(dueSnapshot());
    assert.equal(first.decision.status, "DRAW_DUE");
    const reservation: AutomaticDrawReservationCycleResult = {
      status: "RECONCILIATION_REQUIRED",
      decision: first.decision,
      operation: null,
      reconciliationRequired: true,
      reason: "Fixture uncertainty.",
    };
    const mock = dependencies();
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(mock.counters.reads, 0);
    assert.equal(mock.counters.simulations, 0);
  });

  it("stops a self-consistent noncanonical chain before simulation", async function () {
    const noncanonicalChainId = 84_533n;
    const source = dueSnapshot({ chainId: noncanonicalChainId });
    const reservation = await reservationFor(source);
    const mock = dependencies({
      source,
      fresh: source,
      publicChainId: noncanonicalChainId,
    });
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "SAFE_STOP");
    assert.equal(mock.counters.reads, 0);
    assert.equal(mock.counters.identities, 0);
    assert.equal(mock.counters.simulations, 0);
  });

  it("does not enter Phase 3 when Phase 1 returns NO_ACTION", async function () {
    const snapshot = dueSnapshot({
      pools: [makePoolFixture({ activePositionCount: 5n })],
    });
    const reservation = await reservationFor(snapshot);
    assert.equal(reservation.status, "NO_RESERVATION");
    assert.equal(reservation.decision.status, "NO_ACTION");
    const mock = dependencies();
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "SAFE_STOP");
    assert.equal(mock.counters.simulations, 0);
  });

  for (const decisionStatus of ["READ_FAILED", "INCONSISTENT", "AMBIGUOUS"] as const) {
    it(`does not dry-run a Phase 1 ${decisionStatus} result`, async function () {
      const due = await reservationFor(dueSnapshot());
      const decision = {
        ...due.decision,
        status: decisionStatus,
        nextAction: null,
        reason: `${decisionStatus} fixture.`,
      } as Exclude<AutomaticDrawReservationCycleResult, { status: "RESERVED_FIRST_TIME" }>["decision"];
      const reservation = {
        status: "NO_RESERVATION",
        decision,
        operation: null,
        reconciliationRequired: true,
        reason: decision.reason,
      } as AutomaticDrawReservationCycleResult;
      const mock = dependencies();
      const result = await runAutomaticDrawDryRun({
        reservation,
        operatorAddress: OPERATOR,
        dependencies: mock.dependencies,
      });
      assert.equal(result.status, "SAFE_STOP");
      assert.equal(mock.counters.simulations, 0);
    });
  }

  it("stops when fresh lifecycle state changes after reservation", async function () {
    const source = dueSnapshot();
    const fresh = dueSnapshot({
      blockNumber: 12_346n,
      observedAt: FIXTURE_OBSERVED_AT + 1n,
      pools: [makePoolFixture({
        status: "Locked",
        observedAt: FIXTURE_OBSERVED_AT + 1n,
        lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 100n,
      })],
    });
    const reservation = await reservationFor(source);
    const mock = dependencies({ source, fresh });
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "SAFE_STOP");
    assert.notEqual(result.evidence.revalidationStatus, "VALID");
    assert.equal(mock.counters.simulations, 0);
  });

  for (const [label, mismatched] of [
    ["pool", dueSnapshot({ pools: [makePoolFixture({
      poolId: 2n,
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL,
    })] })],
    ["round", dueSnapshot({ pools: [makePoolFixture({
      status: "Drawing",
      lockedAt: FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL,
      completedDrawRoundCount: 1n,
    })] })],
  ] as const) {
    it(`stops when the source plan resolves to a different ${label}`, async function () {
      const reservation = await reservationFor(dueSnapshot());
      const mock = dependencies({ source: mismatched, fresh: mismatched });
      const result = await runAutomaticDrawDryRun({
        reservation,
        operatorAddress: OPERATOR,
        dependencies: mock.dependencies,
      });
      assert.equal(result.status, "SAFE_STOP");
      assert.equal(mock.counters.simulations, 0);
    });
  }

  it("stops on a latest-block lifecycle change before simulation", async function () {
    const source = dueSnapshot();
    const latest = dueSnapshot({
      blockNumber: 12_346n,
      observedAt: FIXTURE_OBSERVED_AT + 1n,
      pools: [makePoolFixture({
        status: "Locked",
        observedAt: FIXTURE_OBSERVED_AT + 1n,
        lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 50n,
      })],
    });
    const reservation = await reservationFor(source);
    const mock = dependencies({
      source,
      fresh: source,
      latest,
      latestBlock: 12_346n,
    });
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "SAFE_STOP");
    assert.equal(mock.counters.simulations, 0);
  });

  it("returns PREFLIGHT_FAILED when exact simulation reverts", async function () {
    const reservation = await reservationFor(dueSnapshot());
    const mock = dependencies({ simulationError: new Error("fixture revert") });
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "PREFLIGHT_FAILED");
    assert.equal(result.evidence.simulationSucceeded, false);
    assert.equal(mock.counters.estimates, 0);
  });

  it("returns PREFLIGHT_FAILED when runtime gas estimation fails", async function () {
    const reservation = await reservationFor(dueSnapshot());
    const mock = dependencies({ estimateError: new Error("fixture estimate failure") });
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "PREFLIGHT_FAILED");
    assert.equal(result.evidence.simulationSucceeded, true);
    assert.equal(result.evidence.bufferedGasLimit, null);
    assert.equal(mock.counters.simulations, 1);
    assert.equal(mock.counters.estimates, 1);
  });

  it("processes at most one exact logical Draw per invocation", async function () {
    const reservation = await reservationFor(dueSnapshot());
    const mock = dependencies();
    const result = await runAutomaticDrawDryRun({
      reservation,
      operatorAddress: OPERATOR,
      dependencies: mock.dependencies,
    });
    assert.equal(result.status, "READY_FOR_EXECUTION");
    assert.equal(mock.counters.simulations, 1);
    assert.equal(mock.counters.estimates, 1);
    assert.deepEqual(mock.counters.simulatedArgs, [[1n, 1n]]);
  });

  it("keeps Phase 3 production modules structurally free of write-capable symbols", async function () {
    const modules = [
      new URL("../scripts/operator/automatic-draw-runner-v1-preflight.ts", import.meta.url),
      new URL("../scripts/operator/guarded-draw-read-only-preflight.ts", import.meta.url),
    ];
    const forbidden = /privateKey|privateKeyToAccount|createWalletClient|writeContract|sendTransaction|\bwallet\b|\bsigner\b|\bbroadcast\b|\bnonce\b|waitForTransactionReceipt/i;
    for (const module of modules) {
      assert.doesNotMatch(await readFile(module, "utf8"), forbidden);
    }
  });
});
