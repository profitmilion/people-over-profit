import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { getAddress, isAddress } from "ethers";

import {
  assertSafeExternalFilePath,
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
  type AtomicWriteHooks,
} from "./durable-file.js";

const JOURNAL_SUFFIX = ".operator-journal.json";
const FORMAT_VERSION = 1;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const OPERATION_ACTIONS = [
  "faucet",
  "approve",
  "join",
  "withdraw",
  "draw",
  "claim",
] as const;
export type OperationAction = (typeof OPERATION_ACTIONS)[number];

export const OPERATION_STATUSES = [
  "prepared",
  "ready_to_broadcast",
  "broadcast",
  "pending",
  "confirmed",
  "failed",
  "replaced",
  "cancelled",
  "requires_manual_review",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export interface JournalReceiptSummary {
  transactionHash: string;
  blockNumber: number;
  status: 0 | 1;
  gasUsed: string;
}

export interface JournalOperation {
  operationId: string;
  idempotencyKey: string;
  runId: string;
  action: OperationAction;
  scope: string;
  walletAddress: string;
  chainId: string;
  contractAddress: string;
  tokenAddress: string | null;
  poolId: string | null;
  round: number | null;
  nonce: number | null;
  transactionHash: string | null;
  parameterDigest: string;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
  receipt: JournalReceiptSummary | null;
  error: string | null;
}

export interface TransactionJournalData {
  formatVersion: 1;
  journalId: string;
  revision: number;
  chainId: string;
  contractAddress: string;
  tokenAddress: string;
  createdAt: string;
  updatedAt: string;
  operations: JournalOperation[];
}

export interface OperationMeaning {
  action: OperationAction;
  scope: string;
  walletAddress: string;
  chainId: bigint;
  contractAddress: string;
  tokenAddress?: string;
  poolId?: bigint;
  round?: number;
  parameters?: unknown;
}

export interface JournalIdentity {
  chainId: bigint;
  contractAddress: string;
  tokenAddress: string;
}

export interface TransactionJournal {
  readonly runId: string;
  snapshot(): TransactionJournalData;
  prepare(meaning: OperationMeaning): Promise<JournalOperation>;
  transition(
    operationId: string,
    status: OperationStatus,
    update?: Partial<Pick<JournalOperation, "nonce" | "transactionHash" | "receipt" | "error">>,
  ): Promise<JournalOperation>;
  find(operationId: string): JournalOperation | undefined;
}

const ALLOWED_TRANSITIONS: Record<OperationStatus, ReadonlySet<OperationStatus>> = {
  prepared: new Set(["ready_to_broadcast", "failed", "requires_manual_review"]),
  ready_to_broadcast: new Set(["broadcast", "failed", "requires_manual_review"]),
  broadcast: new Set(["pending", "confirmed", "failed", "replaced", "cancelled", "requires_manual_review"]),
  pending: new Set(["confirmed", "failed", "replaced", "cancelled", "requires_manual_review"]),
  confirmed: new Set(),
  failed: new Set(),
  replaced: new Set(),
  cancelled: new Set(),
  requires_manual_review: new Set(),
};

function digest(value: string): string {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function isoNow(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be an EVM address.`);
  return getAddress(value);
}

function requireIso(value: unknown, label: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${label} must be a 32-byte hash.`);
  return value.toLowerCase();
}

function requireDecimal(value: unknown, label: string, allowNull = false): string | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error(`${label} must be an unsigned decimal.`);
  return value;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  for (const key of keys) if (!(key in record)) throw new Error(`${label}.${key} is required.`);
  return record;
}

export function sanitizeOperatorError(error: unknown): string {
  const raw = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Operator operation failed.";
  return raw
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[redacted]@")
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\b(mnemonic|seed phrase)\s*[:=]\s*(?:[a-z]+\s+){11,23}[a-z]+/gi, "$1=[redacted]")
    .replace(/\b(?:0x)?[0-9a-f]{64}\b/gi, "[redacted-64-byte-value]")
    .replace(/\b(private key|mnemonic|seed phrase|password|passphrase)\s*[:=]\s*[^\r\n]+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function assertSafeScope(scope: string): void {
  if (!scope || scope.length > 120 || sanitizeOperatorError(scope) !== scope) {
    throw new Error("Operation scope is required, bounded, and must not contain secret-like data.");
  }
}

export function operationIdFor(meaning: OperationMeaning): string {
  assertSafeScope(meaning.scope);
  const normalized = {
    action: meaning.action,
    scope: meaning.scope,
    walletAddress: getAddress(meaning.walletAddress),
    chainId: meaning.chainId.toString(),
    contractAddress: getAddress(meaning.contractAddress),
    tokenAddress: meaning.tokenAddress ? getAddress(meaning.tokenAddress) : null,
    poolId: meaning.poolId?.toString() ?? null,
    round: meaning.round ?? null,
    parameterDigest: digest(canonicalize(meaning.parameters ?? null)),
  };
  return operationIdFromNormalized(normalized);
}

function operationIdFromNormalized(normalized: {
  action: OperationAction;
  scope: string;
  walletAddress: string;
  chainId: string;
  contractAddress: string;
  tokenAddress: string | null;
  poolId: string | null;
  round: number | null;
  parameterDigest: string;
}): string {
  return digest(`pop33-operator-operation:v1:${canonicalize(normalized)}`);
}

function operationFromMeaning(meaning: OperationMeaning, runId: string): JournalOperation {
  if (!OPERATION_ACTIONS.includes(meaning.action)) throw new Error("Unsupported journal action.");
  assertSafeScope(meaning.scope);
  if (meaning.round !== undefined && (!Number.isSafeInteger(meaning.round) || meaning.round < 1 || meaning.round > 10)) {
    throw new Error("Operation round must be between 1 and 10.");
  }
  const now = isoNow();
  const operationId = operationIdFor(meaning);
  return {
    operationId,
    idempotencyKey: operationId,
    runId,
    action: meaning.action,
    scope: meaning.scope,
    walletAddress: getAddress(meaning.walletAddress),
    chainId: meaning.chainId.toString(),
    contractAddress: getAddress(meaning.contractAddress),
    tokenAddress: meaning.tokenAddress ? getAddress(meaning.tokenAddress) : null,
    poolId: meaning.poolId?.toString() ?? null,
    round: meaning.round ?? null,
    nonce: null,
    transactionHash: null,
    parameterDigest: digest(canonicalize(meaning.parameters ?? null)),
    status: "prepared",
    createdAt: now,
    updatedAt: now,
    receipt: null,
    error: null,
  };
}

function validateOperation(value: unknown, identity: JournalIdentity): JournalOperation {
  const operation = exactObject(value, [
    "operationId", "idempotencyKey", "runId", "action", "scope", "walletAddress", "chainId",
    "contractAddress", "tokenAddress", "poolId", "round", "nonce", "transactionHash",
    "parameterDigest", "status", "createdAt", "updatedAt", "receipt", "error",
  ], "journal.operation");
  const operationId = requireHash(operation.operationId, "operationId");
  if (requireHash(operation.idempotencyKey, "idempotencyKey") !== operationId) throw new Error("Journal idempotency key mismatch.");
  if (typeof operation.runId !== "string" || !UUID.test(operation.runId)) throw new Error("Journal run ID is invalid.");
  if (typeof operation.action !== "string" || !OPERATION_ACTIONS.includes(operation.action as OperationAction)) throw new Error("Journal action is invalid.");
  if (
    typeof operation.scope !== "string" ||
    !operation.scope ||
    operation.scope.length > 120 ||
    sanitizeOperatorError(operation.scope) !== operation.scope
  ) throw new Error("Journal scope is invalid or secret-like.");
  const walletAddress = requireAddress(operation.walletAddress, "walletAddress");
  const chainId = requireDecimal(operation.chainId, "operation.chainId") as string;
  if (chainId !== identity.chainId.toString()) throw new Error("Journal operation chain ID mismatch.");
  const contractAddress = requireAddress(operation.contractAddress, "operation.contractAddress");
  if (contractAddress !== getAddress(identity.contractAddress)) throw new Error("Journal operation contract address mismatch.");
  const tokenAddress = operation.tokenAddress === null ? null : requireAddress(operation.tokenAddress, "operation.tokenAddress");
  if (tokenAddress !== null && tokenAddress !== getAddress(identity.tokenAddress)) throw new Error("Journal operation token address mismatch.");
  const poolId = requireDecimal(operation.poolId, "operation.poolId", true);
  const round = operation.round === null ? null : operation.round;
  if (round !== null && (!Number.isSafeInteger(round) || (round as number) < 1 || (round as number) > 10)) throw new Error("Journal round is invalid.");
  const nonce = operation.nonce === null ? null : operation.nonce;
  if (nonce !== null && (!Number.isSafeInteger(nonce) || (nonce as number) < 0)) throw new Error("Journal nonce is invalid.");
  const transactionHash = operation.transactionHash === null ? null : requireHash(operation.transactionHash, "transactionHash");
  const parameterDigest = requireHash(operation.parameterDigest, "parameterDigest");
  if (typeof operation.status !== "string" || !OPERATION_STATUSES.includes(operation.status as OperationStatus)) throw new Error("Journal status is invalid.");
  const createdAt = requireIso(operation.createdAt, "operation.createdAt");
  const updatedAt = requireIso(operation.updatedAt, "operation.updatedAt");
  let receipt: JournalReceiptSummary | null = null;
  if (operation.receipt !== null) {
    const summary = exactObject(operation.receipt, ["transactionHash", "blockNumber", "status", "gasUsed"], "operation.receipt");
    const receiptHash = requireHash(summary.transactionHash, "receipt.transactionHash");
    if (summary.status !== 0 && summary.status !== 1) throw new Error("Receipt status is invalid.");
    if (!Number.isSafeInteger(summary.blockNumber) || (summary.blockNumber as number) < 0) throw new Error("Receipt block number is invalid.");
    const gasUsed = requireDecimal(summary.gasUsed, "receipt.gasUsed") as string;
    receipt = { transactionHash: receiptHash, blockNumber: summary.blockNumber as number, status: summary.status, gasUsed };
  }
  if (operation.error !== null && (typeof operation.error !== "string" || operation.error.length > 500)) throw new Error("Journal error summary is invalid.");
  const status = operation.status as OperationStatus;
  if (status === "ready_to_broadcast" && nonce === null) {
    throw new Error("ready_to_broadcast journal operation requires a nonce.");
  }
  if (["broadcast", "pending", "confirmed", "replaced", "cancelled"].includes(status)) {
    if (nonce === null || transactionHash === null) {
      throw new Error(`${status} journal operation requires nonce and transaction hash.`);
    }
  }
  if (status === "confirmed") {
    if (!receipt || receipt.status !== 1 || receipt.transactionHash !== transactionHash) {
      throw new Error("Confirmed journal operation requires a matching successful receipt.");
    }
  }
  const expectedOperationId = operationIdFromNormalized({
    action: operation.action as OperationAction,
    scope: operation.scope as string,
    walletAddress,
    chainId,
    contractAddress,
    tokenAddress,
    poolId,
    round: round as number | null,
    parameterDigest,
  });
  if (operationId !== expectedOperationId) {
    throw new Error("Journal operation idempotency integrity check failed.");
  }
  return {
    operationId, idempotencyKey: operationId, runId: operation.runId as string,
    action: operation.action as OperationAction, scope: operation.scope as string, walletAddress,
    chainId, contractAddress, tokenAddress, poolId, round: round as number | null,
    nonce: nonce as number | null, transactionHash, parameterDigest,
    status, createdAt, updatedAt, receipt,
    error: operation.error as string | null,
  };
}

export function validateJournal(value: unknown, identity: JournalIdentity): TransactionJournalData {
  const journal = exactObject(value, [
    "formatVersion", "journalId", "revision", "chainId", "contractAddress", "tokenAddress",
    "createdAt", "updatedAt", "operations",
  ], "journal");
  if (journal.formatVersion !== FORMAT_VERSION) throw new Error("Unsupported transaction journal format version.");
  if (typeof journal.journalId !== "string" || !UUID.test(journal.journalId)) throw new Error("Journal ID is invalid.");
  if (!Number.isSafeInteger(journal.revision) || (journal.revision as number) < 0) throw new Error("Journal revision is invalid.");
  const chainId = requireDecimal(journal.chainId, "journal.chainId") as string;
  if (chainId !== identity.chainId.toString()) throw new Error("Transaction journal chain ID mismatch.");
  const contractAddress = requireAddress(journal.contractAddress, "journal.contractAddress");
  if (contractAddress !== getAddress(identity.contractAddress)) throw new Error("Transaction journal contract address mismatch.");
  const tokenAddress = requireAddress(journal.tokenAddress, "journal.tokenAddress");
  if (tokenAddress !== getAddress(identity.tokenAddress)) throw new Error("Transaction journal token address mismatch.");
  const createdAt = requireIso(journal.createdAt, "journal.createdAt");
  const updatedAt = requireIso(journal.updatedAt, "journal.updatedAt");
  if (!Array.isArray(journal.operations)) throw new Error("Journal operations must be an array.");
  const operations = journal.operations.map((operation) => validateOperation(operation, identity));
  const ids = new Set(operations.map((operation) => operation.operationId));
  if (ids.size !== operations.length) throw new Error("Transaction journal contains duplicate operations.");
  return {
    formatVersion: FORMAT_VERSION,
    journalId: journal.journalId as string,
    revision: journal.revision as number,
    chainId,
    contractAddress,
    tokenAddress,
    createdAt,
    updatedAt,
    operations,
  };
}

abstract class BaseTransactionJournal implements TransactionJournal {
  readonly runId = randomUUID();
  protected constructor(protected data: TransactionJournalData) {}
  protected abstract persist(): Promise<void>;

  snapshot(): TransactionJournalData { return clone(this.data); }
  find(operationId: string): JournalOperation | undefined {
    const found = this.data.operations.find((operation) => operation.operationId === operationId.toLowerCase());
    return found ? clone(found) : undefined;
  }

  async prepare(meaning: OperationMeaning): Promise<JournalOperation> {
    const candidate = operationFromMeaning(meaning, this.runId);
    if (
      candidate.chainId !== this.data.chainId ||
      candidate.contractAddress !== this.data.contractAddress ||
      (candidate.tokenAddress !== null && candidate.tokenAddress !== this.data.tokenAddress)
    ) {
      throw new Error("Operation identity does not match the transaction journal.");
    }
    const existing = this.data.operations.find((operation) => operation.operationId === candidate.operationId);
    if (existing) return clone(existing);
    this.data.operations.push(candidate);
    await this.bumpAndPersist();
    return clone(candidate);
  }

  async transition(
    operationId: string,
    status: OperationStatus,
    update: Partial<Pick<JournalOperation, "nonce" | "transactionHash" | "receipt" | "error">> = {},
  ): Promise<JournalOperation> {
    const operation = this.data.operations.find((entry) => entry.operationId === operationId.toLowerCase());
    if (!operation) throw new Error("Journal operation does not exist.");
    if (operation.status === status) return clone(operation);
    if (!ALLOWED_TRANSITIONS[operation.status].has(status)) {
      throw new Error(`Unsafe journal transition ${operation.status} -> ${status} rejected.`);
    }
    const readyNonce = update.nonce;
    if (status === "ready_to_broadcast" && (readyNonce === undefined || readyNonce === null || !Number.isSafeInteger(readyNonce) || readyNonce < 0)) {
      throw new Error("ready_to_broadcast requires a valid reserved nonce.");
    }
    if ((status === "broadcast" || status === "pending") && !(update.transactionHash ?? operation.transactionHash)) {
      throw new Error(`${status} requires a transaction hash.`);
    }
    if (status === "confirmed" && !(update.receipt ?? operation.receipt)) {
      throw new Error("confirmed requires a receipt summary.");
    }
    if (update.nonce !== undefined) operation.nonce = update.nonce;
    if (update.transactionHash !== undefined) operation.transactionHash = requireHash(update.transactionHash, "transactionHash");
    if (update.receipt !== undefined) operation.receipt = clone(update.receipt);
    if (update.error !== undefined) operation.error = update.error === null ? null : sanitizeOperatorError(update.error);
    operation.status = status;
    operation.updatedAt = isoNow();
    await this.bumpAndPersist();
    return clone(operation);
  }

  private async bumpAndPersist(): Promise<void> {
    this.data.revision += 1;
    this.data.updatedAt = isoNow();
    await this.persist();
  }
}

function newJournal(identity: JournalIdentity): TransactionJournalData {
  const now = isoNow();
  return {
    formatVersion: FORMAT_VERSION,
    journalId: randomUUID(),
    revision: 0,
    chainId: identity.chainId.toString(),
    contractAddress: getAddress(identity.contractAddress),
    tokenAddress: getAddress(identity.tokenAddress),
    createdAt: now,
    updatedAt: now,
    operations: [],
  };
}

export class MemoryTransactionJournal extends BaseTransactionJournal {
  constructor(identity: JournalIdentity) { super(newJournal(identity)); }
  protected async persist(): Promise<void> {}
}

export class JsonTransactionJournal extends BaseTransactionJournal {
  private constructor(
    private readonly filePath: string,
    data: TransactionJournalData,
    private readonly hooks?: AtomicWriteHooks,
  ) { super(data); }

  static async open(
    filePathValue: string,
    identity: JournalIdentity,
    hooks?: AtomicWriteHooks,
  ): Promise<JsonTransactionJournal> {
    const filePath = await assertSafeExternalFilePath(filePathValue, JOURNAL_SUFFIX);
    const data = await withExclusiveFileLock(filePath, async () => {
      if (await pathIsRegularFile(filePath)) {
        let parsed: unknown;
        try { parsed = JSON.parse(await readFile(filePath, "utf8")); }
        catch { throw new Error("Transaction journal is incomplete or invalid JSON."); }
        return validateJournal(parsed, identity);
      }
      const created = newJournal(identity);
      await atomicWritePrivateFile(filePath, `${JSON.stringify(created, null, 2)}\n`, hooks);
      return created;
    });
    return new JsonTransactionJournal(filePath, data, hooks);
  }

  protected async persist(): Promise<void> {
    await assertSafeExternalFilePath(this.filePath, JOURNAL_SUFFIX);
    await withExclusiveFileLock(this.filePath, async () => {
      let persisted: unknown;
      try { persisted = JSON.parse(await readFile(this.filePath, "utf8")); }
      catch { throw new Error("Transaction journal changed into invalid JSON before update."); }
      const currentRevision = (persisted as { revision?: unknown }).revision;
      if (currentRevision !== this.data.revision - 1) {
        throw new Error("Transaction journal revision conflict; another process changed the file.");
      }
      await atomicWritePrivateFile(
        this.filePath,
        `${JSON.stringify(this.data, null, 2)}\n`,
        this.hooks,
      );
    });
  }
}

export async function inspectExistingTransactionJournal(
  filePathValue: string,
  identity: JournalIdentity,
): Promise<TransactionJournalData> {
  const filePath = await assertSafeExternalFilePath(filePathValue, JOURNAL_SUFFIX);
  if (!(await pathIsRegularFile(filePath))) {
    throw new Error("Transaction journal does not exist; read-only inspection will not create it.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Transaction journal is incomplete or invalid JSON.");
  }
  return validateJournal(parsed, identity);
}

export function readJournalPathFromEnvironment(env: NodeJS.ProcessEnv): string {
  const value = env.OPERATOR_TRANSACTION_JOURNAL_PATH?.trim();
  if (!value) throw new Error("OPERATOR_TRANSACTION_JOURNAL_PATH is required.");
  return value;
}
