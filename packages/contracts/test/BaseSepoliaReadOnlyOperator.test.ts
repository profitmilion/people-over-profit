import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Provider } from "ethers";

import { DEMO_V1_PARAMETERS } from "../scripts/lib/demo-v1-config.js";
import {
  PUBLIC_OPERATOR_CHAIN_ID,
  PUBLIC_OPERATOR_CONTRACT_ADDRESS,
  PUBLIC_OPERATOR_TOKEN_ADDRESS,
  assertPublicOperatorMode,
  assertPublicOperatorWalletCount,
  renderPublicOperatorText,
  runBaseSepoliaReadOnlyOperator,
  validatePublicOperatorRpcUrl,
  type ArtifactAudit,
  type PlannedAction,
  type PublicContractIdentity,
  type PublicPoolSnapshot,
  type PublicReadOnlyRuntime,
  type PublicRoundSnapshot,
  type PublicWalletSnapshot,
} from "../scripts/operator/base-sepolia-read-only-operator.js";
import {
  EncryptedWalletProvider,
  inspectExistingEncryptedWalletStore,
} from "../scripts/operator/encrypted-wallet-store.js";
import { inspectExistingTransactionJournal } from "../scripts/operator/transaction-journal.js";
import { ReadOnlyRpcRateLimitExhaustedError } from "../scripts/operator/read-only-rpc-retry.js";

const PASSWORD = "runtime-only-test-password";
const NOW = 2_000_000_000n;

function address(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function artifacts(count: number): ArtifactAudit {
  return {
    walletAddresses: Array.from({ length: count }, (_, index) => address(index + 1)),
    checks: [
      { name: "wallet-store", ok: true, detail: "validated" },
      { name: "checkpoint", ok: true, detail: "validated" },
      { name: "journal", ok: true, detail: "validated" },
      { name: "project-identity", ok: true, detail: "validated" },
      { name: "recovery", ok: true, detail: "clear" },
    ],
    pendingRecoveryOperations: 0,
    minimumConfirmations: 3,
    leastConfirmedDepth: null,
    journalStatesByWallet: {},
  };
}

class FakeReadOnlyRuntime implements PublicReadOnlyRuntime {
  chainId = PUBLIC_OPERATOR_CHAIN_ID;
  tokenCode = "0x6001";
  contractCode = "0x6002";
  fee = 1_000_000_000n;
  estimateFailure = new Set<PlannedAction>();
  identity: PublicContractIdentity = {
    paymentToken: PUBLIC_OPERATOR_TOKEN_ADDRESS,
    tokenName: "POP33 Demo USD",
    tokenSymbol: "dUSDC",
    tokenDecimals: 6n,
    dripAmount: DEMO_V1_PARAMETERS.dripAmount,
    dripCooldown: DEMO_V1_PARAMETERS.dripCooldownSeconds,
    entryAmount: DEMO_V1_PARAMETERS.entryPrice,
    maxParticipants: DEMO_V1_PARAMETERS.positionsPerPool,
    maxActivePositions: 10n,
    roundCount: DEMO_V1_PARAMETERS.drawRoundCount,
    drawInterval: DEMO_V1_PARAMETERS.drawIntervalSeconds,
    poolCount: 1n,
  };
  pool: PublicPoolSnapshot = {
    id: 1n,
    status: 0n,
    activePositionCount: 0n,
    escrowedAmount: 0n,
    lockedAt: 0n,
    completedDrawRoundCount: 0n,
    claimedPrizeCount: 0n,
  };
  wallets = new Map<string, Partial<PublicWalletSnapshot>>();
  walletCallOrder: string[] = [];
  activeWalletReads = 0;
  maximumConcurrentWalletReads = 0;
  walletReadDelayMs = 0;

  async getChainId() { return this.chainId; }
  async getLatestBlockNumber() { return 123; }
  async getLatestBlockTimestamp() { return NOW; }
  async getCode(target: string) { return target === PUBLIC_OPERATOR_TOKEN_ADDRESS ? this.tokenCode : this.contractCode; }
  async getFeePerGas() { return this.fee; }
  async getContractIdentity() { return this.identity; }
  async getOpenPoolIds() { return this.pool.status === 0n ? [1n] : []; }
  async getPool() { return this.pool; }
  async getRounds(_poolId: bigint, count: bigint): Promise<PublicRoundSnapshot[]> {
    return Array.from({ length: Number(count) }, (_, index) => ({
      number: BigInt(index + 1), scheduledAt: 0n, executedAt: 0n, status: 0n,
      winningPositionId: 0n, winner: address(999), claimed: false,
    }));
  }
  async getWallet(value: string): Promise<PublicWalletSnapshot> {
    this.walletCallOrder.push(value.toLowerCase());
    this.activeWalletReads += 1;
    this.maximumConcurrentWalletReads = Math.max(
      this.maximumConcurrentWalletReads,
      this.activeWalletReads,
    );
    try {
      if (this.walletReadDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.walletReadDelayMs));
      }
      const override = this.wallets.get(value.toLowerCase()) ?? {};
      return {
        address: value,
        nativeBalance: 10n ** 18n,
        tokenBalance: DEMO_V1_PARAMETERS.entryPrice,
        allowance: DEMO_V1_PARAMETERS.entryPrice,
        nextDripAt: 0n,
        activePositions: 0n,
        activePositionId: 0n,
        claimablePrizes: 0n,
        nonceLatest: 0,
        noncePending: 0,
        ...override,
      };
    } finally {
      this.activeWalletReads -= 1;
    }
  }
  async estimateAction(input: { action: Exclude<PlannedAction, "fund"> }): Promise<bigint> {
    if (this.estimateFailure.has(input.action)) throw new Error("state dependent revert");
    return 50_000n;
  }
}

async function expectFailure(promise: Promise<unknown>, text: string): Promise<void> {
  await assert.rejects(promise, (error: Error) => error.message.includes(text));
}

describe("Base Sepolia read-only operator", function () {
  it("accepts only the four non-writing modes and bounded wallet ranges", function () {
    for (const mode of ["preflight", "status", "plan", "dry-run"]) assert.equal(assertPublicOperatorMode(mode), mode);
    assert.throws(() => assertPublicOperatorMode("join"), /Mode must be one of/);
    for (const count of [2, 5, 100, 37]) assert.equal(assertPublicOperatorWalletCount(count), count);
    for (const count of [0, 101, 1.5]) assert.throws(() => assertPublicOperatorWalletCount(count));
  });

  it("validates the HTTPS public RPC boundary", function () {
    assert.equal(validatePublicOperatorRpcUrl("https://sepolia.base.org"), "https://sepolia.base.org");
    assert.throws(() => validatePublicOperatorRpcUrl("http://sepolia.base.org"), /HTTPS/);
    assert.throws(() => validatePublicOperatorRpcUrl("https://user:pass@example.com"), /credentials/);
    assert.throws(() => validatePublicOperatorRpcUrl("https://localhost:8545"), /local endpoint/);
  });

  it("produces a read-only plan for 2, 5, 100, and custom wallet ranges", async function () {
    for (const count of [2, 5, 100, 37]) {
      const report = await runBaseSepoliaReadOnlyOperator({
        runtime: new FakeReadOnlyRuntime(), mode: "dry-run", walletCount: count, artifacts: artifacts(100),
      });
      assert.equal(report.wallets.length, count);
      assert.equal(report.safety, "READ_ONLY_NO_SIGNING_NO_BROADCAST");
      assert.equal(report.totals.joinOperations, count);
      assert.equal(report.readyForSeparatelyAuthorizedPilot, true);
    }
  });

  it("supports an explicit bounded start index", async function () {
    const report = await runBaseSepoliaReadOnlyOperator({
      runtime: new FakeReadOnlyRuntime(), mode: "status", startIndex: 3,
      walletCount: 2, artifacts: artifacts(10),
    });
    assert.deepEqual(report.wallets.map((wallet) => wallet.index), [3, 4]);
    assert.deepEqual(report.wallets.map((wallet) => wallet.address.toLowerCase()), [address(4), address(5)]);
    await assert.rejects(runBaseSepoliaReadOnlyOperator({
      runtime: new FakeReadOnlyRuntime(), mode: "status", startIndex: 99,
      walletCount: 2, artifacts: artifacts(100),
    }), /beyond operator index 99/);
  });

  it("reads wallets sequentially and preserves their configured order", async function () {
    const runtime = new FakeReadOnlyRuntime();
    runtime.walletReadDelayMs = 2;
    const report = await runBaseSepoliaReadOnlyOperator({
      runtime, mode: "status", walletCount: 5, artifacts: artifacts(5),
    });
    assert.deepEqual(runtime.walletCallOrder, [1, 2, 3, 4, 5].map(address));
    assert.deepEqual(report.wallets.map((wallet) => wallet.address.toLowerCase()), runtime.walletCallOrder);
    assert.equal(runtime.maximumConcurrentWalletReads, 1);
  });

  it("rejects duplicate selected addresses", async function () {
    const audit = artifacts(2);
    audit.walletAddresses[1] = audit.walletAddresses[0];
    await assert.rejects(runBaseSepoliaReadOnlyOperator({
      runtime: new FakeReadOnlyRuntime(), mode: "preflight", walletCount: 2, artifacts: audit,
    }), /duplicate addresses/);
  });

  it("fails closed on wrong chain, missing code, linkage, or fixed parameters", async function () {
    const wrongChain = new FakeReadOnlyRuntime();
    wrongChain.chainId = 1n;
    await expectFailure(runBaseSepoliaReadOnlyOperator({ runtime: wrongChain, mode: "preflight", walletCount: 2, artifacts: artifacts(2) }), "chain ID mismatch");
    const missingCode = new FakeReadOnlyRuntime();
    missingCode.contractCode = "0x";
    await expectFailure(runBaseSepoliaReadOnlyOperator({ runtime: missingCode, mode: "preflight", walletCount: 2, artifacts: artifacts(2) }), "no deployed bytecode");
    const linkage = new FakeReadOnlyRuntime();
    linkage.identity = { ...linkage.identity, paymentToken: address(777) };
    await expectFailure(runBaseSepoliaReadOnlyOperator({ runtime: linkage, mode: "preflight", walletCount: 2, artifacts: artifacts(2) }), "paymentToken linkage");
    const parameters = new FakeReadOnlyRuntime();
    parameters.identity = { ...parameters.identity, entryAmount: 1n };
    await expectFailure(runBaseSepoliaReadOnlyOperator({ runtime: parameters, mode: "preflight", walletCount: 2, artifacts: artifacts(2) }), "ENTRY_PRICE mismatch");
  });

  it("reports cooldown, allowance, balance, active-position, and gas readiness without mutating state", async function () {
    const runtime = new FakeReadOnlyRuntime();
    runtime.wallets.set(address(1).toLowerCase(), {
      nativeBalance: 0n,
      tokenBalance: 0n,
      allowance: 0n,
      nextDripAt: NOW + 60n,
    });
    runtime.wallets.set(address(2).toLowerCase(), {
      activePositions: 1n,
      activePositionId: 4n,
    });
    const report = await runBaseSepoliaReadOnlyOperator({
      runtime, mode: "dry-run", walletCount: 2, artifacts: artifacts(2),
    });
    assert.deepEqual(report.wallets[0].plannedActions, ["fund", "faucet", "approve", "join"]);
    assert.match(report.wallets[0].blockers[0], /cooldown/i);
    assert.deepEqual(report.wallets[1].plannedActions, ["withdraw"]);
    assert.equal(report.readyForSeparatelyAuthorizedPilot, false);
  });

  it("marks state-dependent estimates unavailable and never invents a gas value", async function () {
    const runtime = new FakeReadOnlyRuntime();
    runtime.estimateFailure.add("join");
    const report = await runBaseSepoliaReadOnlyOperator({
      runtime, mode: "dry-run", walletCount: 2, artifacts: artifacts(2),
    });
    const joins = report.gasPlan.filter((entry) => entry.action === "join");
    assert.equal(joins.length, 2);
    assert.ok(joins.every((entry) => entry.status === "NOT CURRENTLY ESTIMABLE" && entry.gasUnits === null));
  });

  it("hard-stops instead of hiding an exhausted rate limit during gas estimation", async function () {
    const runtime = new FakeReadOnlyRuntime();
    runtime.estimateAction = async () => {
      throw new ReadOnlyRpcRateLimitExhaustedError(
        "Read-only RPC eth_estimateGas remained rate-limited after 5 attempts.",
      );
    };
    await assert.rejects(runBaseSepoliaReadOnlyOperator({
      runtime, mode: "dry-run", walletCount: 2, artifacts: artifacts(2),
    }), /remained rate-limited after 5 attempts/);
  });

  it("blocks missing wallets, artifact mismatches, pending recovery, and insufficient confirmations", async function () {
    const audit = artifacts(1);
    audit.checks[1] = { name: "checkpoint", ok: false, detail: "identity mismatch" };
    audit.pendingRecoveryOperations = 1;
    audit.leastConfirmedDepth = 2;
    const report = await runBaseSepoliaReadOnlyOperator({
      runtime: new FakeReadOnlyRuntime(), mode: "preflight", walletCount: 2, artifacts: audit,
    });
    assert.equal(report.readyForSeparatelyAuthorizedPilot, false);
    assert.ok(report.blockers.some((entry) => entry.includes("identity mismatch")));
    assert.ok(report.blockers.some((entry) => entry.includes("require recovery")));
    assert.ok(report.blockers.some((entry) => entry.includes("confirmation depth")));
  });

  it("renders a human report without exposing secret material", async function () {
    const report = await runBaseSepoliaReadOnlyOperator({
      runtime: new FakeReadOnlyRuntime(), mode: "plan", walletCount: 2, artifacts: artifacts(2),
    });
    const text = renderPublicOperatorText(report);
    assert.match(text, /READ ONLY \/ DRY RUN/);
    assert.doesNotMatch(text, /private.?key|password|mnemonic/i);
  });

  it("inspects an existing encrypted store without returning key material", async function () {
    const directory = join(tmpdir(), `pop33-public-operator-${Date.now()}-${Math.random()}`);
    const filePath = join(directory, "fixture.operator-wallets.enc.json");
    await EncryptedWalletProvider.openOrCreate({
      filePath, password: PASSWORD, walletCount: 2, provider: {} as Provider,
    });
    const before = await readFile(filePath, "utf8");
    const inspection = await inspectExistingEncryptedWalletStore({ filePath, password: PASSWORD });
    const after = await readFile(filePath, "utf8");
    assert.equal(inspection.walletCount, 2);
    assert.equal("privateKey" in inspection, false);
    assert.equal(before, after);
    await assert.rejects(
      inspectExistingEncryptedWalletStore({ filePath, password: "wrong-runtime-password" }),
      /wrong password or file integrity failure/,
    );
    await rm(directory, { recursive: true, force: true });
  });

  it("is repeatable and leaves observed nonce and wallet state unchanged", async function () {
    const runtime = new FakeReadOnlyRuntime();
    runtime.wallets.set(address(1).toLowerCase(), { nonceLatest: 7, noncePending: 8 });
    const fixed = new Date("2026-07-18T12:00:00.000Z");
    const first = await runBaseSepoliaReadOnlyOperator({
      runtime, mode: "dry-run", walletCount: 2, artifacts: artifacts(2), now: fixed,
    });
    const second = await runBaseSepoliaReadOnlyOperator({
      runtime, mode: "dry-run", walletCount: 2, artifacts: artifacts(2), now: fixed,
    });
    assert.deepEqual(second, first);
    assert.equal(first.wallets[0].nonceLatest, 7);
    assert.equal(first.wallets[0].noncePending, 8);
    assert.equal((await runtime.getWallet(address(1))).allowance, DEMO_V1_PARAMETERS.entryPrice);
  });

  it("exposes no funding, faucet, approval, join, withdrawal, draw, claim, or raw-send method", function () {
    const runtime = new FakeReadOnlyRuntime() as unknown as Record<string, unknown>;
    for (const method of ["fund", "faucet", "approve", "join", "withdraw", "draw", "claim", "broadcast", "sendRawTransaction"]) {
      assert.equal(method in runtime, false, `${method} must not exist on the public read-only runtime`);
    }
  });

  it("does not create a missing wallet store or transaction journal during inspection", async function () {
    const directory = join(tmpdir(), `pop33-public-operator-missing-${Date.now()}-${Math.random()}`);
    const walletPath = join(directory, "missing.operator-wallets.enc.json");
    const journalPath = join(directory, "missing.operator-journal.json");
    await assert.rejects(inspectExistingEncryptedWalletStore({ filePath: walletPath, password: PASSWORD }), /will not create/);
    await assert.rejects(inspectExistingTransactionJournal(journalPath, {
      chainId: PUBLIC_OPERATOR_CHAIN_ID,
      contractAddress: PUBLIC_OPERATOR_CONTRACT_ADDRESS,
      tokenAddress: PUBLIC_OPERATOR_TOKEN_ADDRESS,
    }), /will not create/);
    await assert.rejects(stat(walletPath));
    await assert.rejects(stat(journalPath));
  });

  it("contains no transaction-signing or broadcast primitive in the public runtime", async function () {
    for (const relative of [
      "../scripts/operator/ethers-base-sepolia-read-only-runtime.ts",
      "../scripts/operator/read-only-rpc-retry.ts",
    ]) {
      const source = await readFile(new URL(relative, import.meta.url), "utf8");
      assert.doesNotMatch(
        source,
        /sendTransaction|sendRawTransaction|eth_sendTransaction|writeContract|walletClient|\bSigner\b|privateKey|deployer/i,
      );
    }
  });
});
