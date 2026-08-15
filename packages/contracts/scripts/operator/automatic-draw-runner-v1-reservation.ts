import { randomUUID } from "node:crypto";

import { getAddress, isAddress, ZeroAddress } from "ethers";

import {
  logicalDrawKey,
  runAutomaticDrawReadOnlyDecisionCycle,
  type AutomaticDrawDueDecision,
  type AutomaticDrawReadOnlyDecision,
  type AutomaticDrawReadOnlyDecisionCycleOptions,
} from "./automatic-draw-runner-v1-decision.js";

export const AUTOMATIC_DRAW_RESERVATION_SCHEMA_VERSION = 1 as const;

const DECIMAL = /^(?:0|[1-9]\d*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AutomaticDrawReservationRecord {
  schemaVersion: typeof AUTOMATIC_DRAW_RESERVATION_SCHEMA_VERSION;
  logicalDrawKey: string;
  action: "Draw";
  chainId: string;
  contractAddress: string;
  poolId: string;
  roundNumber: string;
  state: "RESERVED";
  createdAt: string;
  updatedAt: string;
  sourceBlock: string;
  scheduledAt: string;
  invocationId: string;
}

export type AutomaticDrawAtomicReservationResult =
  | {
      status: "CREATED" | "EXISTING";
      record: unknown;
    }
  | {
      status: "UNKNOWN";
    };

export interface AutomaticDrawAtomicReservationStorage {
  /** Atomically create this logical Draw only if it does not already exist. */
  reserveIfAbsent(
    record: AutomaticDrawReservationRecord,
  ): Promise<AutomaticDrawAtomicReservationResult>;
}

export type AutomaticDrawReservationResult =
  | {
      status: "RESERVED_FIRST_TIME" | "EXISTING_OPERATION";
      operation: AutomaticDrawReservationRecord;
      reconciliationRequired: boolean;
      reason: string;
    }
  | {
      status: "RECONCILIATION_REQUIRED";
      operation: null;
      reconciliationRequired: true;
      reason: string;
    };

export interface AutomaticDrawReservationCycleOptions
  extends AutomaticDrawReadOnlyDecisionCycleOptions {
  storage: AutomaticDrawAtomicReservationStorage;
  invocationId?: string;
}

export type AutomaticDrawReservationCycleResult =
  | {
      status: "NO_RESERVATION";
      decision: Exclude<AutomaticDrawReadOnlyDecision, AutomaticDrawDueDecision>;
      operation: null;
      reconciliationRequired: boolean;
      reason: string;
    }
  | (AutomaticDrawReservationResult & {
      decision: AutomaticDrawDueDecision;
    });

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

function requireAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be an EVM address.`);
  }
  const address = getAddress(value);
  if (address === ZeroAddress) throw new Error(`${label} must not be zero.`);
  return address;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function validateAutomaticDrawReservationRecord(
  value: unknown,
): AutomaticDrawReservationRecord {
  const record = exactObject(value, [
    "schemaVersion",
    "logicalDrawKey",
    "action",
    "chainId",
    "contractAddress",
    "poolId",
    "roundNumber",
    "state",
    "createdAt",
    "updatedAt",
    "sourceBlock",
    "scheduledAt",
    "invocationId",
  ], "automaticDrawReservation");
  if (record.schemaVersion !== AUTOMATIC_DRAW_RESERVATION_SCHEMA_VERSION) {
    throw new Error("Unsupported automatic Draw reservation schema version.");
  }
  if (record.action !== "Draw") throw new Error("Draw reservation action is invalid.");
  if (record.state !== "RESERVED") throw new Error("Draw reservation state is invalid.");
  const chainId = requireDecimal(record.chainId, "reservation.chainId", true);
  const contractAddress = requireAddress(
    record.contractAddress,
    "reservation.contractAddress",
  );
  const poolId = requireDecimal(record.poolId, "reservation.poolId", true);
  const roundNumber = requireDecimal(
    record.roundNumber,
    "reservation.roundNumber",
    true,
  );
  const createdAt = requireIso(record.createdAt, "reservation.createdAt");
  const updatedAt = requireIso(record.updatedAt, "reservation.updatedAt");
  if (updatedAt < createdAt) throw new Error("Draw reservation timestamp regressed.");
  const sourceBlock = requireDecimal(
    record.sourceBlock,
    "reservation.sourceBlock",
    false,
  );
  const scheduledAt = requireDecimal(
    record.scheduledAt,
    "reservation.scheduledAt",
    false,
  );
  const invocationId = requireUuid(record.invocationId, "reservation.invocationId");
  const expectedKey = logicalDrawKey({
    chainId: BigInt(chainId),
    contractAddress,
    poolId: BigInt(poolId),
    roundNumber: BigInt(roundNumber),
  });
  if (record.logicalDrawKey !== expectedKey) {
    throw new Error("Draw reservation logical identity does not match its scope.");
  }
  return {
    schemaVersion: AUTOMATIC_DRAW_RESERVATION_SCHEMA_VERSION,
    logicalDrawKey: expectedKey,
    action: "Draw",
    chainId,
    contractAddress,
    poolId,
    roundNumber,
    state: "RESERVED",
    createdAt,
    updatedAt,
    sourceBlock,
    scheduledAt,
    invocationId,
  };
}

export function createAutomaticDrawReservationRecord(
  decision: AutomaticDrawDueDecision,
  invocationIdValue: string = randomUUID(),
  nowValue = new Date().toISOString(),
): AutomaticDrawReservationRecord {
  if (decision.sourceBlock === null) {
    throw new Error("A Draw reservation requires a trusted source block.");
  }
  const expectedKey = logicalDrawKey({
    chainId: decision.chainId,
    contractAddress: decision.contractAddress,
    poolId: decision.poolId,
    roundNumber: decision.roundNumber,
  });
  if (decision.logicalDrawKey !== expectedKey) {
    throw new Error("Phase 1 logical Draw identity is inconsistent.");
  }
  if (decision.scheduledAt < 0n || decision.sourceBlock < 0n) {
    throw new Error("Phase 1 Draw evidence contains a negative value.");
  }
  return validateAutomaticDrawReservationRecord({
    schemaVersion: AUTOMATIC_DRAW_RESERVATION_SCHEMA_VERSION,
    logicalDrawKey: expectedKey,
    action: "Draw",
    chainId: decision.chainId.toString(),
    contractAddress: getAddress(decision.contractAddress),
    poolId: decision.poolId.toString(),
    roundNumber: decision.roundNumber.toString(),
    state: "RESERVED",
    createdAt: nowValue,
    updatedAt: nowValue,
    sourceBlock: decision.sourceBlock.toString(),
    scheduledAt: decision.scheduledAt.toString(),
    invocationId: invocationIdValue,
  });
}

function reconciliationRequired(): AutomaticDrawReservationResult {
  return {
    status: "RECONCILIATION_REQUIRED",
    operation: null,
    reconciliationRequired: true,
    reason:
      "Durable Draw state could not be safely validated or updated; stop and reconcile.",
  };
}

export function mapAutomaticDrawAtomicReservationResult(
  requested: AutomaticDrawReservationRecord,
  result: AutomaticDrawAtomicReservationResult,
): AutomaticDrawReservationResult {
  if (result.status === "UNKNOWN") return reconciliationRequired();
  try {
    const stored = validateAutomaticDrawReservationRecord(result.record);
    if (stored.logicalDrawKey !== requested.logicalDrawKey) {
      return reconciliationRequired();
    }
    if (
      result.status === "CREATED" &&
      JSON.stringify(stored) !== JSON.stringify(requested)
    ) {
      return reconciliationRequired();
    }
    if (result.status === "CREATED") {
      return {
        status: "RESERVED_FIRST_TIME",
        operation: stored,
        reconciliationRequired: false,
        reason: "One durable reservation was created for this logical Draw.",
      };
    }
    return {
      status: "EXISTING_OPERATION",
      operation: stored,
      reconciliationRequired: true,
      reason: "This logical Draw already has a durable reservation.",
    };
  } catch {
    return reconciliationRequired();
  }
}

export async function reserveAutomaticDraw(
  decision: AutomaticDrawDueDecision,
  storage: AutomaticDrawAtomicReservationStorage,
  invocationId?: string,
): Promise<AutomaticDrawReservationResult> {
  try {
    const requested = createAutomaticDrawReservationRecord(decision, invocationId);
    const result = await storage.reserveIfAbsent(requested);
    return mapAutomaticDrawAtomicReservationResult(requested, result);
  } catch {
    return reconciliationRequired();
  }
}

export async function runAutomaticDrawReservationCycle(
  options: AutomaticDrawReservationCycleOptions,
): Promise<AutomaticDrawReservationCycleResult> {
  const decision = await runAutomaticDrawReadOnlyDecisionCycle(options);
  if (decision.status !== "DRAW_DUE") {
    return {
      status: "NO_RESERVATION",
      decision,
      operation: null,
      reconciliationRequired:
        decision.status === "AMBIGUOUS" ||
        decision.status === "INCONSISTENT" ||
        decision.status === "READ_FAILED",
      reason: decision.reason,
    };
  }
  return {
    ...await reserveAutomaticDraw(decision, options.storage, options.invocationId),
    decision,
  };
}
