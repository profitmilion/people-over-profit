import test from "node:test";
import assert from "node:assert/strict";
import {
  canClaim,
  canExecuteDraw,
  canJoin,
  canWithdraw,
  formatDUsdc,
  isFaucetAvailable,
  needsApproval,
  shouldWaitForConfirmedAllowance,
} from "../src/demo-v1/domain.js";
import {
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_ENTRY_PRICE,
  DEMO_V1_TOKEN_ADDRESS,
  DemoV1ActionError,
  DemoV1SingleFlightGuard,
  assertDemoV1WriteChain,
  assertExactApprovalObserved,
  assertFaucetPostReceipt,
  assertJoinPostReceipt,
  assertReversibleJoinPool,
  assertSafeExistingAllowance,
  assertWithdrawalPostReceipt,
  classifyDemoV1TransactionError,
  exactDemoV1ApprovalAmount,
  runBoundedDemoV1ReadVerification,
  runDemoV1SingleFlight,
  validateDemoV1PublicConfig,
  validateDemoV1RuntimeIdentity,
} from "../src/demo-v1/safety.js";

test("formats 6-decimal dUSDC values without losing precision", () => {
  assert.equal(formatDUsdc(33_000_000n), "33");
  assert.equal(formatDUsdc(1_234_567n), "1.234567");
  assert.equal(formatDUsdc(100n), "0.0001");
});

test("faucet eligibility respects the cooldown timestamp", () => {
  const now = 2_000_000;
  assert.equal(isFaucetAvailable(2_000n, now), true);
  assert.equal(isFaucetAvailable(2_001n, now), false);
});

test("approval is required only below the exact entry price", () => {
  assert.equal(needsApproval(32_999_999n, 33_000_000n), true);
  assert.equal(needsApproval(33_000_000n, 33_000_000n), false);
});

test("a confirmed approval waits for fresh allowance instead of approving twice", () => {
  assert.equal(shouldWaitForConfirmedAllowance(0n, 33_000_000n, true), true);
  assert.equal(shouldWaitForConfirmedAllowance(0n, 33_000_000n, false), false);
  assert.equal(shouldWaitForConfirmedAllowance(33_000_000n, 33_000_000n, true), false);
});

test("join eligibility requires configuration, wallet, chain, balance and position capacity", () => {
  const valid = {
    configured: true,
    connected: true,
    correctChain: true,
    tokenBalance: 33_000_000n,
    entryPrice: 33_000_000n,
    activePositions: 9n,
    maxActivePositions: 10n,
  };
  assert.equal(canJoin(valid), true);
  assert.equal(canJoin({ ...valid, correctChain: false }), false);
  assert.equal(canJoin({ ...valid, tokenBalance: 32_999_999n }), false);
  assert.equal(canJoin({ ...valid, activePositions: 10n }), false);
});

test("withdraw is limited to active positions in open pools", () => {
  assert.equal(canWithdraw(0, true), true);
  assert.equal(canWithdraw(1, true), false);
  assert.equal(canWithdraw(0, false), false);
});

test("draw eligibility requires a due pending round in a locked or drawing pool", () => {
  const valid = {
    poolStatus: 1,
    completedRounds: 0n,
    totalRounds: 10n,
    scheduledAt: 1_000n,
    nowMs: 1_000_000,
  };
  assert.equal(canExecuteDraw(valid), true);
  assert.equal(canExecuteDraw({ ...valid, poolStatus: 0 }), false);
  assert.equal(canExecuteDraw({ ...valid, poolStatus: 0, scheduledAt: 0n }), false);
  assert.equal(canExecuteDraw({ ...valid, scheduledAt: 0n }), false);
  assert.equal(canExecuteDraw({ ...valid, scheduledAt: 1_001n }), false);
  assert.equal(canExecuteDraw({ ...valid, completedRounds: 10n }), false);
});

test("claim eligibility requires the connected winner and an unclaimed finalized round", () => {
  const winner = "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB";
  assert.equal(canClaim({ roundStatus: 1, claimed: false, winner, user: winner.toLowerCase() }), true);
  assert.equal(canClaim({ roundStatus: 0, claimed: false, winner, user: winner }), false);
  assert.equal(canClaim({ roundStatus: 1, claimed: true, winner, user: winner }), false);
});

test("public configuration accepts only the reviewed Demo V1 addresses and Base Sepolia", () => {
  const valid = {
    contractAddress: DEMO_V1_CONTRACT_ADDRESS,
    tokenAddress: DEMO_V1_TOKEN_ADDRESS,
    chainId: "84532",
    rpcUrl: "https://sepolia.base.org",
  };
  assert.deepEqual(validateDemoV1PublicConfig(valid), []);
  assert.deepEqual(
    validateDemoV1PublicConfig({
      ...valid,
      contractAddress: "0x0000000000000000000000000000000000000001",
      tokenAddress: "0x0000000000000000000000000000000000000002",
    }),
    ["unexpected-contract", "unexpected-token"],
  );
  assert.deepEqual(validateDemoV1PublicConfig({ ...valid, chainId: "8453" }), ["invalid-chain-id"]);
});

test("runtime identity requires bytecode, payment-token linkage and fixed Demo V1 values", () => {
  const valid = {
    contractHasBytecode: true,
    tokenHasBytecode: true,
    paymentToken: DEMO_V1_TOKEN_ADDRESS,
    tokenName: "POP33 Demo USD",
    tokenSymbol: "dUSDC",
    tokenDecimals: 6,
    entryPrice: 33_000_000n,
    poolCapacity: 100n,
    drawRounds: 10n,
    prizePerRound: 330_000_000n,
    drawInterval: 3_600n,
    dripAmount: 330_000_000n,
    dripCooldown: 86_400n,
  };
  assert.deepEqual(validateDemoV1RuntimeIdentity(valid), []);
  assert.deepEqual(
    validateDemoV1RuntimeIdentity({
      ...valid,
      paymentToken: "0x0000000000000000000000000000000000000001",
      entryPrice: 1n,
    }),
    ["payment-token-link", "entry-price"],
  );
});

test("writes are blocked before submission on every chain other than Base Sepolia", () => {
  assert.doesNotThrow(() => assertDemoV1WriteChain(84_532));
  assert.throws(
    () => assertDemoV1WriteChain(8_453),
    (error) => error instanceof DemoV1ActionError && error.phase === "wrong-network",
  );
});

test("approval is fixed to exactly one 33 dUSDC entry", () => {
  assert.equal(exactDemoV1ApprovalAmount(DEMO_V1_ENTRY_PRICE), 33_000_000n);
  assert.doesNotThrow(() => assertExactApprovalObserved(33_000_000n, DEMO_V1_ENTRY_PRICE));
  assert.throws(
    () => assertExactApprovalObserved(32_999_999n, DEMO_V1_ENTRY_PRICE),
    (error) => error instanceof DemoV1ActionError && error.phase === "allowance-not-observed",
  );
  assert.throws(
    () => assertSafeExistingAllowance(33_000_001n, DEMO_V1_ENTRY_PRICE),
    (error) => error instanceof DemoV1ActionError && error.phase === "unsafe-allowance",
  );
});

test("single-flight blocks a second call while pending", async () => {
  const guard = new DemoV1SingleFlightGuard();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const first = runDemoV1SingleFlight(guard, async () => {
    calls += 1;
    await pending;
    return "confirmed";
  });

  await assert.rejects(
    runDemoV1SingleFlight(guard, async () => {
      calls += 1;
      return "duplicate";
    }),
    (error) => error instanceof DemoV1ActionError && error.phase === "busy",
  );
  assert.equal(calls, 1);
  finish();
  assert.equal(await first, "confirmed");
});

test("a failed operation is not retried automatically and releases the manual guard", async () => {
  const guard = new DemoV1SingleFlightGuard();
  let calls = 0;
  await assert.rejects(
    runDemoV1SingleFlight(guard, async () => {
      calls += 1;
      throw new Error("receipt failed");
    }),
  );
  assert.equal(calls, 1);
  assert.equal(guard.isActive(), false);
});

test("post-receipt verification retries only stale reads with a strict bound", async () => {
  let readCalls = 0;
  const waits: number[] = [];
  const result = await runBoundedDemoV1ReadVerification(
    async () => {
      readCalls += 1;
      if (readCalls < 3) throw new Error("stale read");
      return "verified";
    },
    async (delayMs) => {
      waits.push(delayMs);
    },
  );
  assert.equal(result, "verified");
  assert.equal(readCalls, 3);
  assert.deepEqual(waits, [500, 1_000]);
});

test("wallet rejection and receipt timeout produce safe terminal messages", () => {
  assert.deepEqual(classifyDemoV1TransactionError({ code: 4001 }), {
    phase: "rejected",
    message: "Request rejected in the wallet. No retry was sent.",
  });
  assert.equal(
    classifyDemoV1TransactionError({ name: "WaitForTransactionReceiptTimeoutError", message: "timed out" }).phase,
    "manual-review",
  );
});

test("reversible join preflight refuses a non-Open or near-full pool", () => {
  assert.doesNotThrow(() => assertReversibleJoinPool({ poolStatus: 0, activePositionCount: 89n }));
  assert.throws(() => assertReversibleJoinPool({ poolStatus: 1, activePositionCount: 0n }));
  assert.throws(() => assertReversibleJoinPool({ poolStatus: 0, activePositionCount: 90n }));
});

test("join post-receipt verification checks the actual position, exact payment and escrow", () => {
  const user = "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB";
  const valid = {
    user,
    expectedPoolId: 1n,
    eventUser: user,
    eventPoolId: 1n,
    eventPositionId: 4n,
    eventAmount: 33_000_000n,
    eventPoolActiveCount: 1n,
    positionOwner: user,
    positionPoolId: 1n,
    positionActive: true,
    poolStatus: 0,
    poolActiveCount: 1n,
    poolEscrow: 33_000_000n,
    userActiveBefore: 0n,
    userActiveAfter: 1n,
    tokenBalanceBefore: 330_000_000n,
    tokenBalanceAfter: 297_000_000n,
    allowanceAfter: 0n,
    entryPrice: 33_000_000n,
  };
  assert.doesNotThrow(() => assertJoinPostReceipt(valid));
  assert.throws(
    () => assertJoinPostReceipt({ ...valid, poolEscrow: 0n }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
});

test("faucet post-receipt verification requires the exact drip and a new cooldown", () => {
  assert.doesNotThrow(() => assertFaucetPostReceipt({
    balanceBefore: 0n,
    balanceAfter: 330_000_000n,
    nextDripBefore: 0n,
    nextDripAfter: 86_400n,
    dripAmount: 330_000_000n,
  }));
  assert.throws(
    () => assertFaucetPostReceipt({
      balanceBefore: 0n,
      balanceAfter: 329_999_999n,
      nextDripBefore: 0n,
      nextDripAfter: 86_400n,
      dripAmount: 330_000_000n,
    }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
});

test("withdrawal post-receipt verification checks inactive position, exact refund and escrow", () => {
  const user = "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB";
  const valid = {
    user,
    positionId: 4n,
    eventUser: user,
    eventPositionId: 4n,
    eventPoolId: 1n,
    eventAmount: 33_000_000n,
    eventPoolActiveCount: 0n,
    positionOwner: user,
    positionPoolId: 1n,
    positionActive: false,
    poolStatus: 0,
    poolActiveCount: 0n,
    poolEscrow: 0n,
    userActiveBefore: 1n,
    userActiveAfter: 0n,
    tokenBalanceBefore: 297_000_000n,
    tokenBalanceAfter: 330_000_000n,
    entryPrice: 33_000_000n,
  };
  assert.doesNotThrow(() => assertWithdrawalPostReceipt(valid));
  assert.throws(
    () => assertWithdrawalPostReceipt({ ...valid, tokenBalanceAfter: 329_000_000n }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
});
