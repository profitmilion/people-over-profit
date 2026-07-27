import { createHash } from "node:crypto";

import { getAddress, isAddress } from "ethers";

import {
  EXACT_99_AUTOMATIC_JOIN_HARD_STOP,
  exact99ManifestFingerprint,
  validateExact99Checkpoint,
  validateExact99Journal,
  validateExact99Manifest,
  type Exact99Checkpoint,
  type Exact99Journal,
  type Exact99JournalEntry,
  type Exact99Manifest,
  type Exact99OperationStatus,
  type Exact99PreflightCheck,
} from "./exact-99-operator-artifacts.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const EXACT_99_FUNDING_PURPOSE = "base-sepolia-exact-99-gas-funding";
export const EXACT_99_FUNDING_MODES = ["plan", "inspect", "simulate"] as const;

export type Exact99FundingMode = (typeof EXACT_99_FUNDING_MODES)[number];

export interface Exact99FundingLimits {
  plannedAmountPerWalletWei: string;
  minimumTargetBalanceWei: string;
  maximumPerWalletWei: string;
  maximumTotalBudgetWei: string;
  signerReserveWei: string;
}

export interface Exact99FundingSignerIdentity {
  address: string;
  chainId: string;
  purpose: typeof EXACT_99_FUNDING_PURPOSE;
  maximumBudgetWei: string;
  startingBalanceWei: string;
  requiredReserveWei: string;
}

export interface Exact99FundingPlanOperation {
  index: number;
  address: string;
  plannedAmountWei: string;
  status: "planned";
  minimumTargetBalanceWei: string;
  maximumAllowedAmountWei: string;
  operationId: string;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
}

export interface Exact99FundingPlan {
  formatVersion: 1;
  purpose: typeof EXACT_99_FUNDING_PURPOSE;
  mode: "plan";
  planId: string;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  walletOrderDigest: string;
  walletCount: 99;
  limits: Exact99FundingLimits;
  signer: Exact99FundingSignerIdentity;
  totalPlannedWei: string;
  operations: Exact99FundingPlanOperation[];
}

export interface Exact99FundingInspection {
  profile: "exact-99-funding";
  readOnly: true;
  planId: string;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  walletCount: number;
  totalPlannedWei: string;
  maximumPerWalletWei: string;
  maximumTotalBudgetWei: string;
  confirmedFundingCount: number;
  completedFundingCount: number;
  checks: Exact99PreflightCheck[];
  blockers: string[];
  latestStatusByOperation: Record<string, Exact99OperationStatus>;
  readyForSimulation: boolean;
}

export type Exact99FundingSimulationOutcome =
  | {
      type: "success";
      transactionHash: string;
      blockNumber: number;
      gasUsed: string;
    }
  | {
      type: "failure";
      error: string;
    }
  | {
      type: "timeout";
      transactionHash: string;
    }
  | {
      type: "ambiguous-receipt";
      transactionHash: string;
      error: string;
    }
  | {
      type: "manual-review";
      error: string;
    }
  | {
      type: "already-funded";
      observedBalanceWei: string;
    };

export interface Exact99FundingSimulationResult {
  mode: "simulate";
  simulatedOnly: true;
  stopped: boolean;
  stopReason: string | null;
  processedOperations: number;
  confirmedFundingCount: number;
  completedFundingCount: number;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  inspection: Exact99FundingInspection;
}

const DECIMAL_WEI = /^(?:0|[1-9]\d*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const PLAN_KEYS = [
  "formatVersion", "purpose", "mode", "planId", "setId", "storeId",
  "manifestFingerprint", "walletOrderDigest", "walletCount", "limits",
  "signer", "totalPlannedWei", "operations",
] as const;
const LIMIT_KEYS = [
  "plannedAmountPerWalletWei", "minimumTargetBalanceWei", "maximumPerWalletWei",
  "maximumTotalBudgetWei", "signerReserveWei",
] as const;
const SIGNER_KEYS = [
  "address", "chainId", "purpose", "maximumBudgetWei", "startingBalanceWei",
  "requiredReserveWei",
] as const;
const OPERATION_KEYS = [
  "index", "address", "plannedAmountWei", "status", "minimumTargetBalanceWei",
  "maximumAllowedAmountWei", "operationId", "setId", "storeId",
  "manifestFingerprint",
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const candidate = record(value, label);
  for (const key of Object.keys(candidate)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  for (const key of keys) {
    if (!(key in candidate)) throw new Error(`${label}.${key} is required.`);
  }
  return candidate;
}

function wei(value: unknown, label: string, allowZero = false): bigint {
  if (typeof value !== "string" || !DECIMAL_WEI.test(value)) {
    throw new Error(`${label} must be a canonical decimal wei string; ETH, gwei, numbers, and units are rejected.`);
  }
  const parsed = BigInt(value);
  if (!allowZero && parsed <= 0n) throw new Error(`${label} must be greater than zero wei.`);
  return parsed;
}

function weiString(value: unknown, label: string, allowZero = false): string {
  return wei(value, label, allowZero).toString();
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be a valid public EVM address.`);
  }
  return getAddress(value);
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function iso(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function safeText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) {
    throw new Error(`${label} must be a non-empty redacted string no longer than 500 characters.`);
  }
  if (/\b(?:private key|mnemonic|seed phrase|password|passphrase)\b/i.test(value) ||
      /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i.test(value) ||
      /(?:^|\s)(?:0x)?[0-9a-fA-F]{64}(?:\s|$)/.test(value)) {
    throw new Error(`${label} contains forbidden secret-like data.`);
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID.`);
  return value;
}

function requireFingerprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a sha256 fingerprint.`);
  }
  return value;
}

function transactionHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !TRANSACTION_HASH.test(value)) {
    throw new Error(`${label} must be a transaction hash.`);
  }
  return value.toLowerCase();
}

function deterministicUuid(parts: readonly string[]): string {
  const hex = createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalExpectedState(operation: Exact99FundingPlanOperation): string {
  return [
    `funding-plan=${operation.manifestFingerprint}`,
    `wallet-index=${operation.index}`,
    `minimum-target-wei=${operation.minimumTargetBalanceWei}`,
    `planned-amount-wei=${operation.plannedAmountWei}`,
    `maximum-amount-wei=${operation.maximumAllowedAmountWei}`,
  ].join(";");
}

function validateLimits(value: unknown): Exact99FundingLimits {
  const limits = exactRecord(value, LIMIT_KEYS, "fundingPlan.limits");
  const result: Exact99FundingLimits = {
    plannedAmountPerWalletWei: weiString(
      limits.plannedAmountPerWalletWei,
      "fundingPlan.limits.plannedAmountPerWalletWei",
    ),
    minimumTargetBalanceWei: weiString(
      limits.minimumTargetBalanceWei,
      "fundingPlan.limits.minimumTargetBalanceWei",
    ),
    maximumPerWalletWei: weiString(
      limits.maximumPerWalletWei,
      "fundingPlan.limits.maximumPerWalletWei",
    ),
    maximumTotalBudgetWei: weiString(
      limits.maximumTotalBudgetWei,
      "fundingPlan.limits.maximumTotalBudgetWei",
    ),
    signerReserveWei: weiString(
      limits.signerReserveWei,
      "fundingPlan.limits.signerReserveWei",
    ),
  };
  if (BigInt(result.plannedAmountPerWalletWei) < BigInt(result.minimumTargetBalanceWei)) {
    throw new Error("Planned wallet funding is below the configured minimum target balance.");
  }
  if (BigInt(result.plannedAmountPerWalletWei) > BigInt(result.maximumPerWalletWei)) {
    throw new Error("Planned wallet funding exceeds the per-wallet maximum.");
  }
  return result;
}

function validateSigner(
  value: unknown,
  manifest: Exact99Manifest,
  limits: Exact99FundingLimits,
  totalPlannedWei: bigint,
): Exact99FundingSignerIdentity {
  const signer = exactRecord(value, SIGNER_KEYS, "fundingPlan.signer");
  if (signer.chainId !== manifest.chainId) throw new Error("Funding signer chain ID mismatch.");
  if (signer.purpose !== EXACT_99_FUNDING_PURPOSE) throw new Error("Funding signer purpose mismatch.");
  const maximumBudgetWei = weiString(signer.maximumBudgetWei, "fundingPlan.signer.maximumBudgetWei");
  const startingBalanceWei = weiString(signer.startingBalanceWei, "fundingPlan.signer.startingBalanceWei");
  const requiredReserveWei = weiString(signer.requiredReserveWei, "fundingPlan.signer.requiredReserveWei");
  if (maximumBudgetWei !== limits.maximumTotalBudgetWei) {
    throw new Error("Funding signer maximum budget does not match the plan limit.");
  }
  if (requiredReserveWei !== limits.signerReserveWei) {
    throw new Error("Funding signer reserve does not match the plan limit.");
  }
  const starting = BigInt(startingBalanceWei);
  if (starting < totalPlannedWei) {
    throw new Error("Funding signer has insufficient balance for the planned transfers.");
  }
  if (starting - totalPlannedWei < BigInt(requiredReserveWei)) {
    throw new Error("Funding plan would violate the required signer reserve.");
  }
  return {
    address: address(signer.address, "fundingPlan.signer.address"),
    chainId: manifest.chainId,
    purpose: EXACT_99_FUNDING_PURPOSE,
    maximumBudgetWei,
    startingBalanceWei,
    requiredReserveWei,
  };
}

function operationId(
  manifest: Exact99Manifest,
  manifestFingerprint: string,
  index: number,
  walletAddress: string,
  amountWei: string,
  minimumTargetBalanceWei: string,
): string {
  return deterministicUuid([
    EXACT_99_FUNDING_PURPOSE,
    manifest.setId,
    manifest.storeId,
    manifestFingerprint,
    index.toString(),
    walletAddress.toLowerCase(),
    amountWei,
    minimumTargetBalanceWei,
  ]);
}

export function assertExact99FundingMode(value: string): asserts value is Exact99FundingMode {
  if (!(EXACT_99_FUNDING_MODES as readonly string[]).includes(value)) {
    throw new Error("Exact-99 funding mode must be plan, inspect, or simulate.");
  }
}

export function buildExact99FundingPlan(input: {
  manifest: Exact99Manifest;
  limits: Exact99FundingLimits;
  signer: Exact99FundingSignerIdentity;
}): Exact99FundingPlan {
  const manifest = validateExact99Manifest(input.manifest);
  const limits = validateLimits(input.limits);
  const plannedAmount = BigInt(limits.plannedAmountPerWalletWei);
  const totalPlanned = plannedAmount * BigInt(manifest.walletCount);
  if (totalPlanned > BigInt(limits.maximumTotalBudgetWei)) {
    throw new Error("Exact-99 funding plan exceeds the maximum total budget.");
  }
  const signer = validateSigner(input.signer, manifest, limits, totalPlanned);
  const manifestFingerprint = exact99ManifestFingerprint(manifest);
  const operations: Exact99FundingPlanOperation[] = manifest.walletAddresses.map(
    (walletAddress, index) => ({
      index,
      address: walletAddress,
      plannedAmountWei: limits.plannedAmountPerWalletWei,
      status: "planned",
      minimumTargetBalanceWei: limits.minimumTargetBalanceWei,
      maximumAllowedAmountWei: limits.maximumPerWalletWei,
      operationId: operationId(
        manifest,
        manifestFingerprint,
        index,
        walletAddress,
        limits.plannedAmountPerWalletWei,
        limits.minimumTargetBalanceWei,
      ),
      setId: manifest.setId,
      storeId: manifest.storeId,
      manifestFingerprint,
    }),
  );
  const planIdentity = JSON.stringify({
    purpose: EXACT_99_FUNDING_PURPOSE,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint,
    walletOrderDigest: manifest.walletOrderDigest,
    limits,
    signer,
    operations,
  });
  return validateExact99FundingPlan({
    formatVersion: 1,
    purpose: EXACT_99_FUNDING_PURPOSE,
    mode: "plan",
    planId: sha256(planIdentity),
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint,
    walletOrderDigest: manifest.walletOrderDigest,
    walletCount: EXACT_99_AUTOMATIC_JOIN_HARD_STOP,
    limits,
    signer,
    totalPlannedWei: totalPlanned.toString(),
    operations,
  }, manifest);
}

export function validateExact99FundingPlan(
  value: unknown,
  manifestInput: Exact99Manifest,
): Exact99FundingPlan {
  const manifest = validateExact99Manifest(manifestInput);
  const candidate = exactRecord(value, PLAN_KEYS, "fundingPlan");
  if (candidate.formatVersion !== 1) throw new Error("Funding plan format version must equal 1.");
  if (candidate.purpose !== EXACT_99_FUNDING_PURPOSE || candidate.mode !== "plan") {
    throw new Error("Funding plan purpose or mode mismatch.");
  }
  if (candidate.setId !== manifest.setId || candidate.storeId !== manifest.storeId) {
    throw new Error("Funding plan set or store ID mismatch.");
  }
  const manifestFingerprint = exact99ManifestFingerprint(manifest);
  if (candidate.manifestFingerprint !== manifestFingerprint) {
    throw new Error("Funding plan manifest fingerprint mismatch.");
  }
  if (candidate.walletOrderDigest !== manifest.walletOrderDigest) {
    throw new Error("Funding plan wallet-order digest mismatch.");
  }
  if (candidate.walletCount !== 99 ||
      !Array.isArray(candidate.operations) ||
      candidate.operations.length !== 99) {
    throw new Error("Funding plan must contain exactly 99 operations.");
  }
  const limits = validateLimits(candidate.limits);
  const totalPlannedWei = weiString(candidate.totalPlannedWei, "fundingPlan.totalPlannedWei");
  const expectedTotal = BigInt(limits.plannedAmountPerWalletWei) * 99n;
  if (BigInt(totalPlannedWei) !== expectedTotal) {
    throw new Error("Funding plan total does not match its 99 operations.");
  }
  if (expectedTotal > BigInt(limits.maximumTotalBudgetWei)) {
    throw new Error("Funding plan exceeds the maximum total budget.");
  }
  const signer = validateSigner(candidate.signer, manifest, limits, expectedTotal);
  const seenAddresses = new Set<string>();
  const seenOperationIds = new Set<string>();
  const operations = candidate.operations.map((raw, index) => {
    const operation = exactRecord(raw, OPERATION_KEYS, `fundingPlan.operations[${index}]`);
    if (operation.index !== index) throw new Error("Funding plan operation order or index changed.");
    const walletAddress = address(operation.address, `fundingPlan.operations[${index}].address`);
    if (walletAddress !== manifest.walletAddresses[index]) {
      throw new Error("Funding plan contains an address outside the ordered exact-99 manifest.");
    }
    if (seenAddresses.has(walletAddress.toLowerCase())) {
      throw new Error("Funding plan contains a duplicate recipient address.");
    }
    seenAddresses.add(walletAddress.toLowerCase());
    if (operation.status !== "planned") throw new Error("Immutable funding plan status must equal planned.");
    const amount = weiString(operation.plannedAmountWei, `fundingPlan.operations[${index}].plannedAmountWei`);
    const minimum = weiString(
      operation.minimumTargetBalanceWei,
      `fundingPlan.operations[${index}].minimumTargetBalanceWei`,
    );
    const maximum = weiString(
      operation.maximumAllowedAmountWei,
      `fundingPlan.operations[${index}].maximumAllowedAmountWei`,
    );
    if (amount !== limits.plannedAmountPerWalletWei ||
        minimum !== limits.minimumTargetBalanceWei ||
        maximum !== limits.maximumPerWalletWei) {
      throw new Error("Funding operation limits do not match the plan profile.");
    }
    if (BigInt(amount) > BigInt(maximum)) throw new Error("Funding operation exceeds the per-wallet maximum.");
    if (operation.setId !== manifest.setId ||
        operation.storeId !== manifest.storeId ||
        operation.manifestFingerprint !== manifestFingerprint) {
      throw new Error("Funding operation artifact identity mismatch.");
    }
    const expectedOperationId = operationId(
      manifest,
      manifestFingerprint,
      index,
      walletAddress,
      amount,
      minimum,
    );
    if (operation.operationId !== expectedOperationId ||
        !UUID.test(operation.operationId as string)) {
      throw new Error("Funding operation deterministic identity mismatch.");
    }
    if (seenOperationIds.has(expectedOperationId)) throw new Error("Funding plan contains a duplicate operation.");
    seenOperationIds.add(expectedOperationId);
    return {
      index,
      address: walletAddress,
      plannedAmountWei: amount,
      status: "planned" as const,
      minimumTargetBalanceWei: minimum,
      maximumAllowedAmountWei: maximum,
      operationId: expectedOperationId,
      setId: manifest.setId,
      storeId: manifest.storeId,
      manifestFingerprint,
    };
  });
  const planIdentity = JSON.stringify({
    purpose: EXACT_99_FUNDING_PURPOSE,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint,
    walletOrderDigest: manifest.walletOrderDigest,
    limits,
    signer,
    operations,
  });
  if (candidate.planId !== sha256(planIdentity)) {
    throw new Error("Funding plan deterministic plan ID mismatch.");
  }
  return {
    formatVersion: 1,
    purpose: EXACT_99_FUNDING_PURPOSE,
    mode: "plan",
    planId: candidate.planId as string,
    setId: manifest.setId,
    storeId: manifest.storeId,
    manifestFingerprint,
    walletOrderDigest: manifest.walletOrderDigest,
    walletCount: 99,
    limits,
    signer,
    totalPlannedWei,
    operations,
  };
}

function latestFundingEntries(journal: Exact99Journal): Map<string, Exact99JournalEntry> {
  const latest = new Map<string, Exact99JournalEntry>();
  for (const entry of journal.entries) {
    if (entry.type === "funding") latest.set(entry.operationId, entry);
  }
  return latest;
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

export function inspectExact99Funding(input: {
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  plan: Exact99FundingPlan;
}): Exact99FundingInspection {
  const checks: Exact99PreflightCheck[] = [];
  let manifest: Exact99Manifest | undefined;
  let checkpoint: Exact99Checkpoint | undefined;
  let journal: Exact99Journal | undefined;
  let plan: Exact99FundingPlan | undefined;

  check(checks, "funding-manifest", () => {
    manifest = validateExact99Manifest(input.manifest);
  });
  check(checks, "funding-plan", () => {
    if (!manifest) throw new Error("Exact-99 manifest is unavailable.");
    plan = validateExact99FundingPlan(input.plan, manifest);
  });
  check(checks, "funding-checkpoint", () => {
    if (!manifest) throw new Error("Exact-99 manifest is unavailable.");
    checkpoint = validateExact99Checkpoint(input.checkpoint, manifest);
  });
  check(checks, "funding-journal", () => {
    if (!manifest) throw new Error("Exact-99 manifest is unavailable.");
    journal = validateExact99Journal(input.journal, manifest);
  });

  let latest = new Map<string, Exact99JournalEntry>();
  check(checks, "funding-journal-plan-binding", () => {
    if (!plan || !journal) throw new Error("Funding plan or journal is unavailable.");
    latest = latestFundingEntries(journal);
    const operations = new Map(plan.operations.map((operation) => [operation.operationId, operation]));
    for (const entry of latest.values()) {
      const planned = operations.get(entry.operationId);
      if (!planned) throw new Error("Funding journal contains an operation outside the exact-99 plan.");
      if (entry.walletIndex !== planned.index ||
          entry.walletAddress !== planned.address ||
          entry.expectedState !== canonicalExpectedState(planned)) {
        throw new Error("Funding journal operation does not match its manifest-bound plan.");
      }
    }
  });

  let confirmedFundingCount = 0;
  let completedFundingCount = 0;
  check(checks, "funding-checkpoint-journal-reconciliation", () => {
    if (!checkpoint || !plan) throw new Error("Funding checkpoint or plan is unavailable.");
    const confirmedIndices = new Set<number>();
    const completedIndices = new Set<number>();
    for (const entry of latest.values()) {
      if (entry.status === "confirmed") {
        if (entry.walletIndex === null || confirmedIndices.has(entry.walletIndex)) {
          throw new Error("Funding journal contains a duplicate confirmed wallet.");
        }
        confirmedIndices.add(entry.walletIndex);
        completedIndices.add(entry.walletIndex);
      } else if (entry.status === "skipped-already-funded") {
        if (entry.walletIndex === null || completedIndices.has(entry.walletIndex)) {
          throw new Error("Funding journal contains a duplicate completed wallet.");
        }
        completedIndices.add(entry.walletIndex);
      }
    }
    confirmedFundingCount = confirmedIndices.size;
    completedFundingCount = completedIndices.size;
    if (checkpoint.counters.funded !== confirmedFundingCount) {
      throw new Error("Funding checkpoint count does not match confirmed journal operations.");
    }
    if (confirmedFundingCount > 99 || completedFundingCount > 99) {
      throw new Error("Funding state exceeds the exact-99 recipient limit.");
    }
  });

  check(checks, "funding-recovery", () => {
    const blockers = [...latest.values()].filter((entry) =>
      ["prepared", "pending", "ambiguous", "manual-review", "failed"].includes(entry.status),
    );
    if (blockers.length > 0 ||
        checkpoint?.recovery.pending ||
        checkpoint?.recovery.ambiguous ||
        checkpoint?.recovery.manualReview) {
      throw new Error("Funding state requires recovery or manual review before automatic continuation.");
    }
  });

  const blockers = checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`);
  return {
    profile: "exact-99-funding",
    readOnly: true,
    planId: plan?.planId ?? "",
    setId: manifest?.setId ?? "",
    storeId: manifest?.storeId ?? "",
    manifestFingerprint: manifest ? exact99ManifestFingerprint(manifest) : "",
    walletCount: plan?.walletCount ?? 0,
    totalPlannedWei: plan?.totalPlannedWei ?? "0",
    maximumPerWalletWei: plan?.limits.maximumPerWalletWei ?? "0",
    maximumTotalBudgetWei: plan?.limits.maximumTotalBudgetWei ?? "0",
    confirmedFundingCount,
    completedFundingCount,
    checks,
    blockers,
    latestStatusByOperation: Object.fromEntries(
      [...latest.entries()].map(([operationIdValue, entry]) => [operationIdValue, entry.status]),
    ),
    readyForSimulation: blockers.length === 0,
  };
}

function timestampCursor(startedAt: string): () => string {
  let cursor = new Date(iso(startedAt, "simulation.startedAt")).getTime();
  return () => {
    const value = new Date(cursor).toISOString();
    cursor += 1_000;
    return value;
  };
}

function appendEvent(
  journal: Exact99Journal,
  manifest: Exact99Manifest,
  operation: Exact99FundingPlanOperation,
  status: Exact99OperationStatus,
  updatedAt: string,
  update: Partial<Pick<
    Exact99JournalEntry,
    "transactionHash" | "blockNumber" | "receipt" | "reconciliation" | "error"
  >> = {},
): Exact99Journal {
  const previous = [...journal.entries].reverse().find(
    (entry) => entry.operationId === operation.operationId,
  );
  const entry: Exact99JournalEntry = {
    sequence: journal.entries.length + 1,
    operationId: operation.operationId,
    type: "funding",
    walletIndex: operation.index,
    walletAddress: operation.address,
    expectedState: canonicalExpectedState(operation),
    transactionHash: update.transactionHash ?? previous?.transactionHash ?? null,
    status,
    blockNumber: update.blockNumber ?? null,
    receipt: update.receipt ?? null,
    reconciliation: update.reconciliation ?? null,
    error: update.error ?? null,
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
  };
  return validateExact99Journal({
    ...journal,
    revision: journal.revision + 1,
    updatedAt,
    entries: [...journal.entries, entry],
  }, manifest);
}

function checkpointWithRecovery(
  checkpoint: Exact99Checkpoint,
  manifest: Exact99Manifest,
  timestamp: string,
  recovery: Exact99Checkpoint["recovery"],
): Exact99Checkpoint {
  return validateExact99Checkpoint({
    ...checkpoint,
    stage: recovery.manualReview ? "manual-review" : checkpoint.stage,
    recovery,
    updatedAt: timestamp,
  }, manifest);
}

function confirmedCount(journal: Exact99Journal): number {
  return [...latestFundingEntries(journal).values()].filter((entry) => entry.status === "confirmed").length;
}

function completedCount(journal: Exact99Journal): number {
  return [...latestFundingEntries(journal).values()].filter((entry) =>
    entry.status === "confirmed" || entry.status === "skipped-already-funded",
  ).length;
}

export function simulateExact99Funding(input: {
  manifest: Exact99Manifest;
  checkpoint: Exact99Checkpoint;
  journal: Exact99Journal;
  plan: Exact99FundingPlan;
  outcomes: ReadonlyMap<number, Exact99FundingSimulationOutcome>;
  startedAt: string;
}): Exact99FundingSimulationResult {
  const manifest = validateExact99Manifest(input.manifest);
  const plan = validateExact99FundingPlan(input.plan, manifest);
  let checkpoint = validateExact99Checkpoint(input.checkpoint, manifest);
  let journal = validateExact99Journal(input.journal, manifest);
  const initialInspection = inspectExact99Funding({ manifest, checkpoint, journal, plan });
  if (!initialInspection.readyForSimulation) {
    return {
      mode: "simulate",
      simulatedOnly: true,
      stopped: true,
      stopReason: "Local artifact reconciliation blocked simulation.",
      processedOperations: 0,
      confirmedFundingCount: initialInspection.confirmedFundingCount,
      completedFundingCount: initialInspection.completedFundingCount,
      checkpoint,
      journal,
      inspection: initialInspection,
    };
  }

  const nextTimestamp = timestampCursor(input.startedAt);
  let processedOperations = 0;
  let stopped = false;
  let stopReason: string | null = null;
  for (const operation of plan.operations) {
    const latest = latestFundingEntries(journal).get(operation.operationId);
    if (latest?.status === "confirmed" || latest?.status === "skipped-already-funded") continue;
    const outcome = input.outcomes.get(operation.index);
    if (!outcome) break;
    if (!latest) {
      journal = appendEvent(journal, manifest, operation, "planned", nextTimestamp());
    }
    if (outcome.type === "already-funded") {
      const observed = weiString(outcome.observedBalanceWei, "simulation.observedBalanceWei");
      if (BigInt(observed) < BigInt(operation.minimumTargetBalanceWei)) {
        throw new Error("Already-funded simulation balance is below the minimum target.");
      }
      journal = appendEvent(
        journal,
        manifest,
        operation,
        "skipped-already-funded",
        nextTimestamp(),
        { reconciliation: "Fixture balance already meets the manifest-bound minimum target." },
      );
      processedOperations += 1;
      continue;
    }

    journal = appendEvent(journal, manifest, operation, "prepared", nextTimestamp());
    processedOperations += 1;
    if (outcome.type === "success") {
      const hash = transactionHash(outcome.transactionHash, "simulation.transactionHash");
      journal = appendEvent(journal, manifest, operation, "pending", nextTimestamp(), {
        transactionHash: hash,
      });
      journal = appendEvent(journal, manifest, operation, "confirmed", nextTimestamp(), {
        transactionHash: hash,
        blockNumber: integer(outcome.blockNumber, "simulation.blockNumber", 1),
        receipt: {
          status: 1,
          gasUsed: weiString(outcome.gasUsed, "simulation.gasUsed", true),
        },
        reconciliation: "Fixture receipt and minimum target balance reconciled.",
      });
      const funded = confirmedCount(journal);
      const completed = completedCount(journal);
      checkpoint = validateExact99Checkpoint({
        ...checkpoint,
        stage: completed === 99 ? "funded" : checkpoint.stage,
        counters: { ...checkpoint.counters, funded },
        lastConfirmedOperation: {
          type: "funding",
          walletIndex: operation.index,
          transactionHash: hash,
          blockNumber: outcome.blockNumber,
          confirmedAt: nextTimestamp(),
        },
        recovery: { pending: false, ambiguous: false, manualReview: false, reason: null },
        updatedAt: nextTimestamp(),
      }, manifest);
      continue;
    }
    if (outcome.type === "failure") {
      journal = appendEvent(journal, manifest, operation, "failed", nextTimestamp(), {
        error: safeText(outcome.error, "simulation.error"),
      });
      checkpoint = checkpointWithRecovery(checkpoint, manifest, nextTimestamp(), {
        pending: false,
        ambiguous: false,
        manualReview: true,
        reason: "Fixture funding operation failed; explicit review is required.",
      });
      stopped = true;
      stopReason = "Simulation stopped on the first failed operation.";
      break;
    }
    if (outcome.type === "timeout") {
      journal = appendEvent(journal, manifest, operation, "pending", nextTimestamp(), {
        transactionHash: transactionHash(outcome.transactionHash, "simulation.transactionHash"),
        error: "Fixture receipt timeout; do not retry automatically.",
      });
      checkpoint = checkpointWithRecovery(checkpoint, manifest, nextTimestamp(), {
        pending: true,
        ambiguous: false,
        manualReview: false,
        reason: "Fixture transaction remains pending after timeout.",
      });
      stopped = true;
      stopReason = "Simulation stopped on a pending timeout.";
      break;
    }
    if (outcome.type === "ambiguous-receipt") {
      journal = appendEvent(journal, manifest, operation, "ambiguous", nextTimestamp(), {
        transactionHash: transactionHash(outcome.transactionHash, "simulation.transactionHash"),
        error: safeText(outcome.error, "simulation.error"),
      });
      checkpoint = checkpointWithRecovery(checkpoint, manifest, nextTimestamp(), {
        pending: false,
        ambiguous: true,
        manualReview: false,
        reason: "Fixture receipt result is ambiguous.",
      });
      stopped = true;
      stopReason = "Simulation stopped on an ambiguous receipt.";
      break;
    }
    journal = appendEvent(journal, manifest, operation, "manual-review", nextTimestamp(), {
      error: safeText(outcome.error, "simulation.error"),
    });
    checkpoint = checkpointWithRecovery(checkpoint, manifest, nextTimestamp(), {
      pending: false,
      ambiguous: false,
      manualReview: true,
      reason: "Fixture operation requires manual review.",
    });
    stopped = true;
    stopReason = "Simulation stopped for manual review.";
    break;
  }

  const inspection = inspectExact99Funding({ manifest, checkpoint, journal, plan });
  return {
    mode: "simulate",
    simulatedOnly: true,
    stopped,
    stopReason,
    processedOperations,
    confirmedFundingCount: confirmedCount(journal),
    completedFundingCount: completedCount(journal),
    checkpoint,
    journal,
    inspection,
  };
}

function shortAddress(value: string): string {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "unavailable";
}

export function renderExact99FundingPlan(planInput: Exact99FundingPlan, manifest: Exact99Manifest): string {
  const plan = validateExact99FundingPlan(planInput, manifest);
  return [
    "POP33 exact-99 funding plan (local only)",
    `Plan ID: ${plan.planId}`,
    `Recipients: ${plan.walletCount}`,
    `Signer: ${shortAddress(plan.signer.address)}`,
    `Per wallet: ${plan.limits.plannedAmountPerWalletWei} wei`,
    `Per-wallet maximum: ${plan.limits.maximumPerWalletWei} wei`,
    `Total planned: ${plan.totalPlannedWei} wei`,
    `Total maximum: ${plan.limits.maximumTotalBudgetWei} wei`,
    `Signer reserve: ${plan.limits.signerReserveWei} wei`,
    ...plan.operations.map((operation) =>
      `${operation.index}: ${shortAddress(operation.address)} ${operation.plannedAmountWei} wei ${operation.status}`,
    ),
    "No provider, private key, signer, RPC connection, or transaction transport is present.",
  ].join("\n");
}

export function renderExact99FundingInspection(report: Exact99FundingInspection): string {
  return [
    "POP33 exact-99 funding inspection (local read-only)",
    `Plan ID: ${report.planId}`,
    `Recipients: ${report.walletCount}`,
    `Confirmed funding operations: ${report.confirmedFundingCount}`,
    `Completed funding targets: ${report.completedFundingCount}`,
    ...report.checks.map((entry) => `${entry.ok ? "OK" : "BLOCKED"} ${entry.name}: ${entry.detail}`),
    `Ready for fixture simulation: ${report.readyForSimulation ? "YES" : "NO"}`,
    "No secret, RPC credential, private key, mnemonic, or transaction payload was printed.",
  ].join("\n");
}
