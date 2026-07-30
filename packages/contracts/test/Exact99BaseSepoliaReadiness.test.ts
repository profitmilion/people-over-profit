import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAddress, type Hex } from "viem";

import {
  EXACT_99_READINESS_EXIT_CODES,
  EXACT_99_READINESS_SAFETY,
  ViemExact99ReadinessPublicClient,
  assessExact99Candidate,
  buildExact99BoundedLogRanges,
  buildExact99OwnerMapping,
  buildExact99PublicManifest,
  calculateExact99DynamicCheckpoints,
  computeExact99PublicManifestFingerprint,
  computeExact99ReadinessFingerprint,
  createExact99ReadinessPlan,
  manifestNotProvided,
  parseExact99PublicManifestJson,
  parseExact99ReadinessPlanJson,
  readinessExitCode,
  readinessRevalidationExitCode,
  revalidateExact99ReadinessPlan,
  serializeExact99ReadinessPlan,
  writeExact99ReadinessPlanFile,
  type Exact99CandidateAssessment,
  type Exact99JoinedLog,
  type Exact99ManifestAssessment,
  type Exact99OwnerMapping,
  type Exact99PositionObservation,
  type Exact99PublicManifest,
  type Exact99ReadinessPlan,
} from "../scripts/operator/exact-99-base-sepolia-readiness.js";
import {
  LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
  canonicalizeLifecyclePlanValue,
} from "../scripts/operator/lifecycle-action-plan.js";
import {
  analyzeLifecycleSnapshot,
  type SystemSnapshot,
} from "../scripts/operator/lifecycle-supervisor.js";
import {
  makePoolFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";
import {
  LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK,
} from "../scripts/operator/lifecycle-supervisor-base-sepolia.js";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_ENTRY_PRICE,
  DEMO_V1_TOKEN_ADDRESS,
} from "../../../src/demo-v1/safety.js";

const SNAPSHOT_BLOCK = 44_828_407n;
const SNAPSHOT_TIME = 1_785_425_102n;
const HASH = `0x${"1".repeat(64)}` as Hex;

function address(index: number): string {
  return getAddress(`0x${index.toString(16).padStart(40, "0")}`);
}

function snapshotFor(
  count: bigint,
  options: {
    status?: string;
    escrow?: bigint;
    complete?: boolean;
    blockNumber?: bigint;
    observedAt?: bigint;
  } = {},
): SystemSnapshot {
  const status = options.status ?? "Open";
  const pool = makePoolFixture({
    poolId: 1n,
    status,
    activePositionCount: count,
    observedAt: options.observedAt ?? SNAPSHOT_TIME,
    overrides: {
      escrowedAmount:
        options.escrow ?? (
          status === "Open"
            ? count * DEMO_V1_ENTRY_PRICE
            : 3_300_000_000n
        ),
    },
  });
  return makeSystemFixture([pool], {
    chainId: BigInt(DEMO_V1_CHAIN_ID),
    contractAddress: DEMO_V1_CONTRACT_ADDRESS,
    blockNumber: options.blockNumber ?? SNAPSHOT_BLOCK,
    observedAt: options.observedAt ?? SNAPSHOT_TIME,
    source: "base-sepolia-read-only",
    metadata: {
      network: "Base Sepolia",
      rpcHost: "rpc.example.test",
      requestedPoolRange: null,
      snapshotComplete: options.complete ?? true,
      warnings: options.complete === false ? ["fixture incomplete"] : [],
    },
  });
}

function ownerMappingFor(
  count: number,
  options: {
    expectedCount?: bigint;
    duplicateOwner?: boolean;
    complete?: boolean;
    ownerBase?: number;
    snapshotBlock?: bigint;
  } = {},
): Exact99OwnerMapping {
  const joinedLogs: Exact99JoinedLog[] = [];
  const positions: Exact99PositionObservation[] = [];
  const ownerBase = options.ownerBase ?? 1;
  for (let index = 1; index <= count; index += 1) {
    const ownerIndex = options.duplicateOwner && index === count
      ? ownerBase
      : ownerBase + index - 1;
    joinedLogs.push({
      positionId: BigInt(index),
      poolId: 1n,
      user: address(ownerIndex),
      activePositionCount: BigInt(index),
      blockNumber: LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK + BigInt(index),
      blockHash: HASH,
      transactionHash:
        `0x${index.toString(16).padStart(64, "0")}` as Hex,
      logIndex: 0,
    });
    positions.push({
      id: BigInt(index),
      poolId: 1n,
      owner: address(ownerIndex),
      active: true,
    });
  }
  return buildExact99OwnerMapping({
    poolId: 1n,
    deploymentBlock: LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK,
    snapshotBlock: options.snapshotBlock ?? SNAPSHOT_BLOCK,
    logBlockSpan: 10_000n,
    joinedLogs,
    positions,
    expectedActivePositionCount: options.expectedCount ?? BigInt(count),
    complete: options.complete,
  });
}

function manifestFor(
  count: number,
  options: {
    chainId?: bigint;
    contractAddress?: string;
    poolId?: bigint;
    ownerBase?: number;
    manualAddress?: string;
  } = {},
): Exact99PublicManifest {
  const ownerBase = options.ownerBase ?? 1_000;
  return buildExact99PublicManifest({
    chainId: options.chainId,
    contractAddress: options.contractAddress,
    poolId: options.poolId ?? 1n,
    tokenAddress: DEMO_V1_TOKEN_ADDRESS,
    addresses: Array.from({ length: count }, (_, index) =>
      address(ownerBase + index)),
    manual100Address: options.manualAddress ?? address(9_000),
  });
}

function parseManifest(
  manifest: Exact99PublicManifest,
  count: bigint,
  ownerMapping: Exact99OwnerMapping,
) {
  return parseExact99PublicManifestJson(JSON.stringify(manifest), {
    chainId: BigInt(DEMO_V1_CHAIN_ID),
    contractAddress: DEMO_V1_CONTRACT_ADDRESS,
    tokenAddress: DEMO_V1_TOKEN_ADDRESS,
    poolId: 1n,
    remainingTo99: 99n - count,
    ownerMapping,
  });
}

function planFor(
  count: bigint,
  options: {
    status?: string;
    escrow?: bigint;
    complete?: boolean;
    ownerMapping?: Exact99OwnerMapping;
    manifest?: Exact99ManifestAssessment;
    candidate?: Exact99CandidateAssessment;
    openPoolIds?: readonly bigint[] | null;
    maxOpenPools?: bigint | null;
    blockNumber?: bigint;
    observedAt?: bigint;
  } = {},
): Exact99ReadinessPlan {
  const snapshot = snapshotFor(count, options);
  return createExact99ReadinessPlan({
    snapshot,
    report: analyzeLifecycleSnapshot(snapshot),
    poolId: 1n,
    sourceReference: "base-sepolia",
    ownerMapping:
      options.ownerMapping ?? ownerMappingFor(Number(count), {
        expectedCount: count,
        snapshotBlock: options.blockNumber,
      }),
    manifest: options.manifest,
    candidate: options.candidate,
    openPoolIds: options.openPoolIds === undefined
      ? [1n]
      : options.openPoolIds,
    maxOpenPools: options.maxOpenPools === undefined
      ? 10n
      : options.maxOpenPools,
  });
}

function validManifestAssessment(
  count: bigint,
  mapping: Exact99OwnerMapping,
): Exact99ManifestAssessment {
  return parseManifest(
    manifestFor(Number(99n - count)),
    count,
    mapping,
  ).assessment;
}

function reSignManifest(
  manifest: Exact99PublicManifest,
): Exact99PublicManifest {
  return {
    ...manifest,
    fingerprint: computeExact99PublicManifestFingerprint(manifest),
  };
}

describe("exact-99 Base Sepolia readiness plan", function () {
  for (const [count, remaining] of [
    [0n, "5"],
    [3n, "2"],
    [4n, "1"],
    [5n, "0"],
    [19n, "0"],
    [20n, "0"],
    [49n, "0"],
    [50n, "0"],
    [98n, "0"],
    [99n, "0"],
    [100n, "0"],
  ] as const) {
    it(`calculates checkpoint boundaries for count ${count}`, function () {
      const checkpoints = calculateExact99DynamicCheckpoints(count);
      assert.equal(checkpoints[0].remainingFromSnapshot, remaining);
      assert.equal(checkpoints[3].remainingFromSnapshot, (
        count < 99n ? 99n - count : 0n
      ).toString());
    });
  }

  it("blocks an invalid count above capacity", function () {
    const plan = planFor(101n);
    assert.equal(plan.decision.status, "BLOCKED");
    assert.ok(plan.decision.blockers.some((entry) =>
      entry.includes("exceeds capacity")));
  });

  it("blocks a pool status other than Open", function () {
    assert.equal(planFor(100n, { status: "Locked" }).decision.status, "BLOCKED");
  });

  it("accepts escrow equal to count multiplied by entry price", function () {
    assert.equal(planFor(3n).pool.escrowedAmount, "99000000");
  });

  it("blocks inconsistent escrow", function () {
    assert.equal(planFor(3n, { escrow: 1n }).decision.status, "BLOCKED");
  });

  it("calculates dynamic phases for count 3", function () {
    assert.deepEqual(
      calculateExact99DynamicCheckpoints(3n)
        .slice(0, 4)
        .map((entry) => [
          entry.target,
          entry.remainingFromSnapshot,
          entry.positionsInPhase,
        ]),
      [
        ["5", "2", "2"],
        ["20", "17", "15"],
        ["50", "47", "30"],
        ["99", "96", "49"],
      ],
    );
  });

  it("calculates 96 new unique addresses from count 3", function () {
    assert.equal(planFor(3n).resources.newUniqueAddressesTo99, "96");
  });

  it("calculates exact test dUSDC base units without precision loss", function () {
    assert.equal(planFor(3n).resources.requiredTestTokenTo99, "3168000000");
  });

  it("builds a complete owner mapping from logs plus direct position reads", function () {
    const mapping = ownerMappingFor(3);
    assert.equal(mapping.status, "COMPLETE");
    assert.equal(mapping.activeOwnerCount, "3");
    assert.match(mapping.fingerprint, /^sha256:[0-9a-f]{64}$/);
  });

  it("marks owner mapping incomplete when the source read is incomplete", function () {
    assert.equal(ownerMappingFor(3, { complete: false }).status, "INCOMPLETE");
  });

  it("rejects a duplicate active owner in one pool", function () {
    assert.equal(
      ownerMappingFor(2, { duplicateOwner: true }).status,
      "INCOMPLETE",
    );
  });

  it("detects log and getPool active-count mismatch", function () {
    const mapping = ownerMappingFor(2, { expectedCount: 3n });
    assert.equal(mapping.status, "INCOMPLETE");
    assert.ok(mapping.warnings.some((entry) => entry.includes("getPool")));
  });

  it("creates bounded inclusive log ranges", function () {
    const ranges = buildExact99BoundedLogRanges({
      deploymentBlock: 100n,
      snapshotBlock: 250n,
      blockSpan: 100n,
    });
    assert.deepEqual(ranges, [
      { fromBlock: 100n, toBlock: 199n },
      { fromBlock: 200n, toBlock: 250n },
    ]);
    assert.ok(ranges.every((range) =>
      range.toBlock - range.fromBlock + 1n <= 100n));
  });

  it("forbids a scan from genesis", function () {
    assert.throws(() => buildExact99BoundedLogRanges({
      deploymentBlock: 0n,
      snapshotBlock: 100n,
    }));
  });

  it("marks a candidate eligible from pinned public facts", function () {
    const assessment = assessExact99Candidate({
      address: address(500),
      poolId: 1n,
      activePositionId: 0n,
      globalActivePositionCount: 0n,
      maxGlobalActivePositionCount: 10n,
      likelyPoolId: 1n,
      ownerMapping: ownerMappingFor(3),
    });
    assert.equal(assessment.status, "ELIGIBLE");
  });

  it("marks a candidate with an active selected-pool position ineligible", function () {
    const assessment = assessExact99Candidate({
      address: address(1),
      poolId: 1n,
      activePositionId: 1n,
      globalActivePositionCount: 1n,
      maxGlobalActivePositionCount: 10n,
      likelyPoolId: 2n,
      ownerMapping: ownerMappingFor(3),
    });
    assert.equal(assessment.status, "INELIGIBLE");
  });

  it("reports candidate routing to a different pool", function () {
    const assessment = assessExact99Candidate({
      address: address(500),
      poolId: 1n,
      activePositionId: 0n,
      globalActivePositionCount: 1n,
      maxGlobalActivePositionCount: 10n,
      likelyPoolId: 2n,
      ownerMapping: ownerMappingFor(3),
    });
    assert.equal(assessment.status, "ROUTES_TO_DIFFERENT_POOL");
  });

  it("enforces the global active-position limit", function () {
    const assessment = assessExact99Candidate({
      address: address(500),
      poolId: 1n,
      activePositionId: 0n,
      globalActivePositionCount: 10n,
      maxGlobalActivePositionCount: 10n,
      likelyPoolId: 1n,
      ownerMapping: ownerMappingFor(3),
    });
    assert.equal(assessment.status, "INELIGIBLE");
  });

  it("uses NOT_CHECKED when no candidate address is supplied", function () {
    assert.equal(
      assessExact99Candidate({
        poolId: 1n,
        ownerMapping: ownerMappingFor(3),
      }).status,
      "NOT_CHECKED",
    );
  });

  it("uses MANIFEST_NOT_PROVIDED when no manifest is supplied", function () {
    assert.equal(manifestNotProvided().status, "MANIFEST_NOT_PROVIDED");
    assert.equal(planFor(3n).decision.status, "READY_TO_PREPARE");
  });

  it("accepts a canonical public manifest matching remainingTo99", function () {
    const mapping = ownerMappingFor(3);
    const result = parseManifest(manifestFor(96), 3n, mapping);
    assert.equal(result.assessment.status, "VALID");
    assert.equal(result.manifest?.addresses.length, 96);
  });

  it("rejects a public manifest with too few addresses", function () {
    assert.equal(
      parseManifest(manifestFor(95), 3n, ownerMappingFor(3)).assessment.status,
      "INVALID",
    );
  });

  it("rejects a public manifest with too many addresses", function () {
    assert.equal(
      parseManifest(manifestFor(97), 3n, ownerMappingFor(3)).assessment.status,
      "INVALID",
    );
  });

  it("rejects duplicate public manifest addresses", function () {
    const manifest = manifestFor(96);
    manifest.addresses = [...manifest.addresses.slice(0, 95), manifest.addresses[0]];
    const resigned = reSignManifest(manifest);
    assert.equal(
      parseManifest(resigned, 3n, ownerMappingFor(3)).assessment.status,
      "INVALID",
    );
  });

  it("rejects a manifest containing an existing active owner", function () {
    const manifest = manifestFor(96);
    manifest.addresses = [address(1), ...manifest.addresses.slice(1)];
    const resigned = reSignManifest(manifest);
    assert.equal(
      parseManifest(resigned, 3n, ownerMappingFor(3)).assessment.status,
      "INVALID",
    );
  });

  it("rejects a manifest that reuses the manual-100 address", function () {
    const manifest = manifestFor(96);
    manifest.manual100Address = manifest.addresses[0];
    const resigned = reSignManifest(manifest);
    assert.equal(
      parseManifest(resigned, 3n, ownerMappingFor(3)).assessment.status,
      "INVALID",
    );
  });

  it("rejects a manifest bound to another chain", function () {
    assert.equal(
      parseManifest(
        manifestFor(96, { chainId: 1n }),
        3n,
        ownerMappingFor(3),
      ).assessment.status,
      "INVALID",
    );
  });

  it("rejects a manifest bound to another contract", function () {
    assert.equal(
      parseManifest(
        manifestFor(96, { contractAddress: address(777) }),
        3n,
        ownerMappingFor(3),
      ).assessment.status,
      "INVALID",
    );
  });

  it("rejects a field whose name indicates secret material", function () {
    const raw = {
      ...manifestFor(96),
      privateKey: "forbidden-field-without-a-value",
    };
    assert.equal(
      parseExact99PublicManifestJson(JSON.stringify(raw), {
        chainId: BigInt(DEMO_V1_CHAIN_ID),
        contractAddress: DEMO_V1_CONTRACT_ADDRESS,
        tokenAddress: DEMO_V1_TOKEN_ADDRESS,
        poolId: 1n,
        remainingTo99: 96n,
        ownerMapping: ownerMappingFor(3),
      }).assessment.status,
      "INVALID",
    );
  });

  it("uses canonical JSON for stable manifest fingerprints", function () {
    const manifest = manifestFor(2);
    const reversed = Object.fromEntries(
      Object.entries(manifest).reverse(),
    ) as unknown as Exact99PublicManifest;
    assert.equal(
      computeExact99PublicManifestFingerprint(reversed),
      manifest.fingerprint,
    );
  });

  it("serializes bigint-derived values as exact decimal strings", function () {
    const huge = 9_007_199_254_740_993n;
    const checkpoints = calculateExact99DynamicCheckpoints(3n, huge);
    assert.equal(checkpoints[3].expectedEscrow, (99n * huge).toString());
    assert.doesNotThrow(() => BigInt(checkpoints[3].expectedEscrow));
  });

  it("gives logically identical plans the same fingerprint", function () {
    const first = planFor(3n);
    const second = planFor(3n);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(
      canonicalizeLifecyclePlanValue(JSON.parse(serializeExact99ReadinessPlan(first))),
      canonicalizeLifecyclePlanValue(JSON.parse(serializeExact99ReadinessPlan(second))),
    );
  });

  it("changes plan fingerprint when count changes", function () {
    assert.notEqual(planFor(3n).fingerprint, planFor(4n).fingerprint);
  });

  it("changes plan fingerprint when owner mapping changes", function () {
    const first = planFor(3n);
    const second = planFor(3n, {
      ownerMapping: ownerMappingFor(3, { ownerBase: 100 }),
    });
    assert.notEqual(first.fingerprint, second.fingerprint);
  });

  it("revalidates VALID against a newer unchanged public state", function () {
    const plan = planFor(3n);
    const fresh = planFor(3n, {
      blockNumber: SNAPSHOT_BLOCK + 1n,
      observedAt: SNAPSHOT_TIME + 1n,
    });
    assert.equal(revalidateExact99ReadinessPlan(plan, fresh).status, "VALID");
  });

  it("revalidates STALE after an external Join", function () {
    const result = revalidateExact99ReadinessPlan(planFor(3n), planFor(4n, {
      blockNumber: SNAPSHOT_BLOCK + 1n,
      observedAt: SNAPSHOT_TIME + 1n,
    }));
    assert.equal(result.status, "STALE");
    assert.ok(result.changes.some((entry) =>
      entry.field === "pool.activePositionCount"));
  });

  it("revalidates BLOCKED after the pool becomes Locked", function () {
    const result = revalidateExact99ReadinessPlan(
      planFor(99n),
      planFor(100n, {
        status: "Locked",
        blockNumber: SNAPSHOT_BLOCK + 1n,
        observedAt: SNAPSHOT_TIME + 1n,
      }),
    );
    assert.equal(result.status, "BLOCKED");
  });

  it("revalidates INCOMPLETE after a public read failure", function () {
    const result = revalidateExact99ReadinessPlan(
      planFor(3n),
      planFor(3n, {
        complete: false,
        ownerMapping: ownerMappingFor(3, { complete: false }),
        blockNumber: SNAPSHOT_BLOCK + 1n,
        observedAt: SNAPSHOT_TIME + 1n,
      }),
    );
    assert.equal(result.status, "INCOMPLETE");
  });

  it("rejects a modified readiness plan as INVALID_PLAN", function () {
    const plan = planFor(3n);
    plan.pool.activePositionCount = "4";
    const parsed = parseExact99ReadinessPlanJson(
      serializeExact99ReadinessPlan(plan),
    );
    assert.equal(parsed.ok, false);
  });

  it("maps readiness and revalidation statuses to stable exit codes", function () {
    assert.equal(readinessExitCode("READY_TO_PREPARE"), 0);
    assert.equal(readinessExitCode("BLOCKED"), 11);
    assert.equal(readinessExitCode("INCOMPLETE"), 12);
    assert.equal(readinessExitCode("INVALID_INPUT"), 15);
    assert.equal(readinessRevalidationExitCode("VALID"), 0);
    assert.equal(readinessRevalidationExitCode("STALE"), 10);
    assert.deepEqual(EXACT_99_READINESS_EXIT_CODES.BLOCKED, 11);
  });

  it("contains no wallet-client construction", async function () {
    const source = await readFile(
      new URL(
        "../scripts/operator/exact-99-base-sepolia-readiness.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /createWalletClient|privateKeyToAccount/);
  });

  it("contains no contract-write primitive", async function () {
    const source = await readFile(
      new URL(
        "../scripts/operator/exact-99-base-sepolia-readiness.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /\.writeContract\s*\(/);
  });

  it("contains no transaction-send primitive", async function () {
    const source = await readFile(
      new URL(
        "../scripts/operator/exact-99-base-sepolia-readiness.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /\.sendTransaction\s*\(/);
  });

  it("uses the existing supervisor result without changing it", function () {
    const snapshot = snapshotFor(3n);
    const report = analyzeLifecycleSnapshot(snapshot);
    const before = structuredClone(report);
    planFor(3n);
    assert.deepEqual(report, before);
  });

  it("uses the canonical Base Sepolia adapter identity", function () {
    const plan = planFor(3n);
    assert.equal(plan.identity.chainId, String(DEMO_V1_CHAIN_ID));
    assert.equal(plan.identity.contractAddress, DEMO_V1_CONTRACT_ADDRESS);
    assert.equal(plan.identity.tokenAddress, DEMO_V1_TOKEN_ADDRESS);
  });

  it("uses the existing action-plan interface identity", function () {
    assert.equal(
      planFor(3n).identity.contractInterface,
      LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
    );
  });

  it("does not import the guarded Draw execution adapter", async function () {
    const source = await readFile(
      new URL(
        "../scripts/operator/exact-99-base-sepolia-readiness.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /guarded-single-draw-base-sepolia/);
  });

  it("marks exactly 99 Open as READY_FOR_MANUAL_100_CHECK", function () {
    const plan = planFor(99n);
    assert.equal(plan.decision.status, "READY_FOR_MANUAL_100_CHECK");
    assert.equal(plan.checkpoints[3].classification, "HARD_STOP_REACHED");
    assert.equal(plan.checkpoints[4].classification, "MANUAL_ONLY");
  });

  it("fails closed when selected pool is not first in open-pool order", function () {
    const plan = planFor(3n, { openPoolIds: [2n, 1n] });
    assert.equal(plan.routing.assurance, "BLOCKED");
    assert.equal(plan.decision.status, "BLOCKED");
  });

  it("reports the ten-open-pool limit without authorizing anything", function () {
    const plan = planFor(3n, {
      openPoolIds: Array.from({ length: 10 }, (_, index) => BigInt(index + 1)),
      maxOpenPools: 10n,
    });
    assert.equal(plan.routing.openPoolLimitReached, true);
    assert.equal(plan.safety, EXACT_99_READINESS_SAFETY);
  });

  it("returns READY_FOR_CHECKPOINT for a valid dynamic public manifest", function () {
    const mapping = ownerMappingFor(3);
    const plan = planFor(3n, {
      ownerMapping: mapping,
      manifest: validManifestAssessment(3n, mapping),
    });
    assert.equal(plan.decision.status, "READY_FOR_CHECKPOINT");
  });

  it("keeps manifest overlap unproven when owner mapping is incomplete", function () {
    const mapping = ownerMappingFor(3, { complete: false });
    const parsed = parseManifest(manifestFor(96), 3n, mapping);
    assert.equal(parsed.assessment.status, "INCOMPLETE");
  });

  it("records candidate membership in owner mapping and manifest", function () {
    const mapping = ownerMappingFor(3);
    const manifest = manifestFor(96);
    const assessment = assessExact99Candidate({
      address: manifest.addresses[0],
      poolId: 1n,
      activePositionId: 0n,
      globalActivePositionCount: 0n,
      maxGlobalActivePositionCount: 10n,
      likelyPoolId: 1n,
      ownerMapping: mapping,
      manifest,
    });
    assert.equal(assessment.appearsInOwnerMapping, false);
    assert.equal(assessment.appearsInManifest, true);
  });

  it("keeps plan fingerprint independent of object key insertion order", function () {
    const plan = planFor(3n);
    const reversed = Object.fromEntries(
      Object.entries(plan).reverse(),
    ) as unknown as Exact99ReadinessPlan;
    assert.equal(computeExact99ReadinessFingerprint(reversed), plan.fingerprint);
  });

  it("writes readiness plans atomically and refuses implicit overwrite", async function () {
    const directory = await mkdtemp(join(tmpdir(), "pop33-readiness-"));
    const path = join(directory, "plan.json");
    try {
      const plan = planFor(3n);
      await writeExact99ReadinessPlanFile(path, plan);
      assert.equal(
        parseExact99ReadinessPlanJson(await readFile(path, "utf8")).ok,
        true,
      );
      await assert.rejects(() => writeExact99ReadinessPlanFile(path, plan));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exposes only read methods on the readiness public client prototype", function () {
    assert.deepEqual(
      Object.getOwnPropertyNames(ViemExact99ReadinessPublicClient.prototype)
        .sort(),
      [
        "constructor",
        "readActivePositionId",
        "readActivePositionsByUser",
        "readMaxActivePositionsPerUser",
        "readMaxOpenPools",
        "readOldestQualifyingPool",
        "readOpenPoolIds",
        "readPosition",
        "readPositionCount",
        "readPositionJoinedLogs",
      ],
    );
  });

  it("uses the canonical deployment block for bounded owner scans", function () {
    const ranges = buildExact99BoundedLogRanges({
      deploymentBlock: LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK,
      snapshotBlock: LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK + 1n,
    });
    assert.equal(ranges[0].fromBlock, 44_144_873n);
  });

  it("states explicitly that the plan does not authorize execution", function () {
    const plan = planFor(3n);
    assert.equal(plan.readOnly, true);
    assert.equal(plan.decision.safety, EXACT_99_READINESS_SAFETY);
  });
});
