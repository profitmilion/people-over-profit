import assert from "node:assert/strict";

import {
  logicalDrawKey,
  runAutomaticDrawReadOnlyDecisionCycle,
} from "../scripts/operator/automatic-draw-runner-v1-decision.js";
import {
  FIXTURE_CONTRACT_ADDRESS,
  FIXTURE_DRAW_INTERVAL,
  FIXTURE_OBSERVED_AT,
  FIXTURE_CHAIN_ID,
  FixtureLifecycleSnapshotAdapter,
  makePoolFixture,
  makeSystemFixture,
} from "../scripts/operator/lifecycle-supervisor-fixtures.js";

const scope = {
  chainId: FIXTURE_CHAIN_ID,
  contractAddress: FIXTURE_CONTRACT_ADDRESS,
  poolId: 1n,
};

function decide(pool = makePoolFixture()) {
  return runAutomaticDrawReadOnlyDecisionCycle({
    scope,
    adapter: new FixtureLifecycleSnapshotAdapter(makeSystemFixture([pool])),
  });
}

describe("Automatic Draw Runner V1 read-only decision cycle", function () {
  it("A. returns NO_ACTION when an Open pool is not ready", async function () {
    const decision = await decide(makePoolFixture({ activePositionCount: 99n }));
    assert.equal(decision.status, "NO_ACTION");
    assert.equal(decision.nextAction, "WAITING_FOR_PARTICIPANTS");
  });

  it("B. returns the exact first Draw when it is due", async function () {
    const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL;
    const decision = await decide(makePoolFixture({ status: "Locked", lockedAt }));
    assert.equal(decision.status, "DRAW_DUE");
    if (decision.status !== "DRAW_DUE") assert.fail("Expected DRAW_DUE.");
    assert.equal(decision.poolId, 1n);
    assert.equal(decision.roundNumber, 1n);
    assert.equal(decision.scheduledAt, FIXTURE_OBSERVED_AT);
    assert.equal(decision.nextAction, "DRAW_DUE");
    assert.equal(decision.sourceBlock, 12_345n);
  });

  it("C. returns only the later next sequential Draw", async function () {
    const lockedAt = FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL;
    const decision = await decide(makePoolFixture({
      status: "Drawing",
      lockedAt,
      completedDrawRoundCount: 1n,
    }));
    assert.equal(decision.status, "DRAW_DUE");
    if (decision.status !== "DRAW_DUE") assert.fail("Expected DRAW_DUE.");
    assert.equal(decision.roundNumber, 2n);
    assert.equal(decision.nextAction, "DRAW_DUE");
  });

  it("D. returns NO_ACTION when the next Draw is in the future", async function () {
    const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 1n;
    const decision = await decide(makePoolFixture({ status: "Locked", lockedAt }));
    assert.equal(decision.status, "NO_ACTION");
    assert.equal(decision.nextAction, "WAITING_FOR_FIRST_DRAW");
  });

  it("E. returns NO_ACTION for a Claimable pool", async function () {
    const decision = await decide(makePoolFixture({ status: "Claimable" }));
    assert.equal(decision.status, "NO_ACTION");
    assert.equal(decision.nextAction, "CLAIMS_OUTSTANDING");
  });

  it("F. returns NO_ACTION for a Finished pool", async function () {
    const decision = await decide(makePoolFixture({ status: "Finished" }));
    assert.equal(decision.status, "NO_ACTION");
    assert.equal(decision.nextAction, "FINISHED");
  });

  it("G. returns INCONSISTENT for invalid lifecycle state", async function () {
    const decision = await decide(makePoolFixture({
      status: "Drawing",
      completedDrawRoundCount: 0n,
    }));
    assert.equal(decision.status, "INCONSISTENT");
    assert.equal(decision.nextAction, "INCONSISTENT_STATE");
  });

  it("H. returns READ_FAILED for an incomplete snapshot", async function () {
    const pool = makePoolFixture();
    const incomplete = { ...pool, activePositionCount: undefined };
    const decision = await decide(incomplete);
    assert.equal(decision.status, "READ_FAILED");
  });

  it("I. derives a deterministic, scope-specific logical Draw key", function () {
    const checksum = "0x0000000000000000000000000000000000000033";
    const lowerCase = checksum.toLowerCase();
    const first = logicalDrawKey({ ...scope, contractAddress: checksum, roundNumber: 2n });
    const repeated = logicalDrawKey({ ...scope, contractAddress: lowerCase, roundNumber: 2n });
    const nextRound = logicalDrawKey({ ...scope, roundNumber: 3n });
    const otherPool = logicalDrawKey({ ...scope, poolId: 2n, roundNumber: 2n });
    assert.equal(first, repeated);
    assert.equal(
      first,
      "pop33:action=Draw:chainId=31337:contract=0x0000000000000000000000000000000000000033:poolId=1:round=2",
    );
    assert.notEqual(first, nextRound);
    assert.notEqual(first, otherPool);
  });

  it("J. runs successfully without a Draw private key", async function () {
    const previous = process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY;
    delete process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY;
    try {
      const decision = await decide();
      assert.equal(decision.status, "NO_ACTION");
      assert.equal(decision.safety, "READ_ONLY_NO_KEYS_NO_TRANSACTIONS");
    } finally {
      if (previous === undefined) {
        delete process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY;
      } else {
        process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY = previous;
      }
    }
  });

  it("returns AMBIGUOUS rather than selecting from multiple pool snapshots", async function () {
    const decision = await runAutomaticDrawReadOnlyDecisionCycle({
      scope,
      adapter: new FixtureLifecycleSnapshotAdapter(makeSystemFixture([
        makePoolFixture({ poolId: 1n }),
        makePoolFixture({ poolId: 2n }),
      ])),
    });
    assert.equal(decision.status, "AMBIGUOUS");
  });

  it("returns READ_FAILED when the snapshot read throws", async function () {
    const decision = await runAutomaticDrawReadOnlyDecisionCycle({
      scope,
      adapter: {
        source: "fixture",
        async readSnapshot() {
          throw new Error("fixture read failure");
        },
      },
    });
    assert.equal(decision.status, "READ_FAILED");
  });
});
