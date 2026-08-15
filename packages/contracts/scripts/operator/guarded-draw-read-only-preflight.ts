import { type Address } from "viem";

import { demoV1Abi } from "../../../../src/demo-v1/abi.js";
import { DEMO_V1_CONTRACT_ADDRESS } from "../../../../src/demo-v1/safety.js";

export const GUARDED_DRAW_GAS_BUFFER_BPS = 2_500n;
const BASIS_POINTS = 10_000n;

export interface GuardedDrawSimulation {
  result: bigint | null;
  gasEstimate: bigint | null;
}

export interface GuardedDrawGasPlan {
  preflightEstimate: bigint;
  runtimeEstimate: bigint;
  requiredEstimate: bigint;
  gasLimit: bigint;
}

export interface GuardedDrawReadOnlySimulationDependencies {
  simulateDraw(input: {
    account: Address;
    address: Address;
    abi: typeof demoV1Abi;
    functionName: "executeDraw";
    args: readonly [bigint, bigint];
    blockNumber: bigint;
  }): Promise<GuardedDrawSimulation>;
  estimateDraw(input: {
    account: Address;
    address: Address;
    abi: typeof demoV1Abi;
    functionName: "executeDraw";
    args: readonly [bigint, bigint];
  }): Promise<bigint>;
}

export function calculateGuardedDrawGasPlan(
  preflightEstimate: bigint,
  runtimeEstimate: bigint,
): GuardedDrawGasPlan {
  if (preflightEstimate <= 0n || runtimeEstimate <= 0n) {
    throw new Error("Guarded Draw gas estimates must be positive.");
  }
  const requiredEstimate = preflightEstimate > runtimeEstimate
    ? preflightEstimate
    : runtimeEstimate;
  const bufferedNumerator =
    requiredEstimate * (BASIS_POINTS + GUARDED_DRAW_GAS_BUFFER_BPS);
  const gasLimit = (bufferedNumerator + BASIS_POINTS - 1n) / BASIS_POINTS;
  return {
    preflightEstimate,
    runtimeEstimate,
    requiredEstimate,
    gasLimit,
  };
}

export async function simulateExactGuardedDraw(
  input: {
    operatorAddress: Address;
    poolId: bigint;
    roundNumber: bigint;
    blockNumber: bigint;
  },
  dependencies: Pick<GuardedDrawReadOnlySimulationDependencies, "simulateDraw">,
): Promise<GuardedDrawSimulation> {
  return dependencies.simulateDraw({
    account: input.operatorAddress,
    address: DEMO_V1_CONTRACT_ADDRESS,
    abi: demoV1Abi,
    functionName: "executeDraw",
    args: [input.poolId, input.roundNumber],
    blockNumber: input.blockNumber,
  });
}

export async function estimateExactGuardedDraw(
  input: {
    operatorAddress: Address;
    poolId: bigint;
    roundNumber: bigint;
  },
  dependencies: Pick<GuardedDrawReadOnlySimulationDependencies, "estimateDraw">,
): Promise<bigint> {
  return dependencies.estimateDraw({
    account: input.operatorAddress,
    address: DEMO_V1_CONTRACT_ADDRESS,
    abi: demoV1Abi,
    functionName: "executeDraw",
    args: [input.poolId, input.roundNumber],
  });
}
