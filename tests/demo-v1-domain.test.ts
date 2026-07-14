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
} from "../src/demo-v1/domain.js";

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
  assert.equal(canExecuteDraw({ ...valid, scheduledAt: 1_001n }), false);
  assert.equal(canExecuteDraw({ ...valid, completedRounds: 10n }), false);
});

test("claim eligibility requires the connected winner and an unclaimed finalized round", () => {
  const winner = "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB";
  assert.equal(canClaim({ roundStatus: 1, claimed: false, winner, user: winner.toLowerCase() }), true);
  assert.equal(canClaim({ roundStatus: 0, claimed: false, winner, user: winner }), false);
  assert.equal(canClaim({ roundStatus: 1, claimed: true, winner, user: winner }), false);
});
