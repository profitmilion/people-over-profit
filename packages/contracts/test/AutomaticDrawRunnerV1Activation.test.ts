import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Address } from "viem";

import {
  executeAutomaticDrawActivationOnce,
  prepareAutomaticDrawActivation,
  renderAutomaticDrawActivationResult,
  runAutomaticDrawOneShotActivation,
  type AutomaticDrawActivationServices,
} from "../scripts/automatic-draw-one-shot.js";
import { logicalDrawKey } from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import type {
  AutomaticDrawOneShotExecutionDependencies,
  AutomaticDrawOneShotExecutionOptions,
  AutomaticDrawOneShotExecutionResult,
} from "../scripts/operator/automatic-draw-runner-v1-execution.js";
import {
  JsonTransactionJournal,
  type JournalIdentity,
} from "../scripts/operator/transaction-journal.js";
import {
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_OBSERVED_AT,
  makePoolFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";
import type { SystemSnapshot } from "../scripts/operator/lifecycle-supervisor.js";

const CHAIN_ID = 84_532n;
const CONTRACT =
  "0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98" as Address;
const TOKEN =
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786" as Address;
const OPERATOR =
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB" as Address;
const OTHER_OPERATOR =
  "0x0000000000000000000000000000000000000001" as Address;
const BLOCK = 12_345n;
const SIMULATION_GAS = 100n;
const RUNTIME_GAS = 120n;
const identity: JournalIdentity = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
};
const directories: string[] = [];

interface Counters {
  signerLoads: number;
  nonceReads: number;
  preparations: number;
  broadcasts: number;
  receiptWaits: number;
}

interface PreparedFixture {
  directory: string;
  statePath: string;
  journalPath: string;
  planPath: string;
  key: string;
  progressionRevision: number;
  journalRevision: number;
  dependencies: AutomaticDrawOneShotExecutionDependencies;
  counters: Counters;
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
      rpcHost: "mocked-rpc",
      requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
      snapshotComplete: true,
      warnings: [],
    },
  });
}

function mockedDependencies(counters: Counters): AutomaticDrawOneShotExecutionDependencies {
  return {
    async readSnapshot(blockNumber) {
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
      return { result: 1n, gasEstimate: SIMULATION_GAS };
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
    async getTransactionCount() {
      counters.nonceReads += 1;
      return 7;
    },
    async loadExecutionClient() {
      counters.signerLoads += 1;
      return {
        chainId: CHAIN_ID,
        account: OPERATOR,
        contractAddress: CONTRACT,
        async prepareDraw(input) {
          counters.preparations += 1;
          return {
            gasLimit: input.gasLimit,
            async broadcast() {
              counters.broadcasts += 1;
              return `0x${"1".repeat(64)}` as `0x${string}`;
            },
          };
        },
      };
    },
    async waitForReceipt(transactionHash) {
      counters.receiptWaits += 1;
      return {
        transactionHash,
        status: "success",
        blockNumber: BLOCK + 1n,
      };
    },
  };
}

async function preparedFixture(): Promise<PreparedFixture> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-activation-"));
  directories.push(directory);
  const statePath = join(directory, "runner.automatic-draw-state.json");
  const journalPath = join(directory, "transactions.operator-journal.json");
  const planPath = join(directory, "draw-plan.json");
  const counters: Counters = {
    signerLoads: 0,
    nonceReads: 0,
    preparations: 0,
    broadcasts: 0,
    receiptWaits: 0,
  };
  const dependencies = mockedDependencies(counters);
  const prepared = await prepareAutomaticDrawActivation({
    poolId: 1n,
    planPath,
    automaticDrawStatePath: statePath,
    transactionJournalPath: journalPath,
    operatorAddress: OPERATOR,
    dependencies,
    workingDirectory: directory,
  });
  assert.equal(prepared.readinessStatus, "READY_TO_LOAD_SIGNER");
  return {
    directory,
    statePath,
    journalPath,
    planPath,
    key: prepared.logicalDrawKey,
    progressionRevision: prepared.progressionRevision,
    journalRevision: prepared.journalRevision,
    dependencies,
    counters,
  };
}

function durable(test: PreparedFixture) {
  return {
    automaticDrawStatePath: test.statePath,
    transactionJournalPath: test.journalPath,
    journalIdentity: identity,
    expectedProgressionRevision: test.progressionRevision,
    expectedJournalRevision: test.journalRevision,
    logicalDrawKey: test.key,
  };
}

function confirmation() {
  return {
    chainId: CHAIN_ID.toString(),
    contractAddress: CONTRACT,
    poolId: "1",
    roundNumber: "1",
  };
}

function coordinatorResult(
  status: AutomaticDrawOneShotExecutionResult["status"],
): AutomaticDrawOneShotExecutionResult {
  return {
    status,
    reason: `mocked ${status.toLowerCase()} outcome`,
    journalOperation: null,
    progression: null,
    guardedOutcome: null,
  };
}

describe("Automatic Draw one-shot activation", function () {
  afterEach(async function () {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("1-2. prepare reaches readiness without signer, nonce, preparation, broadcast, or receipt capabilities", async function () {
    const test = await preparedFixture();
    assert.deepEqual(test.counters, {
      signerLoads: 0,
      nonceReads: 0,
      preparations: 0,
      broadcasts: 0,
      receiptWaits: 0,
    });
    assert.ok((await readFile(test.planPath, "utf8")).includes("lifecycle-plan:"));
  });

  it("3. missing or invalid mode and confirmation never invoke execution service", async function () {
    let executeCalls = 0;
    const services: AutomaticDrawActivationServices = {
      async prepare() { throw new Error("not used"); },
      async executeOnce() {
        executeCalls += 1;
        throw new Error("must not run");
      },
    };
    await assert.rejects(
      runAutomaticDrawOneShotActivation({ mode: "", planPath: "plan.json" }, services),
      /mode prepare or --mode execute-once/i,
    );
    await assert.rejects(
      runAutomaticDrawOneShotActivation({ mode: "execute-once", planPath: "plan.json" }, services),
      /requires exact chain/i,
    );
    assert.equal(executeCalls, 0);
  });

  it("4 and 9-10. valid execute-once binds Pool 1 Round 1 and calls the coordinator exactly once", async function () {
    const test = await preparedFixture();
    let coordinatorCalls = 0;
    const received: AutomaticDrawOneShotExecutionOptions[] = [];
    const outcome = await executeAutomaticDrawActivationOnce({
      planPath: test.planPath,
      durable: durable(test),
      operatorAddress: OPERATOR,
      confirmation: confirmation(),
      dependencies: test.dependencies,
      workingDirectory: test.directory,
      async coordinator(options) {
        coordinatorCalls += 1;
        received.push(options);
        return coordinatorResult("CONFIRMED");
      },
    });
    assert.equal(outcome.status, "CONFIRMED");
    assert.equal(coordinatorCalls, 1);
    assert.equal(received[0]?.durable.logicalDrawKey, logicalDrawKey({
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      poolId: 1n,
      roundNumber: 1n,
    }));
    assert.equal(received[0]?.readiness.status, "READY_TO_LOAD_SIGNER");
    assert.equal(test.counters.signerLoads, 0);
    assert.equal(test.counters.nonceReads, 0);
  });

  it("5. target pool or round mismatch stops before coordinator and signer", async function () {
    const test = await preparedFixture();
    let coordinatorCalls = 0;
    for (const mismatch of [
      { ...confirmation(), poolId: "2" },
      { ...confirmation(), roundNumber: "2" },
    ]) {
      await assert.rejects(
        executeAutomaticDrawActivationOnce({
          planPath: test.planPath,
          durable: durable(test),
          operatorAddress: OPERATOR,
          confirmation: mismatch,
          dependencies: test.dependencies,
          workingDirectory: test.directory,
          async coordinator() {
            coordinatorCalls += 1;
            return coordinatorResult("CONFIRMED");
          },
        }),
        /confirmation does not match/i,
      );
    }
    assert.equal(coordinatorCalls, 0);
    assert.equal(test.counters.signerLoads, 0);
  });

  it("6. wrong operator or journal chain, contract, or token identity stops before signer", async function () {
    const test = await preparedFixture();
    let coordinatorCalls = 0;
    await assert.rejects(
      executeAutomaticDrawActivationOnce({
        planPath: test.planPath,
        durable: durable(test),
        operatorAddress: OTHER_OPERATOR,
        confirmation: confirmation(),
        dependencies: test.dependencies,
        workingDirectory: test.directory,
        async coordinator() {
          coordinatorCalls += 1;
          return coordinatorResult("CONFIRMED");
        },
      }),
      /approved Pilot 10 operator/i,
    );
    for (const wrongJournalIdentity of [
      { ...identity, chainId: 1n },
      { ...identity, contractAddress: OTHER_OPERATOR },
      { ...identity, tokenAddress: OTHER_OPERATOR },
    ]) {
      await assert.rejects(
        executeAutomaticDrawActivationOnce({
          planPath: test.planPath,
          durable: {
            ...durable(test),
            journalIdentity: wrongJournalIdentity,
          },
          operatorAddress: OPERATOR,
          confirmation: confirmation(),
          dependencies: test.dependencies,
          workingDirectory: test.directory,
          async coordinator() {
            coordinatorCalls += 1;
            return coordinatorResult("CONFIRMED");
          },
        }),
      );
    }
    assert.equal(coordinatorCalls, 0);
    assert.equal(test.counters.signerLoads, 0);
  });

  it("7. stale progression or journal revision stops before signer", async function () {
    for (const field of ["expectedProgressionRevision", "expectedJournalRevision"] as const) {
      const test = await preparedFixture();
      let coordinatorCalls = 0;
      const stale = { ...durable(test), [field]: durable(test)[field] + 1 };
      const outcome = await executeAutomaticDrawActivationOnce({
        planPath: test.planPath,
        durable: stale,
        operatorAddress: OPERATOR,
        confirmation: confirmation(),
        dependencies: test.dependencies,
        workingDirectory: test.directory,
        async coordinator() {
          coordinatorCalls += 1;
          return coordinatorResult("CONFIRMED");
        },
      });
      assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
      assert.equal(coordinatorCalls, 0);
      assert.equal(test.counters.signerLoads, 0);
    }
  });

  it("8. a journal operation beyond prepared stops before signer", async function () {
    const test = await preparedFixture();
    const journal = await JsonTransactionJournal.openExisting(
      test.journalPath,
      identity,
    );
    const operation = journal.snapshot().operations[0];
    assert.ok(operation);
    assert.equal(
      (await journal.claimReadyToBroadcast(operation.operationId, 7)).status,
      "CLAIMED",
    );
    let coordinatorCalls = 0;
    const outcome = await executeAutomaticDrawActivationOnce({
      planPath: test.planPath,
      durable: {
        ...durable(test),
        expectedJournalRevision: journal.snapshot().revision,
      },
      operatorAddress: OPERATOR,
      confirmation: confirmation(),
      dependencies: test.dependencies,
      workingDirectory: test.directory,
      async coordinator() {
        coordinatorCalls += 1;
        return coordinatorResult("CONFIRMED");
      },
    });
    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(coordinatorCalls, 0);
    assert.equal(test.counters.signerLoads, 0);
  });

  it("11-13. sanitized confirmed, reconciliation, and revert results exit without retry", async function () {
    for (const status of [
      "CONFIRMED",
      "RECONCILIATION_REQUIRED",
      "REVERTED",
    ] as const) {
      const test = await preparedFixture();
      let coordinatorCalls = 0;
      const outcome = await executeAutomaticDrawActivationOnce({
        planPath: test.planPath,
        durable: durable(test),
        operatorAddress: OPERATOR,
        confirmation: confirmation(),
        dependencies: test.dependencies,
        workingDirectory: test.directory,
        async coordinator() {
          coordinatorCalls += 1;
          return coordinatorResult(status);
        },
      });
      const rendered = renderAutomaticDrawActivationResult(outcome);
      assert.equal(coordinatorCalls, 1);
      assert.equal(outcome.status, status);
      assert.doesNotMatch(rendered, /private.?key|mnemonic|password|wallet object|signer object/i);
    }
  });

  it("16. old manual Pilot execute command is blocked while unrelated help remains available", function () {
    const cliPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../scripts/lifecycle-supervisor-cli.mjs",
    );
    const safeEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      POP33_AUTOMATIC_DRAW_LIVE_TEST_ACTIVE: "true",
    };
    const blocked = spawnSync(process.execPath, [
      cliPath,
      "--execute-draw",
      "mock-plan.json",
      "--confirm-chain",
      CHAIN_ID.toString(),
      "--confirm-contract",
      CONTRACT,
      "--confirm-pool",
      "1",
      "--confirm-round",
      "1",
    ], { encoding: "utf8", env: safeEnvironment });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /manual --execute-draw is disabled/i);

    const help = spawnSync(process.execPath, [cliPath, "--help"], {
      encoding: "utf8",
      env: safeEnvironment,
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: npm run supervisor/i);
  });
});
