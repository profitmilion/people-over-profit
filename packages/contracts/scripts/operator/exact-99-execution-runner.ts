import { getAddress } from "ethers";

import { DEMO_V1_PARAMETERS } from "../lib/demo-v1-config.js";
import type { EncryptedWalletStoreInspection } from "./encrypted-wallet-store.js";
import {
  EXACT_99_COORDINATOR_MODES,
  EXACT_99_COORDINATOR_OPERATIONS,
  EXACT_99_COORDINATOR_RANGES,
  exact99CoordinatorOperationId,
  inspectExact99AccumulationCoordinator,
  planExact99AccumulationCoordinator,
  simulateExact99AccumulationCoordinator,
  type Exact99CoordinatorCheckpointId,
  type Exact99CoordinatorInspection,
  type Exact99CoordinatorOperation,
  type Exact99CoordinatorPlan,
  type Exact99CoordinatorSimulationOutcome,
} from "./exact-99-accumulation-coordinator.js";
import type {
  Exact99Checkpoint,
  Exact99Journal,
  Exact99Manifest,
} from "./exact-99-operator-artifacts.js";
import {
  validateExact99FundingPlan,
  type Exact99FundingPlan,
  type Exact99FundingPlanOperation,
} from "./exact-99-funding.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const EXACT_99_RUNNER_MODES = ["plan", "inspect", "simulate"] as const;
export type Exact99RunnerMode = (typeof EXACT_99_RUNNER_MODES)[number];

export interface Exact99RunnerIdentity {
  checkpoint: Exact99CoordinatorCheckpointId;
  walletIndex: number;
  walletAddress: string;
  operation: Exact99CoordinatorOperation;
  operationId: string;
}

export interface Exact99RunnerPoolSnapshot {
  poolId: string;
  cycleId: string;
  status: "Open" | "Locked";
  activePositionCount: number;
  expectedNextPositionIndex: number;
  locked: boolean;
  lockedAt: string | null;
}

export interface Exact99RunnerOperationPreflight {
  identity: Exact99RunnerIdentity;
  joinPool?: Exact99RunnerPoolSnapshot;
}

export interface Exact99RunnerReceipt {
  transactionHash: string;
  blockNumber: number;
  status: 0 | 1;
  gasUsed: string;
}

export type Exact99RunnerReconciliation =
  | {
      type: "funding";
      walletAddress: string;
      amountWei: string;
      nativeBalanceBeforeWei: string;
      nativeBalanceAfterWei: string;
    }
  | {
      type: "faucet";
      walletAddress: string;
      operationId: string;
      tokenBalanceBefore: string;
      tokenBalanceAfter: string;
      receivedAmount: string;
    }
  | {
      type: "approve";
      walletAddress: string;
      operationId: string;
      tokenAddress: string;
      spenderAddress: string;
      allowance: string;
    }
  | {
      type: "join";
      walletAddress: string;
      operationId: string;
      poolBefore: Exact99RunnerPoolSnapshot;
      poolAfter: Exact99RunnerPoolSnapshot;
      positionId: string;
      positionOwner: string;
      positionPoolId: string;
      activePositionCountForWallet: number;
      runnerJoinCountBefore: number;
      runnerJoinCountAfter: number;
    };

interface AdapterResultBase {
  identity: Exact99RunnerIdentity;
  prepared: boolean;
  submitted: boolean;
}

export type Exact99RunnerAdapterResult =
  | (AdapterResultBase & {
      type: "confirmed";
      transactionHash: string;
      receipt: Exact99RunnerReceipt;
      reconciliation: Exact99RunnerReconciliation;
    })
  | (AdapterResultBase & {
      type: "failed";
      transactionHash?: string;
      error: string;
    })
  | (AdapterResultBase & {
      type: "timeout-before-hash";
      error: string;
    })
  | (AdapterResultBase & {
      type: "timeout-after-hash";
      transactionHash: string;
      error: string;
    })
  | (AdapterResultBase & {
      type: "pending";
      transactionHash: string;
      error: string;
    })
  | (AdapterResultBase & {
      type: "ambiguous";
      transactionHash?: string;
      error: string;
    })
  | (AdapterResultBase & {
      type: "manual-review";
      transactionHash?: string;
      error: string;
    });

export interface Exact99RunnerOperationAdapter {
  inspect(request: Exact99RunnerIdentity): Promise<Exact99RunnerOperationPreflight>;
  run(
    request: Exact99RunnerIdentity,
    preflight: Exact99RunnerOperationPreflight,
  ): Promise<Exact99RunnerAdapterResult>;
}

export class FixtureExact99RunnerAdapter implements Exact99RunnerOperationAdapter {
  readonly calls: Array<{ phase: "inspect" | "run"; identity: Exact99RunnerIdentity }> = [];

  constructor(
    private readonly inspectFixture: (
      request: Exact99RunnerIdentity,
    ) => Exact99RunnerOperationPreflight | Promise<Exact99RunnerOperationPreflight>,
    private readonly runFixture: (
      request: Exact99RunnerIdentity,
      preflight: Exact99RunnerOperationPreflight,
    ) => Exact99RunnerAdapterResult | Promise<Exact99RunnerAdapterResult>,
  ) {}

  async inspect(request: Exact99RunnerIdentity): Promise<Exact99RunnerOperationPreflight> {
    this.calls.push({ phase: "inspect", identity: structuredClone(request) });
    return this.inspectFixture(structuredClone(request));
  }

  async run(
    request: Exact99RunnerIdentity,
    preflight: Exact99RunnerOperationPreflight,
  ): Promise<Exact99RunnerAdapterResult> {
    this.calls.push({ phase: "run", identity: structuredClone(request) });
    return this.runFixture(structuredClone(request), structuredClone(preflight));
  }
}

export interface Exact99RunnerArtifacts {
  store: EncryptedWalletStoreInspection;
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  fundingPlan: Exact99FundingPlan;
}

export interface Exact99RunnerInspection {
  profile: "exact-99-execution-runner";
  mode: "inspect";
  readOnly: true;
  fixtureOnly: true;
  coordinator: Exact99CoordinatorInspection;
  currentCheckpoint: Exact99CoordinatorCheckpointId | null;
  currentRange: { startIndex: number; endIndex: number } | null;
  nextWalletIndex: number | null;
  nextOperation: Exact99CoordinatorOperation | null;
  completedWalletCount: number;
  blockers: string[];
  readyForSimulation: boolean;
}

export type Exact99RunnerPlan = Omit<Exact99RunnerInspection, "mode"> & {
  mode: "plan";
};

export interface Exact99RunnerStepResult {
  profile: "exact-99-execution-runner";
  mode: "simulate";
  fixtureOnly: true;
  stopped: boolean;
  stopReason: string | null;
  processedOperations: number;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  inspection: Exact99RunnerInspection;
}

export interface Exact99RunnerSimulationResult extends Exact99RunnerStepResult {
  completedCheckpoint: Exact99CoordinatorCheckpointId | null;
  adapterCalls: number;
}

const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;

function sanitizeRunnerError(error: unknown): string {
  const raw = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Runner fixture operation failed.";
  const valuesRemoved = raw.replace(
    /\b(private.?key|mnemonic|seed phrase|password|passphrase)\s*[:=]\s*[^\s,;]+/gi,
    "[redacted-field]=[redacted]",
  );
  return sanitizeOperatorError(valuesRemoved)
    .replace(/\bprivate.?key\b|\bmnemonic\b|\bseed phrase\b|\bpassword\b|\bpassphrase\b/gi, "[redacted-field]")
    .slice(0, 500);
}

export function assertExact99RunnerMode(value: string): asserts value is Exact99RunnerMode {
  if (!EXACT_99_RUNNER_MODES.includes(value as Exact99RunnerMode)) {
    throw new Error("Exact-99 runner mode must be plan, inspect, or simulate.");
  }
}

function runnerInspection(
  coordinator: Exact99CoordinatorInspection,
  mode: "inspect",
): Exact99RunnerInspection {
  return {
    profile: "exact-99-execution-runner",
    mode,
    readOnly: true,
    fixtureOnly: true,
    coordinator,
    currentCheckpoint: coordinator.currentCheckpoint,
    currentRange: coordinator.currentRange,
    nextWalletIndex: coordinator.nextOperation?.walletIndex ?? null,
    nextOperation: coordinator.nextOperation?.operation ?? null,
    completedWalletCount: coordinator.lastCompletedIndex === null
      ? 0
      : coordinator.lastCompletedIndex + 1,
    blockers: coordinator.blockers,
    readyForSimulation: coordinator.readyForSimulation,
  };
}

export function inspectExact99ExecutionRunner(
  input: Exact99RunnerArtifacts,
): Exact99RunnerInspection {
  return runnerInspection(inspectExact99AccumulationCoordinator(input), "inspect");
}

export function planExact99ExecutionRunner(
  input: Exact99RunnerArtifacts,
): Exact99RunnerPlan {
  const coordinatorPlan: Exact99CoordinatorPlan = planExact99AccumulationCoordinator(input);
  return {
    ...runnerInspection({ ...coordinatorPlan, mode: "inspect" }, "inspect"),
    mode: "plan",
  };
}

function requireIdentity(
  actual: Exact99RunnerIdentity,
  expected: Exact99RunnerIdentity,
  label: string,
): void {
  if (
    actual.checkpoint !== expected.checkpoint ||
    actual.walletIndex !== expected.walletIndex ||
    getAddress(actual.walletAddress) !== getAddress(expected.walletAddress) ||
    actual.operation !== expected.operation ||
    actual.operationId !== expected.operationId
  ) {
    throw new Error(`${label} identity does not match the manifest-bound runner operation.`);
  }
}

function decimal(value: string, label: string): bigint {
  if (!DECIMAL.test(value)) throw new Error(`${label} must be a canonical decimal integer.`);
  return BigInt(value);
}

function requireReceipt(result: Extract<Exact99RunnerAdapterResult, { type: "confirmed" }>): void {
  if (
    !TRANSACTION_HASH.test(result.transactionHash) ||
    result.receipt.transactionHash.toLowerCase() !== result.transactionHash.toLowerCase() ||
    !Number.isSafeInteger(result.receipt.blockNumber) ||
    result.receipt.blockNumber < 1 ||
    result.receipt.status !== 1 ||
    !DECIMAL.test(result.receipt.gasUsed)
  ) {
    throw new Error("Fixture receipt is not successful or does not match the submitted transaction.");
  }
  if (!result.prepared || !result.submitted) {
    throw new Error("Confirmed fixture result must record preparation and submission.");
  }
}

function fundingOperation(
  plan: Exact99FundingPlan,
  walletIndex: number,
): Exact99FundingPlanOperation {
  const operation = plan.operations[walletIndex];
  if (!operation || operation.index !== walletIndex) {
    throw new Error("Funding plan does not contain the expected wallet index.");
  }
  return operation;
}

function requirePoolSnapshot(snapshot: Exact99RunnerPoolSnapshot, label: string): void {
  if (
    !snapshot.poolId ||
    !snapshot.cycleId ||
    !Number.isSafeInteger(snapshot.activePositionCount) ||
    snapshot.activePositionCount < 0 ||
    snapshot.activePositionCount > 100 ||
    !Number.isSafeInteger(snapshot.expectedNextPositionIndex) ||
    snapshot.expectedNextPositionIndex < 1 ||
    (snapshot.lockedAt !== null &&
      (Number.isNaN(Date.parse(snapshot.lockedAt)) ||
       new Date(snapshot.lockedAt).toISOString() !== snapshot.lockedAt))
  ) {
    throw new Error(`${label} pool snapshot is invalid.`);
  }
  if (
    snapshot.status === "Open" &&
    (snapshot.locked || snapshot.lockedAt !== null)
  ) {
    throw new Error(`${label} Open pool cannot be locked or have lockedAt.`);
  }
  if (
    snapshot.status === "Locked" &&
    (!snapshot.locked || snapshot.lockedAt === null)
  ) {
    throw new Error(`${label} Locked pool requires lockedAt.`);
  }
}

function requireJoinPreflight(
  preflight: Exact99RunnerOperationPreflight,
  checkpoint: Exact99Checkpoint,
): Exact99RunnerPoolSnapshot {
  if (!preflight.joinPool) throw new Error("Join fixture preflight requires a pool snapshot.");
  const pool = preflight.joinPool;
  requirePoolSnapshot(pool, "Pre-join");
  if (
    pool.status !== "Open" ||
    pool.locked ||
    pool.lockedAt !== null ||
    pool.activePositionCount !== checkpoint.counters.join ||
    pool.activePositionCount >= 99 ||
    pool.expectedNextPositionIndex !== pool.activePositionCount + 1
  ) {
    throw new Error("Pre-join pool snapshot does not match the exact-99 automatic boundary.");
  }
  return pool;
}

function reconcileConfirmed(input: {
  result: Extract<Exact99RunnerAdapterResult, { type: "confirmed" }>;
  expected: Exact99RunnerIdentity;
  preflight: Exact99RunnerOperationPreflight;
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  fundingPlan: Exact99FundingPlan;
}): void {
  requireReceipt(input.result);
  requireIdentity(input.result.identity, input.expected, "Adapter result");
  const evidence = input.result.reconciliation;
  if (evidence.type !== input.expected.operation) {
    throw new Error("Fixture reconciliation type does not match the operation.");
  }
  if (getAddress(evidence.walletAddress) !== getAddress(input.expected.walletAddress)) {
    throw new Error("Fixture reconciliation wallet does not match the manifest.");
  }

  if (evidence.type === "funding") {
    const planned = fundingOperation(input.fundingPlan, input.expected.walletIndex);
    const amount = decimal(evidence.amountWei, "Funding amount");
    const before = decimal(evidence.nativeBalanceBeforeWei, "Funding balance before");
    const after = decimal(evidence.nativeBalanceAfterWei, "Funding balance after");
    if (
      evidence.amountWei !== planned.plannedAmountWei ||
      amount > decimal(planned.maximumAllowedAmountWei, "Funding maximum") ||
      after - before !== amount
    ) {
      throw new Error("Funding reconciliation does not match the capped funding plan.");
    }
    return;
  }

  if (evidence.operationId !== input.expected.operationId) {
    throw new Error("Fixture reconciliation operation ID mismatch.");
  }
  if (evidence.type === "faucet") {
    const before = decimal(evidence.tokenBalanceBefore, "Faucet balance before");
    const after = decimal(evidence.tokenBalanceAfter, "Faucet balance after");
    const received = decimal(evidence.receivedAmount, "Faucet received amount");
    if (
      received !== DEMO_V1_PARAMETERS.dripAmount ||
      after - before !== DEMO_V1_PARAMETERS.dripAmount
    ) {
      throw new Error("Faucet reconciliation does not prove the expected dUSDC increase.");
    }
    return;
  }
  if (evidence.type === "approve") {
    if (
      getAddress(evidence.tokenAddress) !== getAddress(input.manifest.tokenAddress) ||
      getAddress(evidence.spenderAddress) !== getAddress(input.manifest.contractAddress) ||
      decimal(evidence.allowance, "Approval allowance") < DEMO_V1_PARAMETERS.entryPrice
    ) {
      throw new Error("Approval reconciliation does not prove sufficient allowance for the expected token and spender.");
    }
    return;
  }

  const before = requireJoinPreflight(input.preflight, input.checkpoint);
  requirePoolSnapshot(evidence.poolBefore, "Join before");
  requirePoolSnapshot(evidence.poolAfter, "Join after");
  if (JSON.stringify(evidence.poolBefore) !== JSON.stringify(before)) {
    throw new Error("Join preflight snapshot changed before fixture submission.");
  }
  if (
    evidence.poolAfter.poolId !== before.poolId ||
    evidence.poolAfter.cycleId !== before.cycleId ||
    evidence.poolAfter.activePositionCount !== before.activePositionCount + 1 ||
    evidence.poolAfter.expectedNextPositionIndex !== before.expectedNextPositionIndex + 1 ||
    evidence.poolAfter.status !== "Open" ||
    evidence.poolAfter.locked ||
    evidence.poolAfter.lockedAt !== null ||
    evidence.poolAfter.activePositionCount > 99 ||
    evidence.positionId !== before.expectedNextPositionIndex.toString() ||
    getAddress(evidence.positionOwner) !== getAddress(input.expected.walletAddress) ||
    evidence.positionPoolId !== before.poolId ||
    evidence.activePositionCountForWallet !== 1 ||
    evidence.runnerJoinCountBefore !== input.checkpoint.counters.join ||
    evidence.runnerJoinCountAfter !== input.checkpoint.counters.join + 1
  ) {
    throw new Error("Join reconciliation does not prove exactly one expected position in the same Open pool.");
  }
}

function expectedIdentity(
  inspection: Exact99RunnerInspection,
  manifest: Exact99Manifest,
  fundingPlan: Exact99FundingPlan,
): Exact99RunnerIdentity {
  const next = inspection.coordinator.nextOperation;
  if (!next || inspection.currentCheckpoint === null) {
    throw new Error("Exact-99 runner has no automatic operation available.");
  }
  return {
    checkpoint: next.checkpoint,
    walletIndex: next.walletIndex,
    walletAddress: manifest.walletAddresses[next.walletIndex],
    operation: next.operation,
    operationId: exact99CoordinatorOperationId({
      manifest,
      fundingPlan,
      walletIndex: next.walletIndex,
      operation: next.operation,
    }),
  };
}

function outcomeFromAdapter(input: {
  result: Exact99RunnerAdapterResult;
  expected: Exact99RunnerIdentity;
  preflight: Exact99RunnerOperationPreflight;
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  fundingPlan: Exact99FundingPlan;
}): Exact99CoordinatorSimulationOutcome {
  try {
    requireIdentity(input.result.identity, input.expected, "Adapter result");
    if (input.result.type === "confirmed") {
      reconcileConfirmed(input as typeof input & {
        result: Extract<Exact99RunnerAdapterResult, { type: "confirmed" }>;
      });
      return {
        type: "success",
        transactionHash: input.result.transactionHash,
        blockNumber: input.result.receipt.blockNumber,
        gasUsed: input.result.receipt.gasUsed,
      };
    }
  } catch (error) {
    return {
      type: "inconsistent-receipt",
      transactionHash: input.result.type === "confirmed" &&
        TRANSACTION_HASH.test(input.result.transactionHash)
        ? input.result.transactionHash
        : `0x${"00".repeat(32)}`,
      error: sanitizeRunnerError(error),
    };
  }

  const error = sanitizeRunnerError(input.result.error);
  if (input.result.type === "failed") return { type: "failed", error };
  if (input.result.type === "timeout-after-hash" || input.result.type === "pending") {
    return {
      type: "pending",
      transactionHash: input.result.transactionHash,
    };
  }
  if (input.result.type === "ambiguous" && input.result.transactionHash) {
    return {
      type: "ambiguous",
      transactionHash: input.result.transactionHash,
      error,
    };
  }
  return { type: "manual-review", error };
}

function coordinatorOutcomeAfterAdapterFailure(error: unknown): Exact99CoordinatorSimulationOutcome {
  return {
    type: "manual-review",
    error: sanitizeRunnerError(error),
  };
}

async function adapterOutcome(input: {
  adapter: Exact99RunnerOperationAdapter;
  expected: Exact99RunnerIdentity;
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  fundingPlan: Exact99FundingPlan;
}): Promise<Exact99CoordinatorSimulationOutcome> {
  try {
    const preflight = await input.adapter.inspect(input.expected);
    requireIdentity(preflight.identity, input.expected, "Adapter preflight");
    if (input.expected.operation === "join") requireJoinPreflight(preflight, input.checkpoint);
    const result = await input.adapter.run(input.expected, preflight);
    return outcomeFromAdapter({
      result,
      expected: input.expected,
      preflight,
      manifest: input.manifest,
      checkpoint: input.checkpoint,
      fundingPlan: input.fundingPlan,
    });
  } catch (error) {
    return coordinatorOutcomeAfterAdapterFailure(error);
  }
}

export async function simulateExact99RunnerStep(input: Exact99RunnerArtifacts & {
  adapter: Exact99RunnerOperationAdapter;
  checkpointId: Exact99CoordinatorCheckpointId;
  authorizationPhrase: string;
  startedAt: string;
  requested?: Partial<Pick<Exact99RunnerIdentity, "walletIndex" | "operation" | "operationId" | "walletAddress">>;
}): Promise<Exact99RunnerStepResult> {
  const fundingPlan = validateExact99FundingPlan(input.fundingPlan, input.manifest);
  const initial = inspectExact99ExecutionRunner(input);
  if (!initial.readyForSimulation) {
    return {
      profile: "exact-99-execution-runner",
      mode: "simulate",
      fixtureOnly: true,
      stopped: true,
      stopReason: initial.blockers[0] ?? "Local runner preflight blocked simulation.",
      processedOperations: 0,
      checkpoint: input.checkpoint,
      journal: input.journal,
      inspection: initial,
    };
  }
  const expected = expectedIdentity(initial, input.manifest, fundingPlan);
  if (expected.checkpoint !== input.checkpointId) {
    throw new Error("Runner request is outside the currently authorized checkpoint.");
  }
  if (
    input.requested?.walletIndex !== undefined &&
    input.requested.walletIndex !== expected.walletIndex ||
    input.requested?.operation !== undefined &&
    input.requested.operation !== expected.operation ||
    input.requested?.operationId !== undefined &&
    input.requested.operationId !== expected.operationId ||
    input.requested?.walletAddress !== undefined &&
    getAddress(input.requested.walletAddress) !== getAddress(expected.walletAddress)
  ) {
    throw new Error("Runner request does not match the first manifest-bound unfinished operation.");
  }

  const outcome = await adapterOutcome({
    adapter: input.adapter,
    expected,
    manifest: input.manifest,
    checkpoint: input.checkpoint,
    fundingPlan,
  });

  const coordinated = simulateExact99AccumulationCoordinator({
    store: input.store,
    manifest: input.manifest,
    checkpoint: input.checkpoint,
    journal: input.journal,
    fundingPlan,
    checkpointId: input.checkpointId,
    authorizationPhrase: input.authorizationPhrase,
    outcomes: new Map([[`${expected.walletIndex}:${expected.operation}`, outcome]]),
    startedAt: input.startedAt,
  });
  const inspection = inspectExact99ExecutionRunner({
    ...input,
    checkpoint: coordinated.checkpoint,
    journal: coordinated.journal,
    fundingPlan,
  });
  const stopped = outcome.type !== "success";
  return {
    profile: "exact-99-execution-runner",
    mode: "simulate",
    fixtureOnly: true,
    stopped,
    stopReason: stopped
      ? coordinated.stopReason ?? inspection.blockers[0] ?? "Runner stopped on the first non-success result."
      : null,
    processedOperations: coordinated.processedOperations,
    checkpoint: coordinated.checkpoint,
    journal: coordinated.journal,
    inspection,
  };
}

export async function simulateExact99ExecutionRunner(input: Exact99RunnerArtifacts & {
  adapter: Exact99RunnerOperationAdapter;
  checkpointId: Exact99CoordinatorCheckpointId;
  authorizationPhrase: string;
  startedAt: string;
}): Promise<Exact99RunnerSimulationResult> {
  const range = EXACT_99_COORDINATOR_RANGES.find((candidate) => candidate.id === input.checkpointId);
  if (!range || range.authorizationPhrase !== input.authorizationPhrase) {
    throw new Error("Runner authorization phrase does not match the requested checkpoint.");
  }
  let checkpoint = input.checkpoint;
  let journal = input.journal;
  let processedOperations = 0;
  let adapterCalls = 0;
  const started = new Date(input.startedAt);
  if (Number.isNaN(started.getTime()) || started.toISOString() !== input.startedAt) {
    throw new Error("Runner simulation start must be an ISO timestamp.");
  }
  const fundingPlan = validateExact99FundingPlan(input.fundingPlan, input.manifest);
  const initial = inspectExact99ExecutionRunner({ ...input, checkpoint, journal, fundingPlan });
  if (!initial.readyForSimulation || initial.currentCheckpoint !== input.checkpointId) {
    return {
      profile: "exact-99-execution-runner",
      mode: "simulate",
      fixtureOnly: true,
      stopped: true,
      stopReason: initial.blockers[0] ?? "Runner cannot continue outside the authorized checkpoint.",
      processedOperations: 0,
      checkpoint,
      journal,
      inspection: initial,
      completedCheckpoint: null,
      adapterCalls: 0,
    };
  }
  const first = expectedIdentity(initial, input.manifest, fundingPlan);
  const outcomes = new Map<string, Exact99CoordinatorSimulationOutcome>();
  let reachedFirst = false;
  let terminalOutcome = false;
  const workingCheckpoint = structuredClone(checkpoint);

  outer:
  for (let walletIndex = range.startIndex; walletIndex <= range.endIndex; walletIndex += 1) {
    for (const operation of EXACT_99_COORDINATOR_OPERATIONS) {
      const expected: Exact99RunnerIdentity = {
        checkpoint: range.id,
        walletIndex,
        walletAddress: input.manifest.walletAddresses[walletIndex],
        operation,
        operationId: exact99CoordinatorOperationId({
          manifest: input.manifest,
          fundingPlan,
          walletIndex,
          operation,
        }),
      };
      if (!reachedFirst) {
        reachedFirst = expected.operationId === first.operationId;
        if (!reachedFirst) continue;
      }
      const outcome = await adapterOutcome({
        adapter: input.adapter,
        expected,
        manifest: input.manifest,
        checkpoint: workingCheckpoint,
        fundingPlan,
      });
      adapterCalls += 2;
      outcomes.set(`${walletIndex}:${operation}`, outcome);
      if (outcome.type !== "success") {
        terminalOutcome = true;
        break outer;
      }
      processedOperations += 1;
      if (operation === "funding") workingCheckpoint.counters.funded += 1;
      if (operation === "faucet") workingCheckpoint.counters.faucet += 1;
      if (operation === "approve") workingCheckpoint.counters.approve += 1;
      if (operation === "join") {
        workingCheckpoint.counters.join += 1;
        workingCheckpoint.confirmedWalletCount += 1;
      }
    }
  }

  const coordinated = simulateExact99AccumulationCoordinator({
    store: input.store,
    manifest: input.manifest,
    checkpoint,
    journal,
    fundingPlan,
    checkpointId: input.checkpointId,
    authorizationPhrase: input.authorizationPhrase,
    outcomes,
    startedAt: input.startedAt,
  });
  checkpoint = coordinated.checkpoint;
  journal = coordinated.journal;
  const inspection = inspectExact99ExecutionRunner({ ...input, checkpoint, journal, fundingPlan });
  return {
    profile: "exact-99-execution-runner",
    mode: "simulate",
    fixtureOnly: true,
    stopped: terminalOutcome,
    stopReason: terminalOutcome
      ? coordinated.stopReason ?? inspection.blockers[0] ?? "Runner stopped on the first non-success result."
      : null,
    processedOperations: coordinated.processedOperations,
    checkpoint,
    journal,
    inspection,
    completedCheckpoint: coordinated.completedCheckpoint,
    adapterCalls,
  };
}

export function renderExact99RunnerInspection(report: Exact99RunnerInspection): string {
  const range = report.currentRange
    ? `${report.currentRange.startIndex}-${report.currentRange.endIndex}`
    : "none";
  return [
    "POP33 exact-99 execution runner core",
    "Mode: fixture-only local inspection",
    `Current checkpoint: ${report.currentCheckpoint ?? "none"}`,
    `Allowed range: ${range}`,
    `Next wallet: ${report.nextWalletIndex ?? "none"}`,
    `Next operation: ${report.nextOperation ?? "manual-100-only"}`,
    `Completed wallets: ${report.completedWalletCount}/99`,
    `Ready for fixture simulation: ${report.readyForSimulation ? "yes" : "no"}`,
    ...report.blockers.map((blocker) => `BLOCKER: ${blocker}`),
  ].join("\n");
}

export const EXACT_99_RUNNER_OPERATION_ORDER = EXACT_99_COORDINATOR_OPERATIONS;
export const EXACT_99_RUNNER_LOCAL_MODES = EXACT_99_COORDINATOR_MODES;
