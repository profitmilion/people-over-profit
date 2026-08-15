import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getAddress } from "viem";

import {
  runAutomaticDrawProgressionCycle,
  mapAutomaticDrawDryRunToProgression,
  validateAutomaticDrawProgression,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawTerminalProgression,
} from "../scripts/operator/automatic-draw-runner-v1-progression.js";
import {
  runAutomaticDrawReservationCycle,
  type AutomaticDrawReservationCycleResult,
} from "../scripts/operator/automatic-draw-runner-v1-reservation.js";
import {
  JsonAutomaticDrawReservationStore,
  inspectAutomaticDrawReservationState,
} from "../scripts/operator/automatic-draw-runner-v1-state.js";
import type {
  AutomaticDrawDryRunDependencies,
  AutomaticDrawDryRunResult,
  AutomaticDrawDryRunStatus,
} from "../scripts/operator/automatic-draw-runner-v1-preflight.js";
import { runAutomaticDrawDryRun } from "../scripts/operator/automatic-draw-runner-v1-preflight.js";
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
const directories: string[] = [];

function dueSnapshot(): SystemSnapshot {
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

interface Counters {
  reads: number;
  simulations: number;
  estimates: number;
}

function preflightDependencies(input: {
  simulationError?: Error;
  estimateError?: Error;
} = {}): { dependencies: AutomaticDrawDryRunDependencies; counters: Counters } {
  const snapshot = dueSnapshot();
  const counters = { reads: 0, simulations: 0, estimates: 0 };
  return {
    counters,
    dependencies: {
      async readSnapshot() {
        counters.reads += 1;
        return structuredClone(snapshot);
      },
      async getLatestBlockNumber() {
        return snapshot.blockNumber as bigint;
      },
      async readPublicIdentity() {
        return {
          chainId: snapshot.chainId,
          contractAddress: snapshot.contractAddress,
          hasBytecode: true,
        };
      },
      async simulateDraw() {
        counters.simulations += 1;
        if (input.simulationError) throw input.simulationError;
        return { result: 7n, gasEstimate: 123_456n };
      },
      async estimateDraw() {
        counters.estimates += 1;
        if (input.estimateError) throw input.estimateError;
        return 123_456n;
      },
    },
  };
}

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-progression-"));
  directories.push(directory);
  return join(directory, "runner.automatic-draw-state.json");
}

async function reserve(
  filePath: string,
  store = new JsonAutomaticDrawReservationStore(filePath),
): Promise<AutomaticDrawReservationCycleResult> {
  const snapshot = dueSnapshot();
  return runAutomaticDrawReservationCycle({
    scope: {
      chainId: snapshot.chainId,
      contractAddress: snapshot.contractAddress,
      poolId: 1n,
    },
    adapter: snapshotAdapter(snapshot),
    storage: store,
    invocationId: "123e4567-e89b-42d3-a456-426614174000",
  });
}

async function progress(input: {
  filePath: string;
  reservation: AutomaticDrawReservationCycleResult;
  dependencies?: ReturnType<typeof preflightDependencies>;
  storage?: AutomaticDrawProgressionStorage;
}) {
  const preflight = input.dependencies ?? preflightDependencies();
  const result = await runAutomaticDrawProgressionCycle({
    reservation: input.reservation,
    storage: input.storage ?? new JsonAutomaticDrawReservationStore(input.filePath),
    runDryRun: runAutomaticDrawDryRun,
    operatorAddress: OPERATOR,
    dependencies: preflight.dependencies,
  });
  return { result, counters: preflight.counters };
}

function manualProgression(
  after: string,
  reason = "Fixture requires manual review.",
): AutomaticDrawTerminalProgression {
  const recordedAt = new Date(Date.parse(after) + 1_000).toISOString();
  return validateAutomaticDrawProgression({
    schemaVersion: 1,
    state: "MANUAL_REVIEW_REQUIRED",
    updatedAt: recordedAt,
    preflight: null,
    manualReview: {
      phase3Status: "PREFLIGHT_FAILED",
      reason,
      recordedAt,
    },
  }) as AutomaticDrawTerminalProgression;
}

function fakeDryRun(status: AutomaticDrawDryRunStatus): AutomaticDrawDryRunResult {
  return {
    status,
    dryRunOnly: true,
    transactionAuthorized: false,
    transactionSent: false,
    reason: `${status} fixture.`,
    evidence: {
      logicalDrawKey: null,
      chainId: "84532",
      contractAddress: LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
      poolId: "1",
      roundNumber: "1",
      reservationStatus: "RESERVED_FIRST_TIME",
      planId: null,
      sourceBlock: "12345",
      revalidationBlock: null,
      revalidationStatus: null,
      scheduledAt: "1800000000",
      simulationSucceeded: false,
      gasEstimate: null,
      runtimeGasEstimate: null,
      bufferedGasLimit: null,
    },
  };
}

async function runTransitionChild(input: {
  filePath: string;
  logicalDrawKey: string;
  expectedRevision: number;
  reason: string;
}): Promise<string> {
  const moduleUrl = pathToFileURL(resolve(
    "scripts/operator/automatic-draw-runner-v1-state.ts",
  )).href;
  const source = `
    import { JsonAutomaticDrawReservationStore } from ${JSON.stringify(moduleUrl)};
    const store = new JsonAutomaticDrawReservationStore(${JSON.stringify(input.filePath)});
    const recordedAt = "2099-01-01T00:00:00.000Z";
    const result = await store.transitionIfCurrent({
      logicalDrawKey: ${JSON.stringify(input.logicalDrawKey)},
      expectedRevision: ${input.expectedRevision},
      expectedState: "RESERVED",
      next: {
        schemaVersion: 1,
        state: "MANUAL_REVIEW_REQUIRED",
        updatedAt: recordedAt,
        preflight: null,
        manualReview: {
          phase3Status: "PREFLIGHT_FAILED",
          reason: ${JSON.stringify(input.reason)},
          recordedAt,
        },
      },
    });
    process.stdout.write(JSON.stringify({ status: result.status }));
  `;
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      {
        cwd: resolve("."),
        env: {
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`Progression child failed (${code}): ${stderr}`));
        return;
      }
      resolvePromise((JSON.parse(stdout) as { status: string }).status);
    });
  });
}

describe("Automatic Draw Runner V1 durable progression and recovery", function () {
  this.timeout(30_000);

  afterEach(async function () {
    while (directories.length > 0) {
      const directory = directories.pop();
      if (directory?.startsWith(tmpdir())) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("persists RESERVED -> PREFLIGHT_READY with minimal non-transactional evidence", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const { result } = await progress({ filePath, reservation });
    assert.equal(result.status, "PREFLIGHT_READY");
    assert.equal(result.preflightExecuted, true);
    assert.equal(result.transactionAuthorized, false);
    assert.equal(result.transactionSent, false);
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.formatVersion, 2);
    assert.equal(state.revision, 2);
    assert.equal(state.operations.length, 1);
    const progression = state.operations[0].progression;
    assert.equal(progression.state, "PREFLIGHT_READY");
    assert.match(progression.preflight?.planId ?? "", /^lifecycle-plan:/);
    assert.equal(progression.preflight?.publicOperatorAddress, OPERATOR);
    assert.equal(progression.preflight?.gasEstimate, "123456");
    assert.equal(progression.preflight?.bufferedGasLimit, "154320");
    assert.equal(progression.preflight?.dryRunOnly, true);
    assert.equal(progression.preflight?.transactionAuthorized, false);
    assert.equal(progression.preflight?.transactionSent, false);
  });

  it("persists RESERVED -> MANUAL_REVIEW_REQUIRED after a preflight failure", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const { result } = await progress({
      filePath,
      reservation,
      dependencies: preflightDependencies({
        simulationError: new Error("fixture simulation failure"),
      }),
    });
    assert.equal(result.status, "MANUAL_REVIEW_REQUIRED");
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations[0].progression.state, "MANUAL_REVIEW_REQUIRED");
    assert.equal(
      state.operations[0].progression.manualReview?.phase3Status,
      "PREFLIGHT_FAILED",
    );
    assert.equal(state.operations.length, 1);
  });

  for (const status of [
    "SAFE_STOP",
    "RECONCILIATION_REQUIRED",
    "PREFLIGHT_FAILED",
  ] as const) {
    it(`maps ${status} conservatively to manual review`, function () {
      const progression = mapAutomaticDrawDryRunToProgression(
        fakeDryRun(status),
        OPERATOR,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
      );
      assert.equal(progression.state, "MANUAL_REVIEW_REQUIRED");
      assert.equal(progression.manualReview?.phase3Status, status);
    });
  }

  it("reopens PREFLIGHT_READY idempotently without another preflight or reservation", async function () {
    const filePath = await temporaryStatePath();
    await progress({ filePath, reservation: await reserve(filePath) });
    const reopenedReservation = await reserve(filePath);
    assert.equal(reopenedReservation.status, "EXISTING_OPERATION");
    const dependencies = preflightDependencies();
    const reopened = await progress({
      filePath,
      reservation: reopenedReservation,
      dependencies,
    });
    assert.equal(reopened.result.status, "PREFLIGHT_READY");
    assert.equal(reopened.result.preflightExecuted, false);
    assert.equal(dependencies.counters.reads, 0);
    assert.equal(dependencies.counters.simulations, 0);
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.revision, 2);
    assert.equal(state.operations.length, 1);
  });

  it("resumes an existing RESERVED operation after process restart", async function () {
    const filePath = await temporaryStatePath();
    const first = await reserve(filePath);
    assert.equal(first.status, "RESERVED_FIRST_TIME");
    const reopenedReservation = await reserve(filePath);
    assert.equal(reopenedReservation.status, "EXISTING_OPERATION");
    const resumed = await progress({
      filePath,
      reservation: reopenedReservation,
    });
    assert.equal(resumed.result.status, "PREFLIGHT_READY");
    assert.equal(resumed.result.preflightExecuted, true);
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations.length, 1);
    assert.equal(state.operations[0].progression.state, "PREFLIGHT_READY");
  });

  it("reopens MANUAL_REVIEW_REQUIRED as a durable stop", async function () {
    const filePath = await temporaryStatePath();
    await progress({
      filePath,
      reservation: await reserve(filePath),
      dependencies: preflightDependencies({ simulationError: new Error("fixture") }),
    });
    const dependencies = preflightDependencies();
    const reopened = await progress({
      filePath,
      reservation: await reserve(filePath),
      dependencies,
    });
    assert.equal(reopened.result.status, "MANUAL_REVIEW_REQUIRED");
    assert.equal(reopened.result.preflightExecuted, false);
    assert.equal(dependencies.counters.simulations, 0);
  });

  it("resumes safely when progression writing fails before durable replacement", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const interrupted = await progress({
      filePath,
      reservation,
      storage: new JsonAutomaticDrawReservationStore(filePath, {
        beforeRename: () => { throw new Error("fixture interruption"); },
      }),
    });
    assert.equal(interrupted.result.status, "RECONCILIATION_REQUIRED");
    assert.equal(
      (await inspectAutomaticDrawReservationState(filePath)).operations[0].progression.state,
      "RESERVED",
    );
    const resumed = await progress({
      filePath,
      reservation: await reserve(filePath),
    });
    assert.equal(resumed.result.status, "PREFLIGHT_READY");
  });

  it("discovers PREFLIGHT_READY after an unknown outcome following durable write", async function () {
    const filePath = await temporaryStatePath();
    const interrupted = await progress({
      filePath,
      reservation: await reserve(filePath),
      storage: new JsonAutomaticDrawReservationStore(filePath, {
        afterDurableWrite: () => { throw new Error("fixture process loss"); },
      }),
    });
    assert.equal(interrupted.result.status, "RECONCILIATION_REQUIRED");
    assert.equal(
      (await inspectAutomaticDrawReservationState(filePath)).operations[0].progression.state,
      "PREFLIGHT_READY",
    );
    const dependencies = preflightDependencies();
    const reopened = await progress({
      filePath,
      reservation: await reserve(filePath),
      dependencies,
    });
    assert.equal(reopened.result.status, "PREFLIGHT_READY");
    assert.equal(reopened.result.preflightExecuted, false);
    assert.equal(dependencies.counters.simulations, 0);
  });

  it("discovers MANUAL_REVIEW_REQUIRED after an unknown durable-write outcome", async function () {
    const filePath = await temporaryStatePath();
    const interrupted = await progress({
      filePath,
      reservation: await reserve(filePath),
      dependencies: preflightDependencies({ simulationError: new Error("fixture") }),
      storage: new JsonAutomaticDrawReservationStore(filePath, {
        afterDurableWrite: () => { throw new Error("fixture process loss"); },
      }),
    });
    assert.equal(interrupted.result.status, "RECONCILIATION_REQUIRED");
    assert.equal(
      (await inspectAutomaticDrawReservationState(filePath)).operations[0].progression.state,
      "MANUAL_REVIEW_REQUIRED",
    );
    const reopened = await progress({ filePath, reservation: await reserve(filePath) });
    assert.equal(reopened.result.status, "MANUAL_REVIEW_REQUIRED");
    assert.equal(reopened.result.preflightExecuted, false);
  });

  it("fails closed when the storage transition outcome is UNKNOWN", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const store = new JsonAutomaticDrawReservationStore(filePath);
    const storage: AutomaticDrawProgressionStorage = {
      read: (logicalDrawKey) => store.read(logicalDrawKey),
      async transitionIfCurrent() { return { status: "UNKNOWN" }; },
    };
    const outcome = await progress({ filePath, reservation, storage });
    assert.equal(outcome.result.status, "RECONCILIATION_REQUIRED");
    assert.equal(
      (await inspectAutomaticDrawReservationState(filePath)).operations[0].progression.state,
      "RESERVED",
    );
  });

  it("fails closed when a provider-neutral transition adapter throws", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const store = new JsonAutomaticDrawReservationStore(filePath);
    const storage: AutomaticDrawProgressionStorage = {
      read: (logicalDrawKey) => store.read(logicalDrawKey),
      async transitionIfCurrent() { throw new Error("fixture adapter failure"); },
    };
    const outcome = await progress({ filePath, reservation, storage });
    assert.equal(outcome.result.status, "RECONCILIATION_REQUIRED");
    assert.equal(
      (await inspectAutomaticDrawReservationState(filePath)).operations[0].progression.state,
      "RESERVED",
    );
  });

  it("rejects stale revision/state transitions without rewriting terminal state", async function () {
    const filePath = await temporaryStatePath();
    await reserve(filePath);
    const store = new JsonAutomaticDrawReservationStore(filePath);
    const initial = (await inspectAutomaticDrawReservationState(filePath)).operations[0];
    const stale = await store.transitionIfCurrent({
      logicalDrawKey: initial.record.logicalDrawKey,
      expectedRevision: initial.revision + 1,
      expectedState: "RESERVED",
      next: manualProgression(initial.progression.updatedAt),
    });
    assert.equal(stale.status, "CONFLICT");
    const updated = await store.transitionIfCurrent({
      logicalDrawKey: initial.record.logicalDrawKey,
      expectedRevision: initial.revision,
      expectedState: "RESERVED",
      next: manualProgression(initial.progression.updatedAt),
    });
    assert.equal(updated.status, "UPDATED");
    const repeated = await store.transitionIfCurrent({
      logicalDrawKey: initial.record.logicalDrawKey,
      expectedRevision: initial.revision,
      expectedState: "RESERVED",
      next: manualProgression(initial.progression.updatedAt, "Replacement attempt."),
    });
    assert.equal(repeated.status, "CONFLICT");
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations[0].progression.manualReview?.reason, "Fixture requires manual review.");
  });

  it("fails closed for corrupted progression without overwriting or deleting it", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const state = JSON.parse(await readFile(filePath, "utf8")) as {
      operations: Array<{ progression: { state: string } }>;
    };
    state.operations[0].progression.state = "BROKEN";
    const corrupted = JSON.stringify(state);
    await writeFile(filePath, corrupted, "utf8");
    const outcome = await progress({ filePath, reservation });
    assert.equal(outcome.result.status, "RECONCILIATION_REQUIRED");
    assert.equal(await readFile(filePath, "utf8"), corrupted);
  });

  it("migrates a legacy RESERVED file only when a real progression is persisted", async function () {
    const filePath = await temporaryStatePath();
    const reservation = await reserve(filePath);
    const current = JSON.parse(await readFile(filePath, "utf8")) as {
      formatVersion: number;
      operations: Array<{ revision: number; record: unknown; progression?: unknown }>;
    };
    current.formatVersion = 1;
    current.operations = current.operations.map(({ revision, record }) => ({
      revision,
      record,
    }));
    await writeFile(filePath, JSON.stringify(current), "utf8");
    const normalized = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(normalized.operations[0].progression.state, "RESERVED");
    assert.equal((JSON.parse(await readFile(filePath, "utf8")) as { formatVersion: number }).formatVersion, 1);
    const outcome = await progress({ filePath, reservation });
    assert.equal(outcome.result.status, "PREFLIGHT_READY");
    assert.equal((JSON.parse(await readFile(filePath, "utf8")) as { formatVersion: number }).formatVersion, 2);
  });

  it("allows only one of two real child processes to overwrite RESERVED", async function () {
    const filePath = await temporaryStatePath();
    await reserve(filePath);
    const initial = (await inspectAutomaticDrawReservationState(filePath)).operations[0];
    const statuses = await Promise.all([
      runTransitionChild({
        filePath,
        logicalDrawKey: initial.record.logicalDrawKey,
        expectedRevision: initial.revision,
        reason: "Child A requires manual review.",
      }),
      runTransitionChild({
        filePath,
        logicalDrawKey: initial.record.logicalDrawKey,
        expectedRevision: initial.revision,
        reason: "Child B requires manual review.",
      }),
    ]);
    assert.equal(statuses.filter((status) => status === "UPDATED").length, 1);
    assert.ok(statuses.every((status) => ["UPDATED", "CONFLICT", "UNKNOWN"].includes(status)));
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations.length, 1);
    assert.equal(state.revision, 2);
    assert.equal(state.operations[0].progression.state, "MANUAL_REVIEW_REQUIRED");
    assert.ok([
      "Child A requires manual review.",
      "Child B requires manual review.",
    ].includes(state.operations[0].progression.manualReview?.reason ?? ""));
  });

  it("keeps progression production modules structurally free of transaction capabilities", async function () {
    const modules = [
      new URL("../scripts/operator/automatic-draw-runner-v1-progression.ts", import.meta.url),
      new URL("../scripts/operator/automatic-draw-runner-v1-state.ts", import.meta.url),
    ];
    const forbidden = /BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY|privateKeyToAccount|createWalletClient|writeContract|sendTransaction|wallet\.writeContract|\bnonce\b|\bsigner\b|waitForTransactionReceipt/i;
    for (const module of modules) {
      assert.doesNotMatch(await readFile(module, "utf8"), forbidden);
    }
  });
});
