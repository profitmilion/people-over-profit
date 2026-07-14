import assert from "node:assert/strict";

import { getAddress } from "ethers";

import { DEMO_V1_PARAMETERS } from "./demo-v1-config.js";

// Hardhat exposes dynamic contract factories until project-wide TypeChain output is used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HardhatEthersRuntime = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DynamicContract = any;

export interface DeploymentSummary {
  networkName: string;
  chainId: bigint;
  deployer: string;
  paymentTokenAddress: string;
  drawIntervalSeconds: bigint;
}

export function printDeploymentSummary(summary: DeploymentSummary): void {
  console.log("POP33 Demo V1 deployment configuration");
  console.log(`  Network: ${summary.networkName}`);
  console.log(`  Chain ID: ${summary.chainId}`);
  console.log(`  Deployer: ${summary.deployer}`);
  console.log(`  Payment token: ${summary.paymentTokenAddress}`);
  console.log(`  Position price: ${DEMO_V1_PARAMETERS.entryPrice} token units`);
  console.log(`  Positions per pool: ${DEMO_V1_PARAMETERS.positionsPerPool}`);
  console.log(`  Draw rounds: ${DEMO_V1_PARAMETERS.drawRoundCount}`);
  console.log(`  Prize per round: ${DEMO_V1_PARAMETERS.prizePerRound} token units`);
  console.log(`  Total prizes: ${DEMO_V1_PARAMETERS.totalPrizeAmount} token units`);
  console.log(`  Draw interval: ${summary.drawIntervalSeconds} seconds`);
  console.log("  Randomness: temporary and NOT production-safe");
  console.log("  Explorer verification: disabled (separate future command required)");
}

export async function validatePaymentToken(
  ethers: HardhatEthersRuntime,
  paymentTokenAddress: string,
): Promise<void> {
  const code = await ethers.provider.getCode(paymentTokenAddress);
  assert.notEqual(code, "0x", "Payment token address has no deployed bytecode.");

  const token = await ethers.getContractAt(
    ["function decimals() view returns (uint8)"],
    paymentTokenAddress,
  );
  assert.equal(await token.decimals(), 6n, "Payment token must expose exactly 6 decimals.");
}

export async function deployPop33BasicV1(
  ethers: HardhatEthersRuntime,
  paymentTokenAddress: string,
  drawIntervalSeconds: bigint,
): Promise<DynamicContract> {
  const contract = await ethers.deployContract("Pop33BasicV1", [
    paymentTokenAddress,
    drawIntervalSeconds,
  ]);
  await contract.waitForDeployment();
  return contract;
}

export async function verifyPop33BasicV1Deployment(
  pop33: DynamicContract,
  paymentTokenAddress: string,
  drawIntervalSeconds: bigint,
): Promise<void> {
  assert.equal(
    getAddress(await pop33.paymentToken()),
    getAddress(paymentTokenAddress),
    "Stored payment token does not match deployment input.",
  );
  assert.equal(await pop33.DRAW_INTERVAL(), drawIntervalSeconds);
  assert.equal(await pop33.ENTRY_PRICE(), DEMO_V1_PARAMETERS.entryPrice);
  assert.equal(
    await pop33.MAX_POSITIONS_PER_POOL(),
    DEMO_V1_PARAMETERS.positionsPerPool,
  );
  assert.equal(await pop33.DRAW_ROUNDS(), DEMO_V1_PARAMETERS.drawRoundCount);
  assert.equal(await pop33.PRIZE_PER_ROUND(), DEMO_V1_PARAMETERS.prizePerRound);
  assert.equal(
    await pop33.TOTAL_PRIZE_AMOUNT(),
    DEMO_V1_PARAMETERS.totalPrizeAmount,
  );

  const pool = await pop33.getPool(1);
  assert.equal(pool.id, 1n);
  assert.equal(pool.status, 0n, "Initial pool must be Open.");
  assert.equal(pool.activePositionCount, 0n);
  assert.equal(pool.escrowedAmount, 0n);
  assert.equal(pool.entryPrice, DEMO_V1_PARAMETERS.entryPrice);
  assert.equal(pool.positionsPerPool, DEMO_V1_PARAMETERS.positionsPerPool);
  assert.equal(pool.drawRoundCount, DEMO_V1_PARAMETERS.drawRoundCount);
  assert.equal(pool.prizePerRound, DEMO_V1_PARAMETERS.prizePerRound);
  assert.equal(pool.totalPrizeAmount, DEMO_V1_PARAMETERS.totalPrizeAmount);
  assert.equal(pool.drawInterval, drawIntervalSeconds);
}

export async function printDeploymentResult(
  pop33: DynamicContract,
  summary: DeploymentSummary,
): Promise<void> {
  console.log("POP33 Demo V1 deployment completed and validated");
  console.log(`  Contract: ${await pop33.getAddress()}`);
  console.log(`  Payment token: ${summary.paymentTokenAddress}`);
  console.log(`  Chain ID: ${summary.chainId}`);
  console.log(`  Deployer: ${summary.deployer}`);
  console.log(`  Draw interval: ${summary.drawIntervalSeconds} seconds`);
  console.log(`  Entry price: ${await pop33.ENTRY_PRICE()} token units`);
  console.log(`  Positions per pool: ${await pop33.MAX_POSITIONS_PER_POOL()}`);
  console.log(`  Draw rounds: ${await pop33.DRAW_ROUNDS()}`);
  console.log(`  Prize per round: ${await pop33.PRIZE_PER_ROUND()} token units`);
  console.log(`  Total prizes: ${await pop33.TOTAL_PRIZE_AMOUNT()} token units`);
}
