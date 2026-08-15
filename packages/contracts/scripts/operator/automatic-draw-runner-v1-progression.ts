import { getAddress, isAddress, ZeroAddress } from "ethers";

import {
  validateAutomaticDrawReservationRecord,
  type AutomaticDrawReservationCycleResult,
  type AutomaticDrawReservationRecord,
} from "./automatic-draw-runner-v1-reservation.js";
import type {
  AutomaticDrawDryRunDependencies,
  AutomaticDrawDryRunOptions,
  AutomaticDrawDryRunResult,
  AutomaticDrawDryRunStatus,
} from "./automatic-draw-runner-v1-preflight.js";

export const AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION = 1 as const;

const DECIMAL = /^(?:0|[1-9]\d*)$/;
const PREFLIGHT_STATUSES: readonly AutomaticDrawDryRunStatus[] = [
  "READY_FOR_EXECUTION",
  "SAFE_STOP",
  "RECONCILIATION_REQUIRED",
  "PREFLIGHT_FAILED",
];

export type AutomaticDrawProgressionState =
  | "RESERVED"
  | "PREFLIGHT_READY"
  | "MANUAL_REVIEW_REQUIRED";

export interface AutomaticDrawPreflightReadyEvidence {
  phase3Status: "READY_FOR_EXECUTION";
  planId: string;
  revalidationBlock: string;
  publicOperatorAddress: string;
  gasEstimate: string;
  runtimeGasEstimate: string;
  bufferedGasLimit: string;
  completedAt: string;
  dryRunOnly: true;
  transactionAuthorized: false;
  transactionSent: false;
}

export interface AutomaticDrawManualReviewEvidence {
  phase3Status: AutomaticDrawDryRunStatus;
  reason: string;
  recordedAt: string;
}

export type AutomaticDrawProgression =
  | {
      schemaVersion: typeof AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION;
      state: "RESERVED";
      updatedAt: string;
      preflight: null;
      manualReview: null;
    }
  | {
      schemaVersion: typeof AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION;
      state: "PREFLIGHT_READY";
      updatedAt: string;
      preflight: AutomaticDrawPreflightReadyEvidence;
      manualReview: null;
    }
  | {
      schemaVersion: typeof AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION;
      state: "MANUAL_REVIEW_REQUIRED";
      updatedAt: string;
      preflight: null;
      manualReview: AutomaticDrawManualReviewEvidence;
    };

export type AutomaticDrawTerminalProgression = Exclude<
  AutomaticDrawProgression,
  { state: "RESERVED" }
>;

export interface AutomaticDrawStoredOperation {
  revision: number;
  record: AutomaticDrawReservationRecord;
  progression: AutomaticDrawProgression;
}

export type AutomaticDrawProgressionReadResult =
  | { status: "FOUND"; operation: unknown }
  | { status: "NOT_FOUND" }
  | { status: "UNKNOWN" };

export interface AutomaticDrawProgressionTransition {
  logicalDrawKey: string;
  expectedRevision: number;
  expectedState: "RESERVED";
  next: AutomaticDrawTerminalProgression;
}

export type AutomaticDrawAtomicTransitionResult =
  | { status: "UPDATED"; operation: unknown }
  | { status: "CONFLICT"; operation: unknown | null }
  | { status: "UNKNOWN" };

export interface AutomaticDrawProgressionStorage {
  read(logicalDrawKey: string): Promise<AutomaticDrawProgressionReadResult>;
  transitionIfCurrent(
    transition: AutomaticDrawProgressionTransition,
  ): Promise<AutomaticDrawAtomicTransitionResult>;
}

export interface AutomaticDrawProgressionCycleOptions {
  reservation: AutomaticDrawReservationCycleResult;
  storage: AutomaticDrawProgressionStorage;
  runDryRun(
    options: AutomaticDrawDryRunOptions,
  ): Promise<AutomaticDrawDryRunResult>;
  operatorAddress: string;
  dependencies: AutomaticDrawDryRunDependencies;
  maxPlanAgeSeconds?: bigint;
  now?: string;
}

export type AutomaticDrawProgressionCycleResult =
  | {
      status: "PREFLIGHT_READY" | "MANUAL_REVIEW_REQUIRED";
      operation: AutomaticDrawStoredOperation;
      preflightExecuted: boolean;
      dryRunOnly: true;
      transactionAuthorized: false;
      transactionSent: false;
      reason: string;
    }
  | {
      status: "NO_RESERVATION" | "RECONCILIATION_REQUIRED";
      operation: null;
      preflightExecuted: false;
      dryRunOnly: true;
      transactionAuthorized: false;
      transactionSent: false;
      reason: string;
    };

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  for (const key of keys) {
    if (!(key in record)) throw new Error(`${label}.${key} is required.`);
  }
  return record;
}

function requireIso(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function requireDecimal(
  value: unknown,
  label: string,
  positive: boolean,
): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${label} must be an unsigned decimal string.`);
  }
  if (positive && value === "0") throw new Error(`${label} must be positive.`);
  return value;
}

function requireBounded(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function requirePublicAddress(value: unknown): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error("Preflight public operator address is invalid.");
  }
  const address = getAddress(value);
  if (address === ZeroAddress) {
    throw new Error("Preflight public operator address must not be zero.");
  }
  return address;
}

export function sanitizeAutomaticDrawReviewReason(value: unknown): string {
  const raw = typeof value === "string" && value.trim()
    ? value.trim()
    : "Automatic Draw preflight stopped without safe diagnostic detail.";
  const sanitized = raw
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\b0x[0-9a-f]{64}\b/gi, "[redacted-value]")
    .replace(/\b(?:secret|password|passphrase|api.?key)\b\s*[:=]\s*\S+/gi, "[redacted]")
    .slice(0, 500);
  return sanitized || "Automatic Draw preflight requires manual review.";
}

function validatePreflightEvidence(
  value: unknown,
): AutomaticDrawPreflightReadyEvidence {
  const evidence = exactObject(value, [
    "phase3Status",
    "planId",
    "revalidationBlock",
    "publicOperatorAddress",
    "gasEstimate",
    "runtimeGasEstimate",
    "bufferedGasLimit",
    "completedAt",
    "dryRunOnly",
    "transactionAuthorized",
    "transactionSent",
  ], "automaticDrawProgression.preflight");
  if (evidence.phase3Status !== "READY_FOR_EXECUTION") {
    throw new Error("Persisted preflight status is invalid.");
  }
  if (
    evidence.dryRunOnly !== true ||
    evidence.transactionAuthorized !== false ||
    evidence.transactionSent !== false
  ) {
    throw new Error("Persisted preflight must remain non-transactional.");
  }
  return {
    phase3Status: "READY_FOR_EXECUTION",
    planId: requireBounded(evidence.planId, "preflight.planId", 200),
    revalidationBlock: requireDecimal(
      evidence.revalidationBlock,
      "preflight.revalidationBlock",
      false,
    ),
    publicOperatorAddress: requirePublicAddress(evidence.publicOperatorAddress),
    gasEstimate: requireDecimal(evidence.gasEstimate, "preflight.gasEstimate", true),
    runtimeGasEstimate: requireDecimal(
      evidence.runtimeGasEstimate,
      "preflight.runtimeGasEstimate",
      true,
    ),
    bufferedGasLimit: requireDecimal(
      evidence.bufferedGasLimit,
      "preflight.bufferedGasLimit",
      true,
    ),
    completedAt: requireIso(evidence.completedAt, "preflight.completedAt"),
    dryRunOnly: true,
    transactionAuthorized: false,
    transactionSent: false,
  };
}

function validateManualReviewEvidence(
  value: unknown,
): AutomaticDrawManualReviewEvidence {
  const evidence = exactObject(value, [
    "phase3Status",
    "reason",
    "recordedAt",
  ], "automaticDrawProgression.manualReview");
  if (
    typeof evidence.phase3Status !== "string" ||
    !PREFLIGHT_STATUSES.includes(evidence.phase3Status as AutomaticDrawDryRunStatus)
  ) {
    throw new Error("Persisted manual-review preflight status is invalid.");
  }
  const reason = requireBounded(evidence.reason, "manualReview.reason", 500);
  if (sanitizeAutomaticDrawReviewReason(reason) !== reason) {
    throw new Error("Persisted manual-review reason is not sanitized.");
  }
  return {
    phase3Status: evidence.phase3Status as AutomaticDrawDryRunStatus,
    reason,
    recordedAt: requireIso(evidence.recordedAt, "manualReview.recordedAt"),
  };
}

export function validateAutomaticDrawProgression(
  value: unknown,
): AutomaticDrawProgression {
  const progression = exactObject(value, [
    "schemaVersion",
    "state",
    "updatedAt",
    "preflight",
    "manualReview",
  ], "automaticDrawProgression");
  if (progression.schemaVersion !== AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION) {
    throw new Error("Unsupported automatic Draw progression schema version.");
  }
  const updatedAt = requireIso(progression.updatedAt, "automaticDrawProgression.updatedAt");
  if (progression.state === "RESERVED") {
    if (progression.preflight !== null || progression.manualReview !== null) {
      throw new Error("RESERVED progression must not contain terminal evidence.");
    }
    return {
      schemaVersion: AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION,
      state: "RESERVED",
      updatedAt,
      preflight: null,
      manualReview: null,
    };
  }
  if (progression.state === "PREFLIGHT_READY") {
    if (progression.manualReview !== null) {
      throw new Error("PREFLIGHT_READY progression must not contain manual-review evidence.");
    }
    const preflight = validatePreflightEvidence(progression.preflight);
    if (preflight.completedAt !== updatedAt) {
      throw new Error("PREFLIGHT_READY timestamps must match.");
    }
    return {
      schemaVersion: AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION,
      state: "PREFLIGHT_READY",
      updatedAt,
      preflight,
      manualReview: null,
    };
  }
  if (progression.state === "MANUAL_REVIEW_REQUIRED") {
    if (progression.preflight !== null) {
      throw new Error("MANUAL_REVIEW_REQUIRED must not contain ready evidence.");
    }
    const manualReview = validateManualReviewEvidence(progression.manualReview);
    if (manualReview.recordedAt !== updatedAt) {
      throw new Error("MANUAL_REVIEW_REQUIRED timestamps must match.");
    }
    return {
      schemaVersion: AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION,
      state: "MANUAL_REVIEW_REQUIRED",
      updatedAt,
      preflight: null,
      manualReview,
    };
  }
  throw new Error("Automatic Draw progression state is invalid.");
}

export function createReservedAutomaticDrawProgression(
  updatedAt: string,
): AutomaticDrawProgression {
  return validateAutomaticDrawProgression({
    schemaVersion: AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION,
    state: "RESERVED",
    updatedAt,
    preflight: null,
    manualReview: null,
  });
}

export function validateAutomaticDrawStoredOperation(
  value: unknown,
): AutomaticDrawStoredOperation {
  const operation = exactObject(
    value,
    ["revision", "record", "progression"],
    "automaticDrawStoredOperation",
  );
  if (!Number.isSafeInteger(operation.revision) || (operation.revision as number) < 1) {
    throw new Error("Automatic Draw operation revision is invalid.");
  }
  const record = validateAutomaticDrawReservationRecord(operation.record);
  const progression = validateAutomaticDrawProgression(operation.progression);
  if (
    progression.updatedAt < record.updatedAt ||
    progression.updatedAt < record.createdAt
  ) {
    throw new Error("Automatic Draw progression timestamp predates its reservation.");
  }
  return {
    revision: operation.revision as number,
    record,
    progression,
  };
}

export function validateAutomaticDrawProgressionTransition(
  transition: AutomaticDrawProgressionTransition,
  current: AutomaticDrawStoredOperation,
): AutomaticDrawProgressionTransition {
  if (
    transition.logicalDrawKey !== current.record.logicalDrawKey ||
    transition.expectedRevision !== current.revision ||
    transition.expectedState !== "RESERVED" ||
    current.progression.state !== "RESERVED"
  ) {
    throw new Error("Automatic Draw progression transition precondition failed.");
  }
  const next = validateAutomaticDrawProgression(transition.next);
  if (next.state === "RESERVED") {
    throw new Error("Automatic Draw progression cannot rewrite RESERVED.");
  }
  if (next.updatedAt <= current.progression.updatedAt) {
    throw new Error("Automatic Draw progression timestamp must move forward.");
  }
  return {
    logicalDrawKey: transition.logicalDrawKey,
    expectedRevision: transition.expectedRevision,
    expectedState: "RESERVED",
    next,
  };
}

function nextIsoTimestamp(after: string, nowValue?: string): string {
  const candidate = requireIso(
    nowValue ?? new Date().toISOString(),
    "automaticDrawProgression.nextTimestamp",
  );
  return candidate > after
    ? candidate
    : new Date(Date.parse(after) + 1).toISOString();
}

function manualProgression(
  phase3Status: AutomaticDrawDryRunStatus,
  reason: unknown,
  after: string,
  nowValue?: string,
): AutomaticDrawTerminalProgression {
  const recordedAt = nextIsoTimestamp(after, nowValue);
  return validateAutomaticDrawProgression({
    schemaVersion: AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION,
    state: "MANUAL_REVIEW_REQUIRED",
    updatedAt: recordedAt,
    preflight: null,
    manualReview: {
      phase3Status,
      reason: sanitizeAutomaticDrawReviewReason(reason),
      recordedAt,
    },
  }) as AutomaticDrawTerminalProgression;
}

export function mapAutomaticDrawDryRunToProgression(
  dryRun: AutomaticDrawDryRunResult,
  operatorAddress: string,
  after: string,
  nowValue?: string,
): AutomaticDrawTerminalProgression {
  if (dryRun.status !== "READY_FOR_EXECUTION") {
    return manualProgression(
      dryRun.status,
      dryRun.reason,
      after,
      nowValue,
    );
  }
  const completedAt = nextIsoTimestamp(after, nowValue);
  try {
    return validateAutomaticDrawProgression({
      schemaVersion: AUTOMATIC_DRAW_PROGRESSION_SCHEMA_VERSION,
      state: "PREFLIGHT_READY",
      updatedAt: completedAt,
      preflight: {
        phase3Status: "READY_FOR_EXECUTION",
        planId: dryRun.evidence.planId,
        revalidationBlock: dryRun.evidence.revalidationBlock,
        publicOperatorAddress: operatorAddress,
        gasEstimate: dryRun.evidence.gasEstimate,
        runtimeGasEstimate: dryRun.evidence.runtimeGasEstimate,
        bufferedGasLimit: dryRun.evidence.bufferedGasLimit,
        completedAt,
        dryRunOnly: true,
        transactionAuthorized: false,
        transactionSent: false,
      },
      manualReview: null,
    }) as AutomaticDrawTerminalProgression;
  } catch {
    return manualProgression(
      "READY_FOR_EXECUTION",
      "Successful preflight evidence was incomplete or invalid.",
      after,
      nowValue,
    );
  }
}

function terminalResult(
  operation: AutomaticDrawStoredOperation,
  preflightExecuted: boolean,
): AutomaticDrawProgressionCycleResult {
  if (operation.progression.state === "PREFLIGHT_READY") {
    return {
      status: "PREFLIGHT_READY",
      operation,
      preflightExecuted,
      dryRunOnly: true,
      transactionAuthorized: false,
      transactionSent: false,
      reason:
        "The last persisted non-transactional dry-run preflight completed successfully.",
    };
  }
  if (operation.progression.state === "MANUAL_REVIEW_REQUIRED") {
    return {
      status: "MANUAL_REVIEW_REQUIRED",
      operation,
      preflightExecuted,
      dryRunOnly: true,
      transactionAuthorized: false,
      transactionSent: false,
      reason: operation.progression.manualReview.reason,
    };
  }
  return reconciliationResult(
    "Automatic Draw progression remained RESERVED after a terminal transition.",
  );
}

function reconciliationResult(reason: string): AutomaticDrawProgressionCycleResult {
  return {
    status: "RECONCILIATION_REQUIRED",
    operation: null,
    preflightExecuted: false,
    dryRunOnly: true,
    transactionAuthorized: false,
    transactionSent: false,
    reason,
  };
}

function sameReservation(
  left: AutomaticDrawReservationRecord,
  right: AutomaticDrawReservationRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readStoredOperation(
  storage: AutomaticDrawProgressionStorage,
  logicalDrawKey: string,
): Promise<AutomaticDrawStoredOperation | null> {
  const read = await storage.read(logicalDrawKey);
  if (read.status !== "FOUND") return null;
  return validateAutomaticDrawStoredOperation(read.operation);
}

export async function runAutomaticDrawProgressionCycle(
  options: AutomaticDrawProgressionCycleOptions,
): Promise<AutomaticDrawProgressionCycleResult> {
  if (options.reservation.status === "NO_RESERVATION") {
    return {
      status: "NO_RESERVATION",
      operation: null,
      preflightExecuted: false,
      dryRunOnly: true,
      transactionAuthorized: false,
      transactionSent: false,
      reason: options.reservation.reason,
    };
  }
  if (options.reservation.status === "RECONCILIATION_REQUIRED") {
    return reconciliationResult(options.reservation.reason);
  }

  let reserved: AutomaticDrawReservationRecord;
  let stored: AutomaticDrawStoredOperation | null;
  try {
    reserved = validateAutomaticDrawReservationRecord(options.reservation.operation);
    stored = await readStoredOperation(
      options.storage,
      options.reservation.decision.logicalDrawKey,
    );
  } catch {
    return reconciliationResult(
      "Durable Automatic Draw progression could not be safely inspected.",
    );
  }
  if (
    !stored ||
    !sameReservation(stored.record, reserved) ||
    stored.record.logicalDrawKey !== options.reservation.decision.logicalDrawKey
  ) {
    return reconciliationResult(
      "Durable Automatic Draw progression does not match its reservation.",
    );
  }
  if (stored.progression.state !== "RESERVED") {
    return terminalResult(stored, false);
  }

  const recoverableReservation: AutomaticDrawReservationCycleResult = {
    status: "RESERVED_FIRST_TIME",
    decision: options.reservation.decision,
    operation: stored.record,
    reconciliationRequired: false,
    reason:
      "A durable RESERVED Draw is eligible for non-transactional dry-run recovery.",
  };
  let next: AutomaticDrawTerminalProgression;
  try {
    const dryRun = await options.runDryRun({
      reservation: recoverableReservation,
      operatorAddress: options.operatorAddress,
      dependencies: options.dependencies,
      ...(options.maxPlanAgeSeconds === undefined
        ? {}
        : { maxPlanAgeSeconds: options.maxPlanAgeSeconds }),
    });
    next = mapAutomaticDrawDryRunToProgression(
      dryRun,
      options.operatorAddress,
      stored.progression.updatedAt,
      options.now,
    );
  } catch {
    next = manualProgression(
      "PREFLIGHT_FAILED",
      "Automatic Draw dry-run preflight ended unexpectedly.",
      stored.progression.updatedAt,
      options.now,
    );
  }

  let transition: AutomaticDrawAtomicTransitionResult;
  try {
    transition = await options.storage.transitionIfCurrent({
      logicalDrawKey: stored.record.logicalDrawKey,
      expectedRevision: stored.revision,
      expectedState: "RESERVED",
      next,
    });
  } catch {
    return reconciliationResult(
      "Durable Automatic Draw transition failed before its outcome was known.",
    );
  }
  if (transition.status === "UNKNOWN") {
    return reconciliationResult(
      "Durable Automatic Draw transition outcome is unknown; inspect state before retrying.",
    );
  }
  if (transition.status === "UPDATED") {
    try {
      return terminalResult(
        validateAutomaticDrawStoredOperation(transition.operation),
        true,
      );
    } catch {
      return reconciliationResult(
        "Updated Automatic Draw progression could not be validated.",
      );
    }
  }
  if (transition.operation === null) {
    return reconciliationResult(
      "Automatic Draw progression transition conflicted with missing durable state.",
    );
  }
  try {
    const concurrent = validateAutomaticDrawStoredOperation(transition.operation);
    if (
      sameReservation(concurrent.record, stored.record) &&
      concurrent.progression.state !== "RESERVED"
    ) {
      return terminalResult(concurrent, true);
    }
  } catch {
    // The conflict remains uncertain and fails closed below.
  }
  return reconciliationResult(
    "Automatic Draw progression changed concurrently and requires reconciliation.",
  );
}
