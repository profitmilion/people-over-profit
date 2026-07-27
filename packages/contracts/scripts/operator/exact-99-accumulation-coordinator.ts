import { createHash } from "node:crypto";

import {
  preflightExact99OperatorArtifactsWithFunding,
  type Exact99PreflightWithFunding,
} from "./base-sepolia-artifact-audit.js";
import type { EncryptedWalletStoreInspection } from "./encrypted-wallet-store.js";
import {
  exact99ManifestFingerprint,
  validateExact99Checkpoint,
  validateExact99Journal,
  validateExact99Manifest,
  type Exact99Checkpoint,
  type Exact99Journal,
  type Exact99JournalEntry,
  type Exact99OperationStatus,
  type Exact99OperationType,
  type Exact99PreflightCheck,
  type Exact99Manifest,
} from "./exact-99-operator-artifacts.js";
import {
  validateExact99FundingPlan,
  type Exact99FundingPlan,
  type Exact99FundingPlanOperation,
} from "./exact-99-funding.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const EXACT_99_COORDINATOR_MODES = ["plan", "inspect", "simulate"] as const;
export const EXACT_99_COORDINATOR_OPERATIONS = ["funding", "faucet", "approve", "join"] as const;

export type Exact99CoordinatorMode = (typeof EXACT_99_COORDINATOR_MODES)[number];
export type Exact99CoordinatorOperation = (typeof EXACT_99_COORDINATOR_OPERATIONS)[number];
export type Exact99CoordinatorCheckpointId =
  | "checkpoint-5"
  | "checkpoint-20"
  | "checkpoint-50"
  | "checkpoint-99";

export interface Exact99CoordinatorRange {
  id: Exact99CoordinatorCheckpointId;
  targetWalletCount: 5 | 20 | 50 | 99;
  startIndex: number;
  endIndex: number;
  authorizationPhrase: string;
}

export const EXACT_99_COORDINATOR_RANGES: readonly Exact99CoordinatorRange[] = [
  {
    id: "checkpoint-5",
    targetWalletCount: 5,
    startIndex: 0,
    endIndex: 4,
    authorizationPhrase: "AUTHORIZE POP33 EXACT 99 CHECKPOINT 5",
  },
  {
    id: "checkpoint-20",
    targetWalletCount: 20,
    startIndex: 5,
    endIndex: 19,
    authorizationPhrase: "AUTHORIZE POP33 EXACT 99 CHECKPOINT 20",
  },
  {
    id: "checkpoint-50",
    targetWalletCount: 50,
    startIndex: 20,
    endIndex: 49,
    authorizationPhrase: "AUTHORIZE POP33 EXACT 99 CHECKPOINT 50",
  },
  {
    id: "checkpoint-99",
    targetWalletCount: 99,
    startIndex: 50,
    endIndex: 98,
    authorizationPhrase: "AUTHORIZE POP33 EXACT 99 CHECKPOINT 99",
  },
] as const;

export type Exact99CoordinatorState =
  | "not-started"
  | "awaiting-checkpoint-5-authorization"
  | "running-checkpoint-5"
  | "checkpoint-5-complete"
  | "awaiting-checkpoint-20-authorization"
  | "running-checkpoint-20"
  | "checkpoint-20-complete"
  | "awaiting-checkpoint-50-authorization"
  | "running-checkpoint-50"
  | "checkpoint-50-complete"
  | "awaiting-checkpoint-99-authorization"
  | "running-checkpoint-99"
  | "checkpoint-99-complete"
  | "awaiting-manual-100"
  | "blocked"
  | "manual-review";

export type Exact99CoordinatorSimulationOutcome =
  | {
      type: "success";
      transactionHash: string;
      blockNumber: number;
      gasUsed: string;
    }
  | { type: "failed"; error: string }
  | { type: "pending"; transactionHash: string }
  | { type: "ambiguous"; transactionHash: string; error: string }
  | { type: "inconsistent-receipt"; transactionHash: string; error: string }
  | { type: "manual-review"; error: string };

export interface Exact99CoordinatorNextOperation {
  checkpoint: Exact99CoordinatorCheckpointId;
  rangeStart: number;
  rangeEnd: number;
  walletIndex: number;
  walletAddress: string;
  operation: Exact99CoordinatorOperation;
  operationId: string;
}

export interface Exact99CoordinatorInspection {
  profile: "exact-99-cumulative-accumulation";
  mode: "inspect";
  readOnly: true;
  simulatedOnly: true;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  walletOrderDigest: string;
  fundingPlanId: string;
  state: Exact99CoordinatorState;
  currentCheckpoint: Exact99CoordinatorCheckpointId | null;
  currentRange: { startIndex: number; endIndex: number } | null;
  lastCompletedIndex: number | null;
  currentWalletIndex: number | null;
  currentOperation: Exact99CoordinatorOperation | null;
  completedWalletsByCheckpoint: Record<Exact99CoordinatorCheckpointId, number>;
  operationCounters: Record<Exact99CoordinatorOperation, number>;
  nextOperation: Exact99CoordinatorNextOperation | null;
  stopReason: string | null;
  checks: Exact99PreflightCheck[];
  blockers: string[];
  authorizationAccepted: boolean;
  readyForSimulation: boolean;
}

export interface Exact99CoordinatorSimulationResult {
  profile: "exact-99-cumulative-accumulation";
  mode: "simulate";
  simulatedOnly: true;
  stopped: boolean;
  stopReason: string | null;
  processedOperations: number;
  completedCheckpoint: Exact99CoordinatorCheckpointId | null;
  transitionedThrough: Exact99CoordinatorState | null;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  inspection: Exact99CoordinatorInspection;
}

export type Exact99CoordinatorPlan = Omit<Exact99CoordinatorInspection, "mode"> & {
  mode: "plan";
};

interface CoordinatorArtifacts {
  store: EncryptedWalletStoreInspection;
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  fundingPlan: Exact99FundingPlan;
  ranges?: readonly Exact99CoordinatorRange[];
  authorizationPhrase?: string;
}

const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const BLOCKING_STATUSES = new Set<Exact99OperationStatus>([
  "prepared", "pending", "failed", "ambiguous", "manual-review",
]);

function deterministicUuid(parts: readonly string[]): string {
  const hex = createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function safeText(value: unknown, label: string): string {
  const sanitized = sanitizeOperatorError(value);
  if (sanitized.length === 0 || sanitized.length > 500) {
    throw new Error(`${label} must be a non-empty redacted summary.`);
  }
  return sanitized;
}

function transactionHash(value: string): string {
  if (!TRANSACTION_HASH.test(value)) throw new Error("Fixture transaction hash is invalid.");
  return value.toLowerCase();
}

function integer(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isoCursor(startedAt: string): () => string {
  const parsed = new Date(startedAt);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== startedAt) {
    throw new Error("Coordinator simulation start must be an ISO timestamp.");
  }
  let cursor = parsed.getTime();
  return () => {
    const timestamp = new Date(cursor).toISOString();
    cursor += 1_000;
    return timestamp;
  };
}

function check(checks: Exact99PreflightCheck[], name: string, operation: () => void): void {
  try {
    operation();
    checks.push({ name, ok: true, detail: `${name} validated.` });
  } catch (error) {
    checks.push({ name, ok: false, detail: sanitizeOperatorError(error) });
  }
}

export function assertExact99CoordinatorMode(value: string): asserts value is Exact99CoordinatorMode {
  if (!EXACT_99_COORDINATOR_MODES.includes(value as Exact99CoordinatorMode)) {
    throw new Error("Exact-99 coordinator mode must be plan, inspect, or simulate.");
  }
}

export function validateExact99CoordinatorRanges(
  value: readonly Exact99CoordinatorRange[],
): readonly Exact99CoordinatorRange[] {
  const expected = EXACT_99_COORDINATOR_RANGES;
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error("Exact-99 coordinator must contain exactly four checkpoint ranges.");
  }
  const covered: number[] = [];
  value.forEach((range, index) => {
    const canonical = expected[index];
    if (
      range.id !== canonical.id ||
      range.targetWalletCount !== canonical.targetWalletCount ||
      range.authorizationPhrase !== canonical.authorizationPhrase
    ) {
      throw new Error("Exact-99 checkpoint order, target, or authorization phrase changed.");
    }
    integer(range.startIndex, `${range.id}.startIndex`, 0, 98);
    integer(range.endIndex, `${range.id}.endIndex`, range.startIndex, 98);
    if (range.startIndex !== canonical.startIndex || range.endIndex !== canonical.endIndex) {
      throw new Error("Exact-99 checkpoint ranges must be fixed at 0-4, 5-19, 20-49, and 50-98.");
    }
    for (let walletIndex = range.startIndex; walletIndex <= range.endIndex; walletIndex += 1) {
      covered.push(walletIndex);
    }
  });
  if (
    covered.length !== 99 ||
    new Set(covered).size !== 99 ||
    covered.some((walletIndex, index) => walletIndex !== index) ||
    covered.includes(99)
  ) {
    throw new Error("Exact-99 checkpoint ranges must cover each index 0-98 exactly once and exclude index 99.");
  }
  return value;
}

function rangeForWallet(
  walletIndex: number,
  ranges: readonly Exact99CoordinatorRange[],
): Exact99CoordinatorRange {
  const range = ranges.find((candidate) =>
    walletIndex >= candidate.startIndex && walletIndex <= candidate.endIndex,
  );
  if (!range) throw new Error("Wallet index is outside the exact-99 coordinator ranges.");
  return range;
}

function fundingExpectedState(operation: Exact99FundingPlanOperation): string {
  return [
    `funding-plan=${operation.manifestFingerprint}`,
    `wallet-index=${operation.index}`,
    `minimum-target-wei=${operation.minimumTargetBalanceWei}`,
    `planned-amount-wei=${operation.plannedAmountWei}`,
    `maximum-amount-wei=${operation.maximumAllowedAmountWei}`,
  ].join(";");
}

export function exact99CoordinatorOperationId(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  walletIndex: number;
  operation: Exact99CoordinatorOperation;
}): string {
  const manifest = validateExact99Manifest(input.manifest);
  const plan = validateExact99FundingPlan(input.fundingPlan, manifest);
  const walletIndex = integer(input.walletIndex, "walletIndex", 0, 98);
  return operationIdUnchecked(manifest, plan, walletIndex, input.operation);
}

function operationIdUnchecked(
  manifest: Exact99Manifest,
  plan: Exact99FundingPlan,
  walletIndex: number,
  operation: Exact99CoordinatorOperation,
): string {
  if (operation === "funding") return plan.operations[walletIndex].operationId;
  return deterministicUuid([
    "pop33-exact-99-coordinator",
    manifest.setId,
    manifest.storeId,
    plan.manifestFingerprint,
    manifest.walletOrderDigest,
    plan.planId,
    walletIndex.toString(),
    operation,
  ]);
}

function expectedState(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  walletIndex: number;
  operation: Exact99CoordinatorOperation;
  range: Exact99CoordinatorRange;
}): string {
  if (input.operation === "funding") {
    return fundingExpectedState(input.fundingPlan.operations[input.walletIndex]);
  }
  return [
    "coordinator=exact-99-cumulative-accumulation",
    `checkpoint=${input.range.id}`,
    `range=${input.range.startIndex}-${input.range.endIndex}`,
    `wallet-index=${input.walletIndex}`,
    `operation=${input.operation}`,
    `manifest=${input.fundingPlan.manifestFingerprint}`,
    `wallet-order=${input.manifest.walletOrderDigest}`,
    `funding-plan=${input.fundingPlan.planId}`,
  ].join(";");
}

function latestEntries(journal: Exact99Journal): Map<string, Exact99JournalEntry> {
  const latest = new Map<string, Exact99JournalEntry>();
  for (const entry of journal.entries) latest.set(entry.operationId, entry);
  return latest;
}

function completed(entry: Exact99JournalEntry | undefined): boolean {
  return entry?.status === "confirmed" || (
    entry?.type === "funding" && entry.status === "skipped-already-funded"
  );
}

function operationEntry(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  ranges: readonly Exact99CoordinatorRange[];
  walletIndex: number;
  operation: Exact99CoordinatorOperation;
  latest: Map<string, Exact99JournalEntry>;
}): Exact99JournalEntry | undefined {
  return input.latest.get(operationIdUnchecked(
    input.manifest,
    input.fundingPlan,
    input.walletIndex,
    input.operation,
  ));
}

function completedWalletCount(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  ranges: readonly Exact99CoordinatorRange[];
  latest: Map<string, Exact99JournalEntry>;
}): number {
  let count = 0;
  for (let walletIndex = 0; walletIndex < 99; walletIndex += 1) {
    const done = EXACT_99_COORDINATOR_OPERATIONS.every((operation) =>
      completed(operationEntry({ ...input, walletIndex, operation })),
    );
    if (!done) break;
    count += 1;
  }
  return count;
}

function nextOperation(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  ranges: readonly Exact99CoordinatorRange[];
  latest: Map<string, Exact99JournalEntry>;
}): Exact99CoordinatorNextOperation | null {
  for (let walletIndex = 0; walletIndex < 99; walletIndex += 1) {
    const range = rangeForWallet(walletIndex, input.ranges);
    for (const operation of EXACT_99_COORDINATOR_OPERATIONS) {
      const operationId = operationIdUnchecked(input.manifest, input.fundingPlan, walletIndex, operation);
      if (!completed(input.latest.get(operationId))) {
        return {
          checkpoint: range.id,
          rangeStart: range.startIndex,
          rangeEnd: range.endIndex,
          walletIndex,
          walletAddress: input.manifest.walletAddresses[walletIndex],
          operation,
          operationId,
        };
      }
    }
  }
  return null;
}

function completedByCheckpoint(
  count: number,
  ranges: readonly Exact99CoordinatorRange[],
): Record<Exact99CoordinatorCheckpointId, number> {
  return Object.fromEntries(ranges.map((range) => [
    range.id,
    Math.max(0, Math.min(count, range.endIndex + 1) - range.startIndex),
  ])) as Record<Exact99CoordinatorCheckpointId, number>;
}

function stateFor(input: {
  checkpoint: Exact99Checkpoint;
  next: Exact99CoordinatorNextOperation | null;
  latest: Map<string, Exact99JournalEntry>;
}): Exact99CoordinatorState {
  if (input.checkpoint.recovery.manualReview || input.checkpoint.stage === "manual-review") {
    return "manual-review";
  }
  if (
    input.checkpoint.recovery.pending ||
    input.checkpoint.recovery.ambiguous ||
    [...input.latest.values()].some((entry) => BLOCKING_STATUSES.has(entry.status))
  ) {
    return "blocked";
  }
  if (!input.next) return "awaiting-manual-100";
  const hasCurrentRangeWork = [...input.latest.values()].some((entry) =>
    entry.coordinator?.checkpoint === input.next?.checkpoint,
  );
  return hasCurrentRangeWork
    ? `running-${input.next.checkpoint}` as Exact99CoordinatorState
    : `awaiting-${input.next.checkpoint}-authorization` as Exact99CoordinatorState;
}

function validateJournalCoordination(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  ranges: readonly Exact99CoordinatorRange[];
  journal: Exact99Journal;
}): void {
  const latest = latestEntries(input.journal);
  const knownIds = new Set<string>();
  let laterWorkSeen = false;
  for (let walletIndex = 0; walletIndex < 99; walletIndex += 1) {
    const range = rangeForWallet(walletIndex, input.ranges);
    let walletComplete = true;
    for (const operation of EXACT_99_COORDINATOR_OPERATIONS) {
      const operationId = operationIdUnchecked(input.manifest, input.fundingPlan, walletIndex, operation);
      knownIds.add(operationId);
      const entry = latest.get(operationId);
      if (!entry) {
        walletComplete = false;
        continue;
      }
      laterWorkSeen = true;
      if (
        entry.type !== operation ||
        entry.walletIndex !== walletIndex ||
        entry.walletAddress !== input.manifest.walletAddresses[walletIndex] ||
        entry.expectedState !== expectedState({
          manifest: input.manifest,
          fundingPlan: input.fundingPlan,
          walletIndex,
          operation,
          range,
        })
      ) {
        throw new Error("Coordinator journal operation identity or wallet order changed.");
      }
      const binding = entry.coordinator;
      if (
        !binding ||
        binding.checkpoint !== range.id ||
        binding.rangeStart !== range.startIndex ||
        binding.rangeEnd !== range.endIndex ||
        binding.walletOrderDigest !== input.manifest.walletOrderDigest ||
        binding.fundingPlanId !== input.fundingPlan.planId
      ) {
        throw new Error("Coordinator journal entry is not bound to its exact checkpoint range and artifacts.");
      }
      const operationIndex = EXACT_99_COORDINATOR_OPERATIONS.indexOf(operation);
      if (operationIndex > 0) {
        const previous = operationEntry({
          manifest: input.manifest,
          fundingPlan: input.fundingPlan,
          ranges: input.ranges,
          walletIndex,
          operation: EXACT_99_COORDINATOR_OPERATIONS[operationIndex - 1],
          latest,
        });
        if (!completed(previous)) {
          throw new Error("Coordinator journal skipped the required per-wallet operation order.");
        }
      }
      if (!completed(entry)) walletComplete = false;
    }
    if (laterWorkSeen && walletIndex > 0) {
      const previousWalletComplete = EXACT_99_COORDINATOR_OPERATIONS.every((operation) =>
        completed(operationEntry({
          manifest: input.manifest,
          fundingPlan: input.fundingPlan,
          ranges: input.ranges,
          walletIndex: walletIndex - 1,
          operation,
          latest,
        })),
      );
      if (!previousWalletComplete) {
        const currentHasWork = EXACT_99_COORDINATOR_OPERATIONS.some((operation) =>
          operationEntry({
            manifest: input.manifest,
            fundingPlan: input.fundingPlan,
            ranges: input.ranges,
            walletIndex,
            operation,
            latest,
          }),
        );
        if (currentHasWork) throw new Error("Coordinator journal skipped a wallet or checkpoint.");
      }
    }
    if (!walletComplete) laterWorkSeen = false;
  }
  for (const entry of latest.values()) {
    if (entry.type === "manual-100") {
      throw new Error("Coordinator journal contains a forbidden automatic one-hundredth join.");
    }
    if (
      EXACT_99_COORDINATOR_OPERATIONS.includes(entry.type as Exact99CoordinatorOperation) &&
      !knownIds.has(entry.operationId)
    ) {
      throw new Error("Coordinator journal contains an operation outside indices 0-98.");
    }
  }
}

function validateCheckpointReconciliation(input: {
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
}): Record<Exact99CoordinatorOperation, number> {
  const latest = latestEntries(input.journal);
  const counts = Object.fromEntries(EXACT_99_COORDINATOR_OPERATIONS.map((operation) => [
    operation,
    [...latest.values()].filter((entry) => entry.type === operation && entry.status === "confirmed").length,
  ])) as Record<Exact99CoordinatorOperation, number>;
  if (
    input.checkpoint.counters.funded !== counts.funding ||
    input.checkpoint.counters.faucet !== counts.faucet ||
    input.checkpoint.counters.approve !== counts.approve ||
    input.checkpoint.counters.join !== counts.join ||
    input.checkpoint.confirmedWalletCount !== counts.join
  ) {
    throw new Error("Coordinator checkpoint counters do not match the append-only journal.");
  }
  const expectedStage = counts.join === 99
    ? "awaiting-manual-100"
    : counts.join === 50
      ? "checkpoint-50"
      : counts.join === 20
        ? "checkpoint-20"
        : counts.join === 5
          ? "checkpoint-5"
          : counts.join > 50
            ? "running-checkpoint-99"
            : counts.join > 20
              ? "running-checkpoint-50"
              : counts.join > 5
                ? "running-checkpoint-20"
                : counts.join > 0
                  ? "running-checkpoint-5"
                  : null;
  if (
    expectedStage &&
    input.checkpoint.stage !== expectedStage &&
    input.checkpoint.stage !== "manual-review"
  ) {
    throw new Error("Coordinator checkpoint stage does not match completed checkpoint progress.");
  }
  if (counts.join === 99 && input.checkpoint.stage !== "awaiting-manual-100") {
    throw new Error("Index 98 completion must transition to awaiting-manual-100.");
  }
  return counts;
}

export function inspectExact99AccumulationCoordinator(
  input: CoordinatorArtifacts,
): Exact99CoordinatorInspection {
  const checks: Exact99PreflightCheck[] = [];
  const ranges = input.ranges ?? EXACT_99_COORDINATOR_RANGES;
  let combined: Exact99PreflightWithFunding | undefined;
  let manifest: Exact99Manifest | undefined;
  let checkpoint: Exact99Checkpoint | undefined;
  let journal: Exact99Journal | undefined;
  let fundingPlan: Exact99FundingPlan | undefined;
  let operationCounters: Record<Exact99CoordinatorOperation, number> = {
    funding: 0,
    faucet: 0,
    approve: 0,
    join: 0,
  };

  check(checks, "coordinator-ranges", () => {
    validateExact99CoordinatorRanges(ranges);
  });
  check(checks, "coordinator-artifact-preflight", () => {
    manifest = validateExact99Manifest(input.manifest);
    checkpoint = validateExact99Checkpoint(input.checkpoint, manifest);
    journal = validateExact99Journal(input.journal, manifest);
    fundingPlan = validateExact99FundingPlan(input.fundingPlan, manifest);
    combined = preflightExact99OperatorArtifactsWithFunding({
      store: input.store,
      manifest,
      checkpoint,
      journal,
      fundingPlan,
    });
    if (!combined.readyForFutureNetworkPreflight) {
      throw new Error(combined.blockers.join(" | "));
    }
  });
  check(checks, "coordinator-journal-binding-and-order", () => {
    if (!manifest || !journal || !fundingPlan) throw new Error("Coordinator artifacts are unavailable.");
    validateJournalCoordination({ manifest, journal, fundingPlan, ranges });
  });
  check(checks, "coordinator-checkpoint-journal-reconciliation", () => {
    if (!checkpoint || !journal) throw new Error("Coordinator checkpoint or journal is unavailable.");
    operationCounters = validateCheckpointReconciliation({ checkpoint, journal });
  });
  check(checks, "coordinator-hard-stop", () => {
    if (!manifest || manifest.walletAddresses.length !== 99 || manifest.walletAddresses[99] !== undefined) {
      throw new Error("Coordinator automatic wallet boundary must end at index 98.");
    }
    if (journal?.entries.some((entry) => entry.type === "manual-100" || entry.walletIndex === 99)) {
      throw new Error("Coordinator contains a forbidden automatic operation at index 99.");
    }
  });

  const latest = journal ? latestEntries(journal) : new Map<string, Exact99JournalEntry>();
  const next = manifest && fundingPlan
    ? nextOperation({ manifest, fundingPlan, ranges, latest })
    : null;
  const completedCount = manifest && fundingPlan
    ? completedWalletCount({ manifest, fundingPlan, ranges, latest })
    : 0;
  const state = checkpoint
    ? stateFor({ checkpoint, next, latest })
    : "not-started";
  const currentRange = next
    ? { startIndex: next.rangeStart, endIndex: next.rangeEnd }
    : null;

  let authorizationAccepted = false;
  if (input.authorizationPhrase !== undefined && next) {
    check(checks, "coordinator-authorization", () => {
      const range = ranges.find((candidate) => candidate.id === next.checkpoint);
      if (!range || input.authorizationPhrase !== range.authorizationPhrase) {
        throw new Error("Authorization phrase does not match the currently allowed checkpoint.");
      }
      authorizationAccepted = true;
    });
  }

  const blockers = checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`);
  const blockedState = blockers.length > 0
    ? checkpoint?.recovery.manualReview ? "manual-review" : "blocked"
    : state;
  const stopReason = blockers.length > 0
    ? blockers[0]
    : checkpoint?.recovery.reason ?? null;
  return {
    profile: "exact-99-cumulative-accumulation",
    mode: "inspect",
    readOnly: true,
    simulatedOnly: true,
    setId: manifest?.setId ?? "",
    storeId: manifest?.storeId ?? "",
    manifestFingerprint: manifest ? exact99ManifestFingerprint(manifest) : "",
    walletOrderDigest: manifest?.walletOrderDigest ?? "",
    fundingPlanId: fundingPlan?.planId ?? "",
    state: blockedState,
    currentCheckpoint: next?.checkpoint ?? null,
    currentRange,
    lastCompletedIndex: completedCount === 0 ? null : completedCount - 1,
    currentWalletIndex: next?.walletIndex ?? null,
    currentOperation: next?.operation ?? null,
    completedWalletsByCheckpoint: completedByCheckpoint(completedCount, ranges),
    operationCounters,
    nextOperation: next,
    stopReason,
    checks,
    blockers,
    authorizationAccepted,
    readyForSimulation: blockers.length === 0 && next !== null,
  };
}

export function planExact99AccumulationCoordinator(
  input: CoordinatorArtifacts,
): Exact99CoordinatorPlan {
  return {
    ...inspectExact99AccumulationCoordinator(input),
    mode: "plan",
  };
}

function appendEvent(input: {
  manifest: Exact99Manifest;
  fundingPlan: Exact99FundingPlan;
  ranges: readonly Exact99CoordinatorRange[];
  journal: Exact99Journal;
  walletIndex: number;
  operation: Exact99CoordinatorOperation;
  status: Exact99OperationStatus;
  timestamp: string;
  transactionHash?: string;
  blockNumber?: number;
  receipt?: Exact99JournalEntry["receipt"];
  reconciliation?: string;
  error?: string;
}): Exact99Journal {
  const range = rangeForWallet(input.walletIndex, input.ranges);
  const operationId = operationIdUnchecked(
    input.manifest,
    input.fundingPlan,
    input.walletIndex,
    input.operation,
  );
  const previous = [...input.journal.entries].reverse().find((entry) => entry.operationId === operationId);
  const entry: Exact99JournalEntry = {
    sequence: input.journal.entries.length + 1,
    operationId,
    type: input.operation,
    walletIndex: input.walletIndex,
    walletAddress: input.manifest.walletAddresses[input.walletIndex],
    expectedState: expectedState({
      manifest: input.manifest,
      fundingPlan: input.fundingPlan,
      walletIndex: input.walletIndex,
      operation: input.operation,
      range,
    }),
    transactionHash: input.transactionHash ?? previous?.transactionHash ?? null,
    status: input.status,
    blockNumber: input.blockNumber ?? null,
    receipt: input.receipt ?? null,
    reconciliation: input.reconciliation ?? null,
    error: input.error ?? null,
    createdAt: previous?.createdAt ?? input.timestamp,
    updatedAt: input.timestamp,
    coordinator: {
      checkpoint: range.id,
      rangeStart: range.startIndex,
      rangeEnd: range.endIndex,
      walletOrderDigest: input.manifest.walletOrderDigest,
      fundingPlanId: input.fundingPlan.planId,
    },
  };
  return {
    ...input.journal,
    revision: input.journal.revision + 1,
    updatedAt: input.timestamp,
    entries: [...input.journal.entries, entry],
  };
}

function countsFromJournal(journal: Exact99Journal): Record<Exact99CoordinatorOperation, number> {
  const latest = latestEntries(journal);
  return Object.fromEntries(EXACT_99_COORDINATOR_OPERATIONS.map((operation) => [
    operation,
    [...latest.values()].filter((entry) => entry.type === operation && entry.status === "confirmed").length,
  ])) as Record<Exact99CoordinatorOperation, number>;
}

function checkpointAfterConfirmed(input: {
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  operation: Exact99CoordinatorOperation;
  walletIndex: number;
  transactionHash: string;
  blockNumber: number;
  timestamp: string;
}): Exact99Checkpoint {
  const counts = countsFromJournal(input.journal);
  const joinCount = counts.join;
  const stage = joinCount === 99
    ? "awaiting-manual-100"
    : joinCount === 50
      ? "checkpoint-50"
      : joinCount === 20
        ? "checkpoint-20"
        : joinCount === 5
          ? "checkpoint-5"
          : joinCount > 50
            ? "running-checkpoint-99"
            : joinCount > 20
              ? "running-checkpoint-50"
              : joinCount > 5
                ? "running-checkpoint-20"
                : joinCount > 0
                  ? "running-checkpoint-5"
                  : input.checkpoint.stage;
  return {
    ...input.checkpoint,
    stage,
    confirmedWalletCount: joinCount,
    counters: {
      ...input.checkpoint.counters,
      funded: counts.funding,
      faucet: counts.faucet,
      approve: counts.approve,
      join: counts.join,
    },
    lastConfirmedOperation: {
      type: input.operation,
      walletIndex: input.walletIndex,
      transactionHash: input.transactionHash,
      blockNumber: input.blockNumber,
      confirmedAt: input.timestamp,
    },
    recovery: { pending: false, ambiguous: false, manualReview: false, reason: null },
    updatedAt: input.timestamp,
  };
}

function checkpointAfterStop(input: {
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  timestamp: string;
  kind: "failed" | "pending" | "ambiguous" | "manual-review";
}): Exact99Checkpoint {
  return {
    ...input.checkpoint,
    stage: input.kind === "failed" || input.kind === "manual-review"
      ? "manual-review"
      : input.checkpoint.stage,
    recovery: {
      pending: input.kind === "pending",
      ambiguous: input.kind === "ambiguous",
      manualReview: input.kind === "failed" || input.kind === "manual-review",
      reason: `Fixture coordinator stopped on ${input.kind}; local reconciliation is required.`,
    },
    updatedAt: input.timestamp,
  };
}

export function simulateExact99AccumulationCoordinator(input: CoordinatorArtifacts & {
  checkpointId: Exact99CoordinatorCheckpointId;
  authorizationPhrase: string;
  outcomes: ReadonlyMap<string, Exact99CoordinatorSimulationOutcome>;
  startedAt: string;
}): Exact99CoordinatorSimulationResult {
  const ranges = validateExact99CoordinatorRanges(input.ranges ?? EXACT_99_COORDINATOR_RANGES);
  const initial = inspectExact99AccumulationCoordinator(input);
  if (initial.blockers.length > 0) {
    return {
      profile: "exact-99-cumulative-accumulation",
      mode: "simulate",
      simulatedOnly: true,
      stopped: true,
      stopReason: "Local coordinator preflight blocked simulation.",
      processedOperations: 0,
      completedCheckpoint: null,
      transitionedThrough: null,
      checkpoint: input.checkpoint,
      journal: input.journal,
      inspection: initial,
    };
  }
  if (!initial.nextOperation || initial.state === "awaiting-manual-100") {
    throw new Error("All 99 automatic wallets are complete; the one-hundredth join remains manual.");
  }
  if (initial.currentCheckpoint !== input.checkpointId) {
    throw new Error("Cannot skip or repeat an exact-99 checkpoint.");
  }
  const range = ranges.find((candidate) => candidate.id === input.checkpointId);
  if (!range || input.authorizationPhrase !== range.authorizationPhrase) {
    throw new Error("Authorization phrase does not match the currently allowed checkpoint.");
  }

  const manifest = validateExact99Manifest(input.manifest);
  const fundingPlan = validateExact99FundingPlan(input.fundingPlan, manifest);
  let checkpoint = validateExact99Checkpoint(input.checkpoint, manifest);
  let journal = validateExact99Journal(input.journal, manifest);
  const nextTimestamp = isoCursor(input.startedAt);
  let processedOperations = 0;
  let stopped = false;
  let stopReason: string | null = null;

  for (let walletIndex = range.startIndex; walletIndex <= range.endIndex; walletIndex += 1) {
    for (const operation of EXACT_99_COORDINATOR_OPERATIONS) {
      const latest = operationEntry({
        manifest,
        fundingPlan,
        ranges,
        walletIndex,
        operation,
        latest: latestEntries(journal),
      });
      if (completed(latest)) continue;
      if (latest) {
        stopped = true;
        stopReason = "Existing non-terminal operation requires local reconciliation.";
        break;
      }
      const outcome = input.outcomes.get(`${walletIndex}:${operation}`);
      if (!outcome) {
        stopped = true;
        stopReason = "Fixture outcome is unavailable; simulation stopped without advancing.";
        break;
      }
      journal = appendEvent({
        manifest, fundingPlan, ranges, journal, walletIndex, operation,
        status: "planned", timestamp: nextTimestamp(),
      });
      journal = appendEvent({
        manifest, fundingPlan, ranges, journal, walletIndex, operation,
        status: "prepared", timestamp: nextTimestamp(),
      });
      processedOperations += 1;

      if (outcome.type === "success") {
        const hash = transactionHash(outcome.transactionHash);
        integer(outcome.blockNumber, "Fixture block number", 1, Number.MAX_SAFE_INTEGER);
        if (!DECIMAL.test(outcome.gasUsed)) throw new Error("Fixture gas used must be a decimal integer.");
        journal = appendEvent({
          manifest, fundingPlan, ranges, journal, walletIndex, operation,
          status: "pending", timestamp: nextTimestamp(), transactionHash: hash,
        });
        const confirmedAt = nextTimestamp();
        journal = appendEvent({
          manifest, fundingPlan, ranges, journal, walletIndex, operation,
          status: "confirmed",
          timestamp: confirmedAt,
          transactionHash: hash,
          blockNumber: outcome.blockNumber,
          receipt: { status: 1, gasUsed: outcome.gasUsed },
          reconciliation: "Fixture receipt and expected coordinator state reconciled.",
        });
        checkpoint = checkpointAfterConfirmed({
          manifest,
          checkpoint,
          journal,
          operation,
          walletIndex,
          transactionHash: hash,
          blockNumber: outcome.blockNumber,
          timestamp: confirmedAt,
        });
        continue;
      }

      if (outcome.type === "failed") {
        journal = appendEvent({
          manifest, fundingPlan, ranges, journal, walletIndex, operation,
          status: "failed", timestamp: nextTimestamp(),
          error: safeText(outcome.error, "Fixture failure"),
        });
      } else if (outcome.type === "pending") {
        journal = appendEvent({
          manifest, fundingPlan, ranges, journal, walletIndex, operation,
          status: "pending", timestamp: nextTimestamp(),
          transactionHash: transactionHash(outcome.transactionHash),
          error: "Fixture receipt remains pending; do not continue automatically.",
        });
      } else if (outcome.type === "ambiguous" || outcome.type === "inconsistent-receipt") {
        journal = appendEvent({
          manifest, fundingPlan, ranges, journal, walletIndex, operation,
          status: "ambiguous", timestamp: nextTimestamp(),
          transactionHash: transactionHash(outcome.transactionHash),
          error: safeText(outcome.error, "Fixture ambiguity"),
        });
      } else {
        journal = appendEvent({
          manifest, fundingPlan, ranges, journal, walletIndex, operation,
          status: "manual-review", timestamp: nextTimestamp(),
          error: safeText(outcome.error, "Fixture manual review"),
        });
      }
      checkpoint = checkpointAfterStop({
        manifest,
        checkpoint,
        timestamp: nextTimestamp(),
        kind: outcome.type === "inconsistent-receipt" ? "ambiguous" : outcome.type,
      });
      stopped = true;
      stopReason = `Simulation stopped on the first ${outcome.type} result.`;
      break;
    }
    if (stopped) break;
  }

  const completedCheckpoint = checkpoint.confirmedWalletCount === range.targetWalletCount
    ? range.id
    : null;
  const transitionedThrough = completedCheckpoint
    ? `${completedCheckpoint}-complete` as Exact99CoordinatorState
    : null;
  checkpoint = validateExact99Checkpoint(checkpoint, manifest);
  journal = validateExact99Journal(journal, manifest);
  const inspection = inspectExact99AccumulationCoordinator({
    store: input.store,
    manifest,
    checkpoint,
    journal,
    fundingPlan,
    ranges,
  });
  return {
    profile: "exact-99-cumulative-accumulation",
    mode: "simulate",
    simulatedOnly: true,
    stopped,
    stopReason,
    processedOperations,
    completedCheckpoint,
    transitionedThrough,
    checkpoint,
    journal,
    inspection,
  };
}

export function renderExact99CoordinatorInspection(
  report: Exact99CoordinatorInspection,
): string {
  const range = report.currentRange
    ? `${report.currentRange.startIndex}-${report.currentRange.endIndex}`
    : "none";
  const next = report.nextOperation
    ? `${report.nextOperation.walletIndex}:${report.nextOperation.operation}`
    : "manual-100-only";
  return [
    "POP33 exact-99 cumulative accumulation coordinator",
    "Mode: fixture-only read-only inspection",
    `State: ${report.state}`,
    `Current checkpoint: ${report.currentCheckpoint ?? "none"}`,
    `Current range: ${range}`,
    `Next fixture operation: ${next}`,
    `Completed wallets: ${report.lastCompletedIndex === null ? 0 : report.lastCompletedIndex + 1}/99`,
    `Counters: funding=${report.operationCounters.funding}, faucet=${report.operationCounters.faucet}, approve=${report.operationCounters.approve}, join=${report.operationCounters.join}`,
    `Automatic index 99: forbidden`,
    `Ready for fixture simulation: ${report.readyForSimulation ? "yes" : "no"}`,
    ...report.blockers.map((blocker) => `BLOCKER: ${blocker}`),
  ].join("\n");
}
