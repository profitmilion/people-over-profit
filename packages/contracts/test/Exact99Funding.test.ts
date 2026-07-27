import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  preflightExact99OperatorArtifactsWithFunding,
} from "../scripts/operator/base-sepolia-artifact-audit.js";
import {
  EXACT_99_FUNDING_PURPOSE,
  assertExact99FundingMode,
  buildExact99FundingPlan,
  inspectExact99Funding,
  renderExact99FundingInspection,
  renderExact99FundingPlan,
  simulateExact99Funding,
  validateExact99FundingPlan,
  type Exact99FundingLimits,
  type Exact99FundingPlan,
  type Exact99FundingSignerIdentity,
  type Exact99FundingSimulationOutcome,
} from "../scripts/operator/exact-99-funding.js";
import {
  buildInitialExact99ArtifactSet,
  validateExact99Journal,
  type Exact99Journal,
  type Exact99JournalEntry,
} from "../scripts/operator/exact-99-operator-artifacts.js";
import type { EncryptedWalletStoreInspection } from "../scripts/operator/encrypted-wallet-store.js";

const CREATED_AT = "2026-07-28T10:00:00.000Z";
const SET_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const STORE_FINGERPRINT = `sha256:${"ab".repeat(32)}`;
const HASH_A = `0x${"12".repeat(32)}`;
const HASH_B = `0x${"34".repeat(32)}`;
const PER_WALLET_WEI = "50000000000000";
const MAX_PER_WALLET_WEI = "100000000000000";
const TOTAL_PLANNED_WEI = "4950000000000000";
const MAX_TOTAL_WEI = "10000000000000000";
const RESERVE_WEI = "1000000000000000";
const STARTING_BALANCE_WEI = "20000000000000000";

function fixtureAddress(index: number): string {
  return `0x${(index + 10_000).toString(16).padStart(40, "0")}`;
}

function store(count = 99): EncryptedWalletStoreInspection {
  return {
    formatVersion: 1,
    storeId: STORE_ID,
    walletCount: count,
    addresses: Array.from({ length: count }, (_, index) => fixtureAddress(index)),
    fingerprint: STORE_FINGERPRINT,
  };
}

function artifacts() {
  return buildInitialExact99ArtifactSet(store(), CREATED_AT, SET_ID);
}

function limits(overrides: Partial<Exact99FundingLimits> = {}): Exact99FundingLimits {
  return {
    plannedAmountPerWalletWei: PER_WALLET_WEI,
    minimumTargetBalanceWei: PER_WALLET_WEI,
    maximumPerWalletWei: MAX_PER_WALLET_WEI,
    maximumTotalBudgetWei: MAX_TOTAL_WEI,
    signerReserveWei: RESERVE_WEI,
    ...overrides,
  };
}

function signer(overrides: Partial<Exact99FundingSignerIdentity> = {}): Exact99FundingSignerIdentity {
  return {
    address: fixtureAddress(999),
    chainId: "84532",
    purpose: EXACT_99_FUNDING_PURPOSE,
    maximumBudgetWei: MAX_TOTAL_WEI,
    startingBalanceWei: STARTING_BALANCE_WEI,
    requiredReserveWei: RESERVE_WEI,
    ...overrides,
  };
}

function plan(
  limitOverrides: Partial<Exact99FundingLimits> = {},
  signerOverrides: Partial<Exact99FundingSignerIdentity> = {},
): Exact99FundingPlan {
  const fixture = artifacts();
  const configuredLimits = limits(limitOverrides);
  return buildExact99FundingPlan({
    manifest: fixture.manifest,
    limits: configuredLimits,
    signer: signer({
      maximumBudgetWei: configuredLimits.maximumTotalBudgetWei,
      requiredReserveWei: configuredLimits.signerReserveWei,
      ...signerOverrides,
    }),
  });
}

function success(hash = HASH_A, blockNumber = 100): Exact99FundingSimulationOutcome {
  return { type: "success", transactionHash: hash, blockNumber, gasUsed: "21000" };
}

function simulate(
  outcomes: ReadonlyMap<number, Exact99FundingSimulationOutcome>,
  input?: {
    checkpoint?: ReturnType<typeof artifacts>["checkpoint"];
    journal?: Exact99Journal;
    plan?: Exact99FundingPlan;
    startedAt?: string;
  },
) {
  const fixture = artifacts();
  return simulateExact99Funding({
    manifest: fixture.manifest,
    checkpoint: input?.checkpoint ?? fixture.checkpoint,
    journal: input?.journal ?? fixture.journal,
    plan: input?.plan ?? plan(),
    outcomes,
    startedAt: input?.startedAt ?? CREATED_AT,
  });
}

describe("exact-99 capped funding subsystem", function () {
  it("creates a deterministic manifest-bound plan for exactly 99 ordered recipients", function () {
    const first = plan();
    const second = plan();
    assert.deepEqual(second, first);
    assert.equal(first.walletCount, 99);
    assert.equal(first.operations.length, 99);
    assert.equal(first.totalPlannedWei, TOTAL_PLANNED_WEI);
    assert.equal(new Set(first.operations.map((operation) => operation.address.toLowerCase())).size, 99);
    assert.equal(new Set(first.operations.map((operation) => operation.operationId)).size, 99);
    assert.deepEqual(first.operations.map((operation) => operation.index), Array.from({ length: 99 }, (_, index) => index));
  });

  it("rejects plans containing 98 or 100 recipients", function () {
    const fixture = artifacts();
    const valid = plan();
    for (const count of [98, 100]) {
      const operations = count === 98
        ? valid.operations.slice(0, 98)
        : [...valid.operations, { ...valid.operations[98], index: 99 }];
      assert.throws(() => validateExact99FundingPlan({
        ...valid,
        walletCount: count,
        operations,
      }, fixture.manifest), /exactly 99 operations/);
    }
  });

  it("rejects an address outside the manifest", function () {
    const fixture = artifacts();
    const valid = plan();
    const operations = structuredClone(valid.operations);
    operations[10].address = fixtureAddress(5_000);
    assert.throws(
      () => validateExact99FundingPlan({ ...valid, operations }, fixture.manifest),
      /outside the ordered exact-99 manifest/,
    );
  });

  it("rejects a duplicate recipient", function () {
    const fixture = artifacts();
    const valid = plan();
    const operations = structuredClone(valid.operations);
    operations[1].address = operations[0].address;
    assert.throws(
      () => validateExact99FundingPlan({ ...valid, operations }, fixture.manifest),
      /duplicate recipient|outside the ordered exact-99 manifest/,
    );
  });

  it("rejects changed recipient order", function () {
    const fixture = artifacts();
    const valid = plan();
    const operations = structuredClone(valid.operations);
    [operations[0], operations[1]] = [operations[1], operations[0]];
    assert.throws(
      () => validateExact99FundingPlan({ ...valid, operations }, fixture.manifest),
      /order or index changed/,
    );
  });

  it("rejects a per-wallet amount above its maximum", function () {
    assert.throws(
      () => plan({ maximumPerWalletWei: "49999999999999" }),
      /exceeds the per-wallet maximum/,
    );
  });

  it("rejects a total amount above the configured maximum budget", function () {
    assert.throws(
      () => plan({ maximumTotalBudgetWei: "4949999999999999" }),
      /exceeds the maximum total budget/,
    );
  });

  it("rejects a plan that violates the signer reserve", function () {
    assert.throws(
      () => plan({}, { startingBalanceWei: "5949999999999999" }),
      /violate the required signer reserve/,
    );
  });

  it("rejects an insufficient signer starting balance", function () {
    assert.throws(
      () => plan({}, { startingBalanceWei: "4949999999999999" }),
      /insufficient balance/,
    );
  });

  it("accepts only canonical decimal wei strings and rejects unit ambiguity", function () {
    assert.equal(plan().limits.plannedAmountPerWalletWei, PER_WALLET_WEI);
    for (const invalid of ["0.00005 ETH", "50 gwei", "-1", "0", 50_000_000_000_000]) {
      assert.throws(
        () => plan({ plannedAmountPerWalletWei: invalid as string }),
        /canonical decimal wei string|greater than zero wei/,
      );
    }
  });

  it("binds a public fixture signer identity to chain, purpose, budget, balance, and reserve", function () {
    const fundingPlan = plan();
    assert.equal(fundingPlan.signer.chainId, "84532");
    assert.equal(fundingPlan.signer.purpose, EXACT_99_FUNDING_PURPOSE);
    assert.equal(fundingPlan.signer.maximumBudgetWei, MAX_TOTAL_WEI);
    assert.equal(fundingPlan.signer.requiredReserveWei, RESERVE_WEI);
    assert.throws(() => plan({}, { chainId: "1" }), /chain ID mismatch/);
    assert.throws(
      () => plan({}, { purpose: "other" as typeof EXACT_99_FUNDING_PURPOSE }),
      /purpose mismatch/,
    );
  });

  it("resumes after partially confirmed funding without replaying confirmed wallets", function () {
    const first = simulate(new Map([
      [0, success(HASH_A, 100)],
      [1, success(HASH_B, 101)],
    ]));
    assert.equal(first.confirmedFundingCount, 2);
    assert.equal(first.checkpoint.counters.funded, 2);
    const beforeEntries = first.journal.entries.length;

    const resumed = simulate(
      new Map([[2, success(`0x${"56".repeat(32)}`, 102)]]),
      {
        checkpoint: first.checkpoint,
        journal: first.journal,
        startedAt: "2026-07-28T11:00:00.000Z",
      },
    );
    assert.equal(resumed.confirmedFundingCount, 3);
    assert.equal(resumed.processedOperations, 1);
    assert.equal(
      resumed.journal.entries.filter((entry) => entry.operationId === plan().operations[0].operationId).length,
      4,
    );
    assert.equal(resumed.journal.entries.length, beforeEntries + 4);
  });

  it("resumes safely after a crash immediately after the planned journal event", function () {
    const fixture = artifacts();
    const fundingPlan = plan();
    const operation = fundingPlan.operations[0];
    const plannedEntry: Exact99JournalEntry = {
      sequence: 1,
      operationId: operation.operationId,
      type: "funding",
      walletIndex: operation.index,
      walletAddress: operation.address,
      expectedState: [
        `funding-plan=${operation.manifestFingerprint}`,
        "wallet-index=0",
        `minimum-target-wei=${operation.minimumTargetBalanceWei}`,
        `planned-amount-wei=${operation.plannedAmountWei}`,
        `maximum-amount-wei=${operation.maximumAllowedAmountWei}`,
      ].join(";"),
      transactionHash: null,
      status: "planned",
      blockNumber: null,
      receipt: null,
      reconciliation: null,
      error: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    const journal = validateExact99Journal({
      ...fixture.journal,
      revision: 1,
      entries: [plannedEntry],
    }, fixture.manifest);
    const resumed = simulate(
      new Map([[0, success()]]),
      {
        checkpoint: fixture.checkpoint,
        journal,
        plan: fundingPlan,
        startedAt: "2026-07-28T11:00:00.000Z",
      },
    );
    assert.deepEqual(
      resumed.journal.entries.map((entry) => entry.status),
      ["planned", "prepared", "pending", "confirmed"],
    );
    assert.equal(resumed.confirmedFundingCount, 1);
  });

  it("never automatically funds an already confirmed wallet twice", function () {
    const first = simulate(new Map([[0, success()]]));
    const resumed = simulate(
      new Map([[0, success(HASH_B, 101)]]),
      {
        checkpoint: first.checkpoint,
        journal: first.journal,
        startedAt: "2026-07-28T11:00:00.000Z",
      },
    );
    assert.equal(resumed.processedOperations, 0);
    assert.deepEqual(resumed.journal, first.journal);
    assert.equal(resumed.confirmedFundingCount, 1);
  });

  it("records an already-funded target as a terminal skip without a transaction", function () {
    const result = simulate(new Map([
      [0, { type: "already-funded", observedBalanceWei: PER_WALLET_WEI }],
    ]));
    assert.equal(result.stopped, false);
    assert.equal(result.confirmedFundingCount, 0);
    assert.equal(result.completedFundingCount, 1);
    assert.deepEqual(
      result.journal.entries.map((entry) => entry.status),
      ["planned", "skipped-already-funded"],
    );
    assert.ok(result.journal.entries.every((entry) => entry.transactionHash === null));
  });

  it("stops on the first failed operation", function () {
    const result = simulate(new Map([
      [0, { type: "failure", error: "fixture transfer rejected before broadcast" }],
      [1, success()],
    ]));
    assert.equal(result.stopped, true);
    assert.equal(result.processedOperations, 1);
    assert.equal(result.checkpoint.stage, "manual-review");
    assert.equal(result.journal.entries.some((entry) => entry.walletIndex === 1), false);
  });

  it("blocks restart while a timeout remains pending", function () {
    const timedOut = simulate(new Map([
      [0, { type: "timeout", transactionHash: HASH_A }],
    ]));
    assert.equal(timedOut.checkpoint.recovery.pending, true);
    const restarted = simulate(new Map([[1, success()]]), {
      checkpoint: timedOut.checkpoint,
      journal: timedOut.journal,
      startedAt: "2026-07-28T11:00:00.000Z",
    });
    assert.equal(restarted.processedOperations, 0);
    assert.match(restarted.stopReason ?? "", /reconciliation blocked/);
  });

  it("blocks restart on an ambiguous receipt", function () {
    const ambiguous = simulate(new Map([
      [0, {
        type: "ambiguous-receipt",
        transactionHash: HASH_A,
        error: "fixture provider returned conflicting receipt evidence",
      }],
    ]));
    assert.equal(ambiguous.checkpoint.recovery.ambiguous, true);
    assert.equal(ambiguous.inspection.readyForSimulation, false);
    assert.match(ambiguous.inspection.blockers.join("\n"), /recovery or manual review/);
  });

  it("blocks restart on manual-review state", function () {
    const manual = simulate(new Map([
      [0, { type: "manual-review", error: "fixture evidence requires operator review" }],
    ]));
    assert.equal(manual.checkpoint.recovery.manualReview, true);
    assert.equal(manual.checkpoint.stage, "manual-review");
    assert.equal(manual.inspection.readyForSimulation, false);
  });

  it("rejects two different transaction hashes for one operation", function () {
    const fixture = artifacts();
    const fundingPlan = plan();
    const operation = fundingPlan.operations[0];
    const expectedState = [
      `funding-plan=${operation.manifestFingerprint}`,
      "wallet-index=0",
      `minimum-target-wei=${operation.minimumTargetBalanceWei}`,
      `planned-amount-wei=${operation.plannedAmountWei}`,
      `maximum-amount-wei=${operation.maximumAllowedAmountWei}`,
    ].join(";");
    const base: Omit<Exact99JournalEntry, "sequence" | "status" | "updatedAt"> = {
      operationId: operation.operationId,
      type: "funding",
      walletIndex: 0,
      walletAddress: operation.address,
      expectedState,
      transactionHash: null,
      blockNumber: null,
      receipt: null,
      reconciliation: null,
      error: null,
      createdAt: CREATED_AT,
    };
    const entries: Exact99JournalEntry[] = [
      { ...base, sequence: 1, status: "planned", updatedAt: CREATED_AT },
      { ...base, sequence: 2, status: "prepared", updatedAt: "2026-07-28T10:00:01.000Z" },
      {
        ...base,
        sequence: 3,
        status: "pending",
        transactionHash: HASH_A,
        updatedAt: "2026-07-28T10:00:02.000Z",
      },
      {
        ...base,
        sequence: 4,
        status: "confirmed",
        transactionHash: HASH_B,
        blockNumber: 100,
        receipt: { status: 1, gasUsed: "21000" },
        updatedAt: "2026-07-28T10:00:03.000Z",
      },
    ];
    assert.throws(() => validateExact99Journal({
      ...fixture.journal,
      revision: entries.length,
      entries,
    }, fixture.manifest), /transaction hash changed/);
  });

  it("enforces forward-only funding status transitions and terminal states", function () {
    const failed = simulate(new Map([
      [0, { type: "failure", error: "fixture failure" }],
    ]));
    const fixture = artifacts();
    const last = failed.journal.entries.at(-1)!;
    const invalid = {
      ...last,
      sequence: failed.journal.entries.length + 1,
      status: "prepared",
      updatedAt: "2026-07-28T12:00:00.000Z",
    };
    assert.throws(() => validateExact99Journal({
      ...failed.journal,
      revision: failed.journal.revision + 1,
      entries: [...failed.journal.entries, invalid],
    }, fixture.manifest), /unsafe status transition failed -> prepared/);
  });

  it("integrates manifest, checkpoint, journal, store, and funding plan in one preflight", function () {
    const fixture = artifacts();
    const report = preflightExact99OperatorArtifactsWithFunding({
      store: store(),
      manifest: fixture.manifest,
      checkpoint: fixture.checkpoint,
      journal: fixture.journal,
      fundingPlan: plan(),
    });
    assert.equal(report.profile, "exact-99-with-funding");
    assert.equal(report.readyForFutureNetworkPreflight, true);
    assert.equal(report.funding.walletCount, 99);
    assert.equal(report.funding.confirmedFundingCount, 0);
    assert.ok(report.checks.every((check) => check.ok));
  });

  it("detects funding checkpoint and journal divergence", function () {
    const fixture = artifacts();
    const changedCheckpoint = {
      ...fixture.checkpoint,
      counters: { ...fixture.checkpoint.counters, funded: 1 },
    };
    const report = inspectExact99Funding({
      manifest: fixture.manifest,
      checkpoint: changedCheckpoint,
      journal: fixture.journal,
      plan: plan(),
    });
    assert.equal(report.readyForSimulation, false);
    assert.match(report.blockers.join("\n"), /does not match confirmed journal operations/);
  });

  it("keeps plan and inspection reports free of secrets", function () {
    const fixture = artifacts();
    const fundingPlan = plan();
    const inspection = inspectExact99Funding({
      manifest: fixture.manifest,
      checkpoint: fixture.checkpoint,
      journal: fixture.journal,
      plan: fundingPlan,
    });
    const output = `${renderExact99FundingPlan(fundingPlan, fixture.manifest)}\n${renderExact99FundingInspection(inspection)}`;
    assert.doesNotMatch(output, /private.?key\s*[:=]\s*0x|mnemonic\s*[:=]|password\s*[:=]|passphrase\s*[:=]/i);
    assert.doesNotMatch(output, /hunter2|user:pass/i);
    assert.match(output, /No provider, private key, signer, RPC connection, or transaction transport is present/);
    assert.throws(
      () => simulate(new Map([[0, { type: "failure", error: "password=hunter2" }]])),
      /forbidden secret-like data/,
    );
  });

  it("exposes only local plan, inspect, and simulate modes", function () {
    for (const mode of ["plan", "inspect", "simulate"]) {
      assert.doesNotThrow(() => assertExact99FundingMode(mode));
    }
    for (const mode of ["execute", "send", "fund", "broadcast"]) {
      assert.throws(() => assertExact99FundingMode(mode), /plan, inspect, or simulate/);
    }
  });

  it("contains no provider, signer, key loading, RPC, or transaction transport", async function () {
    const source = await readFile(
      new URL("../scripts/operator/exact-99-funding.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /JsonRpcProvider|BrowserProvider|Wallet\.createRandom|privateKey\s*[:=]|sendTransaction|sendRawTransaction|broadcastTransaction|writeContract|process\.env/i,
    );
  });
});
