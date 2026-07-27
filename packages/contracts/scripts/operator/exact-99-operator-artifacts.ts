import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { getAddress, isAddress } from "ethers";

import {
  assertSafeExternalFilePath,
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
} from "./durable-file.js";
import type { EncryptedWalletStoreInspection } from "./encrypted-wallet-store.js";
import {
  FULL_LIFECYCLE_99_STORE_FILE_NAME,
  FULL_LIFECYCLE_WALLET_COUNT,
} from "./full-lifecycle-wallet-store.js";
import {
  PILOT_SET_CHAIN_ID,
  PILOT_SET_CONTRACT_ADDRESS,
  PILOT_SET_PROJECT,
  PILOT_SET_TOKEN_ADDRESS,
  walletOrderDigest,
} from "./operator-set-identity.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const EXACT_99_PURPOSE = "base-sepolia-full-lifecycle-99";
export const EXACT_99_NETWORK = "base-sepolia";
export const EXACT_99_AUTOMATIC_JOIN_HARD_STOP = 99;
export const EXACT_99_MANIFEST_SUFFIX = ".operator-set-manifest.json";
export const EXACT_99_CHECKPOINT_SUFFIX = ".operator-checkpoint.json";
export const EXACT_99_JOURNAL_SUFFIX = ".operator-journal.json";

export const EXACT_99_FILES = {
  walletStore: FULL_LIFECYCLE_99_STORE_FILE_NAME,
  manifest: "full-lifecycle-99.operator-set-manifest.json",
  checkpoint: "full-lifecycle-99.operator-checkpoint.json",
  journal: "full-lifecycle-99.operator-journal.json",
} as const;

export type Exact99LifecycleStage =
  | "initialized"
  | "inspected"
  | "funded"
  | "running-checkpoint-5"
  | "checkpoint-5"
  | "running-checkpoint-20"
  | "checkpoint-20"
  | "running-checkpoint-50"
  | "checkpoint-50"
  | "running-checkpoint-99"
  | "checkpoint-99"
  | "awaiting-manual-100"
  | "locked"
  | "drawing"
  | "claiming"
  | "finished"
  | "manual-review";

export interface Exact99Manifest {
  formatVersion: 1;
  project: typeof PILOT_SET_PROJECT;
  purpose: typeof EXACT_99_PURPOSE;
  network: typeof EXACT_99_NETWORK;
  chainId: string;
  contractAddress: string;
  tokenAddress: string;
  setId: string;
  storeId: string;
  walletCount: 99;
  walletAddresses: string[];
  walletOrderDigest: string;
  storeFingerprint: string;
  createdAt: string;
  automaticJoinHardStop: 99;
  files: typeof EXACT_99_FILES;
}

export interface Exact99Counters {
  funded: number;
  faucet: number;
  approve: number;
  join: number;
  draw: number;
  claim: number;
}

export interface Exact99LastConfirmedOperation {
  type: Exact99OperationType;
  walletIndex: number | null;
  transactionHash: string;
  blockNumber: number;
  confirmedAt: string;
}

export interface Exact99RecoveryState {
  pending: boolean;
  ambiguous: boolean;
  manualReview: boolean;
  reason: string | null;
}

export interface Exact99Checkpoint {
  formatVersion: 1;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  stage: Exact99LifecycleStage;
  confirmedWalletCount: number;
  counters: Exact99Counters;
  lastConfirmedOperation: Exact99LastConfirmedOperation | null;
  recovery: Exact99RecoveryState;
  createdAt: string;
  updatedAt: string;
}

export type Exact99OperationType =
  | "funding"
  | "faucet"
  | "approve"
  | "join"
  | "manual-100"
  | "draw"
  | "claim";

export type Exact99OperationStatus =
  | "planned"
  | "prepared"
  | "pending"
  | "confirmed"
  | "failed"
  | "ambiguous"
  | "manual-review"
  | "skipped-already-funded";

export interface Exact99JournalReceipt {
  status: 0 | 1;
  gasUsed: string;
}

export interface Exact99JournalCoordinatorBinding {
  checkpoint: "checkpoint-5" | "checkpoint-20" | "checkpoint-50" | "checkpoint-99";
  rangeStart: number;
  rangeEnd: number;
  walletOrderDigest: string;
  fundingPlanId: string;
}

export interface Exact99JournalEntry {
  sequence: number;
  operationId: string;
  type: Exact99OperationType;
  walletIndex: number | null;
  walletAddress: string | null;
  expectedState: string;
  transactionHash: string | null;
  status: Exact99OperationStatus;
  blockNumber: number | null;
  receipt: Exact99JournalReceipt | null;
  reconciliation: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  coordinator?: Exact99JournalCoordinatorBinding | null;
}

export interface Exact99Journal {
  formatVersion: 1;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  entries: Exact99JournalEntry[];
}

export interface Exact99ArtifactSet {
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
}

export interface Exact99PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Exact99PreflightReport {
  profile: "exact-99";
  readOnly: true;
  walletCount: number;
  automaticJoinHardStop: number;
  checks: Exact99PreflightCheck[];
  blockers: string[];
  readyForFutureNetworkPreflight: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const FORBIDDEN_KEY = /private.?key|mnemonic|seed|password|passphrase|secret|salt|ciphertext|auth(?:entication)?tag|\biv\b/i;
const SECRET_TEXT = /\b(?:private key|mnemonic|seed phrase|password|passphrase|ciphertext)\b/i;
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i;
const PRIVATE_KEY_SHAPE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const STAGES = new Set<Exact99LifecycleStage>([
  "initialized", "inspected", "funded", "running-checkpoint-5", "checkpoint-5",
  "running-checkpoint-20", "checkpoint-20", "running-checkpoint-50",
  "checkpoint-50", "running-checkpoint-99", "checkpoint-99",
  "awaiting-manual-100", "locked", "drawing", "claiming", "finished",
  "manual-review",
]);
const OPERATION_TYPES = new Set<Exact99OperationType>([
  "funding", "faucet", "approve", "join", "manual-100", "draw", "claim",
]);
const OPERATION_STATUSES = new Set<Exact99OperationStatus>([
  "planned", "prepared", "pending", "confirmed", "failed", "ambiguous",
  "manual-review", "skipped-already-funded",
]);
const ALLOWED_STATUS_TRANSITIONS: Record<Exact99OperationStatus, ReadonlySet<Exact99OperationStatus>> = {
  planned: new Set(["prepared", "failed", "manual-review", "skipped-already-funded"]),
  prepared: new Set(["pending", "confirmed", "failed", "ambiguous", "manual-review"]),
  pending: new Set(["confirmed", "failed", "ambiguous", "manual-review"]),
  ambiguous: new Set(["confirmed", "failed", "manual-review"]),
  "manual-review": new Set(["confirmed", "failed"]),
  confirmed: new Set(),
  failed: new Set(),
  "skipped-already-funded": new Set(),
};
const STAGE_ORDER = new Map<Exact99LifecycleStage, number>([
  ["initialized", 0],
  ["inspected", 1],
  ["funded", 2],
  ["running-checkpoint-5", 3],
  ["checkpoint-5", 4],
  ["running-checkpoint-20", 5],
  ["checkpoint-20", 6],
  ["running-checkpoint-50", 7],
  ["checkpoint-50", 8],
  ["running-checkpoint-99", 9],
  ["checkpoint-99", 10],
  ["awaiting-manual-100", 11],
  ["locked", 12],
  ["drawing", 13],
  ["claiming", 14],
  ["finished", 15],
]);

const MANIFEST_KEYS = [
  "formatVersion", "project", "purpose", "network", "chainId",
  "contractAddress", "tokenAddress", "setId", "storeId", "walletCount",
  "walletAddresses", "walletOrderDigest", "storeFingerprint", "createdAt",
  "automaticJoinHardStop", "files",
] as const;
const CHECKPOINT_KEYS = [
  "formatVersion", "setId", "storeId", "manifestFingerprint", "stage",
  "confirmedWalletCount", "counters", "lastConfirmedOperation", "recovery",
  "createdAt", "updatedAt",
] as const;
const COUNTER_KEYS = ["funded", "faucet", "approve", "join", "draw", "claim"] as const;
const RECOVERY_KEYS = ["pending", "ambiguous", "manualReview", "reason"] as const;
const LAST_OPERATION_KEYS = [
  "type", "walletIndex", "transactionHash", "blockNumber", "confirmedAt",
] as const;
const JOURNAL_KEYS = [
  "formatVersion", "setId", "storeId", "manifestFingerprint", "revision",
  "createdAt", "updatedAt", "entries",
] as const;
const ENTRY_KEYS = [
  "sequence", "operationId", "type", "walletIndex", "walletAddress",
  "expectedState", "transactionHash", "status", "blockNumber", "receipt",
  "reconciliation", "error", "createdAt", "updatedAt", "coordinator",
] as const;
const REQUIRED_ENTRY_KEYS = ENTRY_KEYS.filter((key) => key !== "coordinator");
const RECEIPT_KEYS = ["status", "gasUsed"] as const;
const COORDINATOR_BINDING_KEYS = [
  "checkpoint", "rangeStart", "rangeEnd", "walletOrderDigest", "fundingPlanId",
] as const;
const FILE_KEYS = ["walletStore", "manifest", "checkpoint", "journal"] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const candidate = record(value, label);
  for (const key of Object.keys(candidate)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  for (const key of keys) {
    if (!(key in candidate)) throw new Error(`${label}.${key} is required.`);
  }
  return candidate;
}

function exactRecordWithOptional(
  value: unknown,
  keys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const candidate = record(value, label);
  for (const key of Object.keys(candidate)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  for (const key of requiredKeys) {
    if (!(key in candidate)) throw new Error(`${label}.${key} is required.`);
  }
  return candidate;
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string no longer than ${maximum} characters.`);
  }
  if (SECRET_TEXT.test(value) || CREDENTIAL_URL.test(value)) {
    throw new Error(`${label} contains forbidden secret-like data.`);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID.`);
  return value;
}

function fingerprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a sha256 fingerprint.`);
  }
  return value;
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be a valid EVM address.`);
  }
  return getAddress(value);
}

function transactionHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !TRANSACTION_HASH.test(value)) {
    throw new Error(`${label} must be a transaction hash.`);
  }
  return value.toLowerCase();
}

function nullableTransactionHash(value: unknown, label: string): string | null {
  return value === null ? null : transactionHash(value, label);
}

function nullableInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return value === null ? null : integer(value, label, 0, maximum);
}

function assertNoSecretFields(value: unknown, path = "artifact"): void {
  if (typeof value === "string") {
    if (
      SECRET_TEXT.test(value) ||
      CREDENTIAL_URL.test(value) ||
      (PRIVATE_KEY_SHAPE.test(value) &&
        !/(?:transactionHash|storeFingerprint|manifestFingerprint)$/.test(path))
    ) {
      throw new Error(`${path} contains forbidden secret-like data.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}.${key} is forbidden.`);
    assertNoSecretFields(nested, `${path}.${key}`);
  }
}

function exactFiles(value: unknown): typeof EXACT_99_FILES {
  const files = exactRecord(value, FILE_KEYS, "exact99.manifest.files");
  for (const [key, expected] of Object.entries(EXACT_99_FILES)) {
    if (files[key] !== expected || basename(files[key] as string) !== expected) {
      throw new Error(`Exact-99 manifest file mismatch at ${key}.`);
    }
  }
  return EXACT_99_FILES;
}

function validateAddresses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== FULL_LIFECYCLE_WALLET_COUNT) {
    throw new Error(`Exact-99 manifest must contain exactly ${FULL_LIFECYCLE_WALLET_COUNT} wallet addresses.`);
  }
  const addresses = value.map((entry, index) => address(entry, `exact99.manifest.walletAddresses[${index}]`));
  if (new Set(addresses.map((entry) => entry.toLowerCase())).size !== addresses.length) {
    throw new Error("Exact-99 manifest contains duplicate wallet addresses.");
  }
  return addresses;
}

export function validateExact99Manifest(value: unknown): Exact99Manifest {
  assertNoSecretFields(value, "exact99.manifest");
  const candidate = exactRecord(value, MANIFEST_KEYS, "exact99.manifest");
  if (candidate.formatVersion !== 1) throw new Error("Exact-99 manifest format version must equal 1.");
  if (candidate.project !== PILOT_SET_PROJECT) throw new Error("Exact-99 manifest project mismatch.");
  if (candidate.purpose !== EXACT_99_PURPOSE) throw new Error("Exact-99 manifest purpose mismatch.");
  if (candidate.network !== EXACT_99_NETWORK) throw new Error("Exact-99 manifest network mismatch.");
  if (candidate.chainId !== PILOT_SET_CHAIN_ID.toString()) throw new Error("Exact-99 manifest chain ID mismatch.");
  if (address(candidate.contractAddress, "exact99.manifest.contractAddress") !== PILOT_SET_CONTRACT_ADDRESS) {
    throw new Error("Exact-99 manifest contract address mismatch.");
  }
  if (address(candidate.tokenAddress, "exact99.manifest.tokenAddress") !== PILOT_SET_TOKEN_ADDRESS) {
    throw new Error("Exact-99 manifest token address mismatch.");
  }
  const setId = uuid(candidate.setId, "exact99.manifest.setId");
  const storeId = uuid(candidate.storeId, "exact99.manifest.storeId");
  if (candidate.walletCount !== FULL_LIFECYCLE_WALLET_COUNT) {
    throw new Error(`Exact-99 manifest wallet count must equal ${FULL_LIFECYCLE_WALLET_COUNT}.`);
  }
  const walletAddresses = validateAddresses(candidate.walletAddresses);
  const orderDigest = text(candidate.walletOrderDigest, "exact99.manifest.walletOrderDigest", 100);
  if (orderDigest !== walletOrderDigest(walletAddresses)) {
    throw new Error("Exact-99 manifest wallet order digest mismatch.");
  }
  const storeFingerprint = fingerprint(candidate.storeFingerprint, "exact99.manifest.storeFingerprint");
  const createdAt = iso(candidate.createdAt, "exact99.manifest.createdAt");
  if (candidate.automaticJoinHardStop !== EXACT_99_AUTOMATIC_JOIN_HARD_STOP) {
    throw new Error("Exact-99 automatic join hard stop must equal 99.");
  }
  return {
    formatVersion: 1,
    project: PILOT_SET_PROJECT,
    purpose: EXACT_99_PURPOSE,
    network: EXACT_99_NETWORK,
    chainId: PILOT_SET_CHAIN_ID.toString(),
    contractAddress: PILOT_SET_CONTRACT_ADDRESS,
    tokenAddress: PILOT_SET_TOKEN_ADDRESS,
    setId,
    storeId,
    walletCount: FULL_LIFECYCLE_WALLET_COUNT,
    walletAddresses,
    walletOrderDigest: orderDigest,
    storeFingerprint,
    createdAt,
    automaticJoinHardStop: EXACT_99_AUTOMATIC_JOIN_HARD_STOP,
    files: exactFiles(candidate.files),
  };
}

export function exact99ManifestFingerprint(manifest: Exact99Manifest): string {
  const validated = validateExact99Manifest(manifest);
  return `sha256:${createHash("sha256").update(JSON.stringify(validated), "utf8").digest("hex")}`;
}

export function buildExact99Manifest(
  store: EncryptedWalletStoreInspection,
  createdAt = new Date().toISOString(),
  setId = randomUUID(),
): Exact99Manifest {
  if (store.walletCount !== FULL_LIFECYCLE_WALLET_COUNT) {
    throw new Error(`Exact-99 store must contain exactly ${FULL_LIFECYCLE_WALLET_COUNT} wallets.`);
  }
  return validateExact99Manifest({
    formatVersion: 1,
    project: PILOT_SET_PROJECT,
    purpose: EXACT_99_PURPOSE,
    network: EXACT_99_NETWORK,
    chainId: PILOT_SET_CHAIN_ID.toString(),
    contractAddress: PILOT_SET_CONTRACT_ADDRESS,
    tokenAddress: PILOT_SET_TOKEN_ADDRESS,
    setId,
    storeId: store.storeId,
    walletCount: FULL_LIFECYCLE_WALLET_COUNT,
    walletAddresses: store.addresses,
    walletOrderDigest: walletOrderDigest(store.addresses),
    storeFingerprint: store.fingerprint,
    createdAt,
    automaticJoinHardStop: EXACT_99_AUTOMATIC_JOIN_HARD_STOP,
    files: EXACT_99_FILES,
  });
}

function validateCounters(value: unknown): Exact99Counters {
  const counters = exactRecord(value, COUNTER_KEYS, "exact99.checkpoint.counters");
  return {
    funded: integer(counters.funded, "exact99.checkpoint.counters.funded", 0, 99),
    faucet: integer(counters.faucet, "exact99.checkpoint.counters.faucet", 0, 99),
    approve: integer(counters.approve, "exact99.checkpoint.counters.approve", 0, 99),
    join: integer(counters.join, "exact99.checkpoint.counters.join", 0, 99),
    draw: integer(counters.draw, "exact99.checkpoint.counters.draw", 0, 10),
    claim: integer(counters.claim, "exact99.checkpoint.counters.claim", 0, 10),
  };
}

function validateRecovery(value: unknown): Exact99RecoveryState {
  const recovery = exactRecord(value, RECOVERY_KEYS, "exact99.checkpoint.recovery");
  for (const key of ["pending", "ambiguous", "manualReview"] as const) {
    if (typeof recovery[key] !== "boolean") {
      throw new Error(`exact99.checkpoint.recovery.${key} must be boolean.`);
    }
  }
  const result: Exact99RecoveryState = {
    pending: recovery.pending as boolean,
    ambiguous: recovery.ambiguous as boolean,
    manualReview: recovery.manualReview as boolean,
    reason: nullableText(recovery.reason, "exact99.checkpoint.recovery.reason"),
  };
  if ((result.pending || result.ambiguous || result.manualReview) !== Boolean(result.reason)) {
    throw new Error("Exact-99 recovery reason must exist exactly when recovery is required.");
  }
  return result;
}

function validateLastOperation(value: unknown): Exact99LastConfirmedOperation | null {
  if (value === null) return null;
  const operation = exactRecord(value, LAST_OPERATION_KEYS, "exact99.checkpoint.lastConfirmedOperation");
  if (!OPERATION_TYPES.has(operation.type as Exact99OperationType)) {
    throw new Error("Exact-99 last confirmed operation type is invalid.");
  }
  return {
    type: operation.type as Exact99OperationType,
    walletIndex: nullableInteger(operation.walletIndex, "exact99.checkpoint.lastConfirmedOperation.walletIndex", 98),
    transactionHash: transactionHash(operation.transactionHash, "exact99.checkpoint.lastConfirmedOperation.transactionHash"),
    blockNumber: integer(operation.blockNumber, "exact99.checkpoint.lastConfirmedOperation.blockNumber"),
    confirmedAt: iso(operation.confirmedAt, "exact99.checkpoint.lastConfirmedOperation.confirmedAt"),
  };
}

function assertStageConsistency(checkpoint: Exact99Checkpoint): void {
  const expectedJoinCount: Partial<Record<Exact99LifecycleStage, number>> = {
    "checkpoint-5": 5,
    "checkpoint-20": 20,
    "checkpoint-50": 50,
    "checkpoint-99": 99,
    "awaiting-manual-100": 99,
  };
  const expected = expectedJoinCount[checkpoint.stage];
  if (expected !== undefined &&
      (checkpoint.confirmedWalletCount !== expected || checkpoint.counters.join !== expected)) {
    throw new Error(`Exact-99 ${checkpoint.stage} requires exactly ${expected} confirmed automatic joins.`);
  }
  if (checkpoint.confirmedWalletCount !== checkpoint.counters.join) {
    throw new Error("Exact-99 confirmed wallet count must equal the automatic join counter.");
  }
  if (checkpoint.counters.approve < checkpoint.counters.join ||
      checkpoint.counters.faucet < checkpoint.counters.join) {
    throw new Error("Exact-99 join count cannot exceed faucet or approval count.");
  }
  if (checkpoint.counters.claim > checkpoint.counters.draw) {
    throw new Error("Exact-99 claim count cannot exceed draw count.");
  }
  if (checkpoint.stage === "finished" &&
      (checkpoint.confirmedWalletCount !== 99 ||
       checkpoint.counters.draw !== 10 ||
       checkpoint.counters.claim !== 10)) {
    throw new Error("Exact-99 finished stage requires 99 automatic joins, 10 draws, and 10 claims.");
  }
  if (checkpoint.stage === "manual-review" && !checkpoint.recovery.manualReview) {
    throw new Error("Exact-99 manual-review stage requires the manual-review recovery flag.");
  }
}

export function validateExact99Checkpoint(
  value: unknown,
  manifest: Exact99Manifest,
): Exact99Checkpoint {
  assertNoSecretFields(value, "exact99.checkpoint");
  const candidate = exactRecord(value, CHECKPOINT_KEYS, "exact99.checkpoint");
  if (candidate.formatVersion !== 1) throw new Error("Exact-99 checkpoint format version must equal 1.");
  if (uuid(candidate.setId, "exact99.checkpoint.setId") !== manifest.setId ||
      uuid(candidate.storeId, "exact99.checkpoint.storeId") !== manifest.storeId) {
    throw new Error("Exact-99 checkpoint set or store ID mismatch.");
  }
  if (fingerprint(candidate.manifestFingerprint, "exact99.checkpoint.manifestFingerprint") !==
      exact99ManifestFingerprint(manifest)) {
    throw new Error("Exact-99 checkpoint manifest fingerprint mismatch.");
  }
  if (!STAGES.has(candidate.stage as Exact99LifecycleStage)) {
    throw new Error("Exact-99 checkpoint stage is invalid.");
  }
  const result: Exact99Checkpoint = {
    formatVersion: 1,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint: candidate.manifestFingerprint as string,
    stage: candidate.stage as Exact99LifecycleStage,
    confirmedWalletCount: integer(candidate.confirmedWalletCount, "exact99.checkpoint.confirmedWalletCount", 0, 99),
    counters: validateCounters(candidate.counters),
    lastConfirmedOperation: validateLastOperation(candidate.lastConfirmedOperation),
    recovery: validateRecovery(candidate.recovery),
    createdAt: iso(candidate.createdAt, "exact99.checkpoint.createdAt"),
    updatedAt: iso(candidate.updatedAt, "exact99.checkpoint.updatedAt"),
  };
  assertStageConsistency(result);
  return result;
}

export function buildInitialExact99Checkpoint(
  manifest: Exact99Manifest,
  createdAt = manifest.createdAt,
): Exact99Checkpoint {
  return validateExact99Checkpoint({
    formatVersion: 1,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint: exact99ManifestFingerprint(manifest),
    stage: "initialized",
    confirmedWalletCount: 0,
    counters: { funded: 0, faucet: 0, approve: 0, join: 0, draw: 0, claim: 0 },
    lastConfirmedOperation: null,
    recovery: { pending: false, ambiguous: false, manualReview: false, reason: null },
    createdAt,
    updatedAt: createdAt,
  }, manifest);
}

function validateJournalEntry(value: unknown, index: number): Exact99JournalEntry {
  const label = `exact99.journal.entries[${index}]`;
  const entry = exactRecordWithOptional(value, ENTRY_KEYS, REQUIRED_ENTRY_KEYS, label);
  if (integer(entry.sequence, `${label}.sequence`, 1) !== index + 1) {
    throw new Error(`${label}.sequence must be append-only and contiguous.`);
  }
  const operationId = uuid(entry.operationId, `${label}.operationId`);
  if (!OPERATION_TYPES.has(entry.type as Exact99OperationType)) {
    throw new Error(`${label}.type is invalid.`);
  }
  const walletIndex = nullableInteger(entry.walletIndex, `${label}.walletIndex`, 98);
  const walletAddress = entry.walletAddress === null ? null : address(entry.walletAddress, `${label}.walletAddress`);
  if ((walletIndex === null) !== (walletAddress === null) &&
      entry.type !== "manual-100" && entry.type !== "draw") {
    throw new Error(`${label} wallet index and address must be present together.`);
  }
  if (!OPERATION_STATUSES.has(entry.status as Exact99OperationStatus)) {
    throw new Error(`${label}.status is invalid.`);
  }
  const status = entry.status as Exact99OperationStatus;
  const hash = nullableTransactionHash(entry.transactionHash, `${label}.transactionHash`);
  const blockNumber = nullableInteger(entry.blockNumber, `${label}.blockNumber`);
  let receipt: Exact99JournalReceipt | null = null;
  if (entry.receipt !== null) {
    const source = exactRecord(entry.receipt, RECEIPT_KEYS, `${label}.receipt`);
    if (source.status !== 0 && source.status !== 1) throw new Error(`${label}.receipt.status is invalid.`);
    if (typeof source.gasUsed !== "string" || !DECIMAL.test(source.gasUsed)) {
      throw new Error(`${label}.receipt.gasUsed must be an unsigned decimal integer.`);
    }
    receipt = { status: source.status, gasUsed: source.gasUsed };
  }
  if (["pending", "confirmed", "ambiguous"].includes(status) && hash === null) {
    throw new Error(`${label}.${status} requires a transaction hash.`);
  }
  if (status === "confirmed" && (blockNumber === null || receipt?.status !== 1)) {
    throw new Error(`${label}.confirmed requires a successful receipt and block number.`);
  }
  if (status === "manual-review" && entry.error === null) {
    throw new Error(`${label}.manual-review requires an error summary.`);
  }
  let coordinator: Exact99JournalCoordinatorBinding | null = null;
  if (entry.coordinator !== undefined && entry.coordinator !== null) {
    const binding = exactRecord(
      entry.coordinator,
      COORDINATOR_BINDING_KEYS,
      `${label}.coordinator`,
    );
    if (!["checkpoint-5", "checkpoint-20", "checkpoint-50", "checkpoint-99"].includes(
      binding.checkpoint as string,
    )) {
      throw new Error(`${label}.coordinator.checkpoint is invalid.`);
    }
    const rangeStart = integer(binding.rangeStart, `${label}.coordinator.rangeStart`, 0, 98);
    const rangeEnd = integer(binding.rangeEnd, `${label}.coordinator.rangeEnd`, rangeStart, 98);
    const orderDigest = text(
      binding.walletOrderDigest,
      `${label}.coordinator.walletOrderDigest`,
      100,
    );
    coordinator = {
      checkpoint: binding.checkpoint as Exact99JournalCoordinatorBinding["checkpoint"],
      rangeStart,
      rangeEnd,
      walletOrderDigest: orderDigest,
      fundingPlanId: fingerprint(binding.fundingPlanId, `${label}.coordinator.fundingPlanId`),
    };
  }
  return {
    sequence: index + 1,
    operationId,
    type: entry.type as Exact99OperationType,
    walletIndex,
    walletAddress,
    expectedState: text(entry.expectedState, `${label}.expectedState`),
    transactionHash: hash,
    status,
    blockNumber,
    receipt,
    reconciliation: nullableText(entry.reconciliation, `${label}.reconciliation`),
    error: nullableText(entry.error, `${label}.error`),
    createdAt: iso(entry.createdAt, `${label}.createdAt`),
    updatedAt: iso(entry.updatedAt, `${label}.updatedAt`),
    coordinator,
  };
}

function assertAppendOnlyHistory(entries: readonly Exact99JournalEntry[]): void {
  const latest = new Map<string, Exact99JournalEntry>();
  for (const entry of entries) {
    const previous = latest.get(entry.operationId);
    if (previous) {
      if (!ALLOWED_STATUS_TRANSITIONS[previous.status].has(entry.status)) {
        throw new Error(
          `Exact-99 journal contains unsafe status transition ${previous.status} -> ${entry.status}.`,
        );
      }
      if (
        previous.type !== entry.type ||
        previous.walletIndex !== entry.walletIndex ||
        previous.walletAddress !== entry.walletAddress ||
        previous.expectedState !== entry.expectedState ||
        JSON.stringify(previous.coordinator ?? null) !== JSON.stringify(entry.coordinator ?? null)
      ) {
        throw new Error("Exact-99 journal operation identity changed between append-only events.");
      }
      if (
        previous.transactionHash !== null &&
        entry.transactionHash !== previous.transactionHash
      ) {
        throw new Error("Exact-99 journal transaction hash changed between append-only events.");
      }
      if (Date.parse(entry.updatedAt) < Date.parse(previous.updatedAt)) {
        throw new Error("Exact-99 journal operation timestamps moved backwards.");
      }
    }
    latest.set(entry.operationId, entry);
  }
}

export function validateExact99Journal(
  value: unknown,
  manifest: Exact99Manifest,
): Exact99Journal {
  assertNoSecretFields(value, "exact99.journal");
  const candidate = exactRecord(value, JOURNAL_KEYS, "exact99.journal");
  if (candidate.formatVersion !== 1) throw new Error("Exact-99 journal format version must equal 1.");
  if (uuid(candidate.setId, "exact99.journal.setId") !== manifest.setId ||
      uuid(candidate.storeId, "exact99.journal.storeId") !== manifest.storeId) {
    throw new Error("Exact-99 journal set or store ID mismatch.");
  }
  if (fingerprint(candidate.manifestFingerprint, "exact99.journal.manifestFingerprint") !==
      exact99ManifestFingerprint(manifest)) {
    throw new Error("Exact-99 journal manifest fingerprint mismatch.");
  }
  const revision = integer(candidate.revision, "exact99.journal.revision");
  if (!Array.isArray(candidate.entries)) throw new Error("Exact-99 journal entries must be an array.");
  const entries = candidate.entries.map(validateJournalEntry);
  assertAppendOnlyHistory(entries);
  if (revision !== entries.length) {
    throw new Error("Exact-99 journal revision must equal its append-only entry count.");
  }
  return {
    formatVersion: 1,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint: candidate.manifestFingerprint as string,
    revision,
    createdAt: iso(candidate.createdAt, "exact99.journal.createdAt"),
    updatedAt: iso(candidate.updatedAt, "exact99.journal.updatedAt"),
    entries,
  };
}

export function buildEmptyExact99Journal(
  manifest: Exact99Manifest,
  createdAt = manifest.createdAt,
): Exact99Journal {
  return validateExact99Journal({
    formatVersion: 1,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint: exact99ManifestFingerprint(manifest),
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    entries: [],
  }, manifest);
}

export function buildInitialExact99ArtifactSet(
  store: EncryptedWalletStoreInspection,
  createdAt = new Date().toISOString(),
  setId = randomUUID(),
): Exact99ArtifactSet {
  const manifest = buildExact99Manifest(store, createdAt, setId);
  return {
    manifest,
    checkpoint: buildInitialExact99Checkpoint(manifest, createdAt),
    journal: buildEmptyExact99Journal(manifest, createdAt),
  };
}

function artifactPaths(directory: string) {
  const root = resolve(directory);
  return {
    manifest: join(root, EXACT_99_FILES.manifest),
    checkpoint: join(root, EXACT_99_FILES.checkpoint),
    journal: join(root, EXACT_99_FILES.journal),
  };
}

async function writeCreateOnly(path: string, suffix: string, value: unknown): Promise<void> {
  const safePath = await assertSafeExternalFilePath(path, suffix);
  if (await pathIsRegularFile(safePath)) throw new Error(`Runtime artifact already exists: ${basename(safePath)}.`);
  await atomicWritePrivateFile(safePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeInitialExact99Artifacts(
  directory: string,
  artifacts: Exact99ArtifactSet,
): Promise<void> {
  const manifest = validateExact99Manifest(artifacts.manifest);
  const checkpoint = validateExact99Checkpoint(artifacts.checkpoint, manifest);
  const journal = validateExact99Journal(artifacts.journal, manifest);
  const paths = artifactPaths(directory);
  for (const [path, suffix] of [
    [paths.manifest, EXACT_99_MANIFEST_SUFFIX],
    [paths.checkpoint, EXACT_99_CHECKPOINT_SUFFIX],
    [paths.journal, EXACT_99_JOURNAL_SUFFIX],
  ] as const) {
    const safePath = await assertSafeExternalFilePath(path, suffix);
    if (await pathIsRegularFile(safePath)) {
      throw new Error("Exact-99 artifact set already exists; creation will not overwrite it.");
    }
  }
  await writeCreateOnly(paths.journal, EXACT_99_JOURNAL_SUFFIX, journal);
  await writeCreateOnly(paths.checkpoint, EXACT_99_CHECKPOINT_SUFFIX, checkpoint);
  await writeCreateOnly(paths.manifest, EXACT_99_MANIFEST_SUFFIX, manifest);
}

async function readJson(path: string, suffix: string, label: string): Promise<unknown> {
  const safePath = await assertSafeExternalFilePath(path, suffix);
  if (!(await pathIsRegularFile(safePath))) throw new Error(`${label} does not exist.`);
  try {
    return JSON.parse(await readFile(safePath, "utf8"));
  } catch {
    throw new Error(`${label} is incomplete or invalid JSON.`);
  }
}

export async function readExact99ArtifactSet(directory: string): Promise<Exact99ArtifactSet> {
  const paths = artifactPaths(directory);
  const manifest = validateExact99Manifest(
    await readJson(paths.manifest, EXACT_99_MANIFEST_SUFFIX, "Exact-99 manifest"),
  );
  const checkpoint = validateExact99Checkpoint(
    await readJson(paths.checkpoint, EXACT_99_CHECKPOINT_SUFFIX, "Exact-99 checkpoint"),
    manifest,
  );
  const journal = validateExact99Journal(
    await readJson(paths.journal, EXACT_99_JOURNAL_SUFFIX, "Exact-99 journal"),
    manifest,
  );
  return { manifest, checkpoint, journal };
}

export async function appendExact99JournalEntry(
  directory: string,
  manifest: Exact99Manifest,
  entry: Omit<Exact99JournalEntry, "sequence">,
): Promise<Exact99Journal> {
  const path = artifactPaths(directory).journal;
  const safePath = await assertSafeExternalFilePath(path, EXACT_99_JOURNAL_SUFFIX);
  return withExclusiveFileLock(safePath, async () => {
    const current = validateExact99Journal(
      await readJson(safePath, EXACT_99_JOURNAL_SUFFIX, "Exact-99 journal"),
      manifest,
    );
    const next = validateExact99Journal({
      ...current,
      revision: current.revision + 1,
      updatedAt: entry.updatedAt,
      entries: [...current.entries, { ...entry, sequence: current.entries.length + 1 }],
    }, manifest);
    await atomicWritePrivateFile(safePath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}

export async function updateExact99Checkpoint(
  directory: string,
  manifest: Exact99Manifest,
  nextValue: Exact99Checkpoint,
  expectedUpdatedAt: string,
): Promise<Exact99Checkpoint> {
  const path = artifactPaths(directory).checkpoint;
  const safePath = await assertSafeExternalFilePath(path, EXACT_99_CHECKPOINT_SUFFIX);
  return withExclusiveFileLock(safePath, async () => {
    const current = validateExact99Checkpoint(
      await readJson(safePath, EXACT_99_CHECKPOINT_SUFFIX, "Exact-99 checkpoint"),
      manifest,
    );
    if (current.updatedAt !== expectedUpdatedAt) {
      throw new Error("Exact-99 checkpoint revision conflict; another process changed it.");
    }
    const next = validateExact99Checkpoint(nextValue, manifest);
    if (next.createdAt !== current.createdAt || Date.parse(next.updatedAt) <= Date.parse(current.updatedAt)) {
      throw new Error("Exact-99 checkpoint timestamps must preserve creation and move forward.");
    }
    const currentOrder = STAGE_ORDER.get(current.stage);
    const nextOrder = STAGE_ORDER.get(next.stage);
    if (
      current.stage !== "manual-review" &&
      next.stage !== "manual-review" &&
      currentOrder !== undefined &&
      nextOrder !== undefined &&
      nextOrder < currentOrder
    ) {
      throw new Error("Exact-99 checkpoint lifecycle stage cannot move backwards.");
    }
    await atomicWritePrivateFile(safePath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}

function check(
  checks: Exact99PreflightCheck[],
  name: string,
  operation: () => void,
): void {
  try {
    operation();
    checks.push({ name, ok: true, detail: `${name} validated.` });
  } catch (error) {
    checks.push({ name, ok: false, detail: sanitizeOperatorError(error) });
  }
}

export function preflightExact99OperatorArtifacts(input: {
  store: EncryptedWalletStoreInspection;
  manifest: unknown;
  checkpoint: unknown;
  journal: unknown;
}): Exact99PreflightReport {
  const checks: Exact99PreflightCheck[] = [];
  let manifest: Exact99Manifest | undefined;
  let checkpoint: Exact99Checkpoint | undefined;
  let journal: Exact99Journal | undefined;

  check(checks, "wallet-store", () => {
    if (input.store.walletCount !== 99 || input.store.addresses.length !== 99) {
      throw new Error("Exact-99 wallet store must contain exactly 99 addresses.");
    }
    const normalized = input.store.addresses.map((entry, index) => address(entry, `store.addresses[${index}]`));
    if (new Set(normalized.map((entry) => entry.toLowerCase())).size !== 99) {
      throw new Error("Exact-99 wallet store contains duplicate addresses.");
    }
    uuid(input.store.storeId, "store.storeId");
    fingerprint(input.store.fingerprint, "store.fingerprint");
  });
  check(checks, "manifest", () => {
    manifest = validateExact99Manifest(input.manifest);
  });
  check(checks, "store-manifest-binding", () => {
    if (!manifest) throw new Error("Exact-99 manifest is unavailable.");
    if (input.store.storeId !== manifest.storeId) throw new Error("Exact-99 store ID does not match the manifest.");
    if (input.store.fingerprint !== manifest.storeFingerprint) {
      throw new Error("Exact-99 encrypted store fingerprint does not match the manifest.");
    }
    if (walletOrderDigest(input.store.addresses) !== manifest.walletOrderDigest) {
      throw new Error("Exact-99 wallet order does not match the manifest.");
    }
  });
  check(checks, "checkpoint", () => {
    if (!manifest) throw new Error("Exact-99 manifest is unavailable.");
    checkpoint = validateExact99Checkpoint(input.checkpoint, manifest);
  });
  check(checks, "journal", () => {
    if (!manifest) throw new Error("Exact-99 manifest is unavailable.");
    journal = validateExact99Journal(input.journal, manifest);
  });
  check(checks, "shared-identity", () => {
    if (!manifest || !checkpoint || !journal) throw new Error("Exact-99 artifact set is incomplete.");
    const expectedFingerprint = exact99ManifestFingerprint(manifest);
    if (checkpoint.setId !== journal.setId ||
        checkpoint.storeId !== journal.storeId ||
        checkpoint.manifestFingerprint !== expectedFingerprint ||
        journal.manifestFingerprint !== expectedFingerprint) {
      throw new Error("Exact-99 manifest, checkpoint, and journal identity mismatch.");
    }
  });
  check(checks, "recovery", () => {
    const latestByOperation = new Map<string, Exact99JournalEntry>();
    for (const entry of journal?.entries ?? []) latestByOperation.set(entry.operationId, entry);
    const unresolved = [...latestByOperation.values()].filter((entry) =>
      ["prepared", "pending", "ambiguous", "manual-review"].includes(entry.status),
    );
    if (checkpoint?.recovery.pending ||
        checkpoint?.recovery.ambiguous ||
        checkpoint?.recovery.manualReview ||
        checkpoint?.stage === "manual-review" ||
        unresolved.length > 0) {
      throw new Error("Exact-99 artifacts contain pending, ambiguous, or manual-review work.");
    }
  });
  check(checks, "automatic-join-hard-stop", () => {
    if (!manifest || manifest.automaticJoinHardStop !== 99 || manifest.walletCount !== 99) {
      throw new Error("Exact-99 automatic join hard stop is not bound to 99 wallets.");
    }
    if (checkpoint && (checkpoint.confirmedWalletCount > 99 || checkpoint.counters.join > 99)) {
      throw new Error("Exact-99 checkpoint exceeds the automatic join hard stop.");
    }
    const latestByOperation = new Map<string, Exact99JournalEntry>();
    for (const entry of journal?.entries ?? []) latestByOperation.set(entry.operationId, entry);
    const liveAutomaticJoins = [...latestByOperation.values()].filter((entry) =>
      entry.type === "join" && entry.status !== "failed",
    );
    if (liveAutomaticJoins.some((entry) => entry.walletIndex === null)) {
      throw new Error("Exact-99 journal contains an automatic join without a bounded wallet index.");
    }
    const boundedIndices = liveAutomaticJoins.map((entry) => entry.walletIndex as number);
    if (new Set(boundedIndices).size !== boundedIndices.length || boundedIndices.length > 99) {
      throw new Error("Exact-99 journal contains a duplicate or 100th automatic join attempt.");
    }
  });

  const blockers = checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`);
  return {
    profile: "exact-99",
    readOnly: true,
    walletCount: input.store.walletCount,
    automaticJoinHardStop: EXACT_99_AUTOMATIC_JOIN_HARD_STOP,
    checks,
    blockers,
    readyForFutureNetworkPreflight: blockers.length === 0,
  };
}

export function renderExact99Preflight(report: Exact99PreflightReport): string {
  return [
    "POP33 exact-99 local artifact preflight",
    `Profile: ${report.profile}`,
    `Wallet count: ${report.walletCount}`,
    `Automatic join hard stop: ${report.automaticJoinHardStop}`,
    ...report.checks.map((entry) => `${entry.ok ? "OK" : "BLOCKED"} ${entry.name}: ${entry.detail}`),
    `Ready for a separately authorized future network preflight: ${report.readyForFutureNetworkPreflight ? "YES" : "NO"}`,
    "No RPC connection, signing, transaction, private key, password, or encrypted payload was used or printed.",
  ].join("\n");
}
