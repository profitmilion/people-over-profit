import { getAddress, isAddress, type Address } from "viem";

import {
  consumeAutomaticDrawDurableRuntime,
  createGuardedDrawDurableRuntimeConsumer,
  inspectAutomaticDrawDurableProgression,
  type AutomaticDrawDurableRuntimeOptions,
} from "./automatic-draw-runner-v1-runtime.js";
import { logicalDrawKey } from "./automatic-draw-runner-v1-decision.js";
import {
  calculateGuardedDrawGasPlan,
  estimateExactGuardedDraw,
} from "./guarded-draw-read-only-preflight.js";
import {
  simulateGuardedSingleDraw,
  type GuardedDrawDependencies,
  type GuardedDrawOutcome,
  type GuardedDrawPreparedIntentContext,
  type GuardedDrawRunOptions,
} from "./guarded-single-draw.js";

export type AutomaticDrawExecutionReadinessStatus =
  | "READY_TO_LOAD_SIGNER"
  | "SAFE_STOP"
  | "INSUFFICIENT_NATIVE_BALANCE"
  | "CONFLICT"
  | "MANUAL_REVIEW_REQUIRED"
  | "RECONCILIATION_REQUIRED"
  | "READ_FAILED";

export interface GuardedDrawExecutionReadinessReadDependencies {
  readNativeBalance(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<{
    blockNumber: bigint;
    nativeBalanceWei: bigint;
  }>;
  readDrawNativeFeeUpperBounds(input: {
    operatorAddress: Address;
    contractAddress: Address;
    poolId: bigint;
    roundNumber: bigint;
    bufferedGasLimit: bigint;
  }): Promise<{
    blockNumber: bigint;
    boundedFeePerGasWei: bigint;
    l1UnsignedTransactionSizeBytes: bigint;
    l1DataFeeUpperBoundWei: bigint;
    operatorFeeScalar: bigint;
    operatorFeeConstantWei: bigint;
    operatorFeeUpperBoundWei: bigint;
  }>;
}

export interface AutomaticDrawExecutionReadinessDependencies
  extends GuardedDrawDependencies,
    GuardedDrawExecutionReadinessReadDependencies {}

export interface AutomaticDrawExecutionReadinessOptions {
  durable: AutomaticDrawDurableRuntimeOptions;
  planJson: string;
  operatorAddress: string;
  dependencies: AutomaticDrawExecutionReadinessDependencies;
  maxPlanAgeSeconds?: bigint;
}

export interface AutomaticDrawExecutionReadinessEvidence {
  logicalDrawKey: string;
  journalOperationId: string | null;
  progressionRevision: number;
  journalRevision: number;
  chainId: string | null;
  contractAddress: string | null;
  poolId: string | null;
  roundNumber: string | null;
  operatorAddress: Address | null;
  planId: string | null;
  revalidationBlock: string | null;
  finalRevalidationBlock: string | null;
  simulationSucceeded: boolean;
  estimatedGas: string | null;
  runtimeGasEstimate: string | null;
  bufferedGasLimit: string | null;
  balanceBlock: string | null;
  nativeBalanceWei: string | null;
  feeBlock: string | null;
  boundedFeePerGasWei: string | null;
  l2ExecutionUpperBoundWei: string | null;
  l1UnsignedTransactionSizeBytes: string | null;
  l1DataFeeUpperBoundWei: string | null;
  operatorFeeScalar: string | null;
  operatorFeeConstantWei: string | null;
  operatorFeeUpperBoundWei: string | null;
  totalRequiredNativeWei: string | null;
}

export interface AutomaticDrawExecutionReadinessResult {
  status: AutomaticDrawExecutionReadinessStatus;
  readyToLoadSigner: boolean;
  signerLoaded: false;
  nonceAcquired: false;
  transactionPrepared: false;
  broadcastAuthorized: false;
  transactionSent: false;
  reason: string;
  evidence: AutomaticDrawExecutionReadinessEvidence;
}

function baseEvidence(
  options: AutomaticDrawExecutionReadinessOptions,
): AutomaticDrawExecutionReadinessEvidence {
  return {
    logicalDrawKey: options.durable.logicalDrawKey,
    journalOperationId: null,
    progressionRevision: options.durable.expectedProgressionRevision,
    journalRevision: options.durable.expectedJournalRevision,
    chainId: null,
    contractAddress: null,
    poolId: null,
    roundNumber: null,
    operatorAddress: null,
    planId: null,
    revalidationBlock: null,
    finalRevalidationBlock: null,
    simulationSucceeded: false,
    estimatedGas: null,
    runtimeGasEstimate: null,
    bufferedGasLimit: null,
    balanceBlock: null,
    nativeBalanceWei: null,
    feeBlock: null,
    boundedFeePerGasWei: null,
    l2ExecutionUpperBoundWei: null,
    l1UnsignedTransactionSizeBytes: null,
    l1DataFeeUpperBoundWei: null,
    operatorFeeScalar: null,
    operatorFeeConstantWei: null,
    operatorFeeUpperBoundWei: null,
    totalRequiredNativeWei: null,
  };
}

function result(
  status: AutomaticDrawExecutionReadinessStatus,
  reason: string,
  evidence: AutomaticDrawExecutionReadinessEvidence,
): AutomaticDrawExecutionReadinessResult {
  return {
    status,
    readyToLoadSigner: status === "READY_TO_LOAD_SIGNER",
    signerLoaded: false,
    nonceAcquired: false,
    transactionPrepared: false,
    broadcastAuthorized: false,
    transactionSent: false,
    reason,
    evidence,
  };
}

function durableFailureStatus(
  status: string,
): AutomaticDrawExecutionReadinessStatus {
  if (status === "RECONCILIATION_REQUIRED") return "RECONCILIATION_REQUIRED";
  if (status === "MANUAL_REVIEW_REQUIRED") return "MANUAL_REVIEW_REQUIRED";
  return "CONFLICT";
}

function guardedFailureStatus(
  outcome: GuardedDrawOutcome,
): AutomaticDrawExecutionReadinessStatus {
  return outcome.status === "RPC_FAILURE" || outcome.status === "INCOMPLETE"
    ? "READ_FAILED"
    : "SAFE_STOP";
}

function exactPlanMatches(
  outcome: GuardedDrawOutcome,
  logicalKey: string,
  planId: string,
): boolean {
  const plan = outcome.plan;
  if (!plan || plan.scope.roundNumber === null || plan.planId !== planId) {
    return false;
  }
  return logicalDrawKey({
    chainId: BigInt(plan.identity.chainId),
    contractAddress: plan.identity.contractAddress,
    poolId: BigInt(plan.scope.poolId),
    roundNumber: BigInt(plan.scope.roundNumber),
  }) === logicalKey;
}

function readOnlyDependencies(
  dependencies: AutomaticDrawExecutionReadinessDependencies,
): GuardedDrawDependencies {
  return {
    readSnapshot: dependencies.readSnapshot,
    readPublicIdentity: dependencies.readPublicIdentity,
    getLatestBlockNumber: dependencies.getLatestBlockNumber,
    simulateDraw: dependencies.simulateDraw,
    estimateDraw: dependencies.estimateDraw,
    getRpcTelemetry: dependencies.getRpcTelemetry,
  };
}

async function simulateAtObservedBlock(
  runOptions: GuardedDrawRunOptions,
  dependencies: AutomaticDrawExecutionReadinessDependencies,
  blockNumber?: bigint,
): Promise<GuardedDrawOutcome> {
  const readOnly = readOnlyDependencies(dependencies);
  return simulateGuardedSingleDraw(runOptions, blockNumber === undefined
    ? readOnly
    : {
        ...readOnly,
        readSnapshot: () => dependencies.readSnapshot(blockNumber),
      });
}

async function simulateAtFreshBlock(
  runOptions: GuardedDrawRunOptions,
  dependencies: AutomaticDrawExecutionReadinessDependencies,
): Promise<GuardedDrawOutcome> {
  let outcome = await simulateGuardedSingleDraw(
    runOptions,
    readOnlyDependencies(dependencies),
  );
  if (outcome.status !== "INSPECT_VALID" || !outcome.snapshot?.blockNumber) {
    return outcome;
  }
  const observedBlock = outcome.snapshot.blockNumber;
  const latestBlock = await dependencies.getLatestBlockNumber();
  if (latestBlock < observedBlock) {
    throw new Error("Latest public block regressed during readiness.");
  }
  if (latestBlock > observedBlock) {
    outcome = await simulateAtObservedBlock(
      runOptions,
      dependencies,
      latestBlock,
    );
  }
  return outcome;
}

function durableContext(
  operation: Awaited<ReturnType<typeof inspectAutomaticDrawDurableProgression>> & {
    status: "READY";
  },
): GuardedDrawPreparedIntentContext {
  const stored = operation.operation;
  if (stored.progression.state !== "PREFLIGHT_READY") {
    throw new Error("Durable progression is not ready.");
  }
  const { record, progression } = stored;
  return {
    logicalDrawKey: record.logicalDrawKey,
    chainId: BigInt(record.chainId),
    contractAddress: getAddress(record.contractAddress),
    poolId: BigInt(record.poolId),
    roundNumber: BigInt(record.roundNumber),
    operatorAddress: getAddress(progression.preflight.publicOperatorAddress),
    planId: progression.preflight.planId,
    revalidationBlock: progression.preflight.revalidationBlock,
    gasEstimate: BigInt(progression.preflight.gasEstimate),
    runtimeGasEstimate: BigInt(progression.preflight.runtimeGasEstimate),
    bufferedGasLimit: BigInt(progression.preflight.bufferedGasLimit),
  };
}

/**
 * One-shot, non-persistent authorization to load a signer in a future stage.
 * This function performs only public reads and stops before signer access.
 */
export async function authorizeAutomaticDrawExecutionReadiness(
  options: AutomaticDrawExecutionReadinessOptions,
): Promise<AutomaticDrawExecutionReadinessResult> {
  let evidence = baseEvidence(options);
  const initial = await consumeAutomaticDrawDurableRuntime(options.durable);
  if (initial.status !== "CONSUMER_READY") {
    return result(
      durableFailureStatus(initial.status),
      "The current durable Draw intent is not safely consumable.",
      evidence,
    );
  }
  const initialOperation = initial.consumer.operation;
  if (!initialOperation) {
    return result("CONFLICT", "The prepared Draw intent is missing.", evidence);
  }
  evidence = {
    ...evidence,
    journalOperationId: initialOperation.operationId,
  };

  const progression = await inspectAutomaticDrawDurableProgression(
    options.durable,
  );
  if (progression.status !== "READY") {
    return result(
      durableFailureStatus(progression.status),
      "The durable Draw progression is no longer ready.",
      evidence,
    );
  }
  const storedContext = durableContext(progression);
  if (
    !isAddress(options.operatorAddress) ||
    getAddress(options.operatorAddress) !== storedContext.operatorAddress ||
    initialOperation.walletAddress !== storedContext.operatorAddress
  ) {
    return result(
      "CONFLICT",
      "The expected public operator does not match durable Draw evidence.",
      evidence,
    );
  }
  evidence = {
    ...evidence,
    chainId: storedContext.chainId.toString(),
    contractAddress: storedContext.contractAddress,
    poolId: storedContext.poolId.toString(),
    roundNumber: storedContext.roundNumber.toString(),
    operatorAddress: storedContext.operatorAddress,
    planId: storedContext.planId,
  };

  let fresh: GuardedDrawOutcome;
  try {
    fresh = await simulateAtFreshBlock({
      planJson: options.planJson,
      operatorAddress: storedContext.operatorAddress,
      ...(options.maxPlanAgeSeconds === undefined
        ? {}
        : { maxPlanAgeSeconds: options.maxPlanAgeSeconds }),
    }, options.dependencies);
  } catch {
    return result(
      "READ_FAILED",
      "Fresh lifecycle and simulation evidence could not be read safely.",
      evidence,
    );
  }
  const freshBlock = fresh.snapshot?.blockNumber ?? null;
  evidence = {
    ...evidence,
    revalidationBlock: freshBlock?.toString() ?? null,
    simulationSucceeded: fresh.simulation !== null,
    estimatedGas: fresh.simulation?.gasEstimate?.toString() ?? null,
  };
  if (
    fresh.status !== "INSPECT_VALID" ||
    freshBlock === null ||
    !fresh.simulation ||
    fresh.simulation.gasEstimate === null ||
    fresh.simulation.gasEstimate <= 0n
  ) {
    return result(
      guardedFailureStatus(fresh),
      "Fresh lifecycle revalidation or exact Draw simulation did not pass.",
      evidence,
    );
  }
  if (!exactPlanMatches(fresh, options.durable.logicalDrawKey, storedContext.planId)) {
    return result(
      "CONFLICT",
      "The fresh lifecycle plan does not match durable Draw evidence.",
      evidence,
    );
  }

  let runtimeGasEstimate: bigint;
  let bufferedGasLimit: bigint;
  try {
    runtimeGasEstimate = await estimateExactGuardedDraw({
      operatorAddress: storedContext.operatorAddress,
      poolId: storedContext.poolId,
      roundNumber: storedContext.roundNumber,
    }, options.dependencies);
    bufferedGasLimit = calculateGuardedDrawGasPlan(
      fresh.simulation.gasEstimate,
      runtimeGasEstimate,
    ).gasLimit;
  } catch {
    return result(
      "SAFE_STOP",
      "Fresh Draw gas estimation or buffered gas planning failed.",
      evidence,
    );
  }
  evidence = {
    ...evidence,
    runtimeGasEstimate: runtimeGasEstimate.toString(),
    bufferedGasLimit: bufferedGasLimit.toString(),
  };

  let balance;
  let fees;
  try {
    fees = await options.dependencies.readDrawNativeFeeUpperBounds({
      operatorAddress: storedContext.operatorAddress,
      contractAddress: storedContext.contractAddress,
      poolId: storedContext.poolId,
      roundNumber: storedContext.roundNumber,
      bufferedGasLimit,
    });
    balance = await options.dependencies.readNativeBalance({
      address: storedContext.operatorAddress,
      blockNumber: fees.blockNumber,
    });
  } catch {
    return result(
      "READ_FAILED",
      "Native balance or complete Base fee evidence could not be read safely.",
      evidence,
    );
  }
  if (
    balance.blockNumber !== fees.blockNumber ||
    fees.blockNumber < 0n ||
    balance.nativeBalanceWei < 0n ||
    fees.boundedFeePerGasWei <= 0n ||
    fees.l1UnsignedTransactionSizeBytes <= 0n ||
    fees.l1DataFeeUpperBoundWei < 0n ||
    fees.operatorFeeScalar < 0n ||
    fees.operatorFeeConstantWei < 0n ||
    fees.operatorFeeUpperBoundWei < 0n
  ) {
    return result(
      "READ_FAILED",
      "Balance and complete Base fee evidence is incomplete or not bound to the same observed fee block.",
      evidence,
    );
  }
  const l2ExecutionUpperBoundWei =
    bufferedGasLimit * fees.boundedFeePerGasWei;
  const totalRequiredNativeWei =
    l2ExecutionUpperBoundWei +
    fees.l1DataFeeUpperBoundWei +
    fees.operatorFeeUpperBoundWei;
  evidence = {
    ...evidence,
    balanceBlock: balance.blockNumber.toString(),
    nativeBalanceWei: balance.nativeBalanceWei.toString(),
    feeBlock: fees.blockNumber.toString(),
    boundedFeePerGasWei: fees.boundedFeePerGasWei.toString(),
    l2ExecutionUpperBoundWei: l2ExecutionUpperBoundWei.toString(),
    l1UnsignedTransactionSizeBytes:
      fees.l1UnsignedTransactionSizeBytes.toString(),
    l1DataFeeUpperBoundWei: fees.l1DataFeeUpperBoundWei.toString(),
    operatorFeeScalar: fees.operatorFeeScalar.toString(),
    operatorFeeConstantWei: fees.operatorFeeConstantWei.toString(),
    operatorFeeUpperBoundWei: fees.operatorFeeUpperBoundWei.toString(),
    totalRequiredNativeWei: totalRequiredNativeWei.toString(),
  };
  if (balance.nativeBalanceWei < totalRequiredNativeWei) {
    return result(
      "INSUFFICIENT_NATIVE_BALANCE",
      "The public operator native balance is below the complete bounded Base Draw cost.",
      evidence,
    );
  }

  let finalBlock: bigint;
  let finalRevalidation: GuardedDrawOutcome;
  try {
    finalBlock = await options.dependencies.getLatestBlockNumber();
    if (finalBlock < freshBlock) {
      throw new Error("Latest public block regressed during readiness.");
    }
    finalRevalidation = await simulateAtObservedBlock(
      {
        planJson: options.planJson,
        operatorAddress: storedContext.operatorAddress,
        ...(options.maxPlanAgeSeconds === undefined
          ? {}
          : { maxPlanAgeSeconds: options.maxPlanAgeSeconds }),
      },
      options.dependencies,
      finalBlock,
    );
  } catch {
    return result(
      "READ_FAILED",
      "The final public Draw state could not be revalidated safely.",
      evidence,
    );
  }
  evidence = {
    ...evidence,
    finalRevalidationBlock: finalBlock.toString(),
  };
  if (
    finalRevalidation.status !== "INSPECT_VALID" ||
    finalRevalidation.snapshot?.blockNumber !== finalBlock ||
    !finalRevalidation.simulation ||
    finalRevalidation.simulation.gasEstimate === null ||
    finalRevalidation.simulation.gasEstimate <= 0n
  ) {
    return result(
      guardedFailureStatus(finalRevalidation),
      "The intended Draw is no longer valid at the final observed block.",
      evidence,
    );
  }
  if (!exactPlanMatches(
    finalRevalidation,
    options.durable.logicalDrawKey,
    storedContext.planId,
  )) {
    return result(
      "CONFLICT",
      "The final lifecycle plan does not match durable Draw evidence.",
      evidence,
    );
  }

  const finalConsumer = await createGuardedDrawDurableRuntimeConsumer(
    options.durable,
  )(storedContext);
  if (
    finalConsumer.status !== "CONSUMER_READY" ||
    !finalConsumer.operation ||
    finalConsumer.operation.operationId !== initialOperation.operationId
  ) {
    return result(
      durableFailureStatus(finalConsumer.status),
      "Durable Draw evidence changed during readiness checks.",
      evidence,
    );
  }

  return result(
    "READY_TO_LOAD_SIGNER",
    "The exact Draw is currently ready for a future signer-load boundary only.",
    evidence,
  );
}
