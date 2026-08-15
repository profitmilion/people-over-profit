import { getAddress, isAddress, type Address } from "viem";

import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
} from "../../../../src/demo-v1/safety.js";
import {
  logicalDrawKey,
  type AutomaticDrawDueDecision,
} from "./automatic-draw-runner-v1-decision.js";
import {
  validateAutomaticDrawReservationRecord,
  type AutomaticDrawReservationCycleResult,
} from "./automatic-draw-runner-v1-reservation.js";
import {
  calculateGuardedDrawGasPlan,
  estimateExactGuardedDraw,
  simulateExactGuardedDraw,
  type GuardedDrawReadOnlySimulationDependencies,
} from "./guarded-draw-read-only-preflight.js";
import {
  createLifecycleActionPlan,
  revalidateLifecycleActionPlan,
  type LifecycleActionPlan,
  type LifecycleRevalidationResult,
} from "./lifecycle-action-plan.js";
import {
  analyzeLifecycleSnapshot,
  type SystemSnapshot,
} from "./lifecycle-supervisor.js";

export type AutomaticDrawDryRunStatus =
  | "READY_FOR_EXECUTION"
  | "SAFE_STOP"
  | "RECONCILIATION_REQUIRED"
  | "PREFLIGHT_FAILED";

export interface AutomaticDrawDryRunEvidence {
  logicalDrawKey: string | null;
  chainId: string | null;
  contractAddress: string | null;
  poolId: string | null;
  roundNumber: string | null;
  reservationStatus: AutomaticDrawReservationCycleResult["status"];
  planId: string | null;
  sourceBlock: string | null;
  revalidationBlock: string | null;
  revalidationStatus: LifecycleRevalidationResult["status"] | null;
  scheduledAt: string | null;
  simulationSucceeded: boolean;
  gasEstimate: string | null;
  runtimeGasEstimate: string | null;
  bufferedGasLimit: string | null;
}

export interface AutomaticDrawDryRunResult {
  status: AutomaticDrawDryRunStatus;
  dryRunOnly: true;
  transactionAuthorized: false;
  transactionSent: false;
  reason: string;
  evidence: AutomaticDrawDryRunEvidence;
}

export interface AutomaticDrawDryRunPublicIdentity {
  chainId: bigint;
  contractAddress: string;
  hasBytecode: boolean;
}

export interface AutomaticDrawDryRunDependencies
  extends GuardedDrawReadOnlySimulationDependencies {
  readSnapshot(blockNumber?: bigint): Promise<SystemSnapshot>;
  getLatestBlockNumber(): Promise<bigint>;
  readPublicIdentity(
    blockNumber: bigint,
  ): Promise<AutomaticDrawDryRunPublicIdentity>;
}

export interface AutomaticDrawDryRunOptions {
  reservation: AutomaticDrawReservationCycleResult;
  operatorAddress: string;
  dependencies: AutomaticDrawDryRunDependencies;
  maxPlanAgeSeconds?: bigint;
}

function baseEvidence(
  reservation: AutomaticDrawReservationCycleResult,
): AutomaticDrawDryRunEvidence {
  const decision = reservation.decision;
  if (decision.status !== "DRAW_DUE") {
    return {
      logicalDrawKey: null,
      chainId: decision.chainId.toString(),
      contractAddress: decision.contractAddress,
      poolId: decision.poolId.toString(),
      roundNumber: null,
      reservationStatus: reservation.status,
      planId: null,
      sourceBlock: decision.sourceBlock?.toString() ?? null,
      revalidationBlock: null,
      revalidationStatus: null,
      scheduledAt: null,
      simulationSucceeded: false,
      gasEstimate: null,
      runtimeGasEstimate: null,
      bufferedGasLimit: null,
    };
  }
  return {
    logicalDrawKey: decision.logicalDrawKey,
    chainId: decision.chainId.toString(),
    contractAddress: getAddress(decision.contractAddress),
    poolId: decision.poolId.toString(),
    roundNumber: decision.roundNumber.toString(),
    reservationStatus: reservation.status,
    planId: null,
    sourceBlock: decision.sourceBlock?.toString() ?? null,
    revalidationBlock: null,
    revalidationStatus: null,
    scheduledAt: decision.scheduledAt.toString(),
    simulationSucceeded: false,
    gasEstimate: null,
    runtimeGasEstimate: null,
    bufferedGasLimit: null,
  };
}

function result(
  status: AutomaticDrawDryRunStatus,
  reason: string,
  evidence: AutomaticDrawDryRunEvidence,
): AutomaticDrawDryRunResult {
  return {
    status,
    dryRunOnly: true,
    transactionAuthorized: false,
    transactionSent: false,
    reason,
    evidence,
  };
}

function sameAddress(left: string, right: string): boolean {
  return isAddress(left) && isAddress(right) &&
    getAddress(left) === getAddress(right);
}

function decisionMatchesPlan(
  decision: AutomaticDrawDueDecision,
  plan: LifecycleActionPlan,
): boolean {
  if (
    plan.identity.chainId !== decision.chainId.toString() ||
    !sameAddress(plan.identity.contractAddress, decision.contractAddress) ||
    plan.scope.poolId !== decision.poolId.toString() ||
    plan.scope.roundNumber !== decision.roundNumber.toString() ||
    plan.scope.classification !== "actionable" ||
    plan.scope.plannedAction !== "DRAW" ||
    (plan.scope.supervisorAction !== "DRAW_DUE" &&
      plan.scope.supervisorAction !== "DRAW_OVERDUE")
  ) {
    return false;
  }
  return logicalDrawKey({
    chainId: BigInt(plan.identity.chainId),
    contractAddress: plan.identity.contractAddress,
    poolId: BigInt(plan.scope.poolId),
    roundNumber: BigInt(plan.scope.roundNumber),
  }) === decision.logicalDrawKey;
}

function sourceMatchesDecision(
  snapshot: SystemSnapshot,
  decision: AutomaticDrawDueDecision,
): boolean {
  return snapshot.blockNumber === decision.sourceBlock &&
    snapshot.chainId === decision.chainId &&
    sameAddress(snapshot.contractAddress, decision.contractAddress) &&
    snapshot.source === decision.source &&
    snapshot.pools.length === 1 &&
    snapshot.pools[0].poolId === decision.poolId;
}

function validPublicIdentity(
  identity: AutomaticDrawDryRunPublicIdentity,
  decision: AutomaticDrawDueDecision,
): boolean {
  return identity.hasBytecode &&
    identity.chainId === decision.chainId &&
    sameAddress(identity.contractAddress, decision.contractAddress);
}

function revalidate(
  plan: LifecycleActionPlan,
  snapshot: SystemSnapshot,
  sourceReference: string,
  maxPlanAgeSeconds: bigint | undefined,
): LifecycleRevalidationResult {
  return revalidateLifecycleActionPlan(
    plan,
    snapshot,
    analyzeLifecycleSnapshot(snapshot),
    {
      ...(maxPlanAgeSeconds === undefined ? {} : { maxPlanAgeSeconds }),
      freshSourceReference: sourceReference,
    },
  );
}

export async function runAutomaticDrawDryRun(
  options: AutomaticDrawDryRunOptions,
): Promise<AutomaticDrawDryRunResult> {
  let evidence = baseEvidence(options.reservation);
  if (options.reservation.status === "NO_RESERVATION") {
    return result(
      "SAFE_STOP",
      "No first-time Draw reservation is available for dry-run preflight.",
      evidence,
    );
  }
  if (options.reservation.status !== "RESERVED_FIRST_TIME") {
    return result(
      "RECONCILIATION_REQUIRED",
      "Only a first-time durable reservation may enter Phase 3.",
      evidence,
    );
  }

  const decision = options.reservation.decision;
  if (decision.sourceBlock === null) {
    return result("SAFE_STOP", "The Draw source block is unavailable.", evidence);
  }
  if (decision.chainId !== BigInt(DEMO_V1_CHAIN_ID)) {
    return result("SAFE_STOP", "The Draw chain is not the canonical Demo V1 chain.", evidence);
  }
  if (!sameAddress(decision.contractAddress, DEMO_V1_CONTRACT_ADDRESS)) {
    return result("SAFE_STOP", "The Draw contract is not the canonical Demo V1 contract.", evidence);
  }

  try {
    const operation = validateAutomaticDrawReservationRecord(
      options.reservation.operation,
    );
    if (
      operation.logicalDrawKey !== decision.logicalDrawKey ||
      operation.chainId !== decision.chainId.toString() ||
      !sameAddress(operation.contractAddress, decision.contractAddress) ||
      operation.poolId !== decision.poolId.toString() ||
      operation.roundNumber !== decision.roundNumber.toString() ||
      operation.sourceBlock !== decision.sourceBlock.toString() ||
      operation.scheduledAt !== decision.scheduledAt.toString()
    ) {
      return result(
        "RECONCILIATION_REQUIRED",
        "The durable reservation does not match its Phase 1 logical Draw.",
        evidence,
      );
    }
  } catch {
    return result(
      "RECONCILIATION_REQUIRED",
      "The durable reservation could not be validated.",
      evidence,
    );
  }

  let operatorAddress: Address;
  try {
    operatorAddress = getAddress(options.operatorAddress);
  } catch {
    return result("PREFLIGHT_FAILED", "The public operator address is invalid.", evidence);
  }

  let plan: LifecycleActionPlan;
  try {
    const sourceSnapshot = await options.dependencies.readSnapshot(
      decision.sourceBlock,
    );
    if (!sourceMatchesDecision(sourceSnapshot, decision)) {
      return result(
        "SAFE_STOP",
        "The pinned source snapshot does not match the reserved logical Draw.",
        evidence,
      );
    }
    const sourceReport = analyzeLifecycleSnapshot(sourceSnapshot);
    plan = createLifecycleActionPlan(
      sourceSnapshot,
      sourceReport,
      decision.poolId,
      { sourceReference: decision.source },
    );
    evidence = { ...evidence, planId: plan.planId };
    if (!decisionMatchesPlan(decision, plan)) {
      return result(
        "SAFE_STOP",
        "The lifecycle action plan changed the reserved logical Draw identity.",
        evidence,
      );
    }
  } catch {
    return result(
      "PREFLIGHT_FAILED",
      "The reserved Draw action plan could not be created from trusted reads.",
      evidence,
    );
  }

  let freshSnapshot: SystemSnapshot;
  let freshRevalidation: LifecycleRevalidationResult;
  try {
    freshSnapshot = await options.dependencies.readSnapshot();
    freshRevalidation = revalidate(
      plan,
      freshSnapshot,
      plan.source.reference,
      options.maxPlanAgeSeconds,
    );
  } catch {
    return result(
      "PREFLIGHT_FAILED",
      "Fresh lifecycle revalidation could not be completed.",
      evidence,
    );
  }
  evidence = {
    ...evidence,
    revalidationBlock: freshSnapshot.blockNumber?.toString() ?? null,
    revalidationStatus: freshRevalidation.status,
  };
  if (
    freshRevalidation.status !== "VALID" ||
    !decisionMatchesPlan(decision, plan)
  ) {
    return result(
      "SAFE_STOP",
      "Fresh lifecycle state no longer validates the reserved Draw.",
      evidence,
    );
  }
  if (freshSnapshot.blockNumber === null) {
    return result("SAFE_STOP", "Fresh revalidation has no trusted block.", evidence);
  }

  let simulation;
  try {
    const latestBlock = await options.dependencies.getLatestBlockNumber();
    if (latestBlock < freshSnapshot.blockNumber) {
      return result("SAFE_STOP", "The latest public block regressed.", evidence);
    }
    if (latestBlock > freshSnapshot.blockNumber) {
      const latestSnapshot = await options.dependencies.readSnapshot(latestBlock);
      const latestRevalidation = revalidate(
        plan,
        latestSnapshot,
        plan.source.reference,
        options.maxPlanAgeSeconds,
      );
      evidence = {
        ...evidence,
        revalidationBlock: latestSnapshot.blockNumber?.toString() ?? null,
        revalidationStatus: latestRevalidation.status,
      };
      if (latestRevalidation.status !== "VALID" || latestSnapshot.blockNumber !== latestBlock) {
        return result(
          "SAFE_STOP",
          "Latest lifecycle state no longer validates the reserved Draw.",
          evidence,
        );
      }
      freshSnapshot = latestSnapshot;
    }

    const identity = await options.dependencies.readPublicIdentity(
      freshSnapshot.blockNumber as bigint,
    );
    if (!validPublicIdentity(identity, decision)) {
      return result(
        "SAFE_STOP",
        "The public chain, contract, or bytecode identity is invalid.",
        evidence,
      );
    }
    simulation = await simulateExactGuardedDraw({
      operatorAddress,
      poolId: decision.poolId,
      roundNumber: decision.roundNumber,
      blockNumber: freshSnapshot.blockNumber as bigint,
    }, options.dependencies);
  } catch {
    return result(
      "PREFLIGHT_FAILED",
      "The exact Draw simulation failed.",
      evidence,
    );
  }

  if (simulation.gasEstimate === null || simulation.gasEstimate <= 0n) {
    return result(
      "PREFLIGHT_FAILED",
      "The exact Draw simulation returned no positive gas estimate.",
      evidence,
    );
  }
  evidence = {
    ...evidence,
    simulationSucceeded: true,
    gasEstimate: simulation.gasEstimate.toString(),
  };

  try {
    const runtimeGasEstimate = await estimateExactGuardedDraw({
      operatorAddress,
      poolId: decision.poolId,
      roundNumber: decision.roundNumber,
    }, options.dependencies);
    const gasPlan = calculateGuardedDrawGasPlan(
      simulation.gasEstimate,
      runtimeGasEstimate,
    );
    evidence = {
      ...evidence,
      runtimeGasEstimate: runtimeGasEstimate.toString(),
      bufferedGasLimit: gasPlan.gasLimit.toString(),
    };
  } catch {
    return result(
      "PREFLIGHT_FAILED",
      "The final gas estimate or buffered gas plan failed.",
      evidence,
    );
  }

  return result(
    "READY_FOR_EXECUTION",
    "The reserved logical Draw passed non-transactional dry-run preflight only.",
    evidence,
  );
}
