import test from "node:test";
import assert from "node:assert/strict";
import {
  canClaim,
  canExecuteDraw,
  canJoin,
  canWithdraw,
  formatDUsdc,
  getPoolFillState,
  isFaucetAvailable,
  needsApproval,
  shouldWaitForConfirmedAllowance,
  sortPoolsByIdAscending,
} from "../src/demo-v1/domain.js";
import {
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_ENTRY_PRICE,
  DEMO_V1_TOKEN_ADDRESS,
  DemoV1ActionError,
  DemoV1SingleFlightGuard,
  assertDemoV1WriteChain,
  assertClaimPostReceipt,
  assertClaimPreflight,
  assertExactApprovalObserved,
  assertFaucetPostReceipt,
  assertJoinPoolPreflight,
  assertJoinPostReceipt,
  assertSafeExistingAllowance,
  assertWithdrawalPostReceipt,
  classifyDemoV1TransactionError,
  exactDemoV1ApprovalAmount,
  refreshDemoV1AfterConfirmation,
  runBoundedDemoV1ReadVerification,
  runDemoV1SingleFlight,
  validateDemoV1PublicConfig,
  validateDemoV1RuntimeIdentity,
} from "../src/demo-v1/safety.js";
import {
  BASE_SEPOLIA_CHAIN_ID,
  RECOMMENDED_DEMO_ETH_BALANCE,
  getDemoOnboardingState,
  getWalletRequestErrorMessage,
  type DemoOnboardingInput,
} from "../src/demo-v1/onboarding.js";

const demoUser = "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB";
const onboardingReadyFixture: DemoOnboardingInput = {
  hasWalletProvider: true,
  isConnected: true,
  chainId: BASE_SEPOLIA_CHAIN_ID,
  isNetworkPending: false,
  nativeBalance: RECOMMENDED_DEMO_ETH_BALANCE,
  tokenBalance: DEMO_V1_ENTRY_PRICE,
  allowance: DEMO_V1_ENTRY_PRICE,
  entryPrice: DEMO_V1_ENTRY_PRICE,
  faucetAvailable: true,
  runtimeReady: true,
  positionCapacityAvailable: true,
  joinEligible: true,
  transactionBusy: false,
};

function joinPreflightFixture(activePositionCount: bigint, poolCapacity = 100n) {
  return {
    poolStatus: 0,
    activePositionCount,
    poolCapacity,
    escrowedAmount: activePositionCount * DEMO_V1_ENTRY_PRICE,
    entryPrice: DEMO_V1_ENTRY_PRICE,
    lockedAt: 0n,
    activePositionId: 0n,
  };
}

function joinPostReceiptFixture(input: {
  activePositionCount: bigint;
  expectedPoolId?: bigint;
  actualPoolId?: bigint;
  poolCapacity?: bigint;
}) {
  const actualPoolId = input.actualPoolId ?? 1n;
  const poolCapacity = input.poolCapacity ?? 100n;
  const lockingJoin = input.activePositionCount === poolCapacity;
  const lockedAt = lockingJoin ? 2_000n : 0n;
  return {
    user: demoUser,
    expectedPoolId: input.expectedPoolId ?? actualPoolId,
    eventUser: demoUser,
    eventPoolId: actualPoolId,
    eventPositionId: 4n,
    eventAmount: DEMO_V1_ENTRY_PRICE,
    eventPoolActiveCount: input.activePositionCount,
    positionOwner: demoUser,
    positionPoolId: actualPoolId,
    positionActive: true,
    activePositionIdAfter: 4n,
    poolStatus: lockingJoin ? 1 : 0,
    poolActiveCount: input.activePositionCount,
    poolEscrow: input.activePositionCount * DEMO_V1_ENTRY_PRICE,
    poolLockedAt: lockedAt,
    poolDrawInterval: 3_600n,
    poolCapacity,
    poolDrawRoundCount: 10n,
    drawRounds: lockingJoin
      ? Array.from({ length: 10 }, (_, index) => ({
          number: BigInt(index + 1),
          scheduledAt: lockedAt + BigInt(index + 1) * 3_600n,
          status: 0,
        }))
      : undefined,
    userActiveBefore: 0n,
    userActiveAfter: 1n,
    tokenBalanceBefore: 330_000_000n,
    tokenBalanceAfter: 297_000_000n,
    allowanceAfter: 0n,
    entryPrice: DEMO_V1_ENTRY_PRICE,
  };
}

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

test("pool fill UI state covers 89, 90, 98, 99 and 100 Locked", () => {
  for (const count of [89n, 90n, 98n]) {
    assert.deepEqual(getPoolFillState({
      poolStatus: 0,
      activePositionCount: count,
      capacity: 100n,
    }), {
      fillLabel: `${count}/100`,
      joinAvailable: true,
      nextJoinLocks: false,
      withdrawalAvailable: true,
    });
  }
  assert.deepEqual(getPoolFillState({
    poolStatus: 0,
    activePositionCount: 99n,
    capacity: 100n,
  }), {
    fillLabel: "99/100",
    joinAvailable: true,
    nextJoinLocks: true,
    withdrawalAvailable: true,
  });
  assert.deepEqual(getPoolFillState({
    poolStatus: 1,
    activePositionCount: 100n,
    capacity: 100n,
  }), {
    fillLabel: "100/100",
    joinAvailable: false,
    nextJoinLocks: false,
    withdrawalAvailable: false,
  });
});

test("archive pools are ordered from the oldest ID to the newest without mutating input", () => {
  const pools = [{ id: 3n }, { id: 1n }, { id: 2n }] as const;
  assert.deepEqual(
    sortPoolsByIdAscending(pools).map((pool) => pool.id),
    [1n, 2n, 3n],
  );
  assert.deepEqual(pools.map((pool) => pool.id), [3n, 1n, 2n]);
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
  const valid = {
    configured: true,
    connected: true,
    correctChain: true,
    roundStatus: 1,
    claimed: false,
    prizeAmount: 33_000_000n,
    winner,
    user: winner.toLowerCase(),
  };
  assert.equal(canClaim(valid), true);
  assert.equal(canClaim({ ...valid, roundStatus: 0 }), false);
  assert.equal(canClaim({ ...valid, claimed: true }), false);
  assert.equal(canClaim({ ...valid, correctChain: false }), false);
  assert.equal(canClaim({ ...valid, configured: false }), false);
  assert.equal(canClaim({ ...valid, prizeAmount: 0n }), false);
  assert.equal(canClaim({ ...valid, user: "0x0000000000000000000000000000000000000001" }), false);
});

test("claim preflight accepts only the finalized unclaimed prize owned by the sender", () => {
  const winner = "0xDb4D1C84EC00dE2387261b1406B5A0A872fa24d7";
  const valid = {
    user: winner,
    poolId: 1n,
    roundNumber: 1n,
    poolStatus: 2,
    poolDrawRoundCount: 10n,
    poolCompletedDrawRoundCount: 1n,
    poolEscrow: 330_000_000n,
    roundNumberOnchain: 1n,
    roundStatus: 1,
    roundWinner: winner,
    winningPositionId: 21n,
    prizeAmount: 33_000_000n,
    claimed: false,
    claimableAmount: 33_000_000n,
  };
  assert.doesNotThrow(() => assertClaimPreflight(valid));
  assert.throws(
    () => assertClaimPreflight({ ...valid, user: demoUser }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
  assert.throws(
    () => assertClaimPreflight({ ...valid, claimed: true }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
});

test("claim post-receipt verifies the event, exact transfer and all Claim counters", () => {
  const winner = "0xDb4D1C84EC00dE2387261b1406B5A0A872fa24d7";
  const valid = {
    user: winner,
    poolId: 1n,
    roundNumber: 1n,
    eventPoolId: 1n,
    eventRoundNumber: 1n,
    eventPositionId: 21n,
    eventWinner: winner,
    eventPrizeAmount: 33_000_000n,
    winningPositionId: 21n,
    roundWinner: winner,
    roundStatus: 1,
    roundClaimed: true,
    roundPrizeAmount: 33_000_000n,
    poolStatusBefore: 2,
    poolStatusAfter: 2,
    poolDrawRoundCount: 10n,
    poolCompletedDrawRoundCountBefore: 1n,
    poolCompletedDrawRoundCountAfter: 1n,
    poolClaimedPrizeCountBefore: 0n,
    poolClaimedPrizeCountAfter: 1n,
    poolClaimedPrizeAmountBefore: 0n,
    poolClaimedPrizeAmountAfter: 33_000_000n,
    poolEscrowBefore: 330_000_000n,
    poolEscrowAfter: 297_000_000n,
    tokenBalanceBefore: 231_000_000n,
    tokenBalanceAfter: 264_000_000n,
    claimableBefore: 33_000_000n,
    claimableAfter: 0n,
  };
  assert.doesNotThrow(() => assertClaimPostReceipt(valid));
  assert.throws(
    () => assertClaimPostReceipt({ ...valid, poolEscrowAfter: 330_000_000n }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
});

test("public configuration fixes the Pilot 10 contract, token and Base Sepolia", () => {
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
  assert.deepEqual(validateDemoV1RuntimeIdentity({
    ...valid,
    poolCapacity: 10n,
    prizePerRound: 33_000_000n,
  }), []);
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

test("a verified receipt triggers a fresh data refresh", async () => {
  let refreshCalls = 0;
  assert.equal(await refreshDemoV1AfterConfirmation(async () => {
    refreshCalls += 1;
  }), true);
  assert.equal(refreshCalls, 1);
  assert.equal(await refreshDemoV1AfterConfirmation(async () => {
    throw new Error("refresh failed");
  }), false);
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
  assert.deepEqual(classifyDemoV1TransactionError({ message: "execution reverted" }), {
    phase: "reverted",
    message: "Simulation or transaction failed. No retry was sent; refresh on-chain reads before deciding what to do next.",
  });
});

test("join preflight allows 89 through 99 and rejects invalid pool state", () => {
  for (const count of [89n, 90n, 98n, 99n]) {
    assert.doesNotThrow(() => assertJoinPoolPreflight(joinPreflightFixture(count)));
  }
  assert.throws(() => assertJoinPoolPreflight({
    ...joinPreflightFixture(99n),
    poolStatus: 1,
  }));
  assert.throws(() => assertJoinPoolPreflight(joinPreflightFixture(100n)));
  assert.throws(() => assertJoinPoolPreflight({
    ...joinPreflightFixture(99n),
    escrowedAmount: 0n,
  }));
  assert.throws(() => assertJoinPoolPreflight({
    ...joinPreflightFixture(99n),
    activePositionId: 7n,
  }));
});

test("pilot join preflight and locking receipt use the configured 10-user capacity", () => {
  assert.doesNotThrow(() => assertJoinPoolPreflight(joinPreflightFixture(9n, 10n)));
  const result = assertJoinPostReceipt(joinPostReceiptFixture({
    activePositionCount: 10n,
    poolCapacity: 10n,
  }));
  assert.equal(result.lockingJoin, true);
  assert.equal(10n * DEMO_V1_ENTRY_PRICE, 330_000_000n);
});

test("ordinary joins at 89, 90 and 98 end Open with exact count and escrow", () => {
  for (const countAfter of [90n, 91n, 99n]) {
    const result = assertJoinPostReceipt(joinPostReceiptFixture({
      activePositionCount: countAfter,
    }));
    assert.equal(result.lockingJoin, false);
    assert.equal(result.poolChangedFromPreflight, false);
  }
});

test("the 100th join verifies 3267 to 3300 dUSDC, Locked and round schedule", () => {
  assert.doesNotThrow(() => assertJoinPoolPreflight(joinPreflightFixture(99n)));
  const result = assertJoinPostReceipt(joinPostReceiptFixture({
    activePositionCount: 100n,
  }));
  assert.equal(result.lockingJoin, true);
  assert.equal(99n * DEMO_V1_ENTRY_PRICE, 3_267_000_000n);
  assert.equal(100n * DEMO_V1_ENTRY_PRICE, 3_300_000_000n);
  assert.equal(canWithdraw(1, true), false);
});

test("join verification follows the PositionJoined pool instead of the preflight snapshot", () => {
  const result = assertJoinPostReceipt(joinPostReceiptFixture({
    activePositionCount: 1n,
    expectedPoolId: 1n,
    actualPoolId: 2n,
  }));
  assert.equal(result.poolChangedFromPreflight, true);
  assert.equal(result.lockingJoin, false);
});

test("join verification rejects an inconsistent receipt and final state", () => {
  const valid = joinPostReceiptFixture({ activePositionCount: 99n });
  assert.throws(
    () => assertJoinPostReceipt({ ...valid, poolEscrow: 0n }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
  assert.throws(
    () => assertJoinPostReceipt({
      ...joinPostReceiptFixture({ activePositionCount: 100n }),
      poolStatus: 0,
    }),
    (error) => error instanceof DemoV1ActionError && error.phase === "verification-failed",
  );
  assert.throws(
    () => assertJoinPostReceipt({
      ...joinPostReceiptFixture({ activePositionCount: 100n }),
      drawRounds: joinPostReceiptFixture({
        activePositionCount: 100n,
      }).drawRounds?.slice(0, 9),
    }),
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

test("onboarding advances through wallet, network, ETH, dUSDC, approval and join", () => {
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      hasWalletProvider: false,
      isConnected: false,
      chainId: undefined,
    }).nextAction,
    "open-wallet-browser",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      isConnected: false,
      chainId: undefined,
    }).nextAction,
    "connect-wallet",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      chainId: 1,
    }).nextAction,
    "switch-network",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      nativeBalance: RECOMMENDED_DEMO_ETH_BALANCE - 1n,
    }).nextAction,
    "get-test-eth",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      tokenBalance: DEMO_V1_ENTRY_PRICE - 1n,
      allowance: 0n,
    }).nextAction,
    "get-dusdc",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      allowance: 0n,
    }).nextAction,
    "approve",
  );
  assert.equal(getDemoOnboardingState(onboardingReadyFixture).nextAction, "join");
  assert.equal(getDemoOnboardingState(onboardingReadyFixture).readyToJoin, true);
});

test("onboarding handles faucet cooldown, unsafe allowance and busy transaction state", () => {
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      tokenBalance: 0n,
      allowance: 0n,
      faucetAvailable: false,
    }).nextAction,
    "wait-for-faucet",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      allowance: DEMO_V1_ENTRY_PRICE + 1n,
    }).nextAction,
    "review-allowance",
  );
  assert.equal(
    getDemoOnboardingState({
      ...onboardingReadyFixture,
      transactionBusy: true,
    }).nextAction,
    "wait",
  );
});

test("wallet request errors distinguish rejection, missing provider and generic failure", () => {
  assert.match(
    getWalletRequestErrorMessage({ code: 4001 }, "connect") ?? "",
    /rejected/i,
  );
  assert.match(
    getWalletRequestErrorMessage(
      { message: "Provider not found" },
      "connect",
    ) ?? "",
    /wallet provider/i,
  );
  assert.match(
    getWalletRequestErrorMessage(new Error("transport stopped"), "network") ?? "",
    /chain ID 84532/i,
  );
});
