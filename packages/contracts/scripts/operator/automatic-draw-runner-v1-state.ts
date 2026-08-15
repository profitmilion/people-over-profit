import { readFile } from "node:fs/promises";

import {
  validateAutomaticDrawReservationRecord,
  type AutomaticDrawAtomicReservationResult,
  type AutomaticDrawAtomicReservationStorage,
  type AutomaticDrawReservationRecord,
} from "./automatic-draw-runner-v1-reservation.js";
import {
  createReservedAutomaticDrawProgression,
  validateAutomaticDrawProgression,
  validateAutomaticDrawProgressionTransition,
  validateAutomaticDrawStoredOperation,
  type AutomaticDrawAtomicTransitionResult,
  type AutomaticDrawProgressionReadResult,
  type AutomaticDrawProgressionStorage,
  type AutomaticDrawProgressionTransition,
  type AutomaticDrawStoredOperation,
} from "./automatic-draw-runner-v1-progression.js";
import {
  assertSafeExternalFilePath,
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
  type AtomicWriteHooks,
} from "./durable-file.js";

const DRAW_STATE_SUFFIX = ".automatic-draw-state.json";
const DRAW_STATE_FORMAT_VERSION = 2 as const;

export type JsonAutomaticDrawReservationEntry = AutomaticDrawStoredOperation;

export interface AutomaticDrawReservationState {
  formatVersion: typeof DRAW_STATE_FORMAT_VERSION;
  revision: number;
  createdAt: string;
  updatedAt: string;
  operations: readonly JsonAutomaticDrawReservationEntry[];
}

export interface AutomaticDrawReservationFaultHooks extends AtomicWriteHooks {
  beforeLock?(): Promise<void> | void;
  afterLockAcquired?(): Promise<void> | void;
  afterDurableWrite?(): Promise<void> | void;
}

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

function validateLegacyEntry(
  value: unknown,
  expectedRevision: number,
): JsonAutomaticDrawReservationEntry {
  const entry = exactObject(
    value,
    ["revision", "record"],
    "automaticDrawState.operation",
  );
  if (entry.revision !== expectedRevision) {
    throw new Error("Automatic Draw filesystem revision is inconsistent.");
  }
  const record = validateAutomaticDrawReservationRecord(entry.record);
  return {
    revision: expectedRevision,
    record,
    progression: createReservedAutomaticDrawProgression(record.updatedAt),
  };
}

function validateEntry(value: unknown): JsonAutomaticDrawReservationEntry {
  return validateAutomaticDrawStoredOperation(value);
}

export function validateAutomaticDrawReservationState(
  value: unknown,
): AutomaticDrawReservationState {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (candidate.formatVersion !== 1 && candidate.formatVersion !== 2) {
    throw new Error("Unsupported automatic Draw state format version.");
  }
  const state = exactObject(value, [
    "formatVersion",
    "revision",
    "createdAt",
    "updatedAt",
    "operations",
  ], "automaticDrawState");
  if (!Number.isSafeInteger(state.revision) || (state.revision as number) < 0) {
    throw new Error("Automatic Draw state revision is invalid.");
  }
  const createdAt = requireIso(state.createdAt, "automaticDrawState.createdAt");
  const updatedAt = requireIso(state.updatedAt, "automaticDrawState.updatedAt");
  if (updatedAt < createdAt) throw new Error("Automatic Draw state timestamp regressed.");
  if (!Array.isArray(state.operations)) {
    throw new Error("Automatic Draw state operations must be an array.");
  }
  const legacy = state.formatVersion === 1;
  if (legacy && state.operations.length !== state.revision) {
    throw new Error("Automatic Draw state revision does not match its operation count.");
  }
  const operations = state.operations.map((operation, index) =>
    legacy ? validateLegacyEntry(operation, index + 1) : validateEntry(operation));
  if (!legacy) {
    const revisions = operations.map(({ revision }) => revision);
    if (
      operations.length > (state.revision as number) ||
      new Set(revisions).size !== revisions.length ||
      revisions.some((revision) => revision > (state.revision as number)) ||
      ((state.revision as number) === 0
        ? operations.length !== 0
        : Math.max(...revisions) !== state.revision)
    ) {
      throw new Error("Automatic Draw operation revisions are inconsistent.");
    }
  }
  const keys = new Set(operations.map(({ record }) => record.logicalDrawKey));
  if (keys.size !== operations.length) {
    throw new Error("Automatic Draw state contains duplicate logical operations.");
  }
  for (const { record, progression } of operations) {
    if (
      record.createdAt < createdAt ||
      record.updatedAt > updatedAt ||
      progression.updatedAt > updatedAt
    ) {
      throw new Error("Automatic Draw operation timestamp is outside state history.");
    }
  }
  return {
    formatVersion: DRAW_STATE_FORMAT_VERSION,
    revision: state.revision as number,
    createdAt,
    updatedAt,
    operations,
  };
}

function newState(now: string): AutomaticDrawReservationState {
  return {
    formatVersion: DRAW_STATE_FORMAT_VERSION,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    operations: [],
  };
}

async function readState(filePath: string): Promise<AutomaticDrawReservationState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Automatic Draw state is incomplete or invalid JSON.");
  }
  return validateAutomaticDrawReservationState(parsed);
}

export async function inspectAutomaticDrawReservationState(
  filePathValue: string,
): Promise<AutomaticDrawReservationState> {
  const filePath = await assertSafeExternalFilePath(
    filePathValue,
    DRAW_STATE_SUFFIX,
  );
  if (!(await pathIsRegularFile(filePath))) {
    throw new Error("Automatic Draw state does not exist.");
  }
  return readState(filePath);
}

export class JsonAutomaticDrawReservationStore
implements AutomaticDrawAtomicReservationStorage, AutomaticDrawProgressionStorage {
  constructor(
    private readonly filePathValue: string,
    private readonly hooks: AutomaticDrawReservationFaultHooks = {},
  ) {}

  async reserveIfAbsent(
    record: AutomaticDrawReservationRecord,
  ): Promise<AutomaticDrawAtomicReservationResult> {
    try {
      await this.hooks.beforeLock?.();
      const filePath = await assertSafeExternalFilePath(
        this.filePathValue,
        DRAW_STATE_SUFFIX,
      );
      return await withExclusiveFileLock(filePath, async () => {
        await this.hooks.afterLockAcquired?.();
        const exists = await pathIsRegularFile(filePath);
        const now = new Date().toISOString();
        const state = exists ? await readState(filePath) : newState(record.createdAt);
        const existing = state.operations.find((operation) =>
          operation.record.logicalDrawKey === record.logicalDrawKey);
        if (existing) {
          return {
            status: "EXISTING",
            record: existing.record,
          };
        }
        const revision = state.revision + 1;
        const updated: AutomaticDrawReservationState = {
          ...state,
          revision,
          updatedAt: [state.updatedAt, record.updatedAt, now].sort().at(-1) as string,
          operations: [...state.operations, {
            revision,
            record,
            progression: createReservedAutomaticDrawProgression(record.updatedAt),
          }],
        };
        const validated = validateAutomaticDrawReservationState(updated);
        const created = validated.operations.at(-1);
        if (!created) throw new Error("Created Automatic Draw operation is missing.");
        await atomicWritePrivateFile(
          filePath,
          `${JSON.stringify(validated, null, 2)}\n`,
          this.hooks,
        );
        await this.hooks.afterDurableWrite?.();
        return {
          status: "CREATED",
          record: created.record,
        };
      });
    } catch {
      return { status: "UNKNOWN" };
    }
  }

  async read(
    logicalDrawKey: string,
  ): Promise<AutomaticDrawProgressionReadResult> {
    try {
      const filePath = await assertSafeExternalFilePath(
        this.filePathValue,
        DRAW_STATE_SUFFIX,
      );
      if (!(await pathIsRegularFile(filePath))) return { status: "NOT_FOUND" };
      const state = await readState(filePath);
      const operation = state.operations.find((entry) =>
        entry.record.logicalDrawKey === logicalDrawKey);
      return operation
        ? { status: "FOUND", operation: structuredClone(operation) }
        : { status: "NOT_FOUND" };
    } catch {
      return { status: "UNKNOWN" };
    }
  }

  async transitionIfCurrent(
    transition: AutomaticDrawProgressionTransition,
  ): Promise<AutomaticDrawAtomicTransitionResult> {
    try {
      await this.hooks.beforeLock?.();
      const filePath = await assertSafeExternalFilePath(
        this.filePathValue,
        DRAW_STATE_SUFFIX,
      );
      return await withExclusiveFileLock(filePath, async () => {
        await this.hooks.afterLockAcquired?.();
        if (!(await pathIsRegularFile(filePath))) {
          return { status: "CONFLICT", operation: null };
        }
        const state = await readState(filePath);
        const index = state.operations.findIndex((entry) =>
          entry.record.logicalDrawKey === transition.logicalDrawKey);
        if (index < 0) return { status: "CONFLICT", operation: null };
        const current = state.operations[index];
        if (
          current.revision !== transition.expectedRevision ||
          current.progression.state !== transition.expectedState
        ) {
          return {
            status: "CONFLICT",
            operation: structuredClone(current),
          };
        }
        const validatedTransition = validateAutomaticDrawProgressionTransition(
          transition,
          current,
        );
        const revision = state.revision + 1;
        const updatedOperation = validateAutomaticDrawStoredOperation({
          revision,
          record: current.record,
          progression: validateAutomaticDrawProgression(validatedTransition.next),
        });
        const operations = [...state.operations];
        operations[index] = updatedOperation;
        const updated = validateAutomaticDrawReservationState({
          ...state,
          formatVersion: DRAW_STATE_FORMAT_VERSION,
          revision,
          updatedAt: [
            state.updatedAt,
            updatedOperation.progression.updatedAt,
          ].sort().at(-1) as string,
          operations,
        });
        await atomicWritePrivateFile(
          filePath,
          `${JSON.stringify(updated, null, 2)}\n`,
          this.hooks,
        );
        await this.hooks.afterDurableWrite?.();
        return {
          status: "UPDATED",
          operation: structuredClone(updatedOperation),
        };
      });
    } catch {
      return { status: "UNKNOWN" };
    }
  }
}
