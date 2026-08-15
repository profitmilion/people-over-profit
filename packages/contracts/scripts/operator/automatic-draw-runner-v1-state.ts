import { readFile } from "node:fs/promises";

import {
  validateAutomaticDrawReservationRecord,
  type AutomaticDrawAtomicReservationResult,
  type AutomaticDrawAtomicReservationStorage,
  type AutomaticDrawReservationRecord,
} from "./automatic-draw-runner-v1-reservation.js";
import {
  assertSafeExternalFilePath,
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
  type AtomicWriteHooks,
} from "./durable-file.js";

const DRAW_STATE_SUFFIX = ".automatic-draw-state.json";
const DRAW_STATE_FORMAT_VERSION = 1 as const;

export interface JsonAutomaticDrawReservationEntry {
  revision: number;
  record: AutomaticDrawReservationRecord;
}

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

function validateEntry(
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
  return {
    revision: expectedRevision,
    record: validateAutomaticDrawReservationRecord(entry.record),
  };
}

export function validateAutomaticDrawReservationState(
  value: unknown,
): AutomaticDrawReservationState {
  const state = exactObject(value, [
    "formatVersion",
    "revision",
    "createdAt",
    "updatedAt",
    "operations",
  ], "automaticDrawState");
  if (state.formatVersion !== DRAW_STATE_FORMAT_VERSION) {
    throw new Error("Unsupported automatic Draw state format version.");
  }
  if (!Number.isSafeInteger(state.revision) || (state.revision as number) < 0) {
    throw new Error("Automatic Draw state revision is invalid.");
  }
  const createdAt = requireIso(state.createdAt, "automaticDrawState.createdAt");
  const updatedAt = requireIso(state.updatedAt, "automaticDrawState.updatedAt");
  if (updatedAt < createdAt) throw new Error("Automatic Draw state timestamp regressed.");
  if (!Array.isArray(state.operations)) {
    throw new Error("Automatic Draw state operations must be an array.");
  }
  if (state.operations.length !== state.revision) {
    throw new Error("Automatic Draw state revision does not match its operation count.");
  }
  const operations = state.operations.map((operation, index) =>
    validateEntry(operation, index + 1));
  const keys = new Set(operations.map(({ record }) => record.logicalDrawKey));
  if (keys.size !== operations.length) {
    throw new Error("Automatic Draw state contains duplicate logical operations.");
  }
  for (const { record } of operations) {
    if (record.createdAt < createdAt || record.updatedAt > updatedAt) {
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
implements AutomaticDrawAtomicReservationStorage {
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
          updatedAt: now,
          operations: [...state.operations, { revision, record }],
        };
        const validated = validateAutomaticDrawReservationState(updated);
        await atomicWritePrivateFile(
          filePath,
          `${JSON.stringify(validated, null, 2)}\n`,
          this.hooks,
        );
        await this.hooks.afterDurableWrite?.();
        return {
          status: "CREATED",
          record: validated.operations[revision - 1].record,
        };
      });
    } catch {
      return { status: "UNKNOWN" };
    }
  }
}
