import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getAddress } from "viem";

import { logicalDrawKey } from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import { handoffAutomaticDrawExecutionIntent } from "../scripts/operator/automatic-draw-runner-v1-handoff.js";
import {
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawStoredOperation,
} from "../scripts/operator/automatic-draw-runner-v1-progression.js";
import {
  JsonTransactionJournal,
  MemoryTransactionJournal,
  type JournalIdentity,
  type LogicalDrawTransactionJournal,
} from "../scripts/operator/transaction-journal.js";

const CHAIN_ID = 84_532n;
const CONTRACT = getAddress("0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F");
const TOKEN = getAddress("0xA7FA084b34c888061757d4b5FBb08a7B53fee786");
const OPERATOR_A = getAddress("0x0000000000000000000000000000000000000042");
const OPERATOR_B = getAddress("0x0000000000000000000000000000000000000043");
const identity: JournalIdentity = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  tokenAddress: TOKEN,
};
const directories: string[] = [];

function readyOperation(input: {
  poolId?: bigint;
  roundNumber?: bigint;
  operatorAddress?: string;
  revision?: number;
} = {}): AutomaticDrawStoredOperation {
  const poolId = input.poolId ?? 5n;
  const roundNumber = input.roundNumber ?? 3n;
  const key = logicalDrawKey({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    poolId,
    roundNumber,
  });
  return validateAutomaticDrawStoredOperation({
    revision: input.revision ?? 2,
    record: {
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
    },
    progression: {
      schemaVersion: 1,
      state: "PREFLIGHT_READY",
      updatedAt: "2026-08-15T10:01:00.000Z",
      preflight: {
        phase3Status: "READY_FOR_EXECUTION",
        planId: `plan-pool-${poolId}-round-${roundNumber}`,
        revalidationBlock: "12346",
        publicOperatorAddress: input.operatorAddress ?? OPERATOR_A,
        gasEstimate: "100000",
        runtimeGasEstimate: "101000",
        bufferedGasLimit: "126250",
        completedAt: "2026-08-15T10:01:00.000Z",
        dryRunOnly: true,
        transactionAuthorized: false,
        transactionSent: false,
      },
      manualReview: null,
    },
  });
}

function storageFor(
  operation: AutomaticDrawStoredOperation,
): Pick<AutomaticDrawProgressionStorage, "read"> {
  return {
    async read(logicalKey) {
      return logicalKey === operation.record.logicalDrawKey
        ? { status: "FOUND", operation: structuredClone(operation) }
        : { status: "NOT_FOUND" };
    },
  };
}

function handoff(
  journal: LogicalDrawTransactionJournal,
  operation = readyOperation(),
  expectedProgressionRevision = operation.revision,
) {
  return handoffAutomaticDrawExecutionIntent({
    logicalDrawKey: operation.record.logicalDrawKey,
    expectedProgressionRevision,
    progressionStorage: storageFor(operation),
    journal,
  });
}

async function temporaryJournalPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pop33-draw-handoff-"));
  directories.push(directory);
  return join(directory, "transactions.operator-journal.json");
}

async function runHandoffChild(
  filePath: string,
  operation: AutomaticDrawStoredOperation,
): Promise<string> {
  const handoffUrl = pathToFileURL(resolve(
    "scripts/operator/automatic-draw-runner-v1-handoff.ts",
  )).href;
  const journalUrl = pathToFileURL(resolve(
    "scripts/operator/transaction-journal.ts",
  )).href;
  const source = `
    import { handoffAutomaticDrawExecutionIntent } from ${JSON.stringify(handoffUrl)};
    import { JsonTransactionJournal } from ${JSON.stringify(journalUrl)};
    const operation = ${JSON.stringify(operation)};
    const identity = {
      chainId: BigInt(${JSON.stringify(CHAIN_ID.toString())}),
      contractAddress: ${JSON.stringify(CONTRACT)},
      tokenAddress: ${JSON.stringify(TOKEN)},
    };
    const journal = await JsonTransactionJournal.openExisting(
      ${JSON.stringify(filePath)},
      identity,
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    const result = await handoffAutomaticDrawExecutionIntent({
      logicalDrawKey: operation.record.logicalDrawKey,
      expectedProgressionRevision: operation.revision,
      progressionStorage: {
        async read() { return { status: "FOUND", operation }; },
      },
      journal,
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
        rejectPromise(new Error(`Draw handoff child failed (${code}): ${stderr}`));
        return;
      }
      resolvePromise((JSON.parse(stdout) as { status: string }).status);
    });
  });
}

describe("Automatic Draw Runner V1 shared execution gate and journal handoff", function () {
  this.timeout(30_000);

  afterEach(async function () {
    while (directories.length > 0) {
      const directory = directories.pop();
      if (directory?.startsWith(tmpdir())) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it("claims one prepared journal intent from PREFLIGHT_READY", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const operation = readyOperation();
    const outcome = await handoff(journal, operation);

    assert.equal(outcome.status, "HANDOFF_READY");
    assert.equal(outcome.journalIntentClaimed, true);
    assert.equal(outcome.journalOperation?.status, "prepared");
    assert.equal(outcome.journalOperation?.scope, operation.record.logicalDrawKey);
    assert.equal(outcome.journalOperation?.poolId, "5");
    assert.equal(outcome.journalOperation?.round, 3);
    assert.equal(outcome.journalOperation?.nonce, null);
    assert.equal(outcome.journalOperation?.transactionHash, null);
    assert.equal(outcome.nonceAcquired, false);
    assert.equal(outcome.transactionPreparedForBroadcast, false);
    assert.equal(outcome.transactionAuthorized, false);
    assert.equal(outcome.transactionSent, false);
  });

  it("returns the same intent for repeated same-wallet handoff", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const first = await handoff(journal);
    const second = await handoff(journal);

    assert.equal(first.status, "HANDOFF_READY");
    assert.equal(second.status, "EXISTING");
    assert.equal(second.journalOperation?.operationId, first.journalOperation?.operationId);
    assert.equal(journal.snapshot().operations.length, 1);
  });

  it("keeps logical Draw uniqueness independent of operator wallet", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const first = await handoff(journal, readyOperation({ operatorAddress: OPERATOR_A }));
    const second = await handoff(journal, readyOperation({ operatorAddress: OPERATOR_B }));

    assert.equal(first.status, "HANDOFF_READY");
    assert.equal(second.status, "EXISTING");
    assert.equal(journal.snapshot().operations.length, 1);
    assert.equal(journal.snapshot().operations[0].walletAddress, OPERATOR_A);
  });

  it("blocks the generic journal prepare API from bypassing the shared Draw gate", async function () {
    const journal = new MemoryTransactionJournal(identity);
    await handoff(journal, readyOperation({ operatorAddress: OPERATOR_A }));

    await assert.rejects(journal.prepare({
      action: "draw",
      scope: "a-different-wallet-scoped-idempotency-key",
      walletAddress: OPERATOR_B,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      poolId: 5n,
      round: 3,
      parameters: { poolId: 5n, roundNumber: 3 },
    }), /different transaction intent already owns this logical Draw/);
    assert.equal(journal.snapshot().operations.length, 1);
  });

  it("serializes concurrent callers on one journal instance", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const outcomes = await Promise.all([
      handoff(journal, readyOperation({ operatorAddress: OPERATOR_A })),
      handoff(journal, readyOperation({ operatorAddress: OPERATOR_B })),
    ]);

    assert.deepEqual(outcomes.map(({ status }) => status).sort(), ["EXISTING", "HANDOFF_READY"]);
    assert.equal(journal.snapshot().operations.length, 1);
  });

  it("enforces one winner across independent processes", async function () {
    const filePath = await temporaryJournalPath();
    await JsonTransactionJournal.open(filePath, identity);
    const operation = readyOperation();
    const statuses = await Promise.all([
      runHandoffChild(filePath, operation),
      runHandoffChild(filePath, readyOperation({ operatorAddress: OPERATOR_B })),
    ]);
    const reopened = await JsonTransactionJournal.openExisting(filePath, identity);

    assert.equal(statuses.filter((status) => status === "HANDOFF_READY").length, 1);
    assert.ok(statuses.every((status) => [
      "HANDOFF_READY",
      "EXISTING",
      "CONFLICT",
      "RECONCILIATION_REQUIRED",
    ].includes(status)));
    assert.equal(reopened.snapshot().operations.length, 1);
  });

  it("discovers the prepared intent after restart", async function () {
    const filePath = await temporaryJournalPath();
    const firstJournal = await JsonTransactionJournal.open(filePath, identity);
    const first = await handoff(firstJournal);
    const reopened = await JsonTransactionJournal.openExisting(filePath, identity);
    const recovered = await handoff(reopened);

    assert.equal(first.status, "HANDOFF_READY");
    assert.equal(recovered.status, "EXISTING");
    assert.equal(recovered.journalOperation?.operationId, first.journalOperation?.operationId);
    assert.equal(reopened.snapshot().operations.length, 1);
  });

  it("fails closed when the progression revision changed", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const outcome = await handoff(journal, readyOperation(), 1);

    assert.equal(outcome.status, "CONFLICT");
    assert.equal(journal.snapshot().operations.length, 0);
  });

  it("fails closed when progression state is unknown or invalid", async function () {
    const operation = readyOperation();
    const journal = new MemoryTransactionJournal(identity);
    const unknown = await handoffAutomaticDrawExecutionIntent({
      logicalDrawKey: operation.record.logicalDrawKey,
      expectedProgressionRevision: operation.revision,
      progressionStorage: { async read() { return { status: "UNKNOWN" }; } },
      journal,
    });
    const invalid = await handoffAutomaticDrawExecutionIntent({
      logicalDrawKey: operation.record.logicalDrawKey,
      expectedProgressionRevision: operation.revision,
      progressionStorage: {
        async read() { return { status: "FOUND", operation: { revision: 2 } }; },
      },
      journal,
    });

    assert.equal(unknown.status, "RECONCILIATION_REQUIRED");
    assert.equal(invalid.status, "RECONCILIATION_REQUIRED");
    assert.equal(journal.snapshot().operations.length, 0);
  });

  it("maps an unknown journal outcome to reconciliation", async function () {
    const operation = readyOperation();
    const journal = {
      runId: "not-used",
      snapshot: () => ({}) as never,
      prepare: async () => { throw new Error("not used"); },
      transition: async () => { throw new Error("not used"); },
      find: () => undefined,
      claimPreparedDraw: async () => ({ status: "UNKNOWN" as const }),
    } satisfies LogicalDrawTransactionJournal;
    const outcome = await handoff(journal, operation);

    assert.equal(outcome.status, "RECONCILIATION_REQUIRED");
    assert.equal(outcome.journalOperation, null);
  });

  it("fails closed on a stale journal revision", async function () {
    const filePath = await temporaryJournalPath();
    const current = await JsonTransactionJournal.open(filePath, identity);
    const stale = await JsonTransactionJournal.openExisting(filePath, identity);
    await current.prepare({
      action: "join",
      scope: "unrelated-join",
      walletAddress: OPERATOR_A,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      tokenAddress: TOKEN,
      poolId: 1n,
      parameters: { position: 1 },
    });
    const outcome = await handoff(stale);

    assert.equal(outcome.status, "CONFLICT");
    const reopened = await JsonTransactionJournal.openExisting(filePath, identity);
    assert.equal(reopened.snapshot().operations.filter(({ action }) => action === "draw").length, 0);
  });

  it("recovers safely when persistence fails before the atomic rename", async function () {
    const filePath = await temporaryJournalPath();
    await JsonTransactionJournal.open(filePath, identity);
    const interrupted = await JsonTransactionJournal.openExisting(filePath, identity, {
      beforeRename: () => { throw new Error("simulated pre-rename crash"); },
    });
    const uncertain = await handoff(interrupted);
    const reopened = await JsonTransactionJournal.openExisting(filePath, identity);

    assert.equal(uncertain.status, "RECONCILIATION_REQUIRED");
    assert.equal(reopened.snapshot().operations.length, 0);
    assert.equal((await handoff(reopened)).status, "HANDOFF_READY");
    assert.equal(reopened.snapshot().operations.length, 1);
  });

  it("finds the durable intent after acknowledgement uncertainty", async function () {
    const filePath = await temporaryJournalPath();
    await JsonTransactionJournal.open(filePath, identity);
    const uncertainJournal = await JsonTransactionJournal.openExisting(filePath, identity, {
      afterRename: () => { throw new Error("simulated acknowledgement loss"); },
    });
    const uncertain = await handoff(uncertainJournal);
    const reopened = await JsonTransactionJournal.openExisting(filePath, identity);
    const recovered = await handoff(reopened);

    assert.equal(uncertain.status, "RECONCILIATION_REQUIRED");
    assert.equal(reopened.snapshot().operations.length, 1);
    assert.equal(recovered.status, "EXISTING");
  });

  it("recognizes a pre-existing Draw intent even when its legacy scope differs", async function () {
    const journal = new MemoryTransactionJournal(identity);
    await journal.prepare({
      action: "draw",
      scope: "pool-5-round-3",
      walletAddress: OPERATOR_B,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      poolId: 5n,
      round: 3,
      parameters: { poolId: 5n, roundNumber: 3 },
    });
    const outcome = await handoff(journal);

    assert.equal(outcome.status, "EXISTING");
    assert.equal(journal.snapshot().operations.length, 1);
    assert.equal(outcome.journalOperation?.walletAddress, OPERATOR_B);
  });

  it("keeps different rounds and pools independent", async function () {
    const journal = new MemoryTransactionJournal(identity);
    const outcomes = await Promise.all([
      handoff(journal, readyOperation({ poolId: 5n, roundNumber: 3n })),
      handoff(journal, readyOperation({ poolId: 5n, roundNumber: 4n })),
      handoff(journal, readyOperation({ poolId: 6n, roundNumber: 3n })),
    ]);

    assert.ok(outcomes.every(({ status }) => status === "HANDOFF_READY"));
    assert.equal(journal.snapshot().operations.length, 3);
    assert.deepEqual(
      journal.snapshot().operations.map(({ poolId, round }) => `${poolId}:${round}`).sort(),
      ["5:3", "5:4", "6:3"],
    );
  });

  it("contains no signer, nonce acquisition, or broadcasting capability", async function () {
    const source = await readFile(resolve(
      "scripts/operator/automatic-draw-runner-v1-handoff.ts",
    ), "utf8");
    for (const forbidden of [
      "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY",
      "privateKeyToAccount",
      "createWalletClient",
      "writeContract",
      "sendTransaction",
      "getTransactionCount",
      "waitForTransactionReceipt",
      "loadExecutionClient",
    ]) {
      assert.equal(source.includes(forbidden), false, `Found forbidden capability: ${forbidden}`);
    }
  });
});
