import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { network } from "hardhat";
import { getAddress } from "viem";

import { exact99FixtureDigest } from "../scripts/operator/exact-99-public-execution-protocol.js";

import {
  GUARDED_CHECKPOINT_20_BATCH_TARGETS,
  GUARDED_CHECKPOINT_20_FUNDING_LIMITS,
  GUARDED_CHECKPOINT_20_STEPS,
  GUARDED_CHECKPOINT_20_TRANSACTION_STEPS,
  appendGuardedCheckpoint20JournalEntry,
  assertGuardedCheckpoint20Mode,
  buildEmptyGuardedCheckpoint20Journal,
  buildGuardedCheckpoint20Manifest,
  evaluateGuardedCheckpoint20HardStops,
  inspectGuardedCheckpoint20Progress,
  readGuardedCheckpoint20Journal,
  serializeGuardedCheckpoint20Journal,
  simulateGuardedCheckpoint20Batch,
  validateGuardedCheckpoint20Journal,
  validateGuardedCheckpoint20Manifest,
  writeGuardedCheckpoint20Journal,
  type GuardedCheckpoint20GuardInput,
  type GuardedCheckpoint20Journal,
  type GuardedCheckpoint20Manifest,
  type GuardedCheckpoint20Step,
} from "../scripts/operator/guarded-checkpoint-20.js";

const connection = await network.create();
const { ethers } = connection;

// Hardhat returns dynamic contract shapes until TypeChain is introduced.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicHardhatValue = any;

function address(index: number): string {
  return getAddress(`0x${(index + 10_000).toString(16).padStart(40, "0")}`);
}

function manifest(): GuardedCheckpoint20Manifest {
  return buildGuardedCheckpoint20Manifest({
    addresses: Array.from({ length: 15 }, (_, index) => address(index)),
    storeBinding: {
      formatVersion: 2,
      artifactClass: "fixture",
      storeId: "11111111-1111-4111-8111-111111111111",
      publicFingerprint: `sha256:${"a".repeat(64)}`,
      selectedRecordDecryption: true,
      externalPathRequired: true,
    },
  });
}

function safeGuards(): GuardedCheckpoint20GuardInput {
  return {
    chainId: 84_532n,
    contractAddress: "0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F",
    tokenAddress: "0xA7FA084b34c888061757d4b5FBb08a7B53fee786",
    contractBytecodeMatches: true,
    tokenBytecodeMatches: true,
    poolStatus: "Open",
    poolCount: 5n,
    escrowedAmount: 165_000_000n,
    lockedAt: 0n,
    lifecycleActionable: 0,
    lifecycleWarnings: 0,
    lifecycleCritical: 0,
    rpcSourcesAgree: true,
    manifestFingerprintMatches: true,
    storeFingerprintMatches: true,
    globalRunLockAvailable: true,
    latestNonceMatchesPending: true,
    manualNonceConflict: false,
    candidateAddress: address(0),
    candidateUnique: true,
    candidatePreviouslyUsed: false,
    candidateEligible: true,
    routedPoolId: 1n,
    candidateEthBalanceWei: 50_000_000_000_000n,
    unexpectedPreFundingBalance: false,
    minimumRequiredEthWei: 3_100_000_000_000n,
    fundingSignerBalanceWei: 15_000_000_000_000_000n,
    fundingSignerReserveWei: 1_000_000_000_000_000n,
    proposedFundingWei: 50_000_000_000_000n,
    feeCapExceeded: false,
    faucetCooldownActive: false,
    dripAmount: 330_000_000n,
    initialAllowance: 0n,
    approvedAmount: 33_000_000n,
    allowanceAfterApprove: 33_000_000n,
    receiptState: "success",
    joinedPoolId: 1n,
    countDelta: 1n,
    escrowDelta: 33_000_000n,
    activePositionDelta: 1n,
  };
}

function appendConfirmed(
  journal: GuardedCheckpoint20Journal,
  step: GuardedCheckpoint20Step,
): GuardedCheckpoint20Journal {
  const progress = inspectGuardedCheckpoint20Progress(journal, manifest());
  return appendGuardedCheckpoint20JournalEntry({
    journal,
    manifest: manifest(),
    candidateIndex: progress.nextCandidateIndex as number,
    step,
    status: "confirmed",
    transactionHash: ["FUND", "FAUCET", "APPROVE_EXACTLY_33", "JOIN"].includes(step)
      ? `0x${(journal.revision + 1).toString(16).padStart(64, "0")}` : null,
    blockNumber: 1n,
    publicEvidence: { verified: true },
  });
}

describe("Guarded Checkpoint-20 Runner", function () {
  it("fixes baseline 5, target 20, 15 candidates and batch stops 10/15/20", function () {
    assert.deepEqual(GUARDED_CHECKPOINT_20_BATCH_TARGETS, [10, 15, 20]);
    assert.equal(manifest().addresses.length, 15);
    assert.equal(GUARDED_CHECKPOINT_20_FUNDING_LIMITS.plannedAmountPerWalletWei, "50000000000000");
    assert.equal(GUARDED_CHECKPOINT_20_FUNDING_LIMITS.maximumTotalBudgetWei, "750000000000000");
    assert.deepEqual(GUARDED_CHECKPOINT_20_TRANSACTION_STEPS, [
      "FUND", "FAUCET", "APPROVE_EXACTLY_33", "JOIN",
    ]);
  });

  it("accepts only plan, inspect and simulate and rejects execute", function () {
    for (const mode of ["plan", "inspect", "simulate"]) assert.doesNotThrow(() => assertGuardedCheckpoint20Mode(mode));
    assert.throws(() => assertGuardedCheckpoint20Mode("execute"), /execute is unavailable/i);
  });

  it("runs 15 fixture candidates in three sequential batches and stops at 20", function () {
    const set = manifest();
    let journal = buildEmptyGuardedCheckpoint20Journal(set);
    const stops: number[] = [];
    for (let batch = 0; batch < 3; batch += 1) {
      const result = simulateGuardedCheckpoint20Batch({ manifest: set, journal });
      journal = result.journal;
      assert.equal(result.stoppedOnFault, false);
      stops.push(result.stoppedAtBatch as number);
    }
    const result = inspectGuardedCheckpoint20Progress(journal, set);
    assert.deepEqual(stops, [10, 15, 20]);
    assert.equal(result.completedCandidates, 15);
    assert.equal(result.expectedCount, "20");
    assert.equal(result.expectedEscrow, "660000000");
    assert.equal(result.hardStopReached, true);
    assert.equal(result.nextCandidateIndex, null);
    assert.throws(() => appendGuardedCheckpoint20JournalEntry({
      journal,
      manifest: set,
      candidateIndex: 14,
      step: "PRECHECK",
      status: "confirmed",
    }), /hard stop/i);
  });

  for (const [index, step] of GUARDED_CHECKPOINT_20_STEPS.entries()) {
    it(`resumes deterministically after confirmed ${step}`, function () {
      const set = manifest();
      let journal = buildEmptyGuardedCheckpoint20Journal(set);
      for (let cursor = 0; cursor <= index; cursor += 1) {
        journal = appendConfirmed(journal, GUARDED_CHECKPOINT_20_STEPS[cursor]);
      }
      const reopened = validateGuardedCheckpoint20Journal(
        JSON.parse(serializeGuardedCheckpoint20Journal(journal)) as GuardedCheckpoint20Journal,
        set,
      );
      const progress = inspectGuardedCheckpoint20Progress(reopened, set);
      const expected = index === GUARDED_CHECKPOINT_20_STEPS.length - 1
        ? "PRECHECK" : GUARDED_CHECKPOINT_20_STEPS[index + 1];
      assert.equal(progress.nextStep, expected);
      assert.equal(progress.nextCandidateIndex, index === GUARDED_CHECKPOINT_20_STEPS.length - 1 ? 1 : 0);
    });
  }

  for (const status of ["pending", "failed", "ambiguous", "manual-review"] as const) {
    it(`stops immediately on ${status} and performs no next fixture step`, function () {
      const set = manifest();
      const result = simulateGuardedCheckpoint20Batch({
        manifest: set,
        journal: buildEmptyGuardedCheckpoint20Journal(set),
        fault: { candidateIndex: 0, step: "JOIN", status, reason: status },
      });
      assert.equal(result.stoppedOnFault, true);
      assert.match(result.inspection.blockers[0], new RegExp(status));
      assert.equal(result.journal.entries.at(-1)?.step, "JOIN");
      assert.throws(() => appendGuardedCheckpoint20JournalEntry({
        journal: result.journal,
        manifest: set,
        candidateIndex: 0,
        step: "VERIFY_RECEIPT",
        status: "confirmed",
      }), /blocked/i);
    });
  }

  for (const step of ["FUND", "FAUCET", "APPROVE_EXACTLY_33", "JOIN"] as const) {
    it(`stops on a failed ${step} without entering its following verification`, function () {
      const set = manifest();
      const result = simulateGuardedCheckpoint20Batch({
        manifest: set,
        journal: buildEmptyGuardedCheckpoint20Journal(set),
        fault: { candidateIndex: 0, step, status: "failed", reason: `${step} fixture failure` },
      });
      assert.equal(result.stoppedOnFault, true);
      assert.equal(result.journal.entries.at(-1)?.step, step);
      assert.equal(result.journal.entries.at(-1)?.status, "failed");
    });
  }

  const guardFaults: Array<[string, Partial<GuardedCheckpoint20GuardInput>, string]> = [
    ["wrong chain", { chainId: 1n }, "WRONG_CHAIN_ID"],
    ["wrong contract", { contractAddress: address(90) }, "WRONG_CONTRACT_ADDRESS"],
    ["wrong token", { tokenAddress: address(91) }, "WRONG_TOKEN_ADDRESS"],
    ["bytecode mismatch", { contractBytecodeMatches: false }, "BYTECODE_MISMATCH"],
    ["pool closed", { poolStatus: "Locked" }, "POOL_NOT_OPEN"],
    ["wrong baseline count", { poolCount: 4n, escrowedAmount: 132_000_000n }, "COUNT_OUTSIDE_CHECKPOINT_RANGE"],
    ["wrong escrow", { escrowedAmount: 164_000_000n }, "ESCROW_MISMATCH"],
    ["lockedAt", { lockedAt: 1n }, "POOL_LOCKED"],
    ["external count race", { countDelta: 2n }, "COUNT_DELTA_MISMATCH"],
    ["wrong routing", { routedPoolId: 2n }, "WRONG_ROUTING"],
    ["ineligible", { candidateEligible: false }, "CANDIDATE_NOT_ELIGIBLE"],
    ["duplicate", { candidateUnique: false }, "DUPLICATE_CANDIDATE"],
    ["used before", { candidatePreviouslyUsed: true }, "CANDIDATE_PREVIOUSLY_USED"],
    ["fingerprint mismatch", { manifestFingerprintMatches: false }, "ARTIFACT_FINGERPRINT_MISMATCH"],
    ["global lock", { globalRunLockAvailable: false }, "GLOBAL_RUN_LOCK_CONFLICT"],
    ["nonce mismatch", { latestNonceMatchesPending: false }, "NONCE_CONFLICT"],
    ["manual nonce conflict", { manualNonceConflict: true }, "NONCE_CONFLICT"],
    ["insufficient ETH", { candidateEthBalanceWei: 1n }, "INSUFFICIENT_ETH"],
    ["unexpected pre-funding balance", { unexpectedPreFundingBalance: true }, "UNEXPECTED_PRE_FUNDING_BALANCE"],
    ["fee spike", { feeCapExceeded: true }, "FEE_CAP_EXCEEDED"],
    ["signer reserve", { fundingSignerBalanceWei: 1n }, "FUNDING_SIGNER_RESERVE_VIOLATION"],
    ["funding cap", { proposedFundingWei: 50_000_000_000_001n }, "FUNDING_CAP_EXCEEDED"],
    ["cooldown", { faucetCooldownActive: true }, "FAUCET_COOLDOWN"],
    ["wrong drip", { dripAmount: 1n }, "WRONG_DRIP_AMOUNT"],
    ["initial allowance drift", { initialAllowance: 1n }, "INITIAL_ALLOWANCE_NOT_ZERO"],
    ["approve mismatch", { approvedAmount: 34_000_000n }, "APPROVE_AMOUNT_MISMATCH"],
    ["allowance mismatch", { allowanceAfterApprove: 32_000_000n }, "ALLOWANCE_MISMATCH"],
    ["join revert", { receiptState: "reverted" }, "RECEIPT_REVERTED"],
    ["pending receipt", { receiptState: "pending" }, "RECEIPT_PENDING"],
    ["ambiguous receipt", { receiptState: "ambiguous" }, "RECEIPT_AMBIGUOUS"],
    ["reorg", { receiptState: "reorged" }, "RECEIPT_REORGED"],
    ["wrong pool id", { joinedPoolId: 2n }, "WRONG_JOIN_POOL"],
    ["wrong position delta", { activePositionDelta: 0n }, "POSITION_DELTA_MISMATCH"],
    ["wrong escrow delta", { escrowDelta: 34_000_000n }, "ESCROW_DELTA_MISMATCH"],
    ["lifecycle actionable", { lifecycleActionable: 1 }, "LIFECYCLE_ACTIONABLE"],
    ["lifecycle warning", { lifecycleWarnings: 1 }, "LIFECYCLE_WARNING"],
    ["lifecycle critical", { lifecycleCritical: 1 }, "LIFECYCLE_CRITICAL"],
    ["RPC disagreement", { rpcSourcesAgree: false }, "RPC_DISAGREEMENT"],
  ];
  for (const [name, overrides, expected] of guardFaults) {
    it(`hard-stops on ${name}`, function () {
      assert.ok(evaluateGuardedCheckpoint20HardStops({ ...safeGuards(), ...overrides }).includes(expected));
    });
  }

  it("accepts a fully clean guard snapshot", function () {
    assert.deepEqual(evaluateGuardedCheckpoint20HardStops(safeGuards()), []);
  });

  it("rejects duplicate candidates and manifest fingerprint drift", function () {
    const addresses = Array.from({ length: 15 }, (_, index) => address(index));
    addresses[14] = addresses[0];
    assert.throws(() => buildGuardedCheckpoint20Manifest({
      addresses,
      storeBinding: manifest().storeBinding,
    }), /duplicate/i);
    const changed = { ...manifest(), fingerprint: `sha256:${"f".repeat(64)}` };
    assert.throws(() => validateGuardedCheckpoint20Manifest(changed), /fingerprint/i);
  });

  it("rejects journal corruption and secret-bearing evidence", function () {
    const set = manifest();
    const journal = buildEmptyGuardedCheckpoint20Journal(set);
    const corrupted = { ...journal, revision: 1 };
    assert.throws(() => validateGuardedCheckpoint20Journal(corrupted, set), /revision|checksum/i);
    const first = appendConfirmed(journal, "PRECHECK");
    const reorderedBody = {
      ...first,
      entries: [{ ...first.entries[0], step: "JOIN" as const }],
      checksum: "",
    };
    const body = {
      formatVersion: reorderedBody.formatVersion,
      purpose: reorderedBody.purpose,
      manifestFingerprint: reorderedBody.manifestFingerprint,
      baselineCount: reorderedBody.baselineCount,
      targetCount: reorderedBody.targetCount,
      revision: reorderedBody.revision,
      entries: reorderedBody.entries,
    };
    const reordered = {
      ...reorderedBody,
      checksum: exact99FixtureDigest(body),
    };
    assert.throws(() => validateGuardedCheckpoint20Journal(reordered, set), /sequence/i);
    assert.throws(() => appendGuardedCheckpoint20JournalEntry({
      journal,
      manifest: set,
      candidateIndex: 0,
      step: "PRECHECK",
      status: "confirmed",
      publicEvidence: { privateKey: "forbidden" },
    }), /secret field/i);
  });

  it("writes and reopens a durable external journal with revision checks", async function () {
    const directory = await mkdtemp(join(tmpdir(), "pop33-checkpoint20-"));
    const path = join(directory, "run.checkpoint-20-journal.json");
    try {
      const set = manifest();
      const empty = buildEmptyGuardedCheckpoint20Journal(set);
      await writeGuardedCheckpoint20Journal({ path, journal: empty, manifest: set, expectedRevision: null });
      const next = appendConfirmed(empty, "PRECHECK");
      await writeGuardedCheckpoint20Journal({ path, journal: next, manifest: set, expectedRevision: 0 });
      assert.equal((await readGuardedCheckpoint20Journal({ path, manifest: set })).revision, 1);
      await assert.rejects(
        writeGuardedCheckpoint20Journal({ path, journal: next, manifest: set, expectedRevision: 0 }),
        /revision conflict/i,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reaches a real local Hardhat baseline of 5/100 and recognizes its accounting", async function () {
    const signers = await ethers.getSigners();
    const token = await ethers.deployContract("Pop33DemoUSDC", [330_000_000n, 86_400n]) as DynamicHardhatValue;
    await token.waitForDeployment();
    const pop33 = await ethers.deployContract("Pop33BasicV1", [await token.getAddress(), 3_600]) as DynamicHardhatValue;
    await pop33.waitForDeployment();
    for (const signer of signers.slice(1, 6)) {
      await token.connect(signer).drip();
      await token.connect(signer).approve(await pop33.getAddress(), 33_000_000n);
      await pop33.connect(signer).join();
    }
    const pool = await pop33.getPool(1);
    assert.equal(pool.activePositionCount, 5n);
    assert.equal(pool.escrowedAmount, 165_000_000n);
    assert.equal(pool.lockedAt, 0n);
    assert.deepEqual(evaluateGuardedCheckpoint20HardStops({
      ...safeGuards(),
      poolCount: pool.activePositionCount,
      escrowedAmount: pool.escrowedAmount,
      lockedAt: pool.lockedAt,
    }), []);
  });

  it("contains no public execute transport or secret loader", async function () {
    const core = await readFile(new URL("../scripts/operator/guarded-checkpoint-20.ts", import.meta.url), "utf8");
    const adapter = await readFile(new URL("../scripts/operator/guarded-checkpoint-20-base-sepolia.ts", import.meta.url), "utf8");
    const cli = await readFile(new URL("../scripts/guarded-checkpoint-20-cli.mjs", import.meta.url), "utf8");
    for (const source of [core, adapter]) {
      assert.doesNotMatch(source, /createWalletClient|sendTransaction|writeContract|privateKeyToAccount/);
    }
    assert.match(cli, /EXECUTE is not implemented or authorized/);
    assert.doesNotMatch(cli, /PRIVATE_KEY|MNEMONIC|SEED_PHRASE/);
  });
});
