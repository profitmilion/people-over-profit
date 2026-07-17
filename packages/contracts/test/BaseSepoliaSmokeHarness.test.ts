import assert from "node:assert/strict";

import { Wallet } from "ethers";

import { DEMO_V1_PARAMETERS } from "../scripts/lib/demo-v1-config.js";
import { assertExecutionPolicy, BASE_SEPOLIA_WRITE_CONFIRMATION } from "../scripts/operator/network-policy.js";
import { MemoryTransactionJournal, type JournalOperation } from "../scripts/operator/transaction-journal.js";
import type {
  BroadcastResponse,
  RecoveryReceipt,
  RecoveryTransaction,
  TransactionRecoveryProvider,
} from "../scripts/operator/transaction-recovery.js";
import {
  BASE_SEPOLIA_SMOKE_CHAIN_ID,
  BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION,
  BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION,
  BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
  BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  assertFreshSmokeWriteReady,
  assertSingleSmokeWallet,
  assertSmokeAction,
  assertSmokeWriteAuthorization,
  readDedicatedSmokePrivateKey,
  readSmokeReadConfiguration,
  runSmokeReadOnlyPreflight,
  runSmokeWriteFlow,
  type SmokeContractParameters,
  type SmokeOperationEvidence,
  type SmokePoolState,
  type SmokePositionState,
  type SmokeRuntime,
  type SmokeTokenState,
  type SmokeWriteAction,
} from "../scripts/smoke/base-sepolia-smoke.js";

const SMOKE_WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const NOW = 2_000_000_000n;
const IMMEDIATE_SEMANTIC_RETRY = { delay: async () => undefined };

interface StaleReadPlan {
  token?: number;
  pool?: number;
  position?: number;
  membership?: number;
}

class FakeSmokeRuntime implements SmokeRuntime {
  readonly walletAddress = SMOKE_WALLET;
  readonly transactions = new Map<string, RecoveryTransaction>();
  readonly receipts = new Map<string, RecoveryReceipt>();
  readonly actionByHash = new Map<string, SmokeWriteAction>();
  readonly replacements = new Map<number, RecoveryTransaction>();
  readonly broadcastActions: SmokeWriteAction[] = [];
  readonly verifiedConfirmedActions: SmokeWriteAction[] = [];
  readonly staleReadsAfter: Partial<Record<SmokeWriteAction, StaleReadPlan>> = {};
  private readonly staleTokenStates: SmokeTokenState[] = [];
  private readonly stalePools: SmokePoolState[] = [];
  private readonly stalePositions: SmokePositionState[] = [];
  private readonly staleMemberships: bigint[] = [];
  chainId = BASE_SEPOLIA_SMOKE_CHAIN_ID;
  tokenCode = "0x6001";
  contractCode = "0x6002";
  nativeBalance = 10n ** 18n;
  feePerGas = 1_000_000_000n;
  latestNonce = 0;
  pendingNonce = 0;
  waitNever = false;
  broadcastError: Error | null = null;
  tokenState: SmokeTokenState = {
    name: "POP33 Demo USD",
    symbol: "dUSDC",
    decimals: 6n,
    dripAmount: DEMO_V1_PARAMETERS.dripAmount,
    dripCooldown: DEMO_V1_PARAMETERS.dripCooldownSeconds,
    nextDripAt: 0n,
    balance: 0n,
    allowance: 0n,
  };
  parameters: SmokeContractParameters = {
    paymentToken: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
    entryPrice: DEMO_V1_PARAMETERS.entryPrice,
    positionsPerPool: DEMO_V1_PARAMETERS.positionsPerPool,
    maxActivePositionsPerUser: 10n,
    maxOpenPools: 10n,
    drawRoundCount: DEMO_V1_PARAMETERS.drawRoundCount,
    prizePerRound: DEMO_V1_PARAMETERS.prizePerRound,
    totalPrizeAmount: DEMO_V1_PARAMETERS.totalPrizeAmount,
    drawInterval: DEMO_V1_PARAMETERS.drawIntervalSeconds,
  };
  pool: SmokePoolState = {
    id: 1n,
    status: 0n,
    activePositionCount: 0n,
    escrowedAmount: 0n,
    entryPrice: DEMO_V1_PARAMETERS.entryPrice,
    positionsPerPool: DEMO_V1_PARAMETERS.positionsPerPool,
    drawRoundCount: DEMO_V1_PARAMETERS.drawRoundCount,
    prizePerRound: DEMO_V1_PARAMETERS.prizePerRound,
    totalPrizeAmount: DEMO_V1_PARAMETERS.totalPrizeAmount,
    drawInterval: DEMO_V1_PARAMETERS.drawIntervalSeconds,
  };
  activePositionId = 0n;
  position: SmokePositionState = {
    id: 1n,
    poolId: 1n,
    owner: SMOKE_WALLET,
    active: false,
  };

  readonly recoveryProvider: TransactionRecoveryProvider = {
    getTransaction: async (hash) => this.transactions.get(hash) ?? null,
    getTransactionReceipt: async (hash) => this.receipts.get(hash) ?? null,
    getTransactionCount: async (_address, blockTag) =>
      blockTag === "latest" ? this.latestNonce : this.pendingNonce,
    findTransactionBySenderAndNonce: async (_address, nonce) =>
      this.replacements.get(nonce) ?? null,
  };

  async getChainId(): Promise<bigint> { return this.chainId; }
  async getCode(address: string): Promise<string> {
    return address === BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS ? this.tokenCode : this.contractCode;
  }
  async getNativeBalance(): Promise<bigint> { return this.nativeBalance; }
  async getFeePerGas(): Promise<bigint> { return this.feePerGas; }
  async getTokenState(): Promise<SmokeTokenState> {
    return structuredClone(this.staleTokenStates.shift() ?? this.tokenState);
  }
  async getContractParameters(): Promise<SmokeContractParameters> { return structuredClone(this.parameters); }
  async getOpenPoolIds(): Promise<bigint[]> { return [1n]; }
  async getPool(): Promise<SmokePoolState> {
    return structuredClone(this.stalePools.shift() ?? this.pool);
  }
  async getActivePositionId(): Promise<bigint> {
    return this.staleMemberships.shift() ?? this.activePositionId;
  }
  async getPosition(): Promise<SmokePositionState> {
    return structuredClone(this.stalePositions.shift() ?? this.position);
  }
  async estimateAction(action: SmokeWriteAction): Promise<bigint> {
    return action === "join" ? 200_000n : action === "withdraw" ? 120_000n : 60_000n;
  }
  async getPendingNonce(): Promise<number> { return this.pendingNonce; }

  async broadcast(action: SmokeWriteAction, nonce: number): Promise<BroadcastResponse> {
    if (this.broadcastError) throw this.broadcastError;
    this.broadcastActions.push(action);
    const hash = `0x${(this.transactions.size + 1).toString(16).padStart(64, "0")}`;
    const transaction: RecoveryTransaction = {
      hash,
      from: this.walletAddress,
      to: action === "faucet" || action === "approve"
        ? BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS
        : BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
      nonce,
      data: `0x${action}`,
      value: 0n,
    };
    this.transactions.set(hash, transaction);
    this.actionByHash.set(hash, action);
    this.pendingNonce = nonce + 1;
    let applied = false;
    return {
      hash,
      nonce,
      wait: async () => {
        if (this.waitNever) return new Promise<never>(() => undefined);
        if (!applied) {
          applied = true;
          this.apply(action);
          const receipt = { hash, blockNumber: 100 + nonce, status: 1, gasUsed: 50_000n };
          this.receipts.set(hash, receipt);
          this.latestNonce = nonce + 1;
        }
        return this.receipts.get(hash)!;
      },
    };
  }

  async verifySubmittedOperation(operation: JournalOperation): Promise<void> {
    if (!operation.transactionHash || this.actionByHash.get(operation.transactionHash) !== operation.action) {
      throw new Error("fake submitted evidence mismatch");
    }
  }

  async verifyConfirmedOperation(operation: JournalOperation): Promise<SmokeOperationEvidence> {
    await this.verifySubmittedOperation(operation);
    if (!operation.transactionHash || !this.receipts.has(operation.transactionHash)) {
      throw new Error("fake confirmed receipt missing");
    }
    this.verifiedConfirmedActions.push(operation.action as SmokeWriteAction);
    switch (operation.action) {
      case "faucet": return { action: "faucet", amount: DEMO_V1_PARAMETERS.dripAmount, poolId: 1n };
      case "approve": return { action: "approve", amount: DEMO_V1_PARAMETERS.entryPrice, poolId: 1n };
      case "join": return { action: "join", amount: DEMO_V1_PARAMETERS.entryPrice, poolId: 1n, positionId: 1n };
      case "withdraw": return { action: "withdraw", amount: DEMO_V1_PARAMETERS.entryPrice, poolId: 1n, positionId: 1n };
      default: throw new Error("prohibited fake action");
    }
  }

  private apply(action: SmokeWriteAction): void {
    const previousToken = structuredClone(this.tokenState);
    const previousPool = structuredClone(this.pool);
    const previousPosition = structuredClone(this.position);
    const previousMembership = this.activePositionId;
    if (action === "faucet") {
      this.tokenState.balance += DEMO_V1_PARAMETERS.dripAmount;
      this.tokenState.nextDripAt = NOW + DEMO_V1_PARAMETERS.dripCooldownSeconds;
    } else if (action === "approve") {
      this.tokenState.allowance = DEMO_V1_PARAMETERS.entryPrice;
    } else if (action === "join") {
      this.tokenState.balance -= DEMO_V1_PARAMETERS.entryPrice;
      this.tokenState.allowance = 0n;
      this.activePositionId = 1n;
      this.position.active = true;
      this.pool.activePositionCount += 1n;
      this.pool.escrowedAmount += DEMO_V1_PARAMETERS.entryPrice;
    } else {
      this.tokenState.balance += DEMO_V1_PARAMETERS.entryPrice;
      this.activePositionId = 0n;
      this.position.active = false;
      this.pool.activePositionCount -= 1n;
      this.pool.escrowedAmount -= DEMO_V1_PARAMETERS.entryPrice;
    }
    const stale = this.staleReadsAfter[action];
    for (let read = 0; read < (stale?.token ?? 0); read += 1) {
      this.staleTokenStates.push(structuredClone(previousToken));
    }
    for (let read = 0; read < (stale?.pool ?? 0); read += 1) {
      this.stalePools.push(structuredClone(previousPool));
    }
    for (let read = 0; read < (stale?.position ?? 0); read += 1) {
      this.stalePositions.push(structuredClone(previousPosition));
    }
    for (let read = 0; read < (stale?.membership ?? 0); read += 1) {
      this.staleMemberships.push(previousMembership);
    }
  }
}

function journal(): MemoryTransactionJournal {
  return new MemoryTransactionJournal({
    chainId: BASE_SEPOLIA_SMOKE_CHAIN_ID,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  });
}

async function preflight(runtime: FakeSmokeRuntime) {
  return runSmokeReadOnlyPreflight(runtime, NOW, { delay: async () => undefined });
}

async function pendingFaucet(runtime: FakeSmokeRuntime, state: "broadcast" | "pending") {
  const store = journal();
  let operation = await store.prepare({
    action: "faucet",
    scope: "base-sepolia-smoke-v1:faucet:pool-1",
    walletAddress: SMOKE_WALLET,
    chainId: BASE_SEPOLIA_SMOKE_CHAIN_ID,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
    poolId: 1n,
    parameters: { dripAmount: DEMO_V1_PARAMETERS.dripAmount },
  });
  operation = await store.transition(operation.operationId, "ready_to_broadcast", { nonce: 0 });
  const hash = `0x${"9".repeat(64)}`;
  operation = await store.transition(operation.operationId, "broadcast", { nonce: 0, transactionHash: hash });
  if (state === "pending") operation = await store.transition(operation.operationId, "pending");
  runtime.actionByHash.set(hash, "faucet");
  return { store, operation, hash };
}

describe("Base Sepolia single-wallet smoke harness", function () {
  it("completes a valid read-only preflight without a private key", async function () {
    const runtime = new FakeSmokeRuntime();
    const report = await preflight(runtime);
    assert.equal(report.chainId, 84_532n);
    assert.deepEqual(report.blockers, []);
    assert.equal(runtime.broadcastActions.length, 0);
  });

  it("requires an HTTPS credential-free non-local smoke RPC", function () {
    const valid = {
      BASE_SEPOLIA_SMOKE_RPC_URL: "https://rpc.example.test/base-sepolia",
      BASE_SEPOLIA_SMOKE_WALLET_ADDRESS: SMOKE_WALLET,
    };
    assert.equal(readSmokeReadConfiguration(valid).walletAddress, SMOKE_WALLET);
    assert.throws(() => readSmokeReadConfiguration({
      ...valid,
      BASE_SEPOLIA_SMOKE_RPC_URL: "http://rpc.example.test",
    }), /must use HTTPS/);
    assert.throws(() => readSmokeReadConfiguration({
      ...valid,
      BASE_SEPOLIA_SMOKE_RPC_URL: ["https://user", "pass@rpc.example.test"].join(":"),
    }), /must not contain URL credentials/);
    assert.throws(() => readSmokeReadConfiguration({
      ...valid,
      BASE_SEPOLIA_SMOKE_RPC_URL: "https://127.0.0.1:8545",
    }), /must not point to a local endpoint/);
  });

  it("refuses the wrong chain ID and Base Mainnet", async function () {
    const wrong = new FakeSmokeRuntime();
    wrong.chainId = 1n;
    await assert.rejects(preflight(wrong), /expected Base Sepolia chain ID/);
    const mainnet = new FakeSmokeRuntime();
    mainnet.chainId = 8453n;
    await assert.rejects(preflight(mainnet), /received 8453/);
  });

  it("refuses missing bytecode at either recorded address", async function () {
    const token = new FakeSmokeRuntime();
    token.tokenCode = "0x";
    await assert.rejects(preflight(token), /dUSDC address has no deployed bytecode/);
    const pop33 = new FakeSmokeRuntime();
    pop33.contractCode = "0x";
    await assert.rejects(preflight(pop33), /POP33 address has no deployed bytecode/);
  });

  it("refuses a mismatched payment token", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.parameters.paymentToken = OTHER_WALLET;
    await assert.rejects(preflight(runtime), /paymentToken/);
  });

  it("refuses a token with non-six decimals", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.tokenState.decimals = 18n;
    await assert.rejects(preflight(runtime), /decimals mismatch/);
  });

  it("refuses at 98 active positions and inside the earlier safety margin", async function () {
    const threshold = new FakeSmokeRuntime();
    threshold.pool.activePositionCount = 98n;
    assert.match((await preflight(threshold)).blockers.join(" "), /98 or more/);
    const margin = new FakeSmokeRuntime();
    margin.pool.activePositionCount = 90n;
    assert.match((await preflight(margin)).blockers.join(" "), /safety margin/);
  });

  it("refuses a pool that is not Open", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.pool.status = 1n;
    const report = await preflight(runtime);
    assert.throws(() => assertFreshSmokeWriteReady(report), /not Open/);
  });

  it("refuses a wallet that already owns a current-pool position", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.activePositionId = 7n;
    const report = await preflight(runtime);
    assert.throws(() => assertFreshSmokeWriteReady(report), /already has an active position/);
  });

  it("refuses insufficient Base Sepolia ETH", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.nativeBalance = 1n;
    const report = await preflight(runtime);
    assert.throws(() => assertFreshSmokeWriteReady(report), /insufficient Base Sepolia ETH/);
  });

  it("requires the CLI write flag and both exact confirmations", function () {
    const validEnv = {
      BASE_SEPOLIA_SMOKE_NETWORK_CONFIRM: BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION,
      BASE_SEPOLIA_SMOKE_FLOW_CONFIRM: BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION,
    };
    assert.throws(() => assertSmokeWriteAuthorization(false, validEnv), /--write-smoke/);
    assert.throws(() => assertSmokeWriteAuthorization(true, {
      ...validEnv,
      BASE_SEPOLIA_SMOKE_NETWORK_CONFIRM: "wrong",
    }), /exact Base Sepolia confirmation/);
    assert.throws(() => assertSmokeWriteAuthorization(true, {
      ...validEnv,
      BASE_SEPOLIA_SMOKE_FLOW_CONFIRM: "wrong",
    }), /exact reversible-flow confirmation/);
    assert.doesNotThrow(() => assertSmokeWriteAuthorization(true, validEnv));
  });

  it("rejects draw, claim, deployment and administrative actions", function () {
    for (const action of ["draw", "claim", "deploy", "admin"] as const) {
      assert.throws(() => assertSmokeAction(action), /prohibited/);
    }
  });

  it("requires exactly one non-deployer smoke wallet", function () {
    assert.throws(() => assertSingleSmokeWallet([]), /exactly one/);
    assert.throws(() => assertSingleSmokeWallet([SMOKE_WALLET, OTHER_WALLET]), /exactly one/);
  });

  it("requires a dedicated private key matching only the public smoke address", function () {
    const wallet = Wallet.createRandom();
    assert.equal(readDedicatedSmokePrivateKey(
      { BASE_SEPOLIA_SMOKE_PRIVATE_KEY: wallet.privateKey },
      wallet.address,
    ), wallet.privateKey);
    assert.throws(() => readDedicatedSmokePrivateKey(
      { BASE_SEPOLIA_SMOKE_PRIVATE_KEY: wallet.privateKey },
      SMOKE_WALLET,
    ), /does not match/);
  });

  it("runs only faucet, exact approve, join and withdraw with complete final state", async function () {
    const runtime = new FakeSmokeRuntime();
    const store = journal();
    const result = await runSmokeWriteFlow({ runtime, journal: store, preflight: await preflight(runtime) });
    assert.deepEqual(runtime.broadcastActions, ["faucet", "approve", "join", "withdraw"]);
    assert.equal(result.finalAllowance, 0n);
    assert.equal(result.finalTokenBalance, DEMO_V1_PARAMETERS.dripAmount);
    assert.equal(runtime.activePositionId, 0n);
    assert.equal(runtime.position.active, false);
    assert.equal(store.snapshot().operations.every((operation) => operation.status === "confirmed"), true);
  });

  it("retries one stale allowance read after confirmed exact approval without rebroadcast", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.staleReadsAfter.approve = { token: 1 };
    const store = journal();
    await runSmokeWriteFlow({
      runtime,
      journal: store,
      preflight: await preflight(runtime),
      semanticRetryOptions: IMMEDIATE_SEMANTIC_RETRY,
    });
    assert.equal(runtime.broadcastActions.filter((action) => action === "approve").length, 1);
    const approvalOperations = store.snapshot().operations.filter((operation) => operation.action === "approve");
    assert.equal(approvalOperations.length, 1);
    assert.equal(approvalOperations[0].status, "confirmed");
    assert.equal(new Set(store.snapshot().operations.map((operation) => operation.operationId)).size, 4);
  });

  it("retries a stale faucet balance and cooldown without rebroadcast", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.staleReadsAfter.faucet = { token: 1 };
    const store = journal();
    await runSmokeWriteFlow({
      runtime,
      journal: store,
      preflight: await preflight(runtime),
      semanticRetryOptions: IMMEDIATE_SEMANTIC_RETRY,
    });
    assert.equal(runtime.broadcastActions.filter((action) => action === "faucet").length, 1);
    assert.equal(store.snapshot().operations.filter((operation) => operation.action === "faucet").length, 1);
  });

  it("retries stale join and withdraw composite state without rebroadcast", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.staleReadsAfter.join = { token: 1, pool: 1, position: 1, membership: 1 };
    runtime.staleReadsAfter.withdraw = { token: 1, pool: 1, position: 1, membership: 1 };
    const store = journal();
    await runSmokeWriteFlow({
      runtime,
      journal: store,
      preflight: await preflight(runtime),
      semanticRetryOptions: IMMEDIATE_SEMANTIC_RETRY,
    });
    for (const action of ["join", "withdraw"] as const) {
      assert.equal(runtime.broadcastActions.filter((broadcast) => broadcast === action).length, 1);
      assert.equal(store.snapshot().operations.filter((operation) => operation.action === action).length, 1);
    }
    assert.equal(runtime.activePositionId, 0n);
    assert.equal(runtime.pool.activePositionCount, 0n);
    assert.equal(runtime.pool.escrowedAmount, 0n);
  });

  it("recovers confirmed faucet and approval and resumes from join without duplicate operations", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.staleReadsAfter.approve = { token: 3 };
    const store = journal();
    await assert.rejects(
      runSmokeWriteFlow({
        runtime,
        journal: store,
        preflight: await preflight(runtime),
        semanticRetryOptions: IMMEDIATE_SEMANTIC_RETRY,
      }),
      /approve exact 33 dUSDC allowance.*reuse the existing journal/,
    );
    assert.deepEqual(runtime.broadcastActions, ["faucet", "approve"]);
    assert.equal(runtime.latestNonce, 2);
    assert.equal(runtime.pendingNonce, 2);
    assert.equal(runtime.tokenState.balance, DEMO_V1_PARAMETERS.dripAmount);
    assert.equal(runtime.tokenState.allowance, DEMO_V1_PARAMETERS.entryPrice);
    assert.equal(runtime.activePositionId, 0n);
    const beforeRecovery = store.snapshot();
    assert.deepEqual(beforeRecovery.operations.map((operation) => operation.status), ["confirmed", "confirmed"]);
    const confirmedIds = beforeRecovery.operations.map((operation) => operation.operationId);

    const validEnv = {
      BASE_SEPOLIA_SMOKE_NETWORK_CONFIRM: BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION,
      BASE_SEPOLIA_SMOKE_FLOW_CONFIRM: BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION,
    };
    assert.throws(() => assertSmokeWriteAuthorization(false, validEnv), /--write-smoke/);
    assert.equal(runtime.broadcastActions.length, 2);

    runtime.verifiedConfirmedActions.length = 0;
    await runSmokeWriteFlow({
      runtime,
      journal: store,
      preflight: await preflight(runtime),
      semanticRetryOptions: IMMEDIATE_SEMANTIC_RETRY,
    });
    assert.deepEqual(runtime.verifiedConfirmedActions.slice(0, 2), ["faucet", "approve"]);
    assert.deepEqual(runtime.broadcastActions, ["faucet", "approve", "join", "withdraw"]);
    const afterRecovery = store.snapshot();
    assert.deepEqual(
      afterRecovery.operations
        .filter((operation) => operation.action === "faucet" || operation.action === "approve")
        .map((operation) => operation.operationId),
      confirmedIds,
    );
    assert.equal(afterRecovery.operations.filter((operation) => operation.action === "faucet").length, 1);
    assert.equal(afterRecovery.operations.filter((operation) => operation.action === "approve").length, 1);
  });

  it("still withdraws safely when its join enters the preflight safety margin", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.pool.activePositionCount = 89n;
    const store = journal();
    await runSmokeWriteFlow({ runtime, journal: store, preflight: await preflight(runtime) });
    assert.equal(runtime.pool.status, 0n);
    assert.equal(runtime.pool.activePositionCount, 89n);
    assert.equal(runtime.position.active, false);
  });

  it("turns a receipt timeout into requires_manual_review without retry", async function () {
    const runtime = new FakeSmokeRuntime();
    runtime.waitNever = true;
    const store = journal();
    await assert.rejects(
      runSmokeWriteFlow({ runtime, journal: store, preflight: await preflight(runtime), receiptTimeoutMs: 5 }),
      /Receipt wait failed/,
    );
    assert.equal(runtime.broadcastActions.length, 1);
    assert.equal(store.snapshot().operations[0].status, "requires_manual_review");
  });

  it("preserves broadcast evidence when interrupted after broadcast", async function () {
    const runtime = new FakeSmokeRuntime();
    const store = journal();
    await assert.rejects(runSmokeWriteFlow({
      runtime,
      journal: store,
      preflight: await preflight(runtime),
      failureHook: async (action, point) => {
        if (action === "faucet" && point === "after_broadcast_recorded") throw new Error("simulated crash");
      },
    }), /simulated crash/);
    assert.equal(store.snapshot().operations[0].status, "broadcast");
    assert.ok(store.snapshot().operations[0].transactionHash);
  });

  it("does not rebroadcast a pending transaction on restart", async function () {
    const runtime = new FakeSmokeRuntime();
    const pending = await pendingFaucet(runtime, "pending");
    runtime.transactions.set(pending.hash, {
      hash: pending.hash,
      from: SMOKE_WALLET,
      to: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
      nonce: 0,
      data: "0xfaucet",
      value: 0n,
    });
    await assert.rejects(
      runSmokeWriteFlow({ runtime, journal: pending.store, preflight: await preflight(runtime) }),
      /stopped in pending/,
    );
    assert.equal(runtime.broadcastActions.length, 0);
  });

  it("revalidates confirmed operations on restart and never sends them twice", async function () {
    const runtime = new FakeSmokeRuntime();
    const store = journal();
    const initial = await preflight(runtime);
    await runSmokeWriteFlow({ runtime, journal: store, preflight: initial });
    const count = runtime.broadcastActions.length;
    const restartedPreflight = await preflight(runtime);
    await runSmokeWriteFlow({ runtime, journal: store, preflight: restartedPreflight });
    assert.equal(runtime.broadcastActions.length, count);
  });

  it("marks an inconclusive missing transaction and nonce as manual review", async function () {
    const runtime = new FakeSmokeRuntime();
    const pending = await pendingFaucet(runtime, "pending");
    await assert.rejects(
      runSmokeWriteFlow({ runtime, journal: pending.store, preflight: await preflight(runtime) }),
      /requires_manual_review/,
    );
    assert.equal(pending.store.snapshot().operations[0].status, "requires_manual_review");
  });

  it("detects a same-nonce replacement and stops", async function () {
    const runtime = new FakeSmokeRuntime();
    const pending = await pendingFaucet(runtime, "pending");
    runtime.replacements.set(0, {
      hash: `0x${"8".repeat(64)}`,
      from: SMOKE_WALLET,
      to: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
      nonce: 0,
      data: "0x1234",
      value: 0n,
    });
    await assert.rejects(
      runSmokeWriteFlow({ runtime, journal: pending.store, preflight: await preflight(runtime) }),
      /stopped in replaced/,
    );
    assert.equal(pending.store.snapshot().operations[0].status, "replaced");
  });

  it("detects a same-nonce cancellation and stops", async function () {
    const runtime = new FakeSmokeRuntime();
    const pending = await pendingFaucet(runtime, "pending");
    runtime.replacements.set(0, {
      hash: `0x${"7".repeat(64)}`,
      from: SMOKE_WALLET,
      to: SMOKE_WALLET,
      nonce: 0,
      data: "0x",
      value: 0n,
    });
    await assert.rejects(
      runSmokeWriteFlow({ runtime, journal: pending.store, preflight: await preflight(runtime) }),
      /stopped in cancelled/,
    );
    assert.equal(pending.store.snapshot().operations[0].status, "cancelled");
  });

  it("sanitizes secret-shaped broadcast failures from journal state", async function () {
    const runtime = new FakeSmokeRuntime();
    const secret = `0x${"ab".repeat(32)}`;
    const credentialUrl = ["https://user", "pass@example.test/rpc"].join(":");
    runtime.broadcastError = new Error(`private key=${secret} url=${credentialUrl}`);
    const store = journal();
    await assert.rejects(
      runSmokeWriteFlow({ runtime, journal: store, preflight: await preflight(runtime) }),
      /ambiguous/,
    );
    const serialized = JSON.stringify(store.snapshot());
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(credentialUrl), false);
    assert.match(serialized, /redacted/);
  });

  it("keeps every Base Sepolia write in the main lifecycle operator blocked", function () {
    assert.throws(() => assertExecutionPolicy({
      mode: "drip",
      network: "baseSepolia",
      executePublic: true,
      confirmation: BASE_SEPOLIA_WRITE_CONFIRMATION,
    }), /public write execution is not implemented/);
  });
});
