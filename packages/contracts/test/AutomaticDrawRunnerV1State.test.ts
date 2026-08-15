import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  logicalDrawKey,
  type AutomaticDrawDueDecision,
} from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import {
  reserveAutomaticDraw,
  runAutomaticDrawReservationCycle,
  type AutomaticDrawAtomicReservationResult,
  type AutomaticDrawAtomicReservationStorage,
  type AutomaticDrawReservationRecord,
} from "../scripts/operator/automatic-draw-runner-v1-reservation.js";
import {
  JsonAutomaticDrawReservationStore,
  inspectAutomaticDrawReservationState,
} from "../scripts/operator/automatic-draw-runner-v1-state.js";
import { withExclusiveFileLock } from "../scripts/operator/durable-file.js";
import {
  FIXTURE_CHAIN_ID,
  FIXTURE_CONTRACT_ADDRESS,
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_OBSERVED_AT,
  FixtureLifecycleSnapshotAdapter,
  makePoolFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";

const directories: string[] = [];
const scope = {
  chainId: FIXTURE_CHAIN_ID,
  contractAddress: FIXTURE_CONTRACT_ADDRESS,
  poolId: 1n,
};

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-automatic-draw-state-"));
  directories.push(directory);
  return join(directory, "runner.automatic-draw-state.json");
}

function dueDecision(input: {
  poolId?: bigint;
  roundNumber?: bigint;
} = {}): AutomaticDrawDueDecision {
  const poolId = input.poolId ?? 1n;
  const roundNumber = input.roundNumber ?? 1n;
  return {
    status: "DRAW_DUE",
    readOnly: true,
    safety: "READ_ONLY_NO_KEYS_NO_TRANSACTIONS",
    chainId: FIXTURE_CHAIN_ID,
    contractAddress: FIXTURE_CONTRACT_ADDRESS,
    poolId,
    source: "fixture",
    sourceBlock: 12_345n,
    nextAction: "DRAW_DUE",
    reason: "Fixture Draw is due.",
    roundNumber,
    scheduledAt: FIXTURE_OBSERVED_AT,
    logicalDrawKey: logicalDrawKey({
      chainId: FIXTURE_CHAIN_ID,
      contractAddress: FIXTURE_CONTRACT_ADDRESS,
      poolId,
      roundNumber,
    }),
  };
}

function decisionAdapter(pools = [makePoolFixture({
  status: "Locked",
  lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL,
})]) {
  return new FixtureLifecycleSnapshotAdapter(makeSystemFixture(pools));
}

function reserve(
  store: AutomaticDrawAtomicReservationStorage,
  decision = dueDecision(),
) {
  return reserveAutomaticDraw(decision, store);
}

async function pathDoesNotExist(filePath: string): Promise<void> {
  await assert.rejects(readFile(filePath, "utf8"), { code: "ENOENT" });
}

async function runReservationChild(filePath: string): Promise<string> {
  const moduleUrl = pathToFileURL(resolve(
    "scripts/operator/automatic-draw-runner-v1-state.ts",
  )).href;
  const reservationUrl = pathToFileURL(resolve(
    "scripts/operator/automatic-draw-runner-v1-reservation.ts",
  )).href;
  const decisionUrl = pathToFileURL(resolve(
    "scripts/operator/automatic-draw-runner-v1-decision.ts",
  )).href;
  const source = `
    import { JsonAutomaticDrawReservationStore } from ${JSON.stringify(moduleUrl)};
    import { reserveAutomaticDraw } from ${JSON.stringify(reservationUrl)};
    import { logicalDrawKey } from ${JSON.stringify(decisionUrl)};
    const filePath = process.env.POP33_TEST_DRAW_STATE_PATH;
    if (!filePath) throw new Error("missing test state path");
    const identity = {
      chainId: 31337n,
      contractAddress: "0x0000000000000000000000000000000000000033",
      poolId: 1n,
      roundNumber: 1n,
    };
    const result = await reserveAutomaticDraw({
      status: "DRAW_DUE",
      readOnly: true,
      safety: "READ_ONLY_NO_KEYS_NO_TRANSACTIONS",
      ...identity,
      source: "fixture",
      sourceBlock: 12345n,
      nextAction: "DRAW_DUE",
      reason: "child fixture",
      scheduledAt: 1800000000n,
      logicalDrawKey: logicalDrawKey(identity),
    }, new JsonAutomaticDrawReservationStore(filePath));
    process.stdout.write(JSON.stringify({ status: result.status }));
  `;
  const environment = {
    POP33_TEST_DRAW_STATE_PATH: filePath,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      { cwd: resolve("."), env: environment, stdio: ["ignore", "pipe", "pipe"] },
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
        rejectPromise(new Error(`Reservation child failed (${code}): ${stderr}`));
        return;
      }
      resolvePromise((JSON.parse(stdout) as { status: string }).status);
    });
  });
}

class FakeAtomicReservationStorage
implements AutomaticDrawAtomicReservationStorage {
  readonly received: AutomaticDrawReservationRecord[] = [];

  constructor(
    private readonly outcome: AutomaticDrawAtomicReservationResult["status"],
  ) {}

  async reserveIfAbsent(
    record: AutomaticDrawReservationRecord,
  ): Promise<AutomaticDrawAtomicReservationResult> {
    this.received.push(record);
    return this.outcome === "UNKNOWN"
      ? { status: "UNKNOWN" }
      : { status: this.outcome, record };
  }
}

describe("Automatic Draw Runner V1 durable reservation state", function () {
  this.timeout(30_000);

  afterEach(async function () {
    while (directories.length > 0) {
      const directory = directories.pop();
      if (directory?.startsWith(tmpdir())) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("creates exactly one first-time reservation for a Phase 1 DRAW_DUE", async function () {
    const filePath = await temporaryStatePath();
    const result = await runAutomaticDrawReservationCycle({
      scope,
      adapter: decisionAdapter(),
      storage: new JsonAutomaticDrawReservationStore(filePath),
    });
    assert.equal(result.status, "RESERVED_FIRST_TIME");
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations.length, 1);
    assert.equal(state.operations[0].record.state, "RESERVED");
    assert.equal(state.operations[0].record.logicalDrawKey, result.decision.status === "DRAW_DUE"
      ? result.decision.logicalDrawKey
      : "unexpected");
  });

  it("maps provider-neutral atomic outcomes without filesystem access", async function () {
    const createdStorage = new FakeAtomicReservationStorage("CREATED");
    const existingStorage = new FakeAtomicReservationStorage("EXISTING");
    const unknownStorage = new FakeAtomicReservationStorage("UNKNOWN");

    const created = await reserve(createdStorage);
    const existing = await reserve(existingStorage);
    const unknown = await reserve(unknownStorage);

    assert.equal(created.status, "RESERVED_FIRST_TIME");
    assert.equal(existing.status, "EXISTING_OPERATION");
    assert.equal(unknown.status, "RECONCILIATION_REQUIRED");
    assert.equal(createdStorage.received.length, 1);
    assert.equal(createdStorage.received[0].schemaVersion, 1);
    assert.equal(createdStorage.received[0].action, "Draw");
    assert.equal(
      createdStorage.received[0].logicalDrawKey,
      dueDecision().logicalDrawKey,
    );
  });

  it("fails closed when an adapter returns an invalid domain record", async function () {
    const storage: AutomaticDrawAtomicReservationStorage = {
      async reserveIfAbsent(record) {
        return {
          status: "EXISTING",
          record: { ...record, poolId: "2" },
        };
      },
    };
    assert.equal((await reserve(storage)).status, "RECONCILIATION_REQUIRED");
  });

  it("returns the existing operation for sequential duplicate deliveries", async function () {
    const filePath = await temporaryStatePath();
    const store = new JsonAutomaticDrawReservationStore(filePath);
    const first = await reserve(store);
    const second = await reserve(store);
    const third = await reserve(store);
    assert.equal(first.status, "RESERVED_FIRST_TIME");
    assert.equal(second.status, "EXISTING_OPERATION");
    assert.equal(third.status, "EXISTING_OPERATION");
    assert.equal((await inspectAutomaticDrawReservationState(filePath)).operations.length, 1);
  });

  it("discovers the same durable operation after a store restart", async function () {
    const filePath = await temporaryStatePath();
    const first = await reserve(new JsonAutomaticDrawReservationStore(filePath));
    const reopened = await reserve(new JsonAutomaticDrawReservationStore(filePath));
    assert.equal(first.status, "RESERVED_FIRST_TIME");
    assert.equal(reopened.status, "EXISTING_OPERATION");
    assert.equal(reopened.operation?.logicalDrawKey, first.operation?.logicalDrawKey);
  });

  it("allows different rounds and pools only as different logical operations", async function () {
    const filePath = await temporaryStatePath();
    const store = new JsonAutomaticDrawReservationStore(filePath);
    const first = await reserve(store);
    const nextRound = await reserve(store, dueDecision({ roundNumber: 2n }));
    const otherPool = await reserve(store, dueDecision({ poolId: 2n }));
    assert.equal(first.status, "RESERVED_FIRST_TIME");
    assert.equal(nextRound.status, "RESERVED_FIRST_TIME");
    assert.equal(otherPool.status, "RESERVED_FIRST_TIME");
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations.length, 3);
    assert.equal(new Set(
      state.operations.map((operation) => operation.record.logicalDrawKey),
    ).size, 3);
  });

  it("fails closed for malformed JSON and never overwrites it", async function () {
    const filePath = await temporaryStatePath();
    await writeFile(filePath, "{", "utf8");
    const result = await reserve(new JsonAutomaticDrawReservationStore(filePath));
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(await readFile(filePath, "utf8"), "{");
  });

  it("fails closed for invalid format and revision metadata", async function () {
    type MutableState = {
      formatVersion: number;
      revision: number;
      operations: Array<{ revision: number }>;
    };
    const corruptions: Array<(state: MutableState) => void> = [
      (state) => { state.formatVersion = 2; },
      (state) => { state.revision = 2; },
      (state) => { state.operations[0].revision = 2; },
    ];
    for (const corrupt of corruptions) {
      const filePath = await temporaryStatePath();
      await reserve(new JsonAutomaticDrawReservationStore(filePath));
      const state = JSON.parse(await readFile(filePath, "utf8")) as MutableState;
      corrupt(state);
      const corruptedContents = JSON.stringify(state);
      await writeFile(filePath, corruptedContents, "utf8");
      const result = await reserve(new JsonAutomaticDrawReservationStore(filePath));
      assert.equal(result.status, "RECONCILIATION_REQUIRED");
      assert.equal(await readFile(filePath, "utf8"), corruptedContents);
    }
  });

  it("fails closed when stored scope and logical identity disagree", async function () {
    const filePath = await temporaryStatePath();
    await reserve(new JsonAutomaticDrawReservationStore(filePath));
    const state = JSON.parse(await readFile(filePath, "utf8")) as {
      operations: Array<{ record: { poolId: string } }>;
    };
    state.operations[0].record.poolId = "2";
    const corruptedContents = JSON.stringify(state);
    await writeFile(filePath, corruptedContents, "utf8");
    const result = await reserve(new JsonAutomaticDrawReservationStore(filePath));
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    assert.equal(await readFile(filePath, "utf8"), corruptedContents);
  });

  it("works in a child process with a deliberately minimal environment", async function () {
    const filePath = await temporaryStatePath();
    assert.equal(await runReservationChild(filePath), "RESERVED_FIRST_TIME");
    assert.equal((await inspectAutomaticDrawReservationState(filePath)).operations.length, 1);
  });

  it("does not create state for a Phase 1 NO_ACTION", async function () {
    const filePath = await temporaryStatePath();
    const result = await runAutomaticDrawReservationCycle({
      scope,
      adapter: decisionAdapter([makePoolFixture({ activePositionCount: 99n })]),
      storage: new JsonAutomaticDrawReservationStore(filePath),
    });
    assert.equal(result.status, "NO_RESERVATION");
    assert.equal(result.decision.status, "NO_ACTION");
    await pathDoesNotExist(filePath);
  });

  it("does not reserve inconsistent Phase 1 state", async function () {
    const filePath = await temporaryStatePath();
    const result = await runAutomaticDrawReservationCycle({
      scope,
      adapter: decisionAdapter([makePoolFixture({
        status: "Drawing",
        completedDrawRoundCount: 0n,
      })]),
      storage: new JsonAutomaticDrawReservationStore(filePath),
    });
    assert.equal(result.status, "NO_RESERVATION");
    assert.equal(result.decision.status, "INCONSISTENT");
    assert.equal(result.reconciliationRequired, true);
    await pathDoesNotExist(filePath);
  });

  it("does not reserve after a Phase 1 read failure", async function () {
    const filePath = await temporaryStatePath();
    const result = await runAutomaticDrawReservationCycle({
      scope,
      adapter: {
        source: "fixture",
        async readSnapshot() { throw new Error("fixture read failed"); },
      },
      storage: new JsonAutomaticDrawReservationStore(filePath),
    });
    assert.equal(result.status, "NO_RESERVATION");
    assert.equal(result.decision.status, "READ_FAILED");
    await pathDoesNotExist(filePath);
  });

  it("does not reserve an ambiguous multi-pool Phase 1 result", async function () {
    const filePath = await temporaryStatePath();
    const result = await runAutomaticDrawReservationCycle({
      scope,
      adapter: decisionAdapter([
        makePoolFixture({ poolId: 1n }),
        makePoolFixture({ poolId: 2n }),
      ]),
      storage: new JsonAutomaticDrawReservationStore(filePath),
    });
    assert.equal(result.status, "NO_RESERVATION");
    assert.equal(result.decision.status, "AMBIGUOUS");
    await pathDoesNotExist(filePath);
  });

  it("one cycle can reserve at most one logical Draw", async function () {
    const filePath = await temporaryStatePath();
    const result = await runAutomaticDrawReservationCycle({
      scope,
      adapter: decisionAdapter(),
      storage: new JsonAutomaticDrawReservationStore(filePath),
    });
    assert.equal(result.status, "RESERVED_FIRST_TIME");
    assert.equal((await inspectAutomaticDrawReservationState(filePath)).operations.length, 1);
  });

  it("leaves no record when failure happens before lock acquisition", async function () {
    const filePath = await temporaryStatePath();
    const result = await reserve(new JsonAutomaticDrawReservationStore(filePath, {
      beforeLock: () => { throw new Error("simulated crash before lock"); },
    }));
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    await pathDoesNotExist(filePath);
  });

  it("releases the lock and leaves no record after failure inside the lock", async function () {
    const filePath = await temporaryStatePath();
    const result = await reserve(new JsonAutomaticDrawReservationStore(filePath, {
      afterLockAcquired: () => { throw new Error("simulated crash inside lock"); },
    }));
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    await pathDoesNotExist(filePath);
    await pathDoesNotExist(`${filePath}.lock`);
  });

  it("leaves no partial record when the durable rename is interrupted", async function () {
    const filePath = await temporaryStatePath();
    const result = await reserve(new JsonAutomaticDrawReservationStore(filePath, {
      beforeRename: () => { throw new Error("simulated crash before durable write"); },
    }));
    assert.equal(result.status, "RECONCILIATION_REQUIRED");
    await pathDoesNotExist(filePath);
  });

  it("finds the reservation after a crash immediately after durable write", async function () {
    const filePath = await temporaryStatePath();
    const interrupted = await reserve(new JsonAutomaticDrawReservationStore(filePath, {
      afterDurableWrite: () => { throw new Error("simulated crash after write"); },
    }));
    assert.equal(interrupted.status, "RECONCILIATION_REQUIRED");
    assert.equal((await inspectAutomaticDrawReservationState(filePath)).operations.length, 1);
    const reopened = await reserve(new JsonAutomaticDrawReservationStore(filePath));
    assert.equal(reopened.status, "EXISTING_OPERATION");
  });

  it("fails closed under live lock contention without creating a record", async function () {
    const filePath = await temporaryStatePath();
    await withExclusiveFileLock(filePath, async () => {
      const result = await reserve(new JsonAutomaticDrawReservationStore(filePath));
      assert.equal(result.status, "RECONCILIATION_REQUIRED");
      await pathDoesNotExist(filePath);
    });
  });

  it("reclaims a lock owned by a dead process before reserving", async function () {
    const filePath = await temporaryStatePath();
    await writeFile(
      `${filePath}.lock`,
      JSON.stringify({ pid: 2_147_483_647, token: "abandoned" }),
      "utf8",
    );
    const result = await reserve(new JsonAutomaticDrawReservationStore(filePath));
    assert.equal(result.status, "RESERVED_FIRST_TIME");
    assert.equal((await inspectAutomaticDrawReservationState(filePath)).operations.length, 1);
    await pathDoesNotExist(`${filePath}.lock`);
  });

  it("two real child processes create exactly one durable reservation", async function () {
    const filePath = await temporaryStatePath();
    const statuses = await Promise.all([
      runReservationChild(filePath),
      runReservationChild(filePath),
    ]);
    assert.equal(statuses.filter((status) => status === "RESERVED_FIRST_TIME").length, 1);
    assert.ok(statuses.every((status) => [
      "RESERVED_FIRST_TIME",
      "EXISTING_OPERATION",
      "RECONCILIATION_REQUIRED",
    ].includes(status)));
    const state = await inspectAutomaticDrawReservationState(filePath);
    assert.equal(state.operations.length, 1);
    assert.equal(state.revision, 1);
  });
});
