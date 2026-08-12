import {
  encodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import { demoV1Abi } from "../../../../src/demo-v1/abi.js";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
} from "../../../../src/demo-v1/safety.js";
import {
  DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS,
  LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
  invalidLifecycleActionPlanResult,
  parseLifecycleActionPlanJson,
  revalidateLifecycleActionPlan,
  type LifecycleActionPlan,
  type LifecycleRevalidationResult,
} from "./lifecycle-action-plan.js";
import {
  analyzeLifecycleSnapshot,
  type SupervisorReport,
  type SystemSnapshot,
} from "./lifecycle-supervisor.js";

export const GUARDED_DRAW_EXIT_CODES = Object.freeze({
  INSPECT_VALID: 0,
  STALE: 20,
  BLOCKED: 21,
  INCOMPLETE: 22,
  INVALID_PLAN: 23,
  SIMULATION_FAILED: 24,
  MISSING_OPERATOR_ACCOUNT: 25,
  CONFIRMATION_MISMATCH: 26,
  TRANSACTION_SUBMITTED: 27,
  RECEIPT_REVERTED: 28,
  POST_CHECK_FAILED: 29,
  RPC_FAILURE: 30,
});

export const GUARDED_DRAW_GAS_BUFFER_BPS = 2_500n;
const BASIS_POINTS = 10_000n;

export type GuardedDrawMode = "inspect" | "simulate" | "execute";
export type GuardedDrawLifecyclePhase =
  | "PRE_BROADCAST"
  | "BROADCASTED"
  | "RECEIPT_KNOWN"
  | "POSTCHECK_COMPLETE";
export type GuardedDrawPostCheckStatus =
  | "NOT_STARTED"
  | "INCOMPLETE"
  | "PASSED"
  | "FAILED";
export type GuardedDrawOutcomeStatus =
  | "INSPECT_VALID"
  | "STALE"
  | "BLOCKED"
  | "INCOMPLETE"
  | "INVALID_PLAN"
  | "SIMULATION_FAILED"
  | "MISSING_OPERATOR_ACCOUNT"
  | "CONFIRMATION_MISMATCH"
  | "TRANSACTION_SUBMITTED"
  | "RECEIPT_REVERTED"
  | "POST_CHECK_FAILED"
  | "RPC_FAILURE";

export interface GuardedDrawPublicIdentity {
  chainId: bigint;
  contractAddress: string;
  hasBytecode: boolean;
}

export interface GuardedDrawSimulation {
  result: bigint | null;
  gasEstimate: bigint | null;
}

export interface GuardedDrawReceipt {
  transactionHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
}

export interface GuardedDrawExecutionClient {
  chainId: bigint;
  account: Address;
  contractAddress: Address;
  prepareDraw(input: {
    address: Address;
    abi: typeof demoV1Abi;
    functionName: "executeDraw";
    args: readonly [bigint, bigint];
    gasLimit: bigint;
  }): Promise<{
    gasLimit: bigint;
    broadcast(): Promise<Hex>;
  }>;
}

export interface GuardedDrawDependencies {
  readSnapshot(blockNumber?: bigint): Promise<SystemSnapshot>;
  readPublicIdentity(blockNumber: bigint): Promise<GuardedDrawPublicIdentity>;
  getLatestBlockNumber(): Promise<bigint>;
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
  loadExecutionClient?(): Promise<GuardedDrawExecutionClient>;
  waitForReceipt?(transactionHash: Hex): Promise<GuardedDrawReceipt>;
  writeAudit?(record: GuardedDrawAuditRecord): Promise<void>;
}

export interface GuardedDrawConfirmation {
  chainId: string;
  contractAddress: string;
  poolId: string;
  roundNumber: string;
}

export interface GuardedDrawRunOptions {
  planJson: string;
  operatorAddress?: string;
  confirmation?: GuardedDrawConfirmation;
  maxPlanAgeSeconds?: bigint;
}

export interface GuardedDrawPostCheck {
  passed: boolean;
  reason: string;
  blockNumber: string;
  winner: string | null;
  nextAction: string | null;
}

export interface GuardedDrawAuditRecord {
  version: 1;
  recordedAt: string;
  mode: GuardedDrawMode;
  status: GuardedDrawOutcomeStatus;
  chainId: string | null;
  contractAddress: string | null;
  poolId: string | null;
  roundNumber: string | null;
  planId: string | null;
  baseBlockNumber: string | null;
  revalidationBlockNumber: string | null;
  revalidationStatus: string | null;
  simulation: "not-run" | "passed" | "failed";
  calldata: Hex | null;
  gasEstimate: string | null;
  runtimeGasEstimate: string | null;
  requiredGasEstimate: string | null;
  gasLimit: string | null;
  lifecyclePhase: GuardedDrawLifecyclePhase;
  broadcastOccurred: boolean;
  transactionSucceeded: boolean | null;
  transactionHash: Hex | null;
  receiptStatus: "success" | "reverted" | null;
  receiptBlockNumber: string | null;
  postCheckStatus: GuardedDrawPostCheckStatus;
  postCheck: GuardedDrawPostCheck | null;
  message: string;
}

export interface GuardedDrawOutcome {
  mode: GuardedDrawMode;
  status: GuardedDrawOutcomeStatus;
  exitCode: number;
  message: string;
  plan: LifecycleActionPlan | null;
  revalidation: LifecycleRevalidationResult;
  snapshot: SystemSnapshot | null;
  report: SupervisorReport | null;
  calldata: Hex | null;
  simulation: GuardedDrawSimulation | null;
  runtimeGasEstimate: bigint | null;
  requiredGasEstimate: bigint | null;
  gasLimit: bigint | null;
  lifecyclePhase: GuardedDrawLifecyclePhase;
  broadcastOccurred: boolean;
  transactionSucceeded: boolean | null;
  transactionHash: Hex | null;
  receipt: GuardedDrawReceipt | null;
  postCheckStatus: GuardedDrawPostCheckStatus;
  postCheck: GuardedDrawPostCheck | null;
}

class GuardedDrawStop extends Error {
  override readonly name = "GuardedDrawStop";

  constructor(
    readonly status: GuardedDrawOutcomeStatus,
    message: string,
    readonly outcome?: Partial<GuardedDrawOutcome>,
  ) {
    super(message);
  }
}

export interface GuardedDrawGasPlan {
  preflightEstimate: bigint;
  runtimeEstimate: bigint;
  requiredEstimate: bigint;
  gasLimit: bigint;
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

function statusFromRevalidation(
  status: LifecycleRevalidationResult["status"],
): GuardedDrawOutcomeStatus {
  return status === "VALID" ? "INSPECT_VALID" : status;
}

function emptyRevalidation(message: string): LifecycleRevalidationResult {
  return invalidLifecycleActionPlanResult([message]);
}

function requireCanonicalIdentity(plan: LifecycleActionPlan): void {
  if (plan.identity.chainId !== String(DEMO_V1_CHAIN_ID)) {
    throw new GuardedDrawStop("BLOCKED", "Plan chain ID must be Base Sepolia (84532).");
  }
  if (
    !isAddress(plan.identity.contractAddress) ||
    getAddress(plan.identity.contractAddress) !== DEMO_V1_CONTRACT_ADDRESS
  ) {
    throw new GuardedDrawStop(
      "BLOCKED",
      "Plan contract must be the canonical Demo V1 contract.",
    );
  }
  if (
    plan.identity.contractInterface !==
      LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE
  ) {
    throw new GuardedDrawStop("BLOCKED", "Plan contract interface is not supported.");
  }
}

function drawScopeError(plan: LifecycleActionPlan): string | null {
  if (
    plan.scope.classification !== "actionable" ||
    plan.scope.plannedAction !== "DRAW"
  ) {
    return "Only an actionable DRAW plan can be used.";
  }
  if (plan.scope.roundNumber === null) {
    return "Draw plan has no round number.";
  }
  if (BigInt(plan.scope.poolId) <= 0n || BigInt(plan.scope.roundNumber) <= 0n) {
    return "Pool ID and round number must be positive.";
  }
  return null;
}

function requireOperatorAddress(value: string | undefined): Address {
  if (!value) {
    throw new GuardedDrawStop(
      "MISSING_OPERATOR_ACCOUNT",
      "A public operator address is required for Draw simulation.",
    );
  }
  if (!isAddress(value)) {
    throw new GuardedDrawStop(
      "MISSING_OPERATOR_ACCOUNT",
      "The public operator address is invalid.",
    );
  }
  return getAddress(value);
}

function requireConfirmations(
  plan: LifecycleActionPlan,
  confirmation: GuardedDrawConfirmation | undefined,
): void {
  if (!confirmation) {
    throw new GuardedDrawStop(
      "CONFIRMATION_MISMATCH",
      "Execute requires exact chain, contract, pool, and round confirmations.",
    );
  }
  const matches =
    confirmation.chainId === plan.identity.chainId &&
    isAddress(confirmation.contractAddress) &&
    getAddress(confirmation.contractAddress) ===
      getAddress(plan.identity.contractAddress) &&
    confirmation.poolId === plan.scope.poolId &&
    confirmation.roundNumber === plan.scope.roundNumber;
  if (!matches) {
    throw new GuardedDrawStop(
      "CONFIRMATION_MISMATCH",
      "Execute confirmation does not exactly match the approved plan scope.",
    );
  }
}

function requirePublicIdentity(identity: GuardedDrawPublicIdentity): void {
  if (identity.chainId !== BigInt(DEMO_V1_CHAIN_ID)) {
    throw new GuardedDrawStop("BLOCKED", "Public client is not on Base Sepolia.");
  }
  if (
    !isAddress(identity.contractAddress) ||
    getAddress(identity.contractAddress) !== DEMO_V1_CONTRACT_ADDRESS
  ) {
    throw new GuardedDrawStop(
      "BLOCKED",
      "Public client is not bound to the canonical Demo V1 contract.",
    );
  }
  if (!identity.hasBytecode) {
    throw new GuardedDrawStop(
      "BLOCKED",
      "Canonical Demo V1 contract bytecode is missing.",
    );
  }
}

function argsFor(plan: LifecycleActionPlan): readonly [bigint, bigint] {
  return [BigInt(plan.scope.poolId), BigInt(plan.scope.roundNumber as string)];
}

function calldataFor(plan: LifecycleActionPlan): Hex {
  return encodeFunctionData({
    abi: demoV1Abi,
    functionName: "executeDraw",
    args: argsFor(plan),
  });
}

function baseOutcome(
  mode: GuardedDrawMode,
  status: GuardedDrawOutcomeStatus,
  message: string,
  partial: Partial<GuardedDrawOutcome> = {},
): GuardedDrawOutcome {
  const transactionHash = partial.transactionHash ?? null;
  const receipt = partial.receipt ?? null;
  return {
    ...partial,
    mode,
    status,
    exitCode: GUARDED_DRAW_EXIT_CODES[status],
    message,
    plan: partial.plan ?? null,
    revalidation: partial.revalidation ?? emptyRevalidation(message),
    snapshot: partial.snapshot ?? null,
    report: partial.report ?? null,
    calldata: partial.calldata ?? null,
    simulation: partial.simulation ?? null,
    runtimeGasEstimate: partial.runtimeGasEstimate ?? null,
    requiredGasEstimate: partial.requiredGasEstimate ?? null,
    gasLimit: partial.gasLimit ?? null,
    lifecyclePhase: partial.lifecyclePhase ?? "PRE_BROADCAST",
    broadcastOccurred:
      partial.broadcastOccurred ?? transactionHash !== null,
    transactionSucceeded: partial.transactionSucceeded ?? (
      receipt ? receipt.status === "success" : null
    ),
    transactionHash,
    receipt,
    postCheckStatus: partial.postCheckStatus ?? "NOT_STARTED",
    postCheck: partial.postCheck ?? null,
  };
}

function auditRecord(outcome: GuardedDrawOutcome): GuardedDrawAuditRecord {
  const plan = outcome.plan;
  return {
    version: 1,
    recordedAt: new Date().toISOString(),
    mode: outcome.mode,
    status: outcome.status,
    chainId: plan?.identity.chainId ?? null,
    contractAddress: plan?.identity.contractAddress ?? null,
    poolId: plan?.scope.poolId ?? null,
    roundNumber: plan?.scope.roundNumber ?? null,
    planId: plan?.planId ?? null,
    baseBlockNumber: plan?.identity.baseBlockNumber ?? null,
    revalidationBlockNumber: outcome.revalidation.freshBlockNumber,
    revalidationStatus: outcome.revalidation.status,
    simulation: outcome.simulation
      ? "passed"
      : outcome.status === "SIMULATION_FAILED"
        ? "failed"
        : "not-run",
    calldata: outcome.calldata,
    gasEstimate: outcome.simulation?.gasEstimate?.toString() ?? null,
    runtimeGasEstimate: outcome.runtimeGasEstimate?.toString() ?? null,
    requiredGasEstimate: outcome.requiredGasEstimate?.toString() ?? null,
    gasLimit: outcome.gasLimit?.toString() ?? null,
    lifecyclePhase: outcome.lifecyclePhase,
    broadcastOccurred: outcome.broadcastOccurred,
    transactionSucceeded: outcome.transactionSucceeded,
    transactionHash: outcome.transactionHash,
    receiptStatus: outcome.receipt?.status ?? null,
    receiptBlockNumber: outcome.receipt?.blockNumber.toString() ?? null,
    postCheckStatus: outcome.postCheckStatus,
    postCheck: outcome.postCheck,
    message: outcome.message,
  };
}

async function audit(
  dependencies: GuardedDrawDependencies,
  outcome: GuardedDrawOutcome,
): Promise<void> {
  await dependencies.writeAudit?.(auditRecord(outcome));
}

async function inspectInternal(
  mode: GuardedDrawMode,
  options: GuardedDrawRunOptions,
  dependencies: GuardedDrawDependencies,
): Promise<GuardedDrawOutcome> {
  const parsed = parseLifecycleActionPlanJson(options.planJson);
  if (!parsed.ok) {
    return baseOutcome(
      mode,
      "INVALID_PLAN",
      "Lifecycle action plan is invalid.",
      { revalidation: invalidLifecycleActionPlanResult(parsed.errors) },
    );
  }
  const plan = parsed.plan;
  requireCanonicalIdentity(plan);
  const snapshot = await dependencies.readSnapshot();
  const report = analyzeLifecycleSnapshot(snapshot);
  const revalidation = revalidateLifecycleActionPlan(plan, snapshot, report, {
    maxPlanAgeSeconds:
      options.maxPlanAgeSeconds ?? DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS,
    freshSourceReference: plan.source.reference,
  });
  const status = statusFromRevalidation(revalidation.status);
  const scopeError = revalidation.status === "VALID"
    ? drawScopeError(plan)
    : null;
  if (scopeError) {
    return baseOutcome(
      mode,
      "BLOCKED",
      scopeError,
      { plan, snapshot, report, revalidation },
    );
  }
  return baseOutcome(
    mode,
    status,
    revalidation.decision,
    { plan, snapshot, report, revalidation },
  );
}

async function simulateInternal(
  mode: GuardedDrawMode,
  options: GuardedDrawRunOptions,
  dependencies: GuardedDrawDependencies,
): Promise<GuardedDrawOutcome> {
  const inspected = await inspectInternal(mode, options, dependencies);
  if (inspected.status !== "INSPECT_VALID") return inspected;
  const plan = inspected.plan as LifecycleActionPlan;
  const snapshot = inspected.snapshot as SystemSnapshot;
  const blockNumber = snapshot.blockNumber;
  if (blockNumber === null) {
    throw new GuardedDrawStop("INCOMPLETE", "Revalidation has no block number.", {
      ...inspected,
    });
  }
  const operatorAddress = requireOperatorAddress(options.operatorAddress);
  requirePublicIdentity(await dependencies.readPublicIdentity(blockNumber));
  const calldata = calldataFor(plan);
  try {
    const simulation = await dependencies.simulateDraw({
      account: operatorAddress,
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "executeDraw",
      args: argsFor(plan),
      blockNumber,
    });
    return {
      ...inspected,
      mode,
      calldata,
      simulation,
      message:
        "Simulation passed. This is not a guarantee that a later transaction will succeed.",
    };
  } catch (error) {
    throw new GuardedDrawStop(
      "SIMULATION_FAILED",
      `Draw simulation failed: ${sanitizeGuardedDrawError(error)}`,
      { ...inspected, calldata },
    );
  }
}

export async function inspectGuardedSingleDraw(
  options: GuardedDrawRunOptions,
  dependencies: GuardedDrawDependencies,
): Promise<GuardedDrawOutcome> {
  return runGuarded("inspect", () =>
    inspectInternal("inspect", options, dependencies), dependencies);
}

export async function simulateGuardedSingleDraw(
  options: GuardedDrawRunOptions,
  dependencies: GuardedDrawDependencies,
): Promise<GuardedDrawOutcome> {
  return runGuarded("simulate", () =>
    simulateInternal("simulate", options, dependencies), dependencies);
}

function validatePostCheck(
  plan: LifecycleActionPlan,
  before: SystemSnapshot,
  after: SystemSnapshot,
  report: SupervisorReport,
  receiptBlock: bigint,
): GuardedDrawPostCheck {
  const poolId = BigInt(plan.scope.poolId);
  const roundNumber = BigInt(plan.scope.roundNumber as string);
  const oldPool = before.pools.find((pool) => pool.poolId === poolId);
  const pool = after.pools.find((candidate) => candidate.poolId === poolId);
  const round = pool?.rounds.find((candidate) => candidate.number === roundNumber);
  const next = report.plans.find((candidate) => candidate.poolId === poolId);
  const reasons: string[] = [];
  if (after.blockNumber === null || after.blockNumber < receiptBlock) {
    reasons.push("post-check snapshot predates the receipt");
  }
  if (!oldPool || !pool || !round) reasons.push("planned pool or round is missing");
  if (round?.status !== "Finalized" || !round.winningPositionId) {
    reasons.push("planned round is not finalized with a winner");
  }
  if (
    oldPool?.completedDrawRoundCount === undefined ||
    pool?.completedDrawRoundCount !== oldPool.completedDrawRoundCount + 1n
  ) {
    reasons.push("completed draw counter did not increase by exactly one");
  }
  if (next?.nextRoundNumber === roundNumber && next.nextAction.includes("DRAW")) {
    reasons.push("supervisor recommends the same Draw again");
  }
  if (
    report.systemDiagnostics.length > 0 ||
    (next?.diagnostics.length ?? 0) > 0 ||
    next?.severity === "critical"
  ) {
    reasons.push("supervisor reported a critical or inconsistent post-state");
  }
  return {
    passed: reasons.length === 0,
    reason: reasons.length === 0
      ? "Receipt and lifecycle post-state match one completed Draw."
      : reasons.join("; "),
    blockNumber: after.blockNumber?.toString() ?? "unknown",
    winner: round?.winner ?? null,
    nextAction: next?.nextAction ?? null,
  };
}

export async function executeGuardedSingleDraw(
  options: GuardedDrawRunOptions,
  dependencies: GuardedDrawDependencies,
): Promise<GuardedDrawOutcome> {
  return runGuarded("execute", async (preserveEvidence) => {
    const first = await inspectInternal("execute", options, dependencies);
    if (first.status !== "INSPECT_VALID") return first;
    const plan = first.plan as LifecycleActionPlan;
    requireConfirmations(plan, options.confirmation);
    let current = await simulateInternal("execute", options, dependencies);
    const firstBlock = (current.snapshot as SystemSnapshot).blockNumber as bigint;
    const latestBlock = await dependencies.getLatestBlockNumber();
    if (latestBlock < firstBlock) {
      throw new GuardedDrawStop("BLOCKED", "Latest public block regressed.", current);
    }
    if (latestBlock > firstBlock) {
      current = await inspectInternal("execute", options, {
        ...dependencies,
        readSnapshot: () => dependencies.readSnapshot(latestBlock),
      });
      if (current.status !== "INSPECT_VALID") return current;
      const operatorAddress = requireOperatorAddress(options.operatorAddress);
      requirePublicIdentity(await dependencies.readPublicIdentity(latestBlock));
      try {
        current = {
          ...current,
          calldata: calldataFor(plan),
          simulation: await dependencies.simulateDraw({
            account: operatorAddress,
            address: DEMO_V1_CONTRACT_ADDRESS,
            abi: demoV1Abi,
            functionName: "executeDraw",
            args: argsFor(plan),
            blockNumber: latestBlock,
          }),
        };
      } catch (error) {
        throw new GuardedDrawStop(
          "SIMULATION_FAILED",
          `Final Draw simulation failed: ${sanitizeGuardedDrawError(error)}`,
          current,
        );
      }
    }
    if (!dependencies.loadExecutionClient || !dependencies.waitForReceipt) {
      throw new GuardedDrawStop(
        "MISSING_OPERATOR_ACCOUNT",
        "Execute dependencies are not configured.",
        current,
      );
    }
    const operatorAddress = requireOperatorAddress(options.operatorAddress);
    const preflightEstimate = current.simulation?.gasEstimate;
    if (preflightEstimate === null || preflightEstimate === undefined) {
      throw new GuardedDrawStop(
        "SIMULATION_FAILED",
        "Draw execution requires a positive preflight gas estimate.",
        current,
      );
    }
    let runtimeEstimate: bigint;
    try {
      runtimeEstimate = await dependencies.estimateDraw({
        account: operatorAddress,
        address: DEMO_V1_CONTRACT_ADDRESS,
        abi: demoV1Abi,
        functionName: "executeDraw",
        args: argsFor(plan),
      });
    } catch (error) {
      throw new GuardedDrawStop(
        "SIMULATION_FAILED",
        `Final gas estimation failed: ${sanitizeGuardedDrawError(error)}`,
        current,
      );
    }
    let gasPlan: GuardedDrawGasPlan;
    try {
      gasPlan = calculateGuardedDrawGasPlan(preflightEstimate, runtimeEstimate);
    } catch (error) {
      throw new GuardedDrawStop(
        "SIMULATION_FAILED",
        `Invalid Draw gas estimate: ${sanitizeGuardedDrawError(error)}`,
        current,
      );
    }
    current = {
      ...current,
      runtimeGasEstimate: gasPlan.runtimeEstimate,
      requiredGasEstimate: gasPlan.requiredEstimate,
      gasLimit: gasPlan.gasLimit,
    };

    const execution = await dependencies.loadExecutionClient();
    if (
      execution.chainId !== BigInt(DEMO_V1_CHAIN_ID) ||
      execution.account !== operatorAddress ||
      execution.contractAddress !== DEMO_V1_CONTRACT_ADDRESS
    ) {
      throw new GuardedDrawStop(
        "MISSING_OPERATOR_ACCOUNT",
        "Execution client identity does not match Base Sepolia, the public operator account, and the canonical contract.",
        current,
      );
    }

    const prepared = await execution.prepareDraw({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "executeDraw",
      args: argsFor(plan),
      gasLimit: gasPlan.gasLimit,
    });
    if (prepared.gasLimit < gasPlan.gasLimit) {
      throw new GuardedDrawStop(
        "BLOCKED",
        `Final gas limit ${prepared.gasLimit} is below the required buffered limit ${gasPlan.gasLimit}; transaction was not signed or broadcast.`,
        { ...current, gasLimit: prepared.gasLimit },
      );
    }
    current = { ...current, gasLimit: prepared.gasLimit };
    const transactionHash = await prepared.broadcast();
    current = {
      ...current,
      status: "TRANSACTION_SUBMITTED",
      exitCode: GUARDED_DRAW_EXIT_CODES.TRANSACTION_SUBMITTED,
      lifecyclePhase: "BROADCASTED",
      broadcastOccurred: true,
      transactionHash,
      message:
        "One Draw transaction was submitted. It will never be resent automatically.",
    };
    preserveEvidence(current);
    try {
      await audit(dependencies, current);
    } catch (error) {
      return {
        ...current,
        message:
          `Transaction hash could not be persisted; do not resend and verify it manually: ${sanitizeGuardedDrawError(error)}`,
      };
    }

    let receipt: GuardedDrawReceipt;
    try {
      receipt = await dependencies.waitForReceipt(transactionHash);
    } catch (error) {
      return {
        ...current,
        message:
          `Receipt lookup failed after broadcast; transaction outcome is unknown. Preserve the hash, do not retry, and verify it manually: ${sanitizeGuardedDrawError(error)}`,
      };
    }
    current = {
      ...current,
      lifecyclePhase: "RECEIPT_KNOWN",
      transactionSucceeded: receipt.status === "success",
      receipt,
    };
    preserveEvidence(current);
    if (receipt.status !== "success") {
      return {
        ...current,
        status: "RECEIPT_REVERTED",
        exitCode: GUARDED_DRAW_EXIT_CODES.RECEIPT_REVERTED,
        message: "Draw receipt is reverted. No resend is allowed.",
      };
    }
    const postSnapshot = await dependencies.readSnapshot(receipt.blockNumber);
    const postReport = analyzeLifecycleSnapshot(postSnapshot);
    const postCheck = validatePostCheck(
      plan,
      current.snapshot as SystemSnapshot,
      postSnapshot,
      postReport,
      receipt.blockNumber,
    );
    return {
      ...current,
      snapshot: postSnapshot,
      report: postReport,
      postCheck,
      lifecyclePhase: "POSTCHECK_COMPLETE",
      postCheckStatus: postCheck.passed ? "PASSED" : "FAILED",
      status: postCheck.passed ? "TRANSACTION_SUBMITTED" : "POST_CHECK_FAILED",
      exitCode: postCheck.passed
        ? GUARDED_DRAW_EXIT_CODES.TRANSACTION_SUBMITTED
        : GUARDED_DRAW_EXIT_CODES.POST_CHECK_FAILED,
      message: postCheck.reason,
    };
  }, dependencies);
}

async function runGuarded(
  mode: GuardedDrawMode,
  operation: (
    preserveEvidence: (outcome: GuardedDrawOutcome) => void,
  ) => Promise<GuardedDrawOutcome>,
  dependencies: GuardedDrawDependencies,
): Promise<GuardedDrawOutcome> {
  let outcome: GuardedDrawOutcome;
  let preservedEvidence: GuardedDrawOutcome | null = null;
  try {
    outcome = await operation((current) => {
      preservedEvidence = current;
    });
  } catch (error) {
    const evidence = preservedEvidence as GuardedDrawOutcome | null;
    if (evidence?.transactionHash) {
      if (evidence.receipt?.status === "success") {
        outcome = baseOutcome(
          mode,
          "POST_CHECK_FAILED",
          `Transaction succeeded, but the read-only post-check is incomplete: ${sanitizeGuardedDrawError(error)} Do not retry the transaction; retry only the read-only post-check.`,
          {
            ...evidence,
            lifecyclePhase: "RECEIPT_KNOWN",
            broadcastOccurred: true,
            transactionSucceeded: true,
            postCheckStatus: "INCOMPLETE",
          },
        );
      } else if (evidence.receipt?.status === "reverted") {
        outcome = baseOutcome(
          mode,
          "RECEIPT_REVERTED",
          "Draw receipt is reverted. No resend is allowed.",
          evidence,
        );
      } else {
        outcome = baseOutcome(
          mode,
          "TRANSACTION_SUBMITTED",
          `Transaction was broadcast, but its receipt is unknown: ${sanitizeGuardedDrawError(error)} Preserve the hash and do not retry the transaction.`,
          {
            ...evidence,
            lifecyclePhase: "BROADCASTED",
            broadcastOccurred: true,
            transactionSucceeded: null,
            postCheckStatus: "NOT_STARTED",
          },
        );
      }
    } else if (error instanceof GuardedDrawStop) {
      outcome = baseOutcome(mode, error.status, error.message, error.outcome);
    } else {
      outcome = baseOutcome(
        mode,
        "RPC_FAILURE",
        `Guarded Draw stopped: ${sanitizeGuardedDrawError(error)}`,
      );
    }
  }
  try {
    await audit(dependencies, outcome);
  } catch (error) {
    if (outcome.transactionHash) {
      return {
        ...outcome,
        message:
          `${outcome.message} Audit update failed; preserve the transaction hash and do not resend: ${sanitizeGuardedDrawError(error)}`,
      };
    }
    return baseOutcome(
      mode,
      "RPC_FAILURE",
      `Guarded Draw audit write failed: ${sanitizeGuardedDrawError(error)}`,
      outcome,
    );
  }
  return outcome;
}

export function sanitizeGuardedDrawError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s/]+\/[^\s]+/gi, "[redacted RPC URL]")
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, "[redacted 32-byte value]")
    .replace(/\b(?:private|secret|mnemonic|password|api.?key)\b\s*[:=]\s*\S+/gi, "[redacted secret]");
}

export function renderGuardedDrawJson(outcome: GuardedDrawOutcome): string {
  return JSON.stringify(
    outcome,
    (_, value: unknown) => typeof value === "bigint" ? value.toString() : value,
    2,
  );
}

export function renderGuardedDrawText(outcome: GuardedDrawOutcome): string {
  const plan = outcome.plan;
  return [
    "POP33 GUARDED SINGLE-DRAW OPERATOR",
    `MODE: ${outcome.mode.toUpperCase()}`,
    `NETWORK: Base Sepolia (${plan?.identity.chainId ?? "-"})`,
    `CONTRACT: ${plan?.identity.contractAddress ?? "-"}`,
    `POOL: ${plan?.scope.poolId ?? "-"}`,
    `ROUND: ${plan?.scope.roundNumber ?? "-"}`,
    "ACTION: DRAW",
    `PLAN STATUS: ${outcome.revalidation.status}`,
    `REVALIDATION BLOCK: ${outcome.revalidation.freshBlockNumber ?? "-"}`,
    `SIMULATION: ${outcome.simulation ? "PASSED (not a guarantee)" : "NOT PASSED"}`,
    `GAS ESTIMATE: ${outcome.simulation?.gasEstimate?.toString() ?? "-"}`,
    `RUNTIME GAS ESTIMATE: ${outcome.runtimeGasEstimate?.toString() ?? "-"}`,
    `REQUIRED GAS ESTIMATE: ${outcome.requiredGasEstimate?.toString() ?? "-"}`,
    `FINAL GAS LIMIT: ${outcome.gasLimit?.toString() ?? "-"}`,
    `LIFECYCLE PHASE: ${outcome.lifecyclePhase}`,
    `BROADCAST OCCURRED: ${outcome.broadcastOccurred ? "YES" : "NO"}`,
    `TRANSACTION SUCCEEDED: ${outcome.transactionSucceeded === null ? "UNKNOWN" : outcome.transactionSucceeded ? "YES" : "NO"}`,
    `TX HASH: ${outcome.transactionHash ?? "-"}`,
    `POST-CHECK STATUS: ${outcome.postCheckStatus}`,
    `RESULT: ${outcome.status}`,
    outcome.message,
  ].join("\n");
}
