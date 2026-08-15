import assert from "node:assert/strict";

import {
  DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
  KNOWN_SNAPSHOT_SOURCES,
  analyzeLifecycleSnapshot,
  filterSupervisorReport,
  isSnapshotSourceIdentifier,
  renderSupervisorJson,
  renderSupervisorText,
  type DrawRoundSnapshot,
  type PoolPlan,
  type PoolSnapshot,
} from "../scripts/operator/lifecycle-supervisor.js";
import {
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_ENTRY_PRICE,
  FIXTURE_OBSERVED_AT,
  FIXTURE_POSITION_CAPACITY,
  FIXTURE_PRIZE_PER_ROUND,
  FIXTURE_ROUND_COUNT,
  FixtureLifecycleSnapshotAdapter,
  loadLifecycleFixture,
  makePoolFixture,
  makeRoundFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";

function analyze(
  pool: PoolSnapshot,
  observedAt = FIXTURE_OBSERVED_AT,
  threshold = DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
): PoolPlan {
  return analyzeLifecycleSnapshot(
    makeSystemFixture([pool], { observedAt }),
    { drawOverdueThresholdSeconds: threshold },
  ).plans[0];
}

function roundSet(pool: PoolSnapshot): DrawRoundSnapshot[] {
  return structuredClone([...pool.rounds]);
}

function diagnosticCodes(plan: PoolPlan): string[] {
  return plan.diagnostics.map((entry) => entry.code);
}

describe("read-only multi-pool lifecycle supervisor", function () {
  it("keeps valid snapshot provenance extensible without changing lifecycle decisions", function () {
    for (const source of KNOWN_SNAPSHOT_SOURCES) {
      assert.equal(isSnapshotSourceIdentifier(source), true);
    }
    const futureSource = "future-production-read-only";
    assert.equal(isSnapshotSourceIdentifier(futureSource), true);
    for (const invalid of ["", "Future Source", "-future", "future_source"]) {
      assert.equal(isSnapshotSourceIdentifier(invalid), false);
    }

    const fixtureSnapshot = makeSystemFixture([makePoolFixture({ activePositionCount: 99n })]);
    const futureSnapshot = { ...fixtureSnapshot, source: futureSource };
    const fixtureReport = analyzeLifecycleSnapshot(fixtureSnapshot);
    const futureReport = analyzeLifecycleSnapshot(futureSnapshot);
    assert.equal(futureReport.snapshot.source, futureSource);
    assert.equal(futureReport.plans[0].nextAction, fixtureReport.plans[0].nextAction);
    assert.equal(futureReport.plans[0].reasonCode, fixtureReport.plans[0].reasonCode);
    assert.equal(futureReport.plans[0].dueAt, fixtureReport.plans[0].dueAt);
    assert.deepEqual(futureReport.plans[0].diagnostics, fixtureReport.plans[0].diagnostics);
    assert.notEqual(futureReport.plans[0].planId, fixtureReport.plans[0].planId);
    assert.throws(
      () => analyzeLifecycleSnapshot({ ...fixtureSnapshot, source: "" }),
      /Snapshot source must be a valid lowercase identifier/,
    );
  });

  it("classifies empty, 50/100, and 99/100 Open pools", function () {
    for (const activePositionCount of [0n, 50n, 99n]) {
      const plan = analyze(makePoolFixture({ activePositionCount }));
      assert.equal(plan.nextAction, "WAITING_FOR_PARTICIPANTS");
      assert.equal(plan.severity, "info");
      assert.equal(plan.nextRoundNumber, null);
      assert.match(plan.explanation, new RegExp(`${activePositionCount}/100`));
    }
  });

  it("accepts a correct 100/100 Locked snapshot", function () {
    const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 1n;
    const plan = analyze(makePoolFixture({ status: "Locked", lockedAt }));
    assert.equal(plan.nextAction, "WAITING_FOR_FIRST_DRAW");
    assert.equal(plan.secondsRemaining, 1n);
    assert.equal(plan.nextRoundNumber, 1n);
    assert.equal(plan.diagnostics.length, 0);
  });

  it("distinguishes first draw before, exactly at, and beyond the overdue threshold", function () {
    const before = analyze(makePoolFixture({
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 1n,
    }));
    const due = analyze(makePoolFixture({
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL,
    }));
    const overdue = analyze(makePoolFixture({
      status: "Locked",
      lockedAt:
        FIXTURE_OBSERVED_AT -
        FIXTURE_DRAW_INTERVAL -
        DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS -
        1n,
    }));
    assert.equal(before.nextAction, "WAITING_FOR_FIRST_DRAW");
    assert.equal(due.nextAction, "DRAW_DUE");
    assert.equal(due.secondsOverdue, 0n);
    assert.equal(overdue.nextAction, "DRAW_OVERDUE");
    assert.equal(
      overdue.secondsOverdue,
      DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS + 1n,
    );
  });

  it("treats the configured overdue threshold itself as DRAW_DUE", function () {
    const lockedAt =
      FIXTURE_OBSERVED_AT -
      FIXTURE_DRAW_INTERVAL -
      DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS;
    const plan = analyze(makePoolFixture({ status: "Locked", lockedAt }));
    assert.equal(plan.nextAction, "DRAW_DUE");
    assert.equal(plan.secondsOverdue, DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS);
  });

  it("classifies Drawing before, at, and after the next round deadline", function () {
    const before = analyze(makePoolFixture({
      status: "Drawing",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL,
      completedDrawRoundCount: 1n,
    }));
    const due = analyze(makePoolFixture({
      status: "Drawing",
      lockedAt: FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL,
      completedDrawRoundCount: 1n,
    }));
    const overdue = analyze(makePoolFixture({
      status: "Drawing",
      lockedAt:
        FIXTURE_OBSERVED_AT -
        2n * FIXTURE_DRAW_INTERVAL -
        DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS -
        1n,
      completedDrawRoundCount: 1n,
    }));
    assert.equal(before.nextAction, "WAITING_FOR_NEXT_DRAW");
    assert.equal(before.nextRoundNumber, 2n);
    assert.equal(due.nextAction, "DRAW_DUE");
    assert.equal(overdue.nextAction, "DRAW_OVERDUE");
  });

  it("proposes only one sequential round when several pending schedules elapsed", function () {
    const plan = analyze(makePoolFixture({
      status: "Drawing",
      lockedAt: FIXTURE_OBSERVED_AT - 5n * FIXTURE_DRAW_INTERVAL,
      completedDrawRoundCount: 1n,
    }));
    assert.equal(plan.nextAction, "DRAW_OVERDUE");
    assert.equal(plan.nextRoundNumber, 2n);
    assert.equal(plan.verification.elapsedPendingSchedules, 4n);
    assert.match(plan.explanation, /only this single next sequential round/i);
  });

  it("detects a finalized later round after an earlier pending round", function () {
    const base = makePoolFixture({
      status: "Drawing",
      completedDrawRoundCount: 1n,
      lockedAt: FIXTURE_OBSERVED_AT - 3n * FIXTURE_DRAW_INTERVAL,
    });
    const rounds = roundSet(base);
    rounds[0] = makeRoundFixture({
      number: 1n,
      lockedAt: base.lockedAt as bigint,
      finalized: false,
    });
    rounds[1] = makeRoundFixture({
      number: 2n,
      lockedAt: base.lockedAt as bigint,
      finalized: true,
    });
    const plan = analyze({ ...base, rounds });
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(diagnosticCodes(plan).includes("DRAW_SEQUENCE_GAP"));
  });

  it("detects a duplicated round number", function () {
    const base = makePoolFixture({
      status: "Claimable",
      lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
      claimedPrizeCount: 9n,
    });
    const rounds = roundSet(base);
    rounds[9] = { ...rounds[8] };
    const plan = analyze({ ...base, rounds });
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(diagnosticCodes(plan).includes("DUPLICATE_ROUND_NUMBER"));
  });

  it("detects duplicate winning positions and winner addresses", function () {
    const base = makePoolFixture({
      status: "Drawing",
      lockedAt: FIXTURE_OBSERVED_AT - 3n * FIXTURE_DRAW_INTERVAL,
      completedDrawRoundCount: 2n,
    });
    const rounds = roundSet(base);
    rounds[1] = {
      ...rounds[1],
      winningPositionId: rounds[0].winningPositionId,
      winner: rounds[0].winner,
    };
    const plan = analyze({ ...base, rounds });
    const codes = diagnosticCodes(plan);
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(codes.includes("DUPLICATE_WINNING_POSITION"));
    assert.ok(codes.includes("DUPLICATE_WINNER_ADDRESS"));
  });

  it("reports Claimable with ten or one outstanding claims", function () {
    const ten = analyze(makePoolFixture({
      status: "Claimable",
      lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
      claimedPrizeCount: 0n,
    }));
    const one = analyze(makePoolFixture({
      status: "Claimable",
      lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
      claimedPrizeCount: 9n,
    }));
    assert.equal(ten.nextAction, "CLAIMS_OUTSTANDING");
    assert.equal(ten.missingClaimCount, 10n);
    assert.equal(ten.outstandingWinners.length, 10);
    assert.equal(one.nextAction, "CLAIMS_OUTSTANDING");
    assert.equal(one.missingClaimCount, 1n);
    assert.equal(one.outstandingWinners.length, 1);
  });

  it("rejects Claimable after every prize is marked claimed", function () {
    const plan = analyze(makePoolFixture({
      status: "Claimable",
      lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
      claimedPrizeCount: 10n,
    }));
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(
      diagnosticCodes(plan).includes("CLAIMABLE_WITHOUT_OUTSTANDING_CLAIMS"),
    );
  });

  it("accepts a fully reconciled Finished pool", function () {
    const plan = analyze(makePoolFixture({
      status: "Finished",
      lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
    }));
    assert.equal(plan.nextAction, "FINISHED");
    assert.equal(plan.missingDrawCount, 0n);
    assert.equal(plan.missingClaimCount, 0n);
    assert.equal(plan.diagnostics.length, 0);
  });

  it("detects nonzero accounted escrow in Finished", function () {
    const plan = analyze(makePoolFixture({
      status: "Finished",
      lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
      overrides: { escrowedAmount: 1n },
    }));
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(diagnosticCodes(plan).includes("UNEXPECTED_ACCOUNTED_ESCROW"));
  });

  it("summarizes Open, Locked, Drawing, Claimable, and Finished pools together", function () {
    const report = analyzeLifecycleSnapshot(loadLifecycleFixture("multi-pool"));
    assert.equal(report.plans.length, 5);
    assert.deepEqual(report.summary.statusCounts, {
      Open: 1n,
      Locked: 1n,
      Drawing: 1n,
      Claimable: 1n,
      Finished: 1n,
    });
    assert.equal(report.summary.actionableCount, 3n);
  });

  it("reports two pools independently when both require a draw", function () {
    const lockedAt = FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL;
    const report = analyzeLifecycleSnapshot(makeSystemFixture([
      makePoolFixture({ poolId: 1n, status: "Locked", lockedAt }),
      makePoolFixture({
        poolId: 2n,
        status: "Drawing",
        lockedAt,
        completedDrawRoundCount: 1n,
      }),
    ]));
    assert.deepEqual(
      report.plans.map((plan) => plan.nextRoundNumber),
      [1n, 2n],
    );
    assert.ok(report.plans.every((plan) => plan.nextAction.startsWith("DRAW_")));
  });

  it("is deterministic for the same snapshot, time, and configuration", function () {
    const snapshot = loadLifecycleFixture("multi-pool");
    const first = analyzeLifecycleSnapshot(snapshot);
    const second = analyzeLifecycleSnapshot(structuredClone(snapshot));
    assert.deepEqual(second, first);
  });

  it("changes planId when snapshot state changes and preserves it otherwise", function () {
    const snapshot = loadLifecycleFixture("open-99");
    const first = analyzeLifecycleSnapshot(snapshot).plans[0];
    const same = analyzeLifecycleSnapshot(structuredClone(snapshot)).plans[0];
    const changed = analyzeLifecycleSnapshot({
      ...snapshot,
      blockNumber: (snapshot.blockNumber ?? 0n) + 1n,
    }).plans[0];
    assert.equal(first.planId, same.planId);
    assert.notEqual(first.planId, changed.planId);
    assert.match(first.planId, /^sha256:[0-9a-f]{64}$/);
  });

  it("produces stable valid JSON with bigint values encoded exactly", function () {
    const report = analyzeLifecycleSnapshot(loadLifecycleFixture("multi-pool"));
    const first = renderSupervisorJson(report);
    const second = renderSupervisorJson(report);
    assert.equal(second, first);
    const parsed = JSON.parse(first) as {
      readOnly: boolean;
      snapshot: { chainId: string };
      plans: Array<{ poolId: string }>;
    };
    assert.equal(parsed.readOnly, true);
    assert.equal(parsed.snapshot.chainId, "31337");
    assert.equal(parsed.plans[0].poolId, "1");
    assert.equal(first.includes("\u001b["), false);
  });

  it("filters by actionable plans, warning severity, and pool ID", function () {
    const report = analyzeLifecycleSnapshot(loadLifecycleFixture("multi-pool"));
    const actionable = filterSupervisorReport(report, { onlyActionable: true });
    const warnings = filterSupervisorReport(report, { onlyWarnings: true });
    const onePool = filterSupervisorReport(report, { poolId: 4n });
    assert.equal(actionable.plans.length, 3);
    assert.ok(actionable.plans.every((plan) =>
      ["DRAW_DUE", "DRAW_OVERDUE", "CLAIMS_OUTSTANDING", "INCONSISTENT_STATE"]
        .includes(plan.nextAction)));
    assert.ok(warnings.plans.every((plan) => plan.severity !== "info"));
    assert.deepEqual(onePool.plans.map((plan) => plan.poolId), [4n]);
  });

  it("exposes an adapter with only fixture construction and snapshot reads", async function () {
    const adapter = new FixtureLifecycleSnapshotAdapter(
      loadLifecycleFixture("empty-open"),
    );
    assert.deepEqual(
      Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort(),
      ["constructor", "readSnapshot"],
    );
    const first = await adapter.readSnapshot();
    first.pools[0].status = "Broken";
    const second = await adapter.readSnapshot();
    assert.equal(second.pools[0].status, "Open");
  });

  it("rejects an unknown pool status", function () {
    const plan = analyze(makePoolFixture({ status: "Paused" }));
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(diagnosticCodes(plan).includes("UNKNOWN_POOL_STATUS"));
  });

  it("fails closed when required pool or round data is incomplete", function () {
    const incompletePool = makePoolFixture();
    delete incompletePool.entryPrice;
    const poolPlan = analyze(incompletePool);
    assert.equal(poolPlan.nextAction, "INCONSISTENT_STATE");
    assert.equal(poolPlan.reasonCode, "MISSING_REQUIRED_DATA");

    const base = makePoolFixture({
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 1n,
    });
    const rounds = roundSet(base);
    delete rounds[0].scheduledAt;
    const roundPlan = analyze({ ...base, rounds });
    assert.equal(roundPlan.nextAction, "INCONSISTENT_STATE");
    assert.ok(diagnosticCodes(roundPlan).includes("MISSING_REQUIRED_ROUND_DATA"));
  });

  it("reports system-level pool count and duplicate-ID inconsistencies", function () {
    const duplicate = makePoolFixture({ poolId: 1n });
    const report = analyzeLifecycleSnapshot(makeSystemFixture(
      [duplicate, structuredClone(duplicate)],
      { poolCount: 3n },
    ));
    assert.deepEqual(
      report.systemDiagnostics.map((entry) => entry.code),
      ["POOL_COUNT_MISMATCH", "DUPLICATE_POOL_ID"],
    );
    assert.equal(report.summary.criticalCount, 2n);
  });

  it("detects capacity, lock timestamp, escrow, claim-before-draw, and excess-claim errors", function () {
    const overCapacity = analyze(makePoolFixture({
      activePositionCount: 101n,
      overrides: { escrowedAmount: 101n * FIXTURE_ENTRY_PRICE },
    }));
    assert.ok(diagnosticCodes(overCapacity).includes("POSITION_CAPACITY_EXCEEDED"));

    const lockedWithoutTime = analyze(makePoolFixture({
      status: "Locked",
      lockedAt: 0n,
    }));
    assert.ok(
      diagnosticCodes(lockedWithoutTime).includes(
        "LOCKED_POOL_MISSING_LOCK_TIMESTAMP",
      ),
    );

    const wrongEscrow = analyze(makePoolFixture({
      activePositionCount: 50n,
      overrides: { escrowedAmount: 1n },
    }));
    assert.ok(diagnosticCodes(wrongEscrow).includes("UNEXPECTED_ACCOUNTED_ESCROW"));

    const locked = makePoolFixture({
      status: "Locked",
      lockedAt: FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 1n,
      claimedPrizeCount: 1n,
    });
    const rounds = roundSet(locked);
    rounds[0] = { ...rounds[0], claimed: true };
    const earlyClaim = analyze({ ...locked, rounds });
    const codes = diagnosticCodes(earlyClaim);
    assert.ok(codes.includes("CLAIM_BEFORE_DRAW"));
    assert.ok(codes.includes("CLAIMS_EXCEED_DRAWS"));
  });

  it("preserves integers far above JavaScript safe-number precision", function () {
    const hugeEntry = 9_007_199_254_740_993_123_456_789n;
    const pool = makePoolFixture({
      activePositionCount: 99n,
      overrides: {
        entryPrice: hugeEntry,
        escrowedAmount: hugeEntry * 99n,
      },
    });
    const report = analyzeLifecycleSnapshot(makeSystemFixture([pool]));
    assert.equal(report.plans[0].nextAction, "WAITING_FOR_PARTICIPANTS");
    assert.ok(renderSupervisorJson(report).includes((hugeEntry * 99n).toString()));
  });

  it("renders a human summary with lifecycle counts and snapshot warning", function () {
    const text = renderSupervisorText(
      analyzeLifecycleSnapshot(loadLifecycleFixture("multi-pool")),
    );
    assert.match(text, /READ ONLY/);
    assert.match(text, /Open 1 \| Locked 1 \| Drawing 1 \| Claimable 1 \| Finished 1/);
    assert.match(text, /Snapshot only/);
  });

  it("rejects invalid time configuration instead of reading ambient time", function () {
    assert.throws(
      () => analyzeLifecycleSnapshot(
        makeSystemFixture([makePoolFixture()]),
        { drawOverdueThresholdSeconds: -1n },
      ),
      /must not be negative/,
    );
    assert.throws(
      () => analyzeLifecycleSnapshot(
        makeSystemFixture([makePoolFixture()], { observedAt: -1n }),
      ),
      /observedAt/,
    );
  });

  it("keeps one main result even when a pool has several inconsistencies", function () {
    const plan = analyze(makePoolFixture({
      status: "Locked",
      activePositionCount: 99n,
      lockedAt: 0n,
      overrides: { escrowedAmount: 1n },
    }));
    assert.equal(plan.nextAction, "INCONSISTENT_STATE");
    assert.ok(plan.diagnostics.length >= 3);
  });

  it("uses the configured pool snapshot rather than hard-coded 100/10 economics", function () {
    const customEntry = 10_000_000n;
    const customPrize = 20_000_000n;
    const pool = makePoolFixture({
      activePositionCount: 2n,
      overrides: {
        maxPositionCount: 3n,
        entryPrice: customEntry,
        escrowedAmount: 2n * customEntry,
        drawRoundCount: 2n,
        prizePerRound: customPrize,
        totalPrizeAmount: 2n * customPrize,
      },
    });
    const plan = analyze(pool);
    assert.equal(plan.nextAction, "WAITING_FOR_PARTICIPANTS");
    assert.match(plan.explanation, /2\/3/);
  });

  it("keeps the fixture constants aligned with current Demo V1", function () {
    assert.equal(FIXTURE_POSITION_CAPACITY, 100n);
    assert.equal(FIXTURE_ROUND_COUNT, 10n);
    assert.equal(FIXTURE_PRIZE_PER_ROUND, 330_000_000n);
  });
});
