import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BaseSepoliaLifecycleSnapshotAdapter,
  LIFECYCLE_SUPERVISOR_BASE_SEPOLIA_CHAIN_ID,
  LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
  LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK,
  LifecycleSupervisorAdapterError,
  ViemLifecycleSupervisorPublicClient,
  redactLifecycleSupervisorRpcUrl,
  requireLifecycleSupervisorDeploymentBlock,
  validateLifecycleSupervisorRpcUrl,
  type LifecycleSupervisorPublicClient,
  type LifecycleSupervisorReadMethod,
} from "../scripts/operator/lifecycle-supervisor-base-sepolia.js";
import {
  analyzeLifecycleSnapshot,
  renderSupervisorJson,
  type SystemSnapshot,
} from "../scripts/operator/lifecycle-supervisor.js";
import {
  FixtureLifecycleSnapshotAdapter,
  loadLifecycleFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";
import { demoV1Abi } from "../../../src/demo-v1/abi.js";

const BLOCK_NUMBER = 55_555_555n;
const BLOCK_TIMESTAMP = 1_800_000_000n;
const ENTRY_PRICE = 33_000_000n;
const PRIZE = 330_000_000n;
const TOTAL_PRIZE = 3_300_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface ClientCall {
  method: string;
  blockNumber: bigint | null;
  args: readonly bigint[];
}

function poolRecord(input: {
  id: bigint;
  status?: number;
  activePositionCount?: bigint;
  lockedAt?: bigint;
  completedDrawRoundCount?: bigint;
  claimedPrizeCount?: bigint;
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  const status = input.status ?? 0;
  const completed = input.completedDrawRoundCount ?? 0n;
  const claimed = input.claimedPrizeCount ?? 0n;
  const active = input.activePositionCount ??
    (status === 0 ? 0n : status === 4 ? 0n : 100n);
  return {
    id: input.id,
    status,
    activePositionCount: active,
    escrowedAmount: status === 0
      ? active * ENTRY_PRICE
      : status === 4
        ? 0n
        : TOTAL_PRIZE - claimed * PRIZE,
    openedAt: BLOCK_TIMESTAMP - 86_400n,
    lockedAt: input.lockedAt ?? (status === 0 ? 0n : BLOCK_TIMESTAMP - 3_599n),
    drawInterval: 3_600n,
    entryPrice: ENTRY_PRICE,
    prizePerRound: PRIZE,
    totalPrizeAmount: TOTAL_PRIZE,
    positionsPerPool: 100n,
    drawRoundCount: 10n,
    completedDrawRoundCount: completed,
    claimedPrizeCount: claimed,
    assignedPrizeAmount: completed * PRIZE,
    claimedPrizeAmount: claimed * PRIZE,
    ...input.overrides,
  };
}

function roundRecord(input: {
  number: bigint;
  lockedAt: bigint;
  finalized?: boolean;
  claimed?: boolean;
}): Record<string, unknown> {
  const scheduledAt = input.lockedAt + input.number * 3_600n;
  const finalized = input.finalized ?? false;
  return {
    number: input.number,
    scheduledAt,
    executedAt: finalized ? scheduledAt : 0n,
    status: finalized ? 1 : 0,
    winningPositionId: finalized ? input.number : 0n,
    winner: finalized
      ? `0x${input.number.toString(16).padStart(40, "0")}`
      : ZERO_ADDRESS,
    prizeAmount: PRIZE,
    temporaryRequestId: finalized ? input.number : 0n,
    claimed: finalized && (input.claimed ?? false),
  };
}

class FakePublicClient implements LifecycleSupervisorPublicClient {
  chainId = Number(LIFECYCLE_SUPERVISOR_BASE_SEPOLIA_CHAIN_ID);
  blockNumber = BLOCK_NUMBER;
  block = { number: BLOCK_NUMBER, timestamp: BLOCK_TIMESTAMP };
  bytecode: `0x${string}` | undefined = "0x6000";
  poolCount = 1n;
  pools = new Map<bigint, Record<string, unknown>>([
    [1n, poolRecord({ id: 1n })],
  ]);
  rounds = new Map<string, Record<string, unknown>>();
  calls: ClientCall[] = [];
  chainFailures: unknown[] = [];
  readFailure: ((method: LifecycleSupervisorReadMethod, args: readonly bigint[]) => unknown) | null =
    null;

  async getChainId(): Promise<number> {
    this.calls.push({ method: "getChainId", blockNumber: null, args: [] });
    const failure = this.chainFailures.shift();
    if (failure !== undefined) throw failure;
    return this.chainId;
  }

  async getBlockNumber(): Promise<bigint> {
    this.calls.push({ method: "getBlockNumber", blockNumber: null, args: [] });
    return this.blockNumber;
  }

  async getBlock(input: {
    blockNumber: bigint;
  }): Promise<{ number: bigint; timestamp: bigint } | null> {
    this.calls.push({
      method: "getBlock",
      blockNumber: input.blockNumber,
      args: [],
    });
    return this.block;
  }

  async getBytecode(input: {
    blockNumber: bigint;
  }): Promise<`0x${string}` | undefined> {
    this.calls.push({
      method: "getBytecode",
      blockNumber: input.blockNumber,
      args: [],
    });
    return this.bytecode;
  }

  async readContract(input: {
    abi: typeof demoV1Abi;
    functionName: LifecycleSupervisorReadMethod;
    args?: readonly bigint[];
    blockNumber: bigint;
  }): Promise<unknown> {
    const args = input.args ?? [];
    this.calls.push({
      method: input.functionName,
      blockNumber: input.blockNumber,
      args,
    });
    const failure = this.readFailure?.(input.functionName, args);
    if (failure !== null && failure !== undefined) throw failure;
    if (input.functionName === "poolCount") return this.poolCount;
    if (input.functionName === "getPool") return this.pools.get(args[0]);
    return this.rounds.get(`${args[0]}:${args[1]}`);
  }
}

function adapter(
  client: FakePublicClient,
  overrides: Partial<ConstructorParameters<
    typeof BaseSepoliaLifecycleSnapshotAdapter
  >[0]> = {},
): BaseSepoliaLifecycleSnapshotAdapter {
  return new BaseSepoliaLifecycleSnapshotAdapter({
    client,
    rpcHost: "rpc.example.test",
    retryOptions: {
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
      sleep: async () => undefined,
      random: () => 0.5,
      log: () => undefined,
    },
    ...overrides,
  });
}

async function expectAdapterError(
  promise: Promise<unknown>,
  code: LifecycleSupervisorAdapterError["code"],
): Promise<LifecycleSupervisorAdapterError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof LifecycleSupervisorAdapterError);
    assert.equal(error.code, code);
    assert.equal(error.context.canContinue, false);
    assert.equal(error.context.snapshotComplete, false);
    return error;
  }
  assert.fail(`Expected adapter error ${code}.`);
}

function prepareLockedPool(client: FakePublicClient, poolId = 1n): void {
  const lockedAt = BLOCK_TIMESTAMP - 3_599n;
  client.pools.set(poolId, poolRecord({
    id: poolId,
    status: 1,
    activePositionCount: 100n,
    lockedAt,
  }));
  for (let round = 1n; round <= 10n; round += 1n) {
    client.rounds.set(
      `${poolId}:${round}`,
      roundRecord({ number: round, lockedAt }),
    );
  }
}

describe("Base Sepolia lifecycle supervisor adapter", function () {
  it("reads one Open pool into the existing snapshot model", async function () {
    const snapshot = await adapter(new FakePublicClient()).readSnapshot();
    assert.equal(snapshot.chainId, 84_532n);
    assert.equal(snapshot.contractAddress, LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS);
    assert.equal(snapshot.blockNumber, BLOCK_NUMBER);
    assert.equal(snapshot.observedAt, BLOCK_TIMESTAMP);
    assert.equal(snapshot.poolCount, 1n);
    assert.equal(snapshot.pools[0].status, "Open");
    assert.deepEqual(snapshot.pools[0].rounds, []);
    assert.equal(snapshot.metadata?.snapshotComplete, true);
  });

  it("reads multiple pools and all initialized rounds sequentially", async function () {
    const client = new FakePublicClient();
    client.poolCount = 2n;
    client.pools.set(2n, poolRecord({ id: 2n }));
    prepareLockedPool(client, 1n);
    const snapshot = await adapter(client).readSnapshot();
    assert.deepEqual(snapshot.pools.map((pool) => pool.poolId), [1n, 2n]);
    assert.equal(snapshot.pools[0].rounds.length, 10);
    assert.equal(snapshot.pools[1].rounds.length, 0);
  });

  it("pins block, bytecode, pool, and round reads to one block number", async function () {
    const client = new FakePublicClient();
    prepareLockedPool(client);
    await adapter(client).readSnapshot();
    const pinned = client.calls.filter((call) =>
      ["getBlock", "getBytecode", "poolCount", "getPool", "getDrawRound"]
        .includes(call.method));
    assert.ok(pinned.length > 0);
    assert.ok(pinned.every((call) => call.blockNumber === BLOCK_NUMBER));
  });

  it("supports an explicit repeatable block override", async function () {
    const client = new FakePublicClient();
    const explicitBlock = BLOCK_NUMBER - 10n;
    client.block = { number: explicitBlock, timestamp: BLOCK_TIMESTAMP - 20n };
    const snapshot = await adapter(client, { blockNumber: explicitBlock })
      .readSnapshot();
    assert.equal(snapshot.blockNumber, explicitBlock);
    assert.equal(
      client.calls.some((call) => call.method === "getBlockNumber"),
      false,
    );
  });

  it("requires Base Sepolia chain ID 84532", async function () {
    const client = new FakePublicClient();
    client.chainId = 1;
    const error = await expectAdapterError(adapter(client).readSnapshot(), "WRONG_CHAIN");
    assert.match(error.message, /84532/);
  });

  it("rejects missing contract bytecode at the pinned block", async function () {
    const client = new FakePublicClient();
    client.bytecode = "0x";
    const error = await expectAdapterError(
      adapter(client).readSnapshot(),
      "NO_CONTRACT_BYTECODE",
    );
    assert.equal(error.context.blockNumber, BLOCK_NUMBER);
  });

  it("reuses bounded retry for a transient public RPC rate limit", async function () {
    const client = new FakePublicClient();
    client.chainFailures.push(Object.assign(new Error("rate limited"), { code: -32016 }));
    const snapshot = await adapter(client).readSnapshot();
    assert.equal(snapshot.chainId, 84_532n);
    assert.equal(
      client.calls.filter((call) => call.method === "getChainId").length,
      2,
    );
  });

  it("fails closed after a persistent public RPC rate limit", async function () {
    const client = new FakePublicClient();
    client.chainFailures.push(
      ...Array.from({ length: 3 }, () =>
        Object.assign(new Error("rate limited"), { code: -32016 })),
    );
    await expectAdapterError(adapter(client).readSnapshot(), "RPC_UNAVAILABLE");
  });

  it("distinguishes a transport timeout", async function () {
    const client = new FakePublicClient();
    client.chainFailures.push(Object.assign(new Error("request timed out"), {
      name: "TimeoutError",
    }));
    await expectAdapterError(adapter(client).readSnapshot(), "RPC_TIMEOUT");
  });

  it("preserves incomplete pool fields instead of inventing zero values", async function () {
    const client = new FakePublicClient();
    const partial = poolRecord({ id: 1n });
    delete partial.claimedPrizeAmount;
    client.pools.set(1n, partial);
    const snapshot = await adapter(client).readSnapshot();
    assert.equal(snapshot.pools[0].claimedPrizeAmount, undefined);
    assert.equal(snapshot.metadata?.snapshotComplete, false);
    const report = analyzeLifecycleSnapshot(snapshot);
    assert.equal(report.plans[0].nextAction, "INCONSISTENT_STATE");
    assert.ok(report.systemDiagnostics.some((entry) =>
      entry.code === "INCOMPLETE_SNAPSHOT"));
  });

  it("reports a failed round read as a partial pool snapshot error", async function () {
    const client = new FakePublicClient();
    prepareLockedPool(client);
    client.readFailure = (method, args) =>
      method === "getDrawRound" && args[1] === 5n
        ? new Error("permanent RPC failure")
        : null;
    const error = await expectAdapterError(
      adapter(client).readSnapshot(),
      "PARTIAL_POOL_READ",
    );
    assert.equal(error.context.poolId, 1n);
    assert.equal(error.context.method, "getDrawRound");
  });

  it("preserves an unknown on-chain status for supervisor diagnosis", async function () {
    const client = new FakePublicClient();
    const lockedAt = BLOCK_TIMESTAMP - 3_599n;
    client.pools.set(1n, poolRecord({ id: 1n, status: 99, lockedAt }));
    for (let round = 1n; round <= 10n; round += 1n) {
      client.rounds.set(
        `1:${round}`,
        roundRecord({ number: round, lockedAt }),
      );
    }
    const snapshot = await adapter(client).readSnapshot();
    assert.equal(snapshot.pools[0].status, "Unknown(99)");
    const report = analyzeLifecycleSnapshot(snapshot);
    assert.equal(report.plans[0].nextAction, "INCONSISTENT_STATE");
    assert.equal(report.plans[0].reasonCode, "UNKNOWN_POOL_STATUS");
  });

  it("keeps large blockchain integers exact through JSON", async function () {
    const client = new FakePublicClient();
    const huge = 9_007_199_254_740_993_123_456n;
    client.pools.set(1n, poolRecord({
      id: 1n,
      activePositionCount: 50n,
      overrides: {
        entryPrice: huge,
        escrowedAmount: huge * 50n,
      },
    }));
    const snapshot = await adapter(client).readSnapshot();
    assert.equal(snapshot.pools[0].escrowedAmount, huge * 50n);
    assert.ok(
      renderSupervisorJson(analyzeLifecycleSnapshot(snapshot))
        .includes((huge * 50n).toString()),
    );
  });

  it("supports a valid bounded pool range without falsifying total poolCount", async function () {
    const client = new FakePublicClient();
    client.poolCount = 3n;
    for (let id = 1n; id <= 3n; id += 1n) {
      client.pools.set(id, poolRecord({ id }));
    }
    const snapshot = await adapter(client, {
      poolRange: { fromPoolId: 2n, toPoolId: 3n },
    }).readSnapshot();
    assert.equal(snapshot.poolCount, 3n);
    assert.deepEqual(snapshot.pools.map((pool) => pool.poolId), [2n, 3n]);
    assert.deepEqual(snapshot.metadata?.requestedPoolRange, {
      fromPoolId: 2n,
      toPoolId: 3n,
    });
    assert.equal(analyzeLifecycleSnapshot(snapshot).systemDiagnostics.length, 0);
  });

  it("rejects invalid, reversed, out-of-bounds, and excessive pool ranges", async function () {
    for (const range of [
      { fromPoolId: 0n, toPoolId: 1n },
      { fromPoolId: 2n, toPoolId: 1n },
      { fromPoolId: 1n, toPoolId: 2n },
    ]) {
      const client = new FakePublicClient();
      await expectAdapterError(
        adapter(client, { poolRange: range }).readSnapshot(),
        "INVALID_POOL_RANGE",
      );
    }
    assert.throws(
      () => adapter(new FakePublicClient(), { maxPoolReads: 0 }),
      (error: unknown) =>
        error instanceof LifecycleSupervisorAdapterError &&
        error.code === "INVALID_POOL_RANGE",
    );
  });

  it("requires a bounded deployment block before any future log scan", function () {
    assert.equal(
      requireLifecycleSupervisorDeploymentBlock(
        LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK,
      ),
      44_144_873n,
    );
    assert.throws(
      () => requireLifecycleSupervisorDeploymentBlock(undefined),
      (error: unknown) =>
        error instanceof LifecycleSupervisorAdapterError &&
        error.code === "MISSING_DEPLOYMENT_BLOCK",
    );
  });

  it("validates HTTPS and redacts RPC paths, queries, and fragments to the host", function () {
    const rpc = "https://rpc.example.test/account/path?token=hidden#fragment";
    assert.equal(validateLifecycleSupervisorRpcUrl(rpc), rpc);
    assert.equal(redactLifecycleSupervisorRpcUrl(rpc), "rpc.example.test");
    assert.throws(() => validateLifecycleSupervisorRpcUrl("http://rpc.example.test"));
    assert.throws(() =>
      validateLifecycleSupervisorRpcUrl("https://user:pass@rpc.example.test"));
  });

  it("exposes no transaction-capable method on either adapter surface", function () {
    const adapterMethods = Object.getOwnPropertyNames(
      BaseSepoliaLifecycleSnapshotAdapter.prototype,
    ).sort();
    const clientMethods = Object.getOwnPropertyNames(
      ViemLifecycleSupervisorPublicClient.prototype,
    ).sort();
    assert.deepEqual(adapterMethods, ["constructor", "readSnapshot"]);
    assert.deepEqual(clientMethods, [
      "constructor",
      "getBlock",
      "getBlockNumber",
      "getBytecode",
      "getChainId",
      "readContract",
    ]);
  });

  it("uses the canonical frontend ABI instead of embedding a second ABI", async function () {
    const source = await readFile(
      new URL(
        "../scripts/operator/lifecycle-supervisor-base-sepolia.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /src\/demo-v1\/abi\.js/);
    assert.doesNotMatch(source, /function poolCount\(\)/);
  });

  it("keeps lifecycle result codes compatible with the fixture engine", async function () {
    const client = new FakePublicClient();
    client.pools.set(1n, poolRecord({
      id: 1n,
      activePositionCount: 99n,
    }));
    const report = analyzeLifecycleSnapshot(await adapter(client).readSnapshot());
    assert.equal(report.plans[0].nextAction, "WAITING_FOR_PARTICIPANTS");

    prepareLockedPool(client);
    const lockedReport = analyzeLifecycleSnapshot(
      await adapter(client).readSnapshot(),
    );
    assert.equal(lockedReport.plans[0].nextAction, "WAITING_FOR_FIRST_DRAW");
  });

  it("does not regress the existing fixture adapter", async function () {
    const fixture = new FixtureLifecycleSnapshotAdapter(
      loadLifecycleFixture("multi-pool"),
    );
    const snapshot = await fixture.readSnapshot();
    assert.equal(snapshot.source, "fixture");
    assert.equal(snapshot.metadata, undefined);
    assert.equal(analyzeLifecycleSnapshot(snapshot).plans.length, 5);
  });

  it("is deterministic for a fixed public block and fixed contract data", async function () {
    const client = new FakePublicClient();
    prepareLockedPool(client);
    const first = analyzeLifecycleSnapshot(await adapter(client).readSnapshot());
    client.calls = [];
    const second = analyzeLifecycleSnapshot(await adapter(client).readSnapshot());
    assert.deepEqual(second, first);
  });

  it("distinguishes ABI decode and inconsistent-block failures", async function () {
    const missingMethod = new FakePublicClient();
    missingMethod.readFailure = (method) => {
      if (method !== "poolCount") return null;
      return Object.assign(new Error("ABI function not found"), {
        name: "AbiFunctionNotFoundError",
      });
    };
    await expectAdapterError(
      adapter(missingMethod).readSnapshot(),
      "ABI_METHOD_MISSING",
    );

    const wrongBlock = new FakePublicClient();
    wrongBlock.block = {
      number: BLOCK_NUMBER - 1n,
      timestamp: BLOCK_TIMESTAMP,
    };
    await expectAdapterError(
      adapter(wrongBlock).readSnapshot(),
      "INCONSISTENT_BLOCK",
    );
  });

  it("returns a complete SystemSnapshot accepted by the existing interface", async function () {
    const snapshot: SystemSnapshot = await adapter(new FakePublicClient())
      .readSnapshot();
    assert.equal(snapshot.source, "base-sepolia-read-only");
    assert.equal(snapshot.metadata?.network, "Base Sepolia");
    assert.equal(snapshot.metadata?.rpcHost, "rpc.example.test");
  });
});
