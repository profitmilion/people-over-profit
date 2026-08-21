import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getAddress, type Address } from "viem";

import {
  consumeAutomaticDrawDurableRuntime,
  createGuardedDrawDurableRuntimeConsumer,
  readAutomaticDrawDurableRuntimeConfig,
  type AutomaticDrawDurableRuntimeConfig,
} from "../scripts/operator/automatic-draw-runner-v1-runtime.js";
import { logicalDrawKey } from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import { handoffAutomaticDrawExecutionIntent } from "../scripts/operator/automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawProgression,
  type AutomaticDrawPreflightReadyEvidence,
  type AutomaticDrawStoredOperation,
  type AutomaticDrawTerminalProgression,
} from "../scripts/operator/automatic-draw-runner-v1-progression.js";
import {
  validateAutomaticDrawReservationRecord,
} from "../scripts/operator/automatic-draw-runner-v1-reservation.js";
import {
  JsonAutomaticDrawReservationStore,
  inspectAutomaticDrawReservationState,
} from "../scripts/operator/automatic-draw-runner-v1-state.js";
import type { GuardedDrawPreparedIntentContext } from "../scripts/operator/guarded-single-draw.js";
import {
  calculateGuardedDrawGasPlan,
  executeGuardedSingleDraw,
  type GuardedDrawDependencies,
} from "../scripts/operator/guarded-single-draw.js";
import {
  createLifecycleActionPlan,
  serializeLifecycleActionPlan,
  type LifecycleActionPlan,
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
const identity: JournalIdentity = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
};
const directories: string[] = [];

interface Fixture {
  directory: string;
  statePath: string;
  journalPath: string;
  operation: AutomaticDrawStoredOperation;
  config: AutomaticDrawDurableRuntimeConfig;
  context: GuardedDrawPreparedIntentContext;
  operationId: string;
}

async function temporaryPaths() {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-runtime-"));
  directories.push(directory);
  return {
    directory,
    statePath: join(directory, "runner.automatic-draw-state.json"),
    journalPath: join(directory, "transactions.operator-journal.json"),
  };
}

function readyEvidence(
  input: Partial<AutomaticDrawPreflightReadyEvidence> = {},
): AutomaticDrawPreflightReadyEvidence {
  return {
    phase3Status: "READY_FOR_EXECUTION",
    planId:
      "lifecycle-plan:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    revalidationBlock: "12345",
    publicOperatorAddress: OPERATOR,
    gasEstimate: "123456",
    runtimeGasEstimate: "123456",
    bufferedGasLimit: "154320",
    completedAt: "2026-08-15T10:01:00.000Z",
    dryRunOnly: true,
    transactionAuthorized: false,
    transactionSent: false,
    ...input,
  };
}

async function persistFixture(input: {
  poolId?: bigint;
  roundNumber?: bigint;
  evidence?: Partial<AutomaticDrawPreflightReadyEvidence>;
} = {}): Promise<Fixture> {
  const paths = await temporaryPaths();
  const poolId = input.poolId ?? 1n;
  const roundNumber = input.roundNumber ?? 1n;
  const key = logicalDrawKey({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    poolId,
    roundNumber,
  });
  const record = validateAutomaticDrawReservationRecord({
    schemaVersion: 1,
    logicalDrawKey: key,
    action: "Draw",
    chainId: CHAIN_ID.toString(),
    contractAddress: CONTRACT,
    poolId: poolId.toString(),
    roundNumber: roundNumber.toString(),
    state: "RESERVED",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    sourceBlock: "12345",
    scheduledAt: "1800000000",
    invocationId: "123e4567-e89b-42d3-a456-426614174000",
  });
  const store = new JsonAutomaticDrawReservationStore(paths.statePath);
  assert.equal((await store.reserveIfAbsent(record)).status, "CREATED");
  const progression = validateAutomaticDrawProgression({
    schemaVersion: 1,
    state: "PREFLIGHT_READY",
    updatedAt: "2026-08-15T10:01:00.000Z",
    preflight: readyEvidence(input.evidence),
    manualReview: null,
  }) as AutomaticDrawTerminalProgression;
  const transition = await store.transitionIfCurrent({
    logicalDrawKey: key,
    expectedRevision: 1,
    expectedState: "RESERVED",
    next: progression,
  });
  assert.equal(transition.status, "UPDATED");
  const operation = (await inspectAutomaticDrawReservationState(paths.statePath))
    .operations[0];
  const journal = await JsonTransactionJournal.open(paths.journalPath, identity);
  const handoff = await handoffAutomaticDrawExecutionIntent({
    logicalDrawKey: key,
    expectedProgressionRevision: operation.revision,
    progressionStorage: store,
    journal,
  });
  assert.equal(handoff.status, "HANDOFF_READY");
  const journalRevision = journal.snapshot().revision;
  const config: AutomaticDrawDurableRuntimeConfig = {
    automaticDrawStatePath: paths.statePath,
    transactionJournalPath: paths.journalPath,
    journalIdentity: identity,
    expectedProgressionRevision: operation.revision,
    expectedJournalRevision: journalRevision,
  };
  const preflight = operation.progression.state === "PREFLIGHT_READY"
    ? operation.progression.preflight
    : assert.fail("Fixture progression is not ready.");
  return {
    ...paths,
    operation,
    config,
    context: {
      logicalDrawKey: key,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      poolId,
      roundNumber,
      operatorAddress: OPERATOR,
      planId: preflight.planId,
      revalidationBlock: preflight.revalidationBlock,
      gasEstimate: BigInt(preflight.gasEstimate),
      runtimeGasEstimate: BigInt(preflight.runtimeGasEstimate),
      bufferedGasLimit: BigInt(preflight.bufferedGasLimit),
    },
    operationId: handoff.journalOperation?.operationId as string,
  };
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

function planFor(snapshot: SystemSnapshot): LifecycleActionPlan {
  return createLifecycleActionPlan(
    snapshot,
    analyzeLifecycleSnapshot(snapshot),
    1n,
    { sourceReference: "base-sepolia" },
  );
}

function guardedDependencies(input: {
  snapshot: SystemSnapshot;
  consume: ReturnType<typeof createGuardedDrawDurableRuntimeConsumer>;
  events: string[];
  loads: { count: number };
  simulationGasEstimate?: bigint;
  runtimeGasEstimate?: bigint;
}): GuardedDrawDependencies {
  return {
    async readSnapshot() { return structuredClone(input.snapshot); },
    async readPublicIdentity() {
      return {
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        hasBytecode: true,
      };
    },
    async getLatestBlockNumber() {
      return input.snapshot.blockNumber as bigint;
    },
    async simulateDraw() {
      return {
        result: 7n,
        gasEstimate: input.simulationGasEstimate ?? 123_456n,
      };
    },
    async estimateDraw() {
      return input.runtimeGasEstimate ?? 123_456n;
    },
    async consumePreparedDrawIntent(context) {
      input.events.push("runtime:start");
      const result = await input.consume(context);
      input.events.push(`runtime:${result.status}`);
      return result;
    },
    async loadExecutionClient() {
      input.loads.count += 1;
      input.events.push("loader");
      throw new Error("test stop before any execution client is created");
    },
    async waitForReceipt() {
      throw new Error("receipt path must remain unreachable");
    },
  };
}

describe("Automatic Draw durable read-only runtime wiring", function () {
  afterEach(async function () {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("1. opens matching durable stores and returns the prepared operation", async function () {
    const fixture = await persistFixture();
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "CONSUMER_READY");
    assert.equal(result.consumer.operation?.operationId, fixture.operationId);
  });

  it("2. fails closed when progression Draw A is paired with journal Draw B", async function () {
    const drawA = await persistFixture({ poolId: 1n });
    const drawB = await persistFixture({ poolId: 2n });
    const result = await consumeAutomaticDrawDurableRuntime({
      ...drawA.config,
      transactionJournalPath: drawB.journalPath,
      logicalDrawKey: drawA.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "CONFLICT");
  });

  it("3. rejects the wrong expected progression revision", async function () {
    const fixture = await persistFixture();
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      expectedProgressionRevision: fixture.config.expectedProgressionRevision - 1,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "CONFLICT");
  });

  it("4. rejects the wrong expected journal revision", async function () {
    const fixture = await persistFixture();
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      expectedJournalRevision: fixture.config.expectedJournalRevision + 1,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "CONFLICT");
  });

  it("5. never treats a journal beyond prepared as fresh work", async function () {
    const fixture = await persistFixture();
    const journal = await JsonTransactionJournal.openExisting(
      fixture.journalPath,
      identity,
    );
    await journal.transition(fixture.operationId, "ready_to_broadcast", { nonce: 7 });
    const consumer = createGuardedDrawDurableRuntimeConsumer({
      ...fixture.config,
      expectedJournalRevision: journal.snapshot().revision,
    });
    const result = await consumer(fixture.context);
    assert.equal(result.status, "EXISTING_NOT_READY");
  });

  it("6. maps corrupt progression to reconciliation", async function () {
    const fixture = await persistFixture();
    await writeFile(fixture.statePath, "{", "utf8");
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
  });

  it("7. maps corrupt journal to reconciliation", async function () {
    const fixture = await persistFixture();
    await writeFile(fixture.journalPath, "{", "utf8");
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
  });

  it("8. fails closed for a missing progression file", async function () {
    const fixture = await persistFixture();
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      automaticDrawStatePath: join(
        fixture.directory,
        "missing.automatic-draw-state.json",
      ),
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
  });

  it("9. fails closed for a missing journal file", async function () {
    const fixture = await persistFixture();
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      transactionJournalPath: join(
        fixture.directory,
        "missing.operator-journal.json",
      ),
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
  });

  it("10. leaves both durable files byte-for-byte unchanged across restart", async function () {
    const fixture = await persistFixture();
    const beforeState = await readFile(fixture.statePath);
    const beforeJournal = await readFile(fixture.journalPath);
    const first = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    const second = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(first.status, "CONSUMER_READY");
    assert.equal(second.status, "CONSUMER_READY");
    assert.equal(second.consumer.operation?.operationId, fixture.operationId);
    assert.deepEqual(await readFile(fixture.statePath), beforeState);
    assert.deepEqual(await readFile(fixture.journalPath), beforeJournal);
  });

  it("11. automatic and guarded runtime resolve the same operation", async function () {
    const fixture = await persistFixture();
    const automatic = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    const guarded = await createGuardedDrawDurableRuntimeConsumer(
      fixture.config,
    )(fixture.context);
    assert.equal(automatic.status, "CONSUMER_READY");
    assert.equal(guarded.status, "CONSUMER_READY");
    assert.equal(automatic.consumer.operation?.operationId, guarded.operation?.operationId);
    assert.equal(guarded.operation?.operationId, fixture.operationId);
  });

  it("12. rejects guarded evidence that differs from durable preflight", async function () {
    const fixture = await persistFixture();
    const result = await createGuardedDrawDurableRuntimeConsumer(
      fixture.config,
    )({ ...fixture.context, planId: `${fixture.context.planId}-changed` });
    assert.equal(result.status, "CONFLICT");
  });

  it("accepts a newer final revalidation block with independently safe refreshed gas evidence", async function () {
    const preparedSnapshot = dueSnapshot();
    const plan = planFor(preparedSnapshot);
    const persistedBlock = preparedSnapshot.blockNumber as bigint;
    const freshSnapshot = {
      ...structuredClone(preparedSnapshot),
      blockNumber: persistedBlock + 25n,
    };
    const fixture = await persistFixture({
      evidence: {
        planId: plan.planId,
        revalidationBlock: persistedBlock.toString(),
      },
    });
    const events: string[] = [];
    const loads = { count: 0 };
    const result = await executeGuardedSingleDraw({
      planJson: serializeLifecycleActionPlan(plan),
      operatorAddress: OPERATOR,
      confirmation: {
        chainId: plan.identity.chainId,
        contractAddress: plan.identity.contractAddress,
        poolId: plan.scope.poolId,
        roundNumber: plan.scope.roundNumber as string,
      },
    }, guardedDependencies({
      snapshot: freshSnapshot,
      consume: createGuardedDrawDurableRuntimeConsumer(fixture.config),
      events,
      loads,
      simulationGasEstimate: 150_000n,
      runtimeGasEstimate: 160_000n,
    }));
    assert.notEqual(result.status, "TRANSACTION_SUBMITTED");
    assert.deepEqual(events, ["runtime:start", "runtime:CONSUMER_READY", "loader"]);
    assert.equal(loads.count, 1);
  });

  it("fails closed when final revalidation regresses behind persisted preflight", async function () {
    const snapshot = dueSnapshot();
    const plan = planFor(snapshot);
    const fixture = await persistFixture({
      evidence: {
        planId: plan.planId,
        revalidationBlock: ((snapshot.blockNumber as bigint) + 1n).toString(),
      },
    });
    const events: string[] = [];
    const loads = { count: 0 };
    const result = await executeGuardedSingleDraw({
      planJson: serializeLifecycleActionPlan(plan),
      operatorAddress: OPERATOR,
      confirmation: {
        chainId: plan.identity.chainId,
        contractAddress: plan.identity.contractAddress,
        poolId: plan.scope.poolId,
        roundNumber: plan.scope.roundNumber as string,
      },
    }, guardedDependencies({
      snapshot,
      consume: createGuardedDrawDurableRuntimeConsumer(fixture.config),
      events,
      loads,
    }));
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(events, ["runtime:start", "runtime:CONFLICT"]);
    assert.equal(loads.count, 0);
  });

  it("fails closed when refreshed gas evidence is not exactly buffered", async function () {
    const fixture = await persistFixture();
    const freshGas = calculateGuardedDrawGasPlan(150_000n, 160_000n);
    const result = await createGuardedDrawDurableRuntimeConsumer(
      fixture.config,
    )({
      ...fixture.context,
      revalidationBlock: "12346",
      gasEstimate: freshGas.preflightEstimate,
      runtimeGasEstimate: freshGas.runtimeEstimate,
      bufferedGasLimit: freshGas.gasLimit - 1n,
    });
    assert.equal(result.status, "CONFLICT");
  });

  it("fails closed when persisted gas evidence is not exactly buffered", async function () {
    const fixture = await persistFixture({
      evidence: { bufferedGasLimit: "154319" },
    });
    const result = await createGuardedDrawDurableRuntimeConsumer(
      fixture.config,
    )(fixture.context);
    assert.equal(result.status, "CONFLICT");
  });

  it("13. runs the real durable consumer before the guarded loader seam", async function () {
    const snapshot = dueSnapshot();
    const plan = planFor(snapshot);
    const fixture = await persistFixture({
      evidence: {
        planId: plan.planId,
        revalidationBlock: snapshot.blockNumber?.toString() as string,
      },
    });
    const events: string[] = [];
    const loads = { count: 0 };
    const result = await executeGuardedSingleDraw({
      planJson: serializeLifecycleActionPlan(plan),
      operatorAddress: OPERATOR,
      confirmation: {
        chainId: plan.identity.chainId,
        contractAddress: plan.identity.contractAddress,
        poolId: plan.scope.poolId,
        roundNumber: plan.scope.roundNumber as string,
      },
    }, guardedDependencies({
      snapshot,
      consume: createGuardedDrawDurableRuntimeConsumer(fixture.config),
      events,
      loads,
    }));
    assert.notEqual(result.status, "TRANSACTION_SUBMITTED");
    assert.deepEqual(events, ["runtime:start", "runtime:CONSUMER_READY", "loader"]);
    assert.equal(loads.count, 1);
  });

  it("14. consumer failure prevents the guarded loader seam", async function () {
    const snapshot = dueSnapshot();
    const plan = planFor(snapshot);
    const fixture = await persistFixture({
      evidence: {
        planId: plan.planId,
        revalidationBlock: snapshot.blockNumber?.toString() as string,
      },
    });
    const events: string[] = [];
    const loads = { count: 0 };
    const result = await executeGuardedSingleDraw({
      planJson: serializeLifecycleActionPlan(plan),
      operatorAddress: OPERATOR,
      confirmation: {
        chainId: plan.identity.chainId,
        contractAddress: plan.identity.contractAddress,
        poolId: plan.scope.poolId,
        roundNumber: plan.scope.roundNumber as string,
      },
    }, guardedDependencies({
      snapshot,
      consume: createGuardedDrawDurableRuntimeConsumer({
        ...fixture.config,
        expectedJournalRevision: fixture.config.expectedJournalRevision + 1,
      }),
      events,
      loads,
    }));
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(events, ["runtime:start", "runtime:CONFLICT"]);
    assert.equal(loads.count, 0);
  });

  it("15. requires narrow path and revision environment configuration", function () {
    const fixtureState = resolve("C:/operator/runner.automatic-draw-state.json");
    const fixtureJournal = resolve("C:/operator/transactions.operator-journal.json");
    const config = readAutomaticDrawDurableRuntimeConfig({
      POP33_INTERNAL_AUTOMATIC_DRAW_STATE_PATH: fixtureState,
      OPERATOR_TRANSACTION_JOURNAL_PATH: fixtureJournal,
      POP33_INTERNAL_AUTOMATIC_DRAW_PROGRESSION_REVISION: "2",
      POP33_INTERNAL_AUTOMATIC_DRAW_JOURNAL_REVISION: "1",
    }, identity);
    assert.equal(config.automaticDrawStatePath, fixtureState);
    assert.equal(config.transactionJournalPath, fixtureJournal);
    assert.equal(config.expectedProgressionRevision, 2);
    assert.equal(config.expectedJournalRevision, 1);
    assert.throws(() => readAutomaticDrawDurableRuntimeConfig({}, identity));
  });

  it("16. fails closed when a configured storage target is not a readable file", async function () {
    const fixture = await persistFixture();
    const invalidTarget = join(
      fixture.directory,
      "directory.automatic-draw-state.json",
    );
    await mkdir(invalidTarget);
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      automaticDrawStatePath: invalidTarget,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
  });

  it("17. keeps storage paths out of runtime failure reasons", async function () {
    const fixture = await persistFixture();
    const secretShapedPath = join(
      fixture.directory,
      "password=do-not-log.automatic-draw-state.json",
    );
    const result = await consumeAutomaticDrawDurableRuntime({
      ...fixture.config,
      automaticDrawStatePath: secretShapedPath,
      logicalDrawKey: fixture.operation.record.logicalDrawKey,
    });
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(result.reason.includes(secretShapedPath), false);
    assert.equal(result.reason.includes("do-not-log"), false);
  });

  it("18. contains no signer, wallet, nonce, transaction, or receipt capability", async function () {
    const source = await readFile(resolve(
      "scripts/operator/automatic-draw-runner-v1-runtime.ts",
    ), "utf8");
    for (const forbidden of [
      "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY",
      "privateKeyToAccount",
      "createWalletClient",
      "loadExecutionClient",
      "writeContract",
      "sendTransaction",
      "getTransactionCount",
      "signTransaction",
      "waitForTransactionReceipt",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
