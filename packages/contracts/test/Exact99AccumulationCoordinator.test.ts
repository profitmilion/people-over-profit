import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EXACT_99_COORDINATOR_MODES,
  EXACT_99_COORDINATOR_OPERATIONS,
  EXACT_99_COORDINATOR_RANGES,
  assertExact99CoordinatorMode,
  exact99CoordinatorOperationId,
  inspectExact99AccumulationCoordinator,
  planExact99AccumulationCoordinator,
  renderExact99CoordinatorInspection,
  simulateExact99AccumulationCoordinator,
  validateExact99CoordinatorRanges,
  type Exact99CoordinatorCheckpointId,
  type Exact99CoordinatorOperation,
  type Exact99CoordinatorRange,
  type Exact99CoordinatorSimulationOutcome,
} from "../scripts/operator/exact-99-accumulation-coordinator.js";
import {
  EXACT_99_FUNDING_PURPOSE,
  buildExact99FundingPlan,
  type Exact99FundingLimits,
  type Exact99FundingSignerIdentity,
} from "../scripts/operator/exact-99-funding.js";
import {
  buildInitialExact99ArtifactSet,
  validateExact99Journal,
  type Exact99Checkpoint,
  type Exact99Journal,
} from "../scripts/operator/exact-99-operator-artifacts.js";
import type { EncryptedWalletStoreInspection } from "../scripts/operator/encrypted-wallet-store.js";

const CREATED_AT = "2026-07-29T10:00:00.000Z";
const SET_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const STORE_FINGERPRINT = `sha256:${"ab".repeat(32)}`;

function address(index: number): string {
  return `0x${(index + 20_000).toString(16).padStart(40, "0")}`;
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

function fixture() {
  return buildInitialExact99ArtifactSet(store(), CREATED_AT, SET_ID);
}

function fundingPlan() {
  const artifact = fixture();
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
  return buildExact99FundingPlan({ manifest: artifact.manifest, limits, signer });
}

function hash(walletIndex: number, operation: Exact99CoordinatorOperation): string {
  const ordinal = EXACT_99_COORDINATOR_OPERATIONS.indexOf(operation) + 1;
  return `0x${(walletIndex * 10 + ordinal + 1).toString(16).padStart(64, "0")}`;
}

function success(
  walletIndex: number,
  operation: Exact99CoordinatorOperation,
): Exact99CoordinatorSimulationOutcome {
  return {
    type: "success",
    transactionHash: hash(walletIndex, operation),
    blockNumber: 1_000 + walletIndex * 10 + EXACT_99_COORDINATOR_OPERATIONS.indexOf(operation),
    gasUsed: "21000",
  };
}

function successOutcomes(startIndex: number, endIndex: number) {
  const outcomes = new Map<string, Exact99CoordinatorSimulationOutcome>();
  for (let walletIndex = startIndex; walletIndex <= endIndex; walletIndex += 1) {
    for (const operation of EXACT_99_COORDINATOR_OPERATIONS) {
      outcomes.set(`${walletIndex}:${operation}`, success(walletIndex, operation));
    }
  }
  return outcomes;
}

function run(input?: {
  checkpoint?: Exact99Checkpoint;
  journal?: Exact99Journal;
  checkpointId?: Exact99CoordinatorCheckpointId;
  authorizationPhrase?: string;
  outcomes?: ReadonlyMap<string, Exact99CoordinatorSimulationOutcome>;
  ranges?: readonly Exact99CoordinatorRange[];
  startedAt?: string;
}) {
  const artifact = fixture();
  const checkpointId = input?.checkpointId ?? "checkpoint-5";
  const range = EXACT_99_COORDINATOR_RANGES.find((candidate) => candidate.id === checkpointId)!;
  return simulateExact99AccumulationCoordinator({
    store: store(),
    manifest: artifact.manifest,
    checkpoint: input?.checkpoint ?? artifact.checkpoint,
    journal: input?.journal ?? artifact.journal,
    fundingPlan: fundingPlan(),
    checkpointId,
    authorizationPhrase: input?.authorizationPhrase ?? range.authorizationPhrase,
    outcomes: input?.outcomes ?? successOutcomes(range.startIndex, range.endIndex),
    ranges: input?.ranges,
    startedAt: input?.startedAt ?? CREATED_AT,
  });
}

function inspect(input?: {
  checkpoint?: Exact99Checkpoint;
  journal?: Exact99Journal;
  authorizationPhrase?: string;
  ranges?: readonly Exact99CoordinatorRange[];
}) {
  const artifact = fixture();
  return inspectExact99AccumulationCoordinator({
    store: store(),
    manifest: artifact.manifest,
    checkpoint: input?.checkpoint ?? artifact.checkpoint,
    journal: input?.journal ?? artifact.journal,
    fundingPlan: fundingPlan(),
    authorizationPhrase: input?.authorizationPhrase,
    ranges: input?.ranges,
  });
}

function completeThrough(
  target: Exact99CoordinatorCheckpointId,
): ReturnType<typeof run> {
  let checkpoint = fixture().checkpoint;
  let journal = fixture().journal;
  let result!: ReturnType<typeof run>;
  for (const range of EXACT_99_COORDINATOR_RANGES) {
    result = run({
      checkpoint,
      journal,
      checkpointId: range.id,
      authorizationPhrase: range.authorizationPhrase,
      outcomes: successOutcomes(range.startIndex, range.endIndex),
      startedAt: new Date(Date.parse(CREATED_AT) + range.startIndex * 100_000).toISOString(),
    });
    checkpoint = result.checkpoint;
    journal = result.journal;
    if (range.id === target) break;
  }
  return result;
}

describe("exact-99 cumulative accumulation coordinator", function () {
  this.timeout(120_000);

  it("defines fixed disjoint ranges 0-4, 5-19, 20-49, and 50-98", function () {
    assert.deepEqual(
      EXACT_99_COORDINATOR_RANGES.map(({ id, startIndex, endIndex }) => ({ id, startIndex, endIndex })),
      [
        { id: "checkpoint-5", startIndex: 0, endIndex: 4 },
        { id: "checkpoint-20", startIndex: 5, endIndex: 19 },
        { id: "checkpoint-50", startIndex: 20, endIndex: 49 },
        { id: "checkpoint-99", startIndex: 50, endIndex: 98 },
      ],
    );
    assert.equal(validateExact99CoordinatorRanges(EXACT_99_COORDINATOR_RANGES).length, 4);
  });

  it("covers exactly 99 indices and excludes index 99", function () {
    const indices = EXACT_99_COORDINATOR_RANGES.flatMap((range) =>
      Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, offset) => range.startIndex + offset),
    );
    assert.deepEqual(indices, Array.from({ length: 99 }, (_, index) => index));
    assert.equal(indices.includes(99), false);
  });

  it("rejects a gap and an overlap", function () {
    const gap = EXACT_99_COORDINATOR_RANGES.map((range) => ({ ...range }));
    gap[1].startIndex = 6;
    assert.throws(() => validateExact99CoordinatorRanges(gap), /fixed/);
    const overlap = EXACT_99_COORDINATOR_RANGES.map((range) => ({ ...range }));
    overlap[1].startIndex = 4;
    assert.throws(() => validateExact99CoordinatorRanges(overlap), /fixed/);
  });

  it("accepts only plan, inspect, and simulate local modes", function () {
    assert.deepEqual(EXACT_99_COORDINATOR_MODES, ["plan", "inspect", "simulate"]);
    for (const mode of EXACT_99_COORDINATOR_MODES) assert.doesNotThrow(() => assertExact99CoordinatorMode(mode));
    for (const mode of ["execute", "send", "broadcast"]) {
      assert.throws(() => assertExact99CoordinatorMode(mode), /plan, inspect, or simulate/);
    }
  });

  it("plans the first funding operation for wallet index 0", function () {
    const artifact = fixture();
    const report = planExact99AccumulationCoordinator({
      store: store(),
      manifest: artifact.manifest,
      checkpoint: artifact.checkpoint,
      journal: artifact.journal,
      fundingPlan: fundingPlan(),
    });
    assert.equal(report.mode, "plan");
    assert.equal(report.readyForSimulation, true);
    assert.equal(report.state, "awaiting-checkpoint-5-authorization");
    assert.equal(report.currentCheckpoint, "checkpoint-5");
    assert.deepEqual(report.currentRange, { startIndex: 0, endIndex: 4 });
    assert.equal(report.currentWalletIndex, 0);
    assert.equal(report.currentOperation, "funding");
    assert.equal(report.lastCompletedIndex, null);
  });

  it("requires the exact authorization phrase for each checkpoint", function () {
    for (const range of EXACT_99_COORDINATOR_RANGES) {
      assert.match(range.authorizationPhrase, new RegExp(`${range.targetWalletCount}$`));
    }
    const rejected = run({ authorizationPhrase: "AUTHORIZE POP33 EXACT 99 CHECKPOINT 20" });
    assert.equal(rejected.stopped, true);
    assert.equal(rejected.processedOperations, 0);
    assert.match(rejected.stopReason!, /preflight blocked/);
  });

  it("completes checkpoint 5 and waits for checkpoint 20 authorization", function () {
    const result = run();
    assert.equal(result.stopped, false);
    assert.equal(result.processedOperations, 20);
    assert.equal(result.completedCheckpoint, "checkpoint-5");
    assert.equal(result.transitionedThrough, "checkpoint-5-complete");
    assert.equal(result.checkpoint.confirmedWalletCount, 5);
    assert.deepEqual(result.checkpoint.counters, {
      funded: 5, faucet: 5, approve: 5, join: 5, draw: 0, claim: 0,
    });
    assert.equal(result.inspection.state, "awaiting-checkpoint-20-authorization");
  });

  it("completes checkpoints 5, 20, 50, and 99 in order", function () {
    const result = completeThrough("checkpoint-99");
    assert.equal(result.completedCheckpoint, "checkpoint-99");
    assert.equal(result.transitionedThrough, "checkpoint-99-complete");
    assert.equal(result.checkpoint.confirmedWalletCount, 99);
    assert.deepEqual(result.checkpoint.counters, {
      funded: 99, faucet: 99, approve: 99, join: 99, draw: 0, claim: 0,
    });
    assert.equal(result.checkpoint.stage, "awaiting-manual-100");
    assert.equal(result.inspection.state, "awaiting-manual-100");
    assert.equal(result.inspection.nextOperation, null);
  });

  it("rejects skipping a checkpoint", function () {
    const result = run({
      checkpointId: "checkpoint-20",
      authorizationPhrase: EXACT_99_COORDINATOR_RANGES[1].authorizationPhrase,
    });
    assert.equal(result.stopped, true);
    assert.equal(result.processedOperations, 0);
  });

  it("rejects rerunning a completed checkpoint", function () {
    const first = run();
    const repeated = run({
      checkpoint: first.checkpoint,
      journal: first.journal,
      checkpointId: "checkpoint-5",
      authorizationPhrase: EXACT_99_COORDINATOR_RANGES[0].authorizationPhrase,
    });
    assert.equal(repeated.stopped, true);
    assert.equal(repeated.processedOperations, 0);
  });

  it("stops on a failure at the first wallet", function () {
    const outcomes = successOutcomes(0, 4);
    outcomes.set("0:funding", { type: "failed", error: "fixture failure" });
    const result = run({ outcomes });
    assert.equal(result.stopped, true);
    assert.equal(result.processedOperations, 1);
    assert.equal(result.checkpoint.stage, "manual-review");
    assert.equal(result.inspection.state, "manual-review");
  });

  it("stops on the first failure in the middle of a range", function () {
    const outcomes = successOutcomes(0, 4);
    outcomes.set("2:approve", { type: "failed", error: "fixture middle failure" });
    const result = run({ outcomes });
    assert.equal(result.stopped, true);
    assert.equal(result.processedOperations, 11);
    assert.equal(result.checkpoint.confirmedWalletCount, 2);
    assert.equal(result.journal.entries.some((entry) => entry.walletIndex === 3), false);
  });

  it("blocks on pending without advancing to the next operation", function () {
    const outcomes = successOutcomes(0, 4);
    outcomes.set("1:faucet", { type: "pending", transactionHash: hash(1, "faucet") });
    const result = run({ outcomes });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.pending, true);
    assert.equal(result.journal.entries.some((entry) => entry.walletIndex === 1 && entry.type === "approve"), false);
    assert.equal(result.inspection.state, "blocked");
  });

  it("blocks on an ambiguous result", function () {
    const outcomes = successOutcomes(0, 4);
    outcomes.set("0:approve", {
      type: "ambiguous",
      transactionHash: hash(0, "approve"),
      error: "fixture receipt disagreement",
    });
    const result = run({ outcomes });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.ambiguous, true);
    assert.equal(result.inspection.state, "blocked");
  });

  it("stops on an inconsistent fixture receipt", function () {
    const outcomes = successOutcomes(0, 4);
    outcomes.set("0:join", {
      type: "inconsistent-receipt",
      transactionHash: hash(0, "join"),
      error: "fixture receipt does not match expected state",
    });
    const result = run({ outcomes });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.ambiguous, true);
    assert.equal(result.journal.entries.some((entry) =>
      entry.walletIndex === 1 && entry.type === "funding"), false);
  });

  it("blocks on manual review", function () {
    const outcomes = successOutcomes(0, 4);
    outcomes.set("0:join", { type: "manual-review", error: "fixture review" });
    const result = run({ outcomes });
    assert.equal(result.stopped, true);
    assert.equal(result.checkpoint.recovery.manualReview, true);
    assert.equal(result.inspection.state, "manual-review");
  });

  it("resumes safely after several confirmed wallets", function () {
    const partial = run({ outcomes: successOutcomes(0, 1) });
    assert.equal(partial.checkpoint.confirmedWalletCount, 2);
    const resumed = run({
      checkpoint: partial.checkpoint,
      journal: partial.journal,
      outcomes: successOutcomes(2, 4),
      startedAt: "2026-07-29T11:00:00.000Z",
    });
    assert.equal(resumed.completedCheckpoint, "checkpoint-5");
    assert.equal(resumed.processedOperations, 12);
    assert.equal(resumed.checkpoint.confirmedWalletCount, 5);
  });

  it("resumes a partially completed wallet at its first unfinished operation", function () {
    const outcomes = new Map<string, Exact99CoordinatorSimulationOutcome>([
      ["0:funding", success(0, "funding")],
      ["0:faucet", success(0, "faucet")],
    ]);
    const partial = run({ outcomes });
    assert.equal(partial.inspection.currentWalletIndex, 0);
    assert.equal(partial.inspection.currentOperation, "approve");
    const resumed = run({
      checkpoint: partial.checkpoint,
      journal: partial.journal,
      outcomes: new Map([
        ...successOutcomes(0, 4),
      ]),
      startedAt: "2026-07-29T11:00:00.000Z",
    });
    assert.equal(resumed.completedCheckpoint, "checkpoint-5");
    assert.equal(resumed.processedOperations, 18);
    const fundingConfirmed = resumed.journal.entries.filter((entry) =>
      entry.walletIndex === 0 && entry.type === "funding" && entry.status === "confirmed",
    );
    assert.equal(fundingConfirmed.length, 1);
  });

  it("does not repeat confirmed operations or change operation IDs and hashes", function () {
    const partial = run({ outcomes: successOutcomes(0, 0) });
    const priorConfirmed = partial.journal.entries.filter((entry) => entry.status === "confirmed");
    const resumed = run({
      checkpoint: partial.checkpoint,
      journal: partial.journal,
      outcomes: successOutcomes(1, 4),
      startedAt: "2026-07-29T11:00:00.000Z",
    });
    for (const prior of priorConfirmed) {
      const matches = resumed.journal.entries.filter((entry) =>
        entry.operationId === prior.operationId && entry.status === "confirmed",
      );
      assert.equal(matches.length, 1);
      assert.equal(matches[0].transactionHash, prior.transactionHash);
    }
  });

  it("detects checkpoint and journal counter divergence", function () {
    const completed = run();
    const report = inspect({
      checkpoint: {
        ...completed.checkpoint,
        counters: { ...completed.checkpoint.counters, funded: 4 },
      },
      journal: completed.journal,
    });
    assert.equal(report.readyForSimulation, false);
    assert.match(report.blockers.join("\n"), /count|counter/i);
  });

  it("rejects changed wallet order", function () {
    const artifact = fixture();
    const changed = {
      ...artifact.manifest,
      walletAddresses: [
        artifact.manifest.walletAddresses[1],
        artifact.manifest.walletAddresses[0],
        ...artifact.manifest.walletAddresses.slice(2),
      ],
    };
    const report = inspectExact99AccumulationCoordinator({
      store: store(),
      manifest: changed,
      checkpoint: artifact.checkpoint,
      journal: artifact.journal,
      fundingPlan: fundingPlan(),
    });
    assert.equal(report.readyForSimulation, false);
    assert.match(report.blockers.join("\n"), /wallet order digest mismatch/);
  });

  it("rejects a journal operation outside its bound checkpoint range", function () {
    const partial = run({ outcomes: new Map([["0:funding", success(0, "funding")]]) });
    const entries = partial.journal.entries.map((entry) =>
      entry.walletIndex === 0
        ? { ...entry, coordinator: { ...entry.coordinator!, rangeEnd: 5 } }
        : entry,
    );
    const changedJournal = validateExact99Journal({
      ...partial.journal,
      entries,
    }, fixture().manifest);
    const report = inspect({ checkpoint: partial.checkpoint, journal: changedJournal });
    assert.equal(report.readyForSimulation, false);
    assert.match(report.blockers.join("\n"), /checkpoint range/);
  });

  it("hard-stops after index 98 and refuses an automatic one-hundredth join", function () {
    const complete = completeThrough("checkpoint-99");
    assert.equal(complete.inspection.lastCompletedIndex, 98);
    assert.equal(complete.inspection.currentWalletIndex, null);
    assert.throws(
      () => exact99CoordinatorOperationId({
        manifest: fixture().manifest,
        fundingPlan: fundingPlan(),
        walletIndex: 99,
        operation: "join",
      }),
      /between 0 and 98/,
    );
    assert.throws(
      () => simulateExact99AccumulationCoordinator({
        store: store(),
        manifest: fixture().manifest,
        checkpoint: complete.checkpoint,
        journal: complete.journal,
        fundingPlan: fundingPlan(),
        checkpointId: "checkpoint-99",
        authorizationPhrase: EXACT_99_COORDINATOR_RANGES[3].authorizationPhrase,
        outcomes: new Map(),
        startedAt: "2026-07-30T10:00:00.000Z",
      }),
      /one-hundredth join remains manual/,
    );
  });

  it("binds every simulated journal event to checkpoint, range, order, and funding plan", function () {
    const result = run({ outcomes: successOutcomes(0, 0) });
    for (const entry of result.journal.entries) {
      assert.deepEqual(entry.coordinator, {
        checkpoint: "checkpoint-5",
        rangeStart: 0,
        rangeEnd: 4,
        walletOrderDigest: fixture().manifest.walletOrderDigest,
        fundingPlanId: fundingPlan().planId,
      });
    }
  });

  it("keeps inspection and rendered reports free of secret-shaped fixture data", function () {
    const report = inspect();
    const rendered = renderExact99CoordinatorInspection(report);
    const serialized = JSON.stringify(report);
    for (const forbidden of ["privateKey", "mnemonic", "password", "ciphertext"]) {
      assert.equal(serialized.includes(forbidden), false);
      assert.equal(rendered.includes(forbidden), false);
    }
    assert.equal(rendered.includes(STORE_FINGERPRINT.slice(7)), false);
  });

  it("contains no provider, signer, key loading, network transport, or public runner", async function () {
    const source = await readFile(
      new URL("../scripts/operator/exact-99-accumulation-coordinator.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /JsonRpcProvider|BrowserProvider|Wallet\.createRandom|privateKey\s*[:=]|sendTransaction|sendRawTransaction|broadcastTransaction|writeContract|process\.env|fetch\s*\(|axios/i,
    );
    assert.deepEqual(EXACT_99_COORDINATOR_MODES, ["plan", "inspect", "simulate"]);
  });
});
