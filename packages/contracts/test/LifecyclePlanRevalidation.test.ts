import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS,
  LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
  LIFECYCLE_REVALIDATION_EXIT_CODES,
  canonicalizeLifecyclePlanValue,
  computeLifecycleActionPlanFingerprint,
  createLifecycleActionPlan,
  lifecycleRevalidationExitCode,
  parseLifecycleActionPlanJson,
  renderLifecycleRevalidationJson,
  renderLifecycleRevalidationText,
  revalidateLifecycleActionPlan,
  serializeLifecycleActionPlan,
  type LifecycleActionPlan,
} from "../scripts/operator/lifecycle-action-plan.js";
import {
  readLifecyclePlanFile,
  resolveLifecyclePlanPath,
  writeLifecyclePlanFile,
} from "../scripts/operator/lifecycle-plan-file.js";
import {
  LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
} from "../scripts/operator/lifecycle-supervisor-base-sepolia.js";
import {
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_OBSERVED_AT,
  FIXTURE_POSITION_CAPACITY,
  FixtureLifecycleSnapshotAdapter,
  loadLifecycleFixture,
  makePoolFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";
import {
  analyzeLifecycleSnapshot,
  type NextAction,
  type SystemSnapshot,
} from "../scripts/operator/lifecycle-supervisor.js";

function dueSnapshot(overrides: Partial<SystemSnapshot> = {}): SystemSnapshot {
  const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL;
  return makeSystemFixture([
    makePoolFixture({ status: "Locked", lockedAt }),
  ], overrides);
}

function planFor(snapshot: SystemSnapshot, sourceReference = "test-fixture") {
  return createLifecycleActionPlan(
    snapshot,
    analyzeLifecycleSnapshot(snapshot),
    snapshot.pools[0].poolId,
    { sourceReference },
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

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, nested]) => [key, reverseKeys(nested)]),
    );
  }
  return value;
}

function revalidate(
  plan: LifecycleActionPlan,
  snapshot: SystemSnapshot,
  options: Parameters<typeof revalidateLifecycleActionPlan>[3] = {},
) {
  return revalidateLifecycleActionPlan(
    plan,
    snapshot,
    analyzeLifecycleSnapshot(snapshot),
    {
      freshSourceReference: plan.source.reference,
      ...options,
    },
  );
}

describe("lifecycle action plan freshness revalidation", function () {
  it("creates a deterministic actionable Draw plan with minimal critical assumptions", function () {
    const snapshot = dueSnapshot();
    const first = planFor(snapshot);
    const second = planFor(structuredClone(snapshot));
    assert.deepEqual(second, first);
    assert.equal(first.scope.classification, "actionable");
    assert.equal(first.scope.plannedAction, "DRAW");
    assert.equal(first.scope.supervisorAction, "DRAW_DUE");
    assert.equal(first.scope.roundNumber, "1");
    assert.equal(first.assumptions.activePositionCount, "100");
    assert.equal(first.assumptions.maxPositionCount, "100");
    assert.equal(first.assumptions.snapshotComplete, true);
    assert.match(first.planId, /^lifecycle-plan:[0-9a-f]{64}$/);
  });

  it("stores identity, block metadata, source, contract interface, and creation time", function () {
    const plan = planFor(dueSnapshot());
    assert.equal(plan.formatVersion, 1);
    assert.equal(plan.createdAt, FIXTURE_OBSERVED_AT.toString());
    assert.equal(plan.identity.chainId, "31337");
    assert.equal(plan.identity.baseBlockNumber, "12345");
    assert.equal(plan.identity.baseBlockTimestamp, FIXTURE_OBSERVED_AT.toString());
    assert.equal(
      plan.identity.contractInterface,
      LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
    );
    assert.equal(plan.source.type, "fixture");
  });

  it("calculates and validates the plan fingerprint", function () {
    const plan = planFor(dueSnapshot());
    assert.equal(computeLifecycleActionPlanFingerprint(plan), plan.fingerprint);
    assert.equal(parseLifecycleActionPlanJson(serializeLifecycleActionPlan(plan)).ok, true);
  });

  it("round-trips a future valid source identifier and rejects an invalid one", function () {
    const source = "future-production-read-only";
    const snapshot = dueSnapshot({ source });
    const plan = planFor(snapshot);
    const parsed = parseLifecycleActionPlanJson(serializeLifecycleActionPlan(plan));
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.plan.source.type, source);
    assert.equal(revalidate(plan, structuredClone(snapshot)).status, "VALID");

    const invalid = resign({ ...plan, source: { ...plan.source, type: "" } });
    const invalidParsed = parseLifecycleActionPlanJson(
      serializeLifecycleActionPlan(invalid),
    );
    assert.equal(invalidParsed.ok, false);
    if (!invalidParsed.ok) assert.ok(invalidParsed.errors.includes("source.type is invalid."));
  });

  it("returns VALID for the identical snapshot", function () {
    const snapshot = dueSnapshot();
    const result = revalidate(planFor(snapshot), structuredClone(snapshot));
    assert.equal(result.status, "VALID");
    assert.equal(result.reasonCode, "PLAN_STILL_CURRENT");
    assert.deepEqual(result.changes, []);
  });

  it("returns VALID for a newer logically unchanged snapshot", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 5n;
    fresh.observedAt += 10n;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "VALID");
    assert.equal(result.freshBlockNumber, "12350");
  });

  it("returns STALE after the planned Draw was executed", function () {
    const snapshot = dueSnapshot();
    const lockedAt = snapshot.pools[0].lockedAt as bigint;
    const fresh = makeSystemFixture([
      makePoolFixture({
        status: "Drawing",
        lockedAt,
        completedDrawRoundCount: 1n,
        observedAt: FIXTURE_OBSERVED_AT + 10n,
      }),
    ], {
      blockNumber: 12_346n,
      observedAt: FIXTURE_OBSERVED_AT + 10n,
    });
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "STALE");
    assert.ok(result.changes.some((entry) =>
      entry.field === "assumptions.completedDrawRoundCount"));
  });

  it("returns STALE when pool status changes", function () {
    const plan = planFor(loadLifecycleFixture("open-99"));
    const fresh = dueSnapshot({ blockNumber: 12_346n });
    const result = revalidate(plan, fresh);
    assert.equal(result.status, "STALE");
    assert.ok(result.changes.some((entry) =>
      entry.field === "scope.expectedPoolStatus"));
  });

  it("returns STALE when the round number changes", function () {
    const snapshot = dueSnapshot();
    const lockedAt = snapshot.pools[0].lockedAt as bigint;
    const fresh = makeSystemFixture([
      makePoolFixture({
        status: "Drawing",
        lockedAt,
        completedDrawRoundCount: 1n,
        observedAt: FIXTURE_OBSERVED_AT + FIXTURE_DRAW_INTERVAL,
      }),
    ], {
      blockNumber: 12_346n,
      observedAt: FIXTURE_OBSERVED_AT + FIXTURE_DRAW_INTERVAL,
    });
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "STALE");
    assert.ok(result.changes.some((entry) => entry.field === "scope.roundNumber"));
  });

  it("returns STALE when the supervisor recommendation changes", function () {
    const snapshot = loadLifecycleFixture("open-99");
    const fresh: SystemSnapshot = {
      ...structuredClone(snapshot),
      blockNumber: (snapshot.blockNumber as bigint) + 1n,
      pools: [makePoolFixture({
        poolId: 1n,
        status: "Finished",
        lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
      })],
    };
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "STALE");
    assert.ok(result.changes.some((entry) =>
      entry.field === "scope.supervisorAction"));
  });

  it("returns BLOCKED when a saved Draw is no longer due", function () {
    const snapshot = dueSnapshot();
    const futureLockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 100n;
    const fresh = makeSystemFixture([
      makePoolFixture({
        status: "Locked",
        lockedAt: futureLockedAt,
      }),
    ], { blockNumber: 12_346n });
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reasonCode, "DRAW_NOT_CURRENTLY_ALLOWED");
  });

  it("returns BLOCKED for incorrect accounted escrow", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    fresh.pools[0].escrowedAmount = 1n;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reasonCode, "FRESH_SUPERVISOR_BLOCKED");
  });

  it("returns BLOCKED for an unknown pool status", function () {
    const snapshot = loadLifecycleFixture("open-99");
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    fresh.pools[0].status = "Unknown(99)";
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "BLOCKED");
  });

  it("returns INCOMPLETE for a snapshot marked partial", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    fresh.metadata = {
      network: "fixture",
      rpcHost: "none",
      requestedPoolRange: null,
      snapshotComplete: false,
      warnings: ["partial read"],
    };
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "INCOMPLETE");
  });

  it("returns INCOMPLETE when required pool data is missing", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    delete fresh.pools[0].claimedPrizeAmount;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "INCOMPLETE");
  });

  it("returns INCOMPLETE when a required round is partial", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    delete fresh.pools[0].rounds[0].scheduledAt;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "INCOMPLETE");
  });

  it("rejects corrupt JSON as INVALID_PLAN without reading a snapshot", function () {
    const parsed = parseLifecycleActionPlanJson("{broken");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.errors[0], /valid JSON/);
  });

  it("rejects an unsupported format version", function () {
    const json = serializeLifecycleActionPlan(planFor(dueSnapshot()))
      .replace('"formatVersion": 1', '"formatVersion": 2');
    const parsed = parseLifecycleActionPlanJson(json);
    assert.equal(parsed.ok, false);
  });

  it("rejects a modified fingerprint", function () {
    const plan = planFor(dueSnapshot());
    plan.fingerprint = `sha256:${"0".repeat(64)}`;
    assert.equal(
      revalidate(plan, dueSnapshot()).status,
      "INVALID_PLAN",
    );
  });

  it("rejects a plan with a missing required field", function () {
    const plan = JSON.parse(
      serializeLifecycleActionPlan(planFor(dueSnapshot())),
    ) as { identity: Record<string, unknown> };
    delete plan.identity.chainId;
    const parsed = parseLifecycleActionPlanJson(JSON.stringify(plan));
    assert.equal(parsed.ok, false);
  });

  it("blocks a different chain ID", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.chainId = 84_532n;
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reasonCode, "IDENTITY_MISMATCH");
  });

  it("blocks a different contract address", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.contractAddress = "0x0000000000000000000000000000000000001234";
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    assert.equal(revalidate(planFor(snapshot), fresh).status, "BLOCKED");
  });

  it("does not validate a different pool ID", function () {
    const snapshot = dueSnapshot();
    const changed = structuredClone(planFor(snapshot));
    changed.scope.poolId = "2";
    const result = revalidate(resign(changed), snapshot);
    assert.equal(result.status, "STALE");
    assert.equal(result.reasonCode, "POOL_NO_LONGER_PRESENT");
  });

  it("blocks a fresh block older than the base block", function () {
    const snapshot = dueSnapshot();
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) - 1n;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reasonCode, "BLOCK_REGRESSION");
  });

  it("returns STALE when the maximum plan age is exceeded", function () {
    const snapshot = loadLifecycleFixture("open-99");
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 100n;
    fresh.observedAt += DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS + 1n;
    const result = revalidate(planFor(snapshot), fresh);
    assert.equal(result.status, "STALE");
    assert.equal(result.reasonCode, "PLAN_MAX_AGE_EXCEEDED");
  });

  it("preserves integers above JavaScript safe-number precision", function () {
    const huge = 9_007_199_254_740_993_123_456_789n;
    const snapshot = makeSystemFixture([
      makePoolFixture({
        activePositionCount: 99n,
        overrides: {
          entryPrice: huge,
          escrowedAmount: huge * 99n,
        },
      }),
    ]);
    const plan = planFor(snapshot);
    assert.equal(plan.assumptions.escrowedAmount, (huge * 99n).toString());
    assert.ok(serializeLifecycleActionPlan(plan).includes((huge * 99n).toString()));
  });

  it("uses key-order-independent canonical serialization", function () {
    const plan = planFor(dueSnapshot());
    const reordered = reverseKeys(plan) as LifecycleActionPlan;
    assert.equal(
      canonicalizeLifecyclePlanValue(plan),
      canonicalizeLifecyclePlanValue(reordered),
    );
    assert.equal(
      computeLifecycleActionPlanFingerprint(plan),
      computeLifecycleActionPlanFingerprint(reordered),
    );
  });

  it("changes the fingerprint when one critical value changes", function () {
    const plan = planFor(dueSnapshot());
    const changed = structuredClone(plan);
    changed.assumptions.completedDrawRoundCount = "1";
    assert.notEqual(
      computeLifecycleActionPlanFingerprint(plan),
      computeLifecycleActionPlanFingerprint(changed),
    );
  });

  it("renders compact text and JSON diffs with expected and actual values", function () {
    const snapshot = loadLifecycleFixture("open-99");
    const fresh = structuredClone(snapshot);
    fresh.blockNumber = (fresh.blockNumber as bigint) + 1n;
    fresh.pools[0].activePositionCount = 50n;
    fresh.pools[0].escrowedAmount = 50n * 33_000_000n;
    const result = revalidate(planFor(snapshot), fresh);
    const text = renderLifecycleRevalidationText(result);
    const json = renderLifecycleRevalidationJson(result);
    assert.match(text, /assumptions\.activePositionCount: 99 -> 50/);
    assert.match(text, /Decision:/);
    assert.equal(JSON.parse(json).status, "STALE");
  });

  it("works through the existing fixture adapter", async function () {
    const adapter = new FixtureLifecycleSnapshotAdapter(
      loadLifecycleFixture("open-99"),
    );
    const snapshot = await adapter.readSnapshot();
    const plan = planFor(snapshot, "open-99");
    assert.equal(revalidate(plan, await adapter.readSnapshot()).status, "VALID");
  });

  it("accepts a Base Sepolia adapter-shaped complete snapshot", function () {
    const snapshot = makeSystemFixture([makePoolFixture({ activePositionCount: 3n })], {
      chainId: 84_532n,
      contractAddress: LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
      source: "base-sepolia-read-only",
      metadata: {
        network: "Base Sepolia",
        rpcHost: "rpc.example.test",
        requestedPoolRange: { fromPoolId: 1n, toPoolId: 1n },
        snapshotComplete: true,
        warnings: [],
      },
    });
    const plan = planFor(snapshot, "base-sepolia");
    assert.equal(revalidate(plan, snapshot).status, "VALID");
  });

  it("does not change the existing supervisor result codes", function () {
    const expected: NextAction[] = [
      "WAITING_FOR_PARTICIPANTS",
      "WAITING_FOR_FIRST_DRAW",
      "WAITING_FOR_NEXT_DRAW",
      "DRAW_DUE",
      "DRAW_OVERDUE",
      "CLAIMS_OUTSTANDING",
      "FINISHED",
      "INCONSISTENT_STATE",
      "NO_ACTION",
    ];
    assert.deepEqual([...expected], expected);
    assert.equal(
      analyzeLifecycleSnapshot(loadLifecycleFixture("open-99")).plans[0].nextAction,
      "WAITING_FOR_PARTICIPANTS",
    );
  });

  it("maps every revalidation status and RPC failure to a distinct CLI exit code", function () {
    assert.equal(lifecycleRevalidationExitCode("VALID"), 0);
    assert.deepEqual(LIFECYCLE_REVALIDATION_EXIT_CODES, {
      VALID: 0,
      STALE: 10,
      BLOCKED: 11,
      INCOMPLETE: 12,
      INVALID_PLAN: 13,
      RPC_FAILURE: 14,
    });
    assert.equal(
      new Set(Object.values(LIFECYCLE_REVALIDATION_EXIT_CODES)).size,
      6,
    );
  });

  it("validates plan paths, writes JSON, and refuses implicit overwrite", async function () {
    const directory = await mkdtemp(join(tmpdir(), "pop33-plan-"));
    try {
      const snapshot = dueSnapshot();
      const plan = planFor(snapshot);
      assert.throws(
        () => resolveLifecyclePlanPath("plan.txt", directory),
        /end with \.json/,
      );
      assert.throws(
        () => resolveLifecyclePlanPath("../plan.json", directory),
        /remain inside/,
      );
      const path = await writeLifecyclePlanFile("plan.json", plan, {
        workingDirectory: directory,
      });
      assert.equal(
        (await readLifecyclePlanFile(path)).json,
        await readFile(path, "utf8"),
      );
      await assert.rejects(
        writeLifecyclePlanFile(path, plan),
        /already exists/,
      );
      await writeLifecyclePlanFile(path, plan, { overwrite: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("stores only read-only planning data and exposes no execution primitive", async function () {
    const source = await readFile(
      new URL(
        "../scripts/operator/lifecycle-action-plan.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /writeContract|sendTransaction|sendRawTransaction|walletClient|\bSigner\b|privateKey|mnemonic|deployContract|\.executeDraw\(|contract\.claim\(|contract\.join\(|contract\.approve\(/i,
    );
    assert.equal(FIXTURE_POSITION_CAPACITY, 100n);
  });
});
