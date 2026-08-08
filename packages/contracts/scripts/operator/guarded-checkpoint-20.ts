import { readFile } from "node:fs/promises";

import { getAddress, isAddress } from "viem";

import {
  atomicWritePrivateFile,
  assertSafeExternalFilePath,
  pathIsRegularFile,
  withExclusiveFileLock,
} from "./durable-file.js";
import { EXACT_99_COORDINATOR_OPERATIONS } from "./exact-99-accumulation-coordinator.js";
import { exact99FixtureDigest } from "./exact-99-public-execution-protocol.js";
import type { Exact99FundingLimits } from "./exact-99-funding.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const GUARDED_CHECKPOINT_20_BASELINE = 5 as const;
export const GUARDED_CHECKPOINT_20_TARGET = 20 as const;
export const GUARDED_CHECKPOINT_20_CANDIDATE_COUNT = 15 as const;
export const GUARDED_CHECKPOINT_20_BATCH_TARGETS = [10, 15, 20] as const;
export const GUARDED_CHECKPOINT_20_ENTRY_PRICE = 33_000_000n;
export const GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI = 50_000_000_000_000n;
export const GUARDED_CHECKPOINT_20_TOTAL_FUNDING_WEI = 750_000_000_000_000n;
export const GUARDED_CHECKPOINT_20_DEFAULT_SIGNER_RESERVE_WEI = 1_000_000_000_000_000n;
export const GUARDED_CHECKPOINT_20_CHAIN_ID = 84_532n;
export const GUARDED_CHECKPOINT_20_POOL_ID = 1n;
export const GUARDED_CHECKPOINT_20_CONTRACT =
  "0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F";
export const GUARDED_CHECKPOINT_20_TOKEN =
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786";
export const GUARDED_CHECKPOINT_20_JOURNAL_SUFFIX = ".checkpoint-20-journal.json";
export const GUARDED_CHECKPOINT_20_MODES = ["plan", "inspect", "simulate"] as const;

export type GuardedCheckpoint20Mode = (typeof GUARDED_CHECKPOINT_20_MODES)[number];
export type GuardedCheckpoint20Step =
  | "PRECHECK"
  | "FUND"
  | "VERIFY_FUNDING"
  | "FAUCET"
  | "VERIFY_DUSDC"
  | "APPROVE_EXACTLY_33"
  | "VERIFY_ALLOWANCE"
  | "JOIN"
  | "VERIFY_RECEIPT"
  | "POSTFLIGHT"
  | "COMMIT_JOURNAL_STATE";
export type GuardedCheckpoint20EntryStatus =
  | "confirmed"
  | "pending"
  | "failed"
  | "ambiguous"
  | "manual-review";

export const GUARDED_CHECKPOINT_20_STEPS: readonly GuardedCheckpoint20Step[] = [
  "PRECHECK",
  "FUND",
  "VERIFY_FUNDING",
  "FAUCET",
  "VERIFY_DUSDC",
  "APPROVE_EXACTLY_33",
  "VERIFY_ALLOWANCE",
  "JOIN",
  "VERIFY_RECEIPT",
  "POSTFLIGHT",
  "COMMIT_JOURNAL_STATE",
];

const COORDINATOR_STEP_MAP = {
  funding: "FUND",
  faucet: "FAUCET",
  approve: "APPROVE_EXACTLY_33",
  join: "JOIN",
} as const satisfies Record<(typeof EXACT_99_COORDINATOR_OPERATIONS)[number], GuardedCheckpoint20Step>;

export const GUARDED_CHECKPOINT_20_TRANSACTION_STEPS: readonly GuardedCheckpoint20Step[] =
  EXACT_99_COORDINATOR_OPERATIONS.map((operation) => COORDINATOR_STEP_MAP[operation]);

export const GUARDED_CHECKPOINT_20_FUNDING_LIMITS: Exact99FundingLimits = {
  plannedAmountPerWalletWei: GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI.toString(),
  minimumTargetBalanceWei: GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI.toString(),
  maximumPerWalletWei: GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI.toString(),
  maximumTotalBudgetWei: GUARDED_CHECKPOINT_20_TOTAL_FUNDING_WEI.toString(),
  signerReserveWei: GUARDED_CHECKPOINT_20_DEFAULT_SIGNER_RESERVE_WEI.toString(),
};

export interface GuardedCheckpoint20StoreBinding {
  formatVersion: 2;
  storeId: string;
  publicFingerprint: string;
  selectedRecordDecryption: true;
  externalPathRequired: true;
}

export interface GuardedCheckpoint20Manifest {
  formatVersion: 1;
  purpose: "pop33-guarded-checkpoint-20-public-addresses";
  chainId: "84532";
  contractAddress: string;
  tokenAddress: string;
  poolId: "1";
  baselineCount: "5";
  targetCount: "20";
  addresses: readonly string[];
  storeBinding: GuardedCheckpoint20StoreBinding;
  fingerprint: string;
}

export interface GuardedCheckpoint20JournalEntry {
  sequence: number;
  candidateIndex: number;
  candidateAddress: string;
  step: GuardedCheckpoint20Step;
  status: GuardedCheckpoint20EntryStatus;
  transactionHash: string | null;
  blockNumber: string | null;
  publicEvidence: Record<string, string | boolean | null>;
  error: string | null;
}

export interface GuardedCheckpoint20Journal {
  formatVersion: 1;
  purpose: "pop33-guarded-checkpoint-20-journal";
  manifestFingerprint: string;
  baselineCount: "5";
  targetCount: "20";
  revision: number;
  entries: readonly GuardedCheckpoint20JournalEntry[];
  checksum: string;
}

export interface GuardedCheckpoint20GuardInput {
  chainId: bigint;
  contractAddress: string;
  tokenAddress: string;
  contractBytecodeMatches: boolean;
  tokenBytecodeMatches: boolean;
  poolStatus: string;
  poolCount: bigint;
  escrowedAmount: bigint;
  lockedAt: bigint;
  lifecycleActionable: number;
  lifecycleWarnings: number;
  lifecycleCritical: number;
  rpcSourcesAgree: boolean;
  manifestFingerprintMatches: boolean;
  storeFingerprintMatches: boolean;
  globalRunLockAvailable: boolean;
  latestNonceMatchesPending: boolean;
  manualNonceConflict: boolean;
  candidateAddress: string | null;
  candidateUnique: boolean;
  candidatePreviouslyUsed: boolean;
  candidateEligible: boolean;
  routedPoolId: bigint | null;
  candidateEthBalanceWei: bigint | null;
  unexpectedPreFundingBalance: boolean;
  minimumRequiredEthWei: bigint;
  fundingSignerBalanceWei: bigint | null;
  fundingSignerReserveWei: bigint;
  proposedFundingWei: bigint;
  feeCapExceeded: boolean;
  faucetCooldownActive: boolean;
  dripAmount: bigint | null;
  initialAllowance: bigint | null;
  approvedAmount: bigint | null;
  allowanceAfterApprove: bigint | null;
  receiptState: "not-applicable" | "success" | "reverted" | "pending" | "ambiguous" | "reorged";
  joinedPoolId: bigint | null;
  countDelta: bigint | null;
  escrowDelta: bigint | null;
  activePositionDelta: bigint | null;
}

export interface GuardedCheckpoint20Inspection {
  readOnly: true;
  allowed: boolean;
  blockers: readonly string[];
  expectedCount: string;
  expectedEscrow: string;
  completedCandidates: number;
  nextCandidateIndex: number | null;
  nextStep: GuardedCheckpoint20Step | null;
  nextBatchTarget: number | null;
  hardStopReached: boolean;
}

export interface GuardedCheckpoint20SimulationFault {
  candidateIndex: number;
  step: GuardedCheckpoint20Step;
  status: Exclude<GuardedCheckpoint20EntryStatus, "confirmed">;
  reason: string;
}

export interface GuardedCheckpoint20SimulationResult {
  mode: "simulate";
  fixtureOnly: true;
  journal: GuardedCheckpoint20Journal;
  inspection: GuardedCheckpoint20Inspection;
  stoppedAtBatch: number | null;
  stoppedOnFault: boolean;
  processedSteps: number;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY = /private|secret|mnemonic|seed|password|passphrase|credential|api.?key/i;
const SECRET_VALUE = /^(?:0x)?[0-9a-fA-F]{64}$/;

export function assertGuardedCheckpoint20Mode(value: string): asserts value is GuardedCheckpoint20Mode {
  if (!(GUARDED_CHECKPOINT_20_MODES as readonly string[]).includes(value)) {
    throw new Error("Checkpoint-20 mode must be plan, inspect, or simulate; execute is unavailable.");
  }
}

function withoutChecksum(journal: GuardedCheckpoint20Journal): Omit<GuardedCheckpoint20Journal, "checksum"> {
  return {
    formatVersion: journal.formatVersion,
    purpose: journal.purpose,
    manifestFingerprint: journal.manifestFingerprint,
    baselineCount: journal.baselineCount,
    targetCount: journal.targetCount,
    revision: journal.revision,
    entries: journal.entries,
  };
}

function journalChecksum(journal: GuardedCheckpoint20Journal): string {
  return exact99FixtureDigest(withoutChecksum(journal));
}

function assertSecretFree(value: unknown, path = "value"): void {
  if (typeof value === "string") {
    if (
      SECRET_VALUE.test(value) &&
      !/(?:transactionHash|blockHash|receiptHash|requestHash)$/i.test(path)
    ) {
      throw new Error(`${path} resembles forbidden secret material.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error(`${path}.${key} is a forbidden secret field.`);
      assertSecretFree(entry, `${path}.${key}`);
    }
  }
}

function normalizeAddresses(addresses: readonly string[]): string[] {
  if (addresses.length !== GUARDED_CHECKPOINT_20_CANDIDATE_COUNT) {
    throw new Error("Checkpoint-20 manifest must contain exactly 15 addresses.");
  }
  const normalized = addresses.map((address, index) => {
    if (!isAddress(address)) throw new Error(`Candidate address ${index} is invalid.`);
    return getAddress(address);
  });
  if (new Set(normalized.map((address) => address.toLowerCase())).size !== normalized.length) {
    throw new Error("Checkpoint-20 manifest contains a duplicate address.");
  }
  return normalized;
}

export function buildGuardedCheckpoint20Manifest(input: {
  addresses: readonly string[];
  storeBinding: GuardedCheckpoint20StoreBinding;
}): GuardedCheckpoint20Manifest {
  const addresses = normalizeAddresses(input.addresses);
  if (!UUID.test(input.storeBinding.storeId)) throw new Error("Store ID must be a UUID.");
  if (!DIGEST.test(input.storeBinding.publicFingerprint)) {
    throw new Error("Store public fingerprint is invalid.");
  }
  if (
    input.storeBinding.formatVersion !== 2 ||
    input.storeBinding.selectedRecordDecryption !== true ||
    input.storeBinding.externalPathRequired !== true
  ) throw new Error("Checkpoint-20 requires an external selected-record store v2 binding.");
  const base = {
    formatVersion: 1 as const,
    purpose: "pop33-guarded-checkpoint-20-public-addresses" as const,
    chainId: "84532" as const,
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    poolId: "1" as const,
    baselineCount: "5" as const,
    targetCount: "20" as const,
    addresses,
    storeBinding: structuredClone(input.storeBinding),
  };
  assertSecretFree(base);
  return { ...base, fingerprint: exact99FixtureDigest(base) };
}

export function validateGuardedCheckpoint20Manifest(value: GuardedCheckpoint20Manifest): GuardedCheckpoint20Manifest {
  const rebuilt = buildGuardedCheckpoint20Manifest({
    addresses: value.addresses,
    storeBinding: value.storeBinding,
  });
  if (
    value.formatVersion !== rebuilt.formatVersion || value.purpose !== rebuilt.purpose ||
    value.chainId !== rebuilt.chainId || getAddress(value.contractAddress) !== rebuilt.contractAddress ||
    getAddress(value.tokenAddress) !== rebuilt.tokenAddress || value.poolId !== "1" ||
    value.baselineCount !== "5" || value.targetCount !== "20" ||
    value.fingerprint !== rebuilt.fingerprint
  ) throw new Error("Checkpoint-20 manifest identity or fingerprint mismatch.");
  return rebuilt;
}

export function buildEmptyGuardedCheckpoint20Journal(
  manifest: GuardedCheckpoint20Manifest,
): GuardedCheckpoint20Journal {
  const checked = validateGuardedCheckpoint20Manifest(manifest);
  const journal: GuardedCheckpoint20Journal = {
    formatVersion: 1,
    purpose: "pop33-guarded-checkpoint-20-journal",
    manifestFingerprint: checked.fingerprint,
    baselineCount: "5",
    targetCount: "20",
    revision: 0,
    entries: [],
    checksum: "",
  };
  return { ...journal, checksum: journalChecksum(journal) };
}

export function validateGuardedCheckpoint20Journal(
  value: GuardedCheckpoint20Journal,
  manifest: GuardedCheckpoint20Manifest,
): GuardedCheckpoint20Journal {
  const checkedManifest = validateGuardedCheckpoint20Manifest(manifest);
  assertSecretFree(value);
  if (
    value.formatVersion !== 1 || value.purpose !== "pop33-guarded-checkpoint-20-journal" ||
    value.manifestFingerprint !== checkedManifest.fingerprint || value.baselineCount !== "5" ||
    value.targetCount !== "20" || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    value.revision !== value.entries.length || value.checksum !== journalChecksum(value)
  ) throw new Error("Checkpoint-20 journal identity, revision, or checksum is invalid.");
  let expectedCandidate = 0;
  let expectedStepIndex = 0;
  let stopped = false;
  value.entries.forEach((entry, sequence) => {
    if (entry.sequence !== sequence || entry.candidateIndex < 0 || entry.candidateIndex >= 15) {
      throw new Error("Checkpoint-20 journal entry order or candidate index is invalid.");
    }
    if (getAddress(entry.candidateAddress) !== checkedManifest.addresses[entry.candidateIndex]) {
      throw new Error("Checkpoint-20 journal candidate does not match the manifest.");
    }
    if (!GUARDED_CHECKPOINT_20_STEPS.includes(entry.step)) throw new Error("Unknown checkpoint-20 step.");
    if (stopped || entry.candidateIndex !== expectedCandidate || entry.step !== GUARDED_CHECKPOINT_20_STEPS[expectedStepIndex]) {
      throw new Error("Checkpoint-20 journal candidate or step sequence is invalid.");
    }
    if (entry.transactionHash !== null && !HASH.test(entry.transactionHash)) {
      throw new Error("Checkpoint-20 journal transaction hash is invalid.");
    }
    if (entry.status !== "confirmed") {
      stopped = true;
    } else if (expectedStepIndex === GUARDED_CHECKPOINT_20_STEPS.length - 1) {
      expectedCandidate += 1;
      expectedStepIndex = 0;
    } else {
      expectedStepIndex += 1;
    }
  });
  return structuredClone(value);
}

function terminal(entry: GuardedCheckpoint20JournalEntry): boolean {
  return entry.status !== "confirmed";
}

export function inspectGuardedCheckpoint20Progress(
  journal: GuardedCheckpoint20Journal,
  manifest: GuardedCheckpoint20Manifest,
): GuardedCheckpoint20Inspection {
  const checked = validateGuardedCheckpoint20Journal(journal, manifest);
  const blockers: string[] = [];
  const blockingEntry = checked.entries.find(terminal);
  if (blockingEntry) blockers.push(
    `Candidate ${blockingEntry.candidateIndex} step ${blockingEntry.step} is ${blockingEntry.status}.`,
  );
  let completedCandidates = 0;
  for (let index = 0; index < 15; index += 1) {
    const complete = checked.entries.some((entry) =>
      entry.candidateIndex === index && entry.step === "COMMIT_JOURNAL_STATE" && entry.status === "confirmed");
    if (!complete) break;
    completedCandidates += 1;
  }
  const nextCandidateIndex = completedCandidates >= 15 ? null : completedCandidates;
  const candidateEntries = nextCandidateIndex === null ? [] : checked.entries.filter(
    (entry) => entry.candidateIndex === nextCandidateIndex && entry.status === "confirmed",
  );
  const nextStep = blockingEntry || nextCandidateIndex === null
    ? null
    : GUARDED_CHECKPOINT_20_STEPS[candidateEntries.length] ?? null;
  const expectedCount = GUARDED_CHECKPOINT_20_BASELINE + completedCandidates;
  const expectedEscrow = BigInt(expectedCount) * GUARDED_CHECKPOINT_20_ENTRY_PRICE;
  const nextBatchTarget = GUARDED_CHECKPOINT_20_BATCH_TARGETS.find((target) => target > expectedCount) ?? null;
  return {
    readOnly: true,
    allowed: blockers.length === 0 && expectedCount < GUARDED_CHECKPOINT_20_TARGET,
    blockers,
    expectedCount: expectedCount.toString(),
    expectedEscrow: expectedEscrow.toString(),
    completedCandidates,
    nextCandidateIndex,
    nextStep,
    nextBatchTarget,
    hardStopReached: expectedCount >= GUARDED_CHECKPOINT_20_TARGET,
  };
}

export function appendGuardedCheckpoint20JournalEntry(input: {
  journal: GuardedCheckpoint20Journal;
  manifest: GuardedCheckpoint20Manifest;
  candidateIndex: number;
  step: GuardedCheckpoint20Step;
  status: GuardedCheckpoint20EntryStatus;
  transactionHash?: string | null;
  blockNumber?: bigint | null;
  publicEvidence?: Record<string, string | boolean | null>;
  error?: unknown;
}): GuardedCheckpoint20Journal {
  const journal = validateGuardedCheckpoint20Journal(input.journal, input.manifest);
  const progress = inspectGuardedCheckpoint20Progress(journal, input.manifest);
  if (progress.blockers.length > 0) throw new Error("Checkpoint-20 journal is blocked and requires review.");
  if (progress.hardStopReached || progress.nextCandidateIndex === null || progress.nextStep === null) {
    throw new Error("Checkpoint-20 hard stop reached; no additional operation is permitted.");
  }
  if (input.candidateIndex !== progress.nextCandidateIndex || input.step !== progress.nextStep) {
    throw new Error("Checkpoint-20 operation is out of candidate or step order.");
  }
  if (input.transactionHash && !GUARDED_CHECKPOINT_20_TRANSACTION_STEPS.includes(input.step)) {
    throw new Error("Only a transaction step may record a transaction hash.");
  }
  const publicEvidence = structuredClone(input.publicEvidence ?? {});
  assertSecretFree(publicEvidence, "publicEvidence");
  const entries = [...journal.entries, {
    sequence: journal.entries.length,
    candidateIndex: input.candidateIndex,
    candidateAddress: input.manifest.addresses[input.candidateIndex],
    step: input.step,
    status: input.status,
    transactionHash: input.transactionHash ?? null,
    blockNumber: input.blockNumber?.toString() ?? null,
    publicEvidence,
    error: input.error === undefined ? null : sanitizeOperatorError(input.error),
  } satisfies GuardedCheckpoint20JournalEntry];
  const next: GuardedCheckpoint20Journal = {
    ...journal,
    revision: journal.revision + 1,
    entries,
    checksum: "",
  };
  return { ...next, checksum: journalChecksum(next) };
}

export function evaluateGuardedCheckpoint20HardStops(
  input: GuardedCheckpoint20GuardInput,
): readonly string[] {
  const blockers: string[] = [];
  if (input.chainId !== GUARDED_CHECKPOINT_20_CHAIN_ID) blockers.push("WRONG_CHAIN_ID");
  if (!isAddress(input.contractAddress) || getAddress(input.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT)) blockers.push("WRONG_CONTRACT_ADDRESS");
  if (!isAddress(input.tokenAddress) || getAddress(input.tokenAddress) !== getAddress(GUARDED_CHECKPOINT_20_TOKEN)) blockers.push("WRONG_TOKEN_ADDRESS");
  if (!input.contractBytecodeMatches || !input.tokenBytecodeMatches) blockers.push("BYTECODE_MISMATCH");
  if (input.poolStatus !== "Open") blockers.push("POOL_NOT_OPEN");
  if (input.poolCount < 5n || input.poolCount > 20n) blockers.push("COUNT_OUTSIDE_CHECKPOINT_RANGE");
  if (input.escrowedAmount !== input.poolCount * GUARDED_CHECKPOINT_20_ENTRY_PRICE) blockers.push("ESCROW_MISMATCH");
  if (input.lockedAt !== 0n) blockers.push("POOL_LOCKED");
  if (input.lifecycleActionable > 0) blockers.push("LIFECYCLE_ACTIONABLE");
  if (input.lifecycleWarnings > 0) blockers.push("LIFECYCLE_WARNING");
  if (input.lifecycleCritical > 0) blockers.push("LIFECYCLE_CRITICAL");
  if (!input.rpcSourcesAgree) blockers.push("RPC_DISAGREEMENT");
  if (!input.manifestFingerprintMatches || !input.storeFingerprintMatches) blockers.push("ARTIFACT_FINGERPRINT_MISMATCH");
  if (!input.globalRunLockAvailable) blockers.push("GLOBAL_RUN_LOCK_CONFLICT");
  if (!input.latestNonceMatchesPending || input.manualNonceConflict) blockers.push("NONCE_CONFLICT");
  if (input.candidateAddress !== null && !isAddress(input.candidateAddress)) blockers.push("INVALID_CANDIDATE");
  if (!input.candidateUnique) blockers.push("DUPLICATE_CANDIDATE");
  if (input.candidatePreviouslyUsed) blockers.push("CANDIDATE_PREVIOUSLY_USED");
  if (!input.candidateEligible) blockers.push("CANDIDATE_NOT_ELIGIBLE");
  if (input.routedPoolId !== null && input.routedPoolId !== GUARDED_CHECKPOINT_20_POOL_ID) blockers.push("WRONG_ROUTING");
  if (input.candidateEthBalanceWei !== null && input.candidateEthBalanceWei < input.minimumRequiredEthWei) blockers.push("INSUFFICIENT_ETH");
  if (input.unexpectedPreFundingBalance) blockers.push("UNEXPECTED_PRE_FUNDING_BALANCE");
  if (input.fundingSignerBalanceWei !== null && input.fundingSignerBalanceWei - input.proposedFundingWei < input.fundingSignerReserveWei) blockers.push("FUNDING_SIGNER_RESERVE_VIOLATION");
  if (input.proposedFundingWei > GUARDED_CHECKPOINT_20_FUNDING_PER_WALLET_WEI) blockers.push("FUNDING_CAP_EXCEEDED");
  if (input.feeCapExceeded) blockers.push("FEE_CAP_EXCEEDED");
  if (input.faucetCooldownActive) blockers.push("FAUCET_COOLDOWN");
  if (input.dripAmount !== null && input.dripAmount !== 330_000_000n) blockers.push("WRONG_DRIP_AMOUNT");
  if (input.initialAllowance !== null && input.initialAllowance !== 0n) blockers.push("INITIAL_ALLOWANCE_NOT_ZERO");
  if (input.approvedAmount !== null && input.approvedAmount !== GUARDED_CHECKPOINT_20_ENTRY_PRICE) blockers.push("APPROVE_AMOUNT_MISMATCH");
  if (input.allowanceAfterApprove !== null && input.allowanceAfterApprove !== GUARDED_CHECKPOINT_20_ENTRY_PRICE) blockers.push("ALLOWANCE_MISMATCH");
  if (input.receiptState !== "not-applicable" && input.receiptState !== "success") blockers.push(`RECEIPT_${input.receiptState.toUpperCase()}`);
  if (input.joinedPoolId !== null && input.joinedPoolId !== GUARDED_CHECKPOINT_20_POOL_ID) blockers.push("WRONG_JOIN_POOL");
  if (input.countDelta !== null && input.countDelta !== 1n) blockers.push("COUNT_DELTA_MISMATCH");
  if (input.escrowDelta !== null && input.escrowDelta !== GUARDED_CHECKPOINT_20_ENTRY_PRICE) blockers.push("ESCROW_DELTA_MISMATCH");
  if (input.activePositionDelta !== null && input.activePositionDelta !== 1n) blockers.push("POSITION_DELTA_MISMATCH");
  return blockers;
}

export function simulateGuardedCheckpoint20Batch(input: {
  manifest: GuardedCheckpoint20Manifest;
  journal: GuardedCheckpoint20Journal;
  fault?: GuardedCheckpoint20SimulationFault;
}): GuardedCheckpoint20SimulationResult {
  let journal = validateGuardedCheckpoint20Journal(input.journal, input.manifest);
  const initial = inspectGuardedCheckpoint20Progress(journal, input.manifest);
  if (initial.blockers.length > 0 || initial.hardStopReached) {
    return { mode: "simulate", fixtureOnly: true, journal, inspection: initial, stoppedAtBatch: initial.hardStopReached ? 20 : null, stoppedOnFault: initial.blockers.length > 0, processedSteps: 0 };
  }
  const batchTarget = initial.nextBatchTarget;
  let processedSteps = 0;
  while (true) {
    const progress = inspectGuardedCheckpoint20Progress(journal, input.manifest);
    if (progress.blockers.length > 0 || progress.hardStopReached || progress.nextCandidateIndex === null || progress.nextStep === null) {
      return { mode: "simulate", fixtureOnly: true, journal, inspection: progress, stoppedAtBatch: progress.hardStopReached ? 20 : null, stoppedOnFault: progress.blockers.length > 0, processedSteps };
    }
    if (batchTarget !== null && Number(progress.expectedCount) >= batchTarget) {
      return { mode: "simulate", fixtureOnly: true, journal, inspection: progress, stoppedAtBatch: batchTarget, stoppedOnFault: false, processedSteps };
    }
    const fault = input.fault?.candidateIndex === progress.nextCandidateIndex && input.fault.step === progress.nextStep
      ? input.fault : undefined;
    journal = appendGuardedCheckpoint20JournalEntry({
      journal,
      manifest: input.manifest,
      candidateIndex: progress.nextCandidateIndex,
      step: progress.nextStep,
      status: fault?.status ?? "confirmed",
      transactionHash: GUARDED_CHECKPOINT_20_TRANSACTION_STEPS.includes(progress.nextStep)
        ? `0x${(journal.revision + 1).toString(16).padStart(64, "0")}` : null,
      blockNumber: BigInt(45_000_000 + journal.revision),
      publicEvidence: { fixtureOnly: true, baselineCount: "5" },
      error: fault?.reason,
    });
    processedSteps += 1;
    if (fault) {
      const inspection = inspectGuardedCheckpoint20Progress(journal, input.manifest);
      return { mode: "simulate", fixtureOnly: true, journal, inspection, stoppedAtBatch: null, stoppedOnFault: true, processedSteps };
    }
  }
}

export function serializeGuardedCheckpoint20Journal(journal: GuardedCheckpoint20Journal): string {
  assertSecretFree(journal);
  return `${JSON.stringify(journal, null, 2)}\n`;
}

export async function writeGuardedCheckpoint20Journal(input: {
  path: string;
  journal: GuardedCheckpoint20Journal;
  manifest: GuardedCheckpoint20Manifest;
  expectedRevision: number | null;
}): Promise<string> {
  const path = await assertSafeExternalFilePath(input.path, GUARDED_CHECKPOINT_20_JOURNAL_SUFFIX);
  const journal = validateGuardedCheckpoint20Journal(input.journal, input.manifest);
  await withExclusiveFileLock(path, async () => {
    const exists = await pathIsRegularFile(path);
    if (input.expectedRevision === null && exists) throw new Error("Checkpoint-20 journal already exists.");
    if (input.expectedRevision !== null) {
      if (!exists) throw new Error("Checkpoint-20 journal is missing during revision update.");
      const current = JSON.parse(await readFile(path, "utf8")) as GuardedCheckpoint20Journal;
      validateGuardedCheckpoint20Journal(current, input.manifest);
      if (current.revision !== input.expectedRevision || journal.revision <= current.revision) {
        throw new Error("Checkpoint-20 journal revision conflict.");
      }
    }
    await atomicWritePrivateFile(path, serializeGuardedCheckpoint20Journal(journal));
  });
  return path;
}

export async function readGuardedCheckpoint20Journal(input: {
  path: string;
  manifest: GuardedCheckpoint20Manifest;
}): Promise<GuardedCheckpoint20Journal> {
  const path = await assertSafeExternalFilePath(input.path, GUARDED_CHECKPOINT_20_JOURNAL_SUFFIX);
  if (!(await pathIsRegularFile(path))) throw new Error("Checkpoint-20 journal does not exist.");
  return validateGuardedCheckpoint20Journal(
    JSON.parse(await readFile(path, "utf8")) as GuardedCheckpoint20Journal,
    input.manifest,
  );
}

export function renderGuardedCheckpoint20Inspection(report: GuardedCheckpoint20Inspection): string {
  return [
    "POP33 guarded checkpoint-20",
    "Mode: read-only / no execution path",
    `Progress: ${report.expectedCount}/100`,
    `Expected escrow: ${report.expectedEscrow} dUSDC base units`,
    `Completed new candidates: ${report.completedCandidates}/15`,
    `Next candidate: ${report.nextCandidateIndex ?? "none"}`,
    `Next step: ${report.nextStep ?? "none"}`,
    `Next batch hard stop: ${report.nextBatchTarget ?? "complete"}`,
    `Blockers: ${report.blockers.length === 0 ? "none" : report.blockers.join("; ")}`,
    "EXECUTE IS NOT IMPLEMENTED OR AUTHORIZED.",
  ].join("\n");
}
