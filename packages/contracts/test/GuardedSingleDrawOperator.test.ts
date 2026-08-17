import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAddress, type Address, type Hex } from "viem";

import {
  computeLifecycleActionPlanFingerprint,
  createLifecycleActionPlan,
  serializeLifecycleActionPlan,
  type LifecycleActionPlan,
} from "../scripts/operator/lifecycle-action-plan.js";
import {
  createBaseSepoliaGuardedDrawDependencies,
  GuardedDrawAuditFile,
} from "../scripts/operator/guarded-single-draw-base-sepolia.js";
import {
  GUARDED_DRAW_EXIT_CODES,
  calculateGuardedDrawGasPlan,
  executeGuardedSingleDraw,
  inspectGuardedSingleDraw,
  renderGuardedDrawJson,
  simulateGuardedSingleDraw,
  type GuardedDrawAuditRecord,
  type GuardedDrawDependencies,
} from "../scripts/operator/guarded-single-draw.js";
import type { DrawPreSignerConsumerResult } from "../scripts/operator/draw-pre-signer-consumer.js";
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
  LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
} from "../scripts/operator/lifecycle-supervisor-base-sepolia.js";

const OPERATOR = getAddress("0x0000000000000000000000000000000000000042");
const APPROVED_PILOT_OPERATOR = getAddress(
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB",
);
const OTHER_PUBLIC_OPERATOR = getAddress(
  "0x0000000000000000000000000000000000000043",
);
const HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

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
      rpcHost: "sepolia.base.org",
      requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
      snapshotComplete: true,
      warnings: [],
    },
    ...overrides,
  });
}

function planFor(snapshot = dueSnapshot()): LifecycleActionPlan {
  return createLifecycleActionPlan(
    snapshot,
    analyzeLifecycleSnapshot(snapshot),
    1n,
    { sourceReference: "base-sepolia" },
  );
}

function resign(plan: LifecycleActionPlan): LifecycleActionPlan {
  const copy = structuredClone(plan);
  const fingerprint = computeLifecycleActionPlanFingerprint(copy);
  return {
    ...copy,
    fingerprint,
    planId: fingerprint.replace("sha256:", "lifecycle-plan:"),
  };
}

function completedSnapshot(blockNumber = 12_346n): SystemSnapshot {
  const observedAt = FIXTURE_OBSERVED_AT + 1n;
  const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL;
  const rounds = Array.from({ length: 10 }, (_, index) =>
    makeRoundFixture({
      number: BigInt(index + 1),
      lockedAt,
      observedAt,
      finalized: index === 0,
    }));
  return dueSnapshot({
    blockNumber,
    observedAt,
    pools: [
      makePoolFixture({
        status: "Drawing",
        lockedAt,
        observedAt,
        completedDrawRoundCount: 1n,
        rounds,
      }),
    ],
  });
}

interface Counters {
  reads: number;
  identities: number;
  simulations: number;
  estimates: number;
  consumers: number;
  loads: number;
  prepares: number;
  sends: number;
  waits: number;
  audits: GuardedDrawAuditRecord[];
  simulatedArgs: Array<readonly [bigint, bigint]>;
  sentArgs: Array<readonly [bigint, bigint]>;
  preparedGasLimits: bigint[];
  executionOrder: string[];
}

function readyConsumerResult(logicalKey: string): DrawPreSignerConsumerResult {
  const timestamp = "2026-08-15T10:00:00.000Z";
  return {
    status: "CONSUMER_READY",
    logicalDrawKey: logicalKey,
    journalRevision: 1,
    operation: {
      operationId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      idempotencyKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "123e4567-e89b-42d3-a456-426614174000",
      action: "draw",
      scope: logicalKey,
      walletAddress: OPERATOR,
      chainId: "84532",
      contractAddress: LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
      tokenAddress: null,
      poolId: "1",
      round: 1,
      nonce: null,
      transactionHash: null,
      parameterDigest: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      status: "prepared",
      createdAt: timestamp,
      updatedAt: timestamp,
      receipt: null,
      error: null,
    },
    existingIntentRequired: true,
    intentCreated: false,
    executionAuthorized: false,
    nonceAcquired: false,
    transactionPrepared: false,
    transactionSent: false,
    reason: "Prepared intent validated by the test seam.",
  };
}

function dependencies(input: {
  snapshots?: readonly SystemSnapshot[];
  latestBlock?: bigint;
  chainId?: bigint;
  contractAddress?: string;
  hasBytecode?: boolean;
  simulationError?: Error;
  simulationGasEstimate?: bigint | null;
  runtimeEstimate?: bigint;
  runtimeEstimateError?: Error;
  preparedGasLimit?: bigint;
  postSnapshotError?: Error;
  loadError?: Error;
  receiptError?: Error;
  receiptStatus?: "success" | "reverted";
  consumerResult?: DrawPreSignerConsumerResult;
  consumerError?: Error;
} = {}): { dependencies: GuardedDrawDependencies; counters: Counters } {
  const snapshots = input.snapshots ?? [dueSnapshot()];
  const counters: Counters = {
    reads: 0,
    identities: 0,
    simulations: 0,
    estimates: 0,
    consumers: 0,
    loads: 0,
    prepares: 0,
    sends: 0,
    waits: 0,
    audits: [],
    simulatedArgs: [],
    sentArgs: [],
    preparedGasLimits: [],
    executionOrder: [],
  };
  const deps: GuardedDrawDependencies = {
    async readSnapshot(blockNumber) {
      if (input.postSnapshotError && counters.reads >= 2) {
        counters.reads += 1;
        throw input.postSnapshotError;
      }
      const candidate = snapshots[Math.min(counters.reads, snapshots.length - 1)];
      counters.reads += 1;
      const copy = structuredClone(candidate);
      if (blockNumber !== undefined && copy.blockNumber !== blockNumber) {
        copy.blockNumber = blockNumber;
      }
      return copy;
    },
    async readPublicIdentity() {
      counters.identities += 1;
      return {
        chainId: input.chainId ?? 84_532n,
        contractAddress:
          input.contractAddress ??
          LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
        hasBytecode: input.hasBytecode ?? true,
      };
    },
    async getLatestBlockNumber() {
      return input.latestBlock ?? (snapshots[0].blockNumber as bigint);
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
      if (input.runtimeEstimateError) throw input.runtimeEstimateError;
      return input.runtimeEstimate ?? 123_456n;
    },
    async consumePreparedDrawIntent(context) {
      counters.consumers += 1;
      counters.executionOrder.push("consumer");
      if (input.consumerError) throw input.consumerError;
      return input.consumerResult ?? readyConsumerResult(context.logicalDrawKey);
    },
    async loadExecutionClient() {
      counters.loads += 1;
      counters.executionOrder.push("loader");
      if (input.loadError) throw input.loadError;
      return {
        chainId: 84_532n,
        account: OPERATOR,
        contractAddress:
          LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS as Address,
        async prepareDraw(call) {
          counters.prepares += 1;
          counters.preparedGasLimits.push(call.gasLimit);
          return {
            gasLimit: input.preparedGasLimit ?? call.gasLimit,
            async broadcast() {
              counters.sends += 1;
              counters.sentArgs.push(call.args);
              return HASH;
            },
          };
        },
      };
    },
    async waitForReceipt(transactionHash) {
      counters.waits += 1;
      if (input.receiptError) throw input.receiptError;
      return {
        transactionHash,
        status: input.receiptStatus ?? "success",
        blockNumber: 12_346n,
      };
    },
    async writeAudit(record) {
      counters.audits.push(structuredClone(record));
    },
  };
  return { dependencies: deps, counters };
}

function common(plan = planFor()) {
  return {
    planJson: serializeLifecycleActionPlan(plan),
    operatorAddress: OPERATOR,
  };
}

function confirmation(plan = planFor()) {
  return {
    chainId: plan.identity.chainId,
    contractAddress: plan.identity.contractAddress,
    poolId: plan.scope.poolId,
    roundNumber: plan.scope.roundNumber as string,
  };
}

describe("guarded single-Draw operator", function () {
  it("1. performs a valid inspect", async function () {
    const mock = dependencies();
    const result = await inspectGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "INSPECT_VALID");
    assert.equal(result.exitCode, GUARDED_DRAW_EXIT_CODES.INSPECT_VALID);
  });

  it("2. performs a valid simulation", async function () {
    const mock = dependencies();
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.simulation?.gasEstimate, 123_456n);
  });

  it("3. permits simulation only after VALID", async function () {
    const mock = dependencies();
    await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(mock.counters.simulations, 1);
  });

  it("4. blocks simulation for STALE", async function () {
    const snapshot = dueSnapshot({ observedAt: FIXTURE_OBSERVED_AT + 7_201n });
    const mock = dependencies({ snapshots: [snapshot] });
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "STALE");
    assert.equal(mock.counters.simulations, 0);
  });

  it("5. blocks simulation for BLOCKED", async function () {
    const snapshot = dueSnapshot({ blockNumber: 1n });
    const mock = dependencies({ snapshots: [snapshot] });
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "BLOCKED");
  });

  it("6. blocks simulation for INCOMPLETE", async function () {
    const snapshot = dueSnapshot({ blockNumber: null });
    const mock = dependencies({ snapshots: [snapshot] });
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "INCOMPLETE");
  });

  it("7. blocks simulation for INVALID_PLAN", async function () {
    const mock = dependencies();
    const result = await simulateGuardedSingleDraw(
      { planJson: "{}" },
      mock.dependencies,
    );
    assert.equal(result.status, "INVALID_PLAN");
  });

  it("8. rejects a plan for the wrong chain ID", async function () {
    const plan = planFor();
    plan.identity.chainId = "1";
    const result = await inspectGuardedSingleDraw(
      common(resign(plan)),
      dependencies().dependencies,
    );
    assert.equal(result.status, "BLOCKED");
  });

  it("9. rejects a plan for the wrong contract", async function () {
    const plan = planFor();
    plan.identity.contractAddress =
      "0x0000000000000000000000000000000000000001";
    const result = await inspectGuardedSingleDraw(
      common(resign(plan)),
      dependencies().dependencies,
    );
    assert.equal(result.status, "BLOCKED");
  });

  it("10. rejects a pool ID not present in the fresh snapshot", async function () {
    const plan = planFor();
    plan.scope.poolId = "2";
    const result = await inspectGuardedSingleDraw(
      common(resign(plan)),
      dependencies().dependencies,
    );
    assert.equal(result.status, "STALE");
  });

  it("11. rejects a changed round number", async function () {
    const plan = planFor();
    plan.scope.roundNumber = "2";
    const result = await inspectGuardedSingleDraw(
      common(resign(plan)),
      dependencies().dependencies,
    );
    assert.equal(result.status, "STALE");
  });

  it("12. rejects a non-actionable plan", async function () {
    const plan = planFor();
    plan.scope.classification = "informational";
    const result = await inspectGuardedSingleDraw(
      common(resign(plan)),
      dependencies().dependencies,
    );
    assert.equal(result.status, "BLOCKED");
  });

  it("13. rejects a plan for a different action", async function () {
    const plan = planFor();
    plan.scope.plannedAction = "WAIT";
    const result = await inspectGuardedSingleDraw(
      common(resign(plan)),
      dependencies().dependencies,
    );
    assert.equal(result.status, "BLOCKED");
  });

  it("14. rejects an over-age plan", async function () {
    const fresh = dueSnapshot({ observedAt: FIXTURE_OBSERVED_AT + 61n });
    const mock = dependencies({ snapshots: [fresh] });
    const result = await inspectGuardedSingleDraw(
      { ...common(), maxPlanAgeSeconds: 60n },
      mock.dependencies,
    );
    assert.equal(result.status, "STALE");
  });

  it("15. rejects missing bytecode", async function () {
    const mock = dependencies({ hasBytecode: false });
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "BLOCKED");
  });

  it("16. reports a successful simulation result", async function () {
    const result = await simulateGuardedSingleDraw(
      common(),
      dependencies().dependencies,
    );
    assert.equal(result.simulation?.result, 7n);
    assert.match(result.calldata ?? "", /^0x[0-9a-f]+$/);
  });

  it("17. translates a simulation revert", async function () {
    const mock = dependencies({
      simulationError: new Error("PoolNotDrawable"),
    });
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "SIMULATION_FAILED");
    assert.match(result.message, /PoolNotDrawable/);
  });

  it("18. requires an operator account for simulation", async function () {
    const mock = dependencies();
    const result = await simulateGuardedSingleDraw(
      { planJson: common().planJson },
      mock.dependencies,
    );
    assert.equal(result.status, "MISSING_OPERATOR_ACCOUNT");
  });

  it("19. validates the operator account format", async function () {
    const mock = dependencies();
    const result = await simulateGuardedSingleDraw(
      { planJson: common().planJson, operatorAddress: "invalid" },
      mock.dependencies,
    );
    assert.equal(result.status, "MISSING_OPERATOR_ACCOUNT");
  });

  it("20. requires exact execute confirmations", async function () {
    const mock = dependencies();
    const result = await executeGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.status, "CONFIRMATION_MISMATCH");
    assert.equal(mock.counters.loads, 0);
  });

  it("21. rejects a wrong chain confirmation", async function () {
    const plan = planFor();
    const result = await executeGuardedSingleDraw(
      { ...common(plan), confirmation: { ...confirmation(plan), chainId: "1" } },
      dependencies().dependencies,
    );
    assert.equal(result.status, "CONFIRMATION_MISMATCH");
  });

  it("22. rejects a wrong pool confirmation", async function () {
    const plan = planFor();
    const result = await executeGuardedSingleDraw(
      { ...common(plan), confirmation: { ...confirmation(plan), poolId: "2" } },
      dependencies().dependencies,
    );
    assert.equal(result.status, "CONFIRMATION_MISMATCH");
  });

  it("23. rejects a wrong round confirmation", async function () {
    const plan = planFor();
    const result = await executeGuardedSingleDraw(
      {
        ...common(plan),
        confirmation: { ...confirmation(plan), roundNumber: "2" },
      },
      dependencies().dependencies,
    );
    assert.equal(result.status, "CONFIRMATION_MISMATCH");
  });

  it("24. detects a new block immediately before send", async function () {
    const fresh = dueSnapshot({
      blockNumber: 12_346n,
      observedAt: FIXTURE_OBSERVED_AT + 1n,
    });
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), fresh, completedSnapshot()],
      latestBlock: 12_346n,
    });
    await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.ok(mock.counters.reads >= 4);
  });

  it("25. resimulates after a still-VALID second revalidation", async function () {
    const fresh = dueSnapshot({
      blockNumber: 12_346n,
      observedAt: FIXTURE_OBSERVED_AT + 1n,
    });
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), fresh, completedSnapshot()],
      latestBlock: 12_346n,
    });
    await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(mock.counters.simulations, 2);
  });

  it("26. blocks when the second revalidation is STALE", async function () {
    const stale = completedSnapshot();
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), stale],
      latestBlock: 12_346n,
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "STALE");
    assert.equal(mock.counters.sends, 0);
  });

  it("27. sends at most one transaction", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
    });
    await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(mock.counters.sends, 1);
  });

  it("28. never resends after receiving a transaction hash", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      receiptError: new Error("receipt timeout"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.transactionHash, HASH);
    assert.equal(mock.counters.sends, 1);
  });

  it("29. accepts a successful receipt", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.receipt?.status, "success");
  });

  it("30. reports a reverted receipt", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      receiptStatus: "reverted",
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "RECEIPT_REVERTED");
  });

  it("31. preserves tx hash after receipt timeout", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      receiptError: new Error("timeout"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "TRANSACTION_SUBMITTED");
    assert.equal(result.transactionHash, HASH);
  });

  it("32. passes a correct post-check", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.postCheck?.passed, true);
  });

  it("33. detects a missing round change in post-check", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), dueSnapshot({ blockNumber: 12_346n })],
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "POST_CHECK_FAILED");
  });

  it("34. detects a repeated recommendation for the same Draw", async function () {
    const post = dueSnapshot({ blockNumber: 12_346n });
    post.pools[0].completedDrawRoundCount = 1n;
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), post],
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "POST_CHECK_FAILED");
  });

  it("35. writes an audit record without secret-bearing fields", async function () {
    const directory = await mkdtemp(join(tmpdir(), "pop33-draw-"));
    const path = join(directory, "attempt.guarded-draw-audit.json");
    try {
      const store = new GuardedDrawAuditFile(path);
      const mock = dependencies();
      mock.dependencies.writeAudit = (record) => store.write(record);
      await simulateGuardedSingleDraw(common(), mock.dependencies);
      await simulateGuardedSingleDraw(common(), mock.dependencies);
      const json = await readFile(path, "utf8");
      assert.doesNotMatch(
        json,
        /private.?key|mnemonic|password|passphrase|api.?key|rpc.?url/i,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("36. preserves precision in JSON output", async function () {
    const result = await simulateGuardedSingleDraw(
      common(),
      dependencies().dependencies,
    );
    assert.match(renderGuardedDrawJson(result), /"123456"/);
  });

  it("37. supports large bigint gas values", async function () {
    const mock = dependencies();
    mock.dependencies.simulateDraw = async () => ({
      result: 2n ** 255n,
      gasEstimate: 2n ** 200n,
    });
    const result = await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(result.simulation?.result, 2n ** 255n);
  });

  it("38. uses the existing supervisor report", async function () {
    const result = await inspectGuardedSingleDraw(
      common(),
      dependencies().dependencies,
    );
    assert.equal(result.report?.readOnly, true);
  });

  it("39. checks the Base Sepolia public identity", async function () {
    const mock = dependencies();
    await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(mock.counters.identities, 1);
  });

  it("40. rejects a tampered action plan fingerprint", async function () {
    const plan = planFor();
    plan.scope.poolId = "9";
    const result = await inspectGuardedSingleDraw(
      common(plan),
      dependencies().dependencies,
    );
    assert.equal(result.status, "INVALID_PLAN");
  });

  it("41. exposes distinct CLI-oriented exit codes", function () {
    assert.equal(new Set(Object.values(GUARDED_DRAW_EXIT_CODES)).size, 12);
  });

  it("42. never sends or loads a wallet in inspect", async function () {
    const mock = dependencies();
    await inspectGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(mock.counters.loads, 0);
    assert.equal(mock.counters.sends, 0);
  });

  it("43. never sends or loads a wallet in simulate", async function () {
    const mock = dependencies();
    await simulateGuardedSingleDraw(common(), mock.dependencies);
    assert.equal(mock.counters.loads, 0);
    assert.equal(mock.counters.sends, 0);
  });

  it("44. executes exactly the approved plan arguments", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
    });
    await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.deepEqual(mock.counters.sentArgs, [[1n, 1n]]);
    assert.deepEqual(mock.counters.simulatedArgs, [[1n, 1n]]);
  });

  it("45. terminates after one attempt", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
    });
    await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(mock.counters.sends, 1);
    assert.equal(mock.counters.waits, 1);
  });

  it("46. adds a 25 percent buffer to the failed Round 3 estimate", function () {
    const gas = calculateGuardedDrawGasPlan(247_699n, 247_699n);
    assert.equal(gas.requiredEstimate, 247_699n);
    assert.equal(gas.gasLimit, 309_624n);
    assert.ok(gas.gasLimit > gas.preflightEstimate);
  });

  it("47. never lets a lower runtime estimate reduce the accepted estimate", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
      simulationGasEstimate: 247_699n,
      runtimeEstimate: 236_849n,
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.requiredGasEstimate, 247_699n);
    assert.equal(result.gasLimit, 309_624n);
    assert.deepEqual(mock.counters.preparedGasLimits, [309_624n]);
    assert.equal(mock.counters.sends, 1);
  });

  it("48. aborts before broadcast if preparation lowers the gas limit", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      preparedGasLimit: 123_455n,
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "BLOCKED");
    assert.match(result.message, /not signed or broadcast/);
    assert.equal(mock.counters.prepares, 1);
    assert.equal(mock.counters.sends, 0);
    assert.equal(result.transactionHash, null);
  });

  it("49. preserves existing guarded Draw behavior with a valid gas plan", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
      simulationGasEstimate: 120_000n,
      runtimeEstimate: 140_000n,
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "TRANSACTION_SUBMITTED");
    assert.equal(result.requiredGasEstimate, 140_000n);
    assert.equal(result.gasLimit, 175_000n);
    assert.equal(mock.counters.sends, 1);
    assert.equal(mock.counters.waits, 1);
  });

  it("50. preserves broadcast evidence when receipt lookup fails", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      receiptError: new Error("HTTP 502 during receipt lookup"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.transactionHash, HASH);
    assert.equal(result.lifecyclePhase, "BROADCASTED");
    assert.equal(result.broadcastOccurred, true);
    assert.equal(result.transactionSucceeded, null);
    assert.match(result.message, /do not retry/);
    assert.equal(mock.counters.sends, 1);
  });

  it("51. preserves a successful receipt when the post-check RPC fails", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      postSnapshotError: new Error("HTTP 502 during post-receipt snapshot"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "POST_CHECK_FAILED");
    assert.equal(result.transactionHash, HASH);
    assert.equal(result.receipt?.status, "success");
    assert.equal(result.receipt?.blockNumber, 12_346n);
    assert.equal(result.simulation?.gasEstimate, 123_456n);
    assert.equal(result.runtimeGasEstimate, 123_456n);
    assert.equal(result.requiredGasEstimate, 123_456n);
    assert.equal(result.gasLimit, 154_320n);
    assert.equal(result.lifecyclePhase, "RECEIPT_KNOWN");
    assert.equal(result.broadcastOccurred, true);
    assert.equal(result.transactionSucceeded, true);
    assert.equal(result.postCheckStatus, "INCOMPLETE");
    assert.match(result.message, /retry only the read-only post-check/);
    assert.equal(mock.counters.sends, 1);
  });

  it("52. reports no broadcast evidence for a pre-broadcast failure", async function () {
    const mock = dependencies({
      runtimeEstimateError: new Error("HTTP 502 during gas estimation"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "SIMULATION_FAILED");
    assert.equal(result.transactionHash, null);
    assert.equal(result.lifecyclePhase, "PRE_BROADCAST");
    assert.equal(result.broadcastOccurred, false);
    assert.equal(result.transactionSucceeded, null);
    assert.equal(mock.counters.prepares, 0);
    assert.equal(mock.counters.sends, 0);
  });

  it("53. completes all lifecycle evidence on the normal success path", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot(), completedSnapshot()],
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "TRANSACTION_SUBMITTED");
    assert.equal(result.lifecyclePhase, "POSTCHECK_COMPLETE");
    assert.equal(result.broadcastOccurred, true);
    assert.equal(result.transactionSucceeded, true);
    assert.equal(result.postCheckStatus, "PASSED");
    assert.equal(result.postCheck?.passed, true);
  });

  it("54. never lets the generic catch or final audit erase a known hash", async function () {
    const mock = dependencies({
      snapshots: [dueSnapshot(), dueSnapshot()],
      postSnapshotError: new Error("post-check transport failed"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    const finalAudit = mock.counters.audits.at(-1);
    assert.equal(result.transactionHash, HASH);
    assert.equal(finalAudit?.transactionHash, HASH);
    assert.equal(finalAudit?.receiptStatus, "success");
    assert.equal(finalAudit?.broadcastOccurred, true);
    assert.equal(finalAudit?.transactionSucceeded, true);
    assert.equal(finalAudit?.postCheckStatus, "INCOMPLETE");
  });

  it("55. requires the shared consumer before the execution-client seam", async function () {
    const mock = dependencies({
      loadError: new Error("test stop after consumer"),
    });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.notEqual(result.status, "TRANSACTION_SUBMITTED");
    assert.deepEqual(mock.counters.executionOrder.slice(0, 2), [
      "consumer",
      "loader",
    ]);
    assert.equal(mock.counters.prepares, 0);
    assert.equal(mock.counters.sends, 0);
  });

  it("56. does not load the execution client when the consumer fails closed", async function () {
    const rejected = readyConsumerResult("unused");
    rejected.status = "CONFLICT";
    rejected.reason = "Prepared intent mismatch.";
    const mock = dependencies({ consumerResult: rejected });
    const result = await executeGuardedSingleDraw(
      { ...common(), confirmation: confirmation() },
      mock.dependencies,
    );
    assert.equal(result.status, "BLOCKED");
    assert.equal(mock.counters.consumers, 1);
    assert.equal(mock.counters.loads, 0);
    assert.equal(mock.counters.prepares, 0);
    assert.equal(mock.counters.sends, 0);
  });

  it("57. keeps inspect and simulate modes journal-free", async function () {
    const inspectMock = dependencies();
    const simulateMock = dependencies();
    await inspectGuardedSingleDraw(common(), inspectMock.dependencies);
    await simulateGuardedSingleDraw(common(), simulateMock.dependencies);
    assert.equal(inspectMock.counters.consumers, 0);
    assert.equal(simulateMock.counters.consumers, 0);
    assert.equal(inspectMock.counters.loads, 0);
    assert.equal(simulateMock.counters.loads, 0);
  });

  it("58. rejects a different Base adapter operator before reading the secret environment", async function () {
    let secretReads = 0;
    const environment = new Proxy({} as NodeJS.ProcessEnv, {
      get(target, property, receiver) {
        if (property === "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY") {
          secretReads += 1;
        }
        return Reflect.get(target, property, receiver) as string | undefined;
      },
    });
    const adapter = createBaseSepoliaGuardedDrawDependencies({
      rpcUrl: "https://mocked-rpc.example",
      poolId: 1n,
      operatorAddress: OTHER_PUBLIC_OPERATOR,
      privateKeyEnvironment: environment,
    });
    assert.ok(adapter.loadExecutionClient);
    await assert.rejects(
      adapter.loadExecutionClient(APPROVED_PILOT_OPERATOR),
      /configured Base Sepolia operator does not match/i,
    );
    assert.equal(secretReads, 0);
  });

  it("59. reaches the late mocked secret seam only for the approved adapter operator", async function () {
    let secretReads = 0;
    const environment = new Proxy({} as NodeJS.ProcessEnv, {
      get(target, property, receiver) {
        if (property === "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY") {
          secretReads += 1;
        }
        return Reflect.get(target, property, receiver) as string | undefined;
      },
    });
    const adapter = createBaseSepoliaGuardedDrawDependencies({
      rpcUrl: "https://mocked-rpc.example",
      poolId: 1n,
      operatorAddress: APPROVED_PILOT_OPERATOR,
      privateKeyEnvironment: environment,
    });
    assert.ok(adapter.loadExecutionClient);
    await assert.rejects(
      adapter.loadExecutionClient(APPROVED_PILOT_OPERATOR),
      /missing or invalid/i,
    );
    assert.equal(secretReads, 1);
  });
});
