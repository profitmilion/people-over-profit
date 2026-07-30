import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

import { demoV1Abi } from "../../../../src/demo-v1/abi.js";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_ENTRY_PRICE,
  DEMO_V1_POOL_CAPACITY,
  DEMO_V1_TOKEN_ADDRESS,
} from "../../../../src/demo-v1/safety.js";
import {
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
} from "./durable-file.js";
import {
  LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
  canonicalizeLifecyclePlanValue,
} from "./lifecycle-action-plan.js";
import {
  LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK,
  LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  redactLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./lifecycle-supervisor-base-sepolia.js";
import {
  type SupervisorReport,
  type SystemSnapshot,
} from "./lifecycle-supervisor.js";
import {
  withReadOnlyRpcRetry,
  type ReadOnlyRpcRetryOptions,
} from "./read-only-rpc-retry.js";
import { sanitizeOperatorError } from "./transaction-journal.js";

export const EXACT_99_READINESS_FORMAT_VERSION = 1 as const;
export const EXACT_99_PUBLIC_MANIFEST_FORMAT_VERSION = 1 as const;
export const EXACT_99_PUBLIC_MANIFEST_PURPOSE =
  "pop33-exact-99-public-addresses" as const;
export const EXACT_99_READINESS_SAFETY =
  "READ_ONLY — NOT AUTHORIZATION TO EXECUTE" as const;
export const EXACT_99_READINESS_DEFAULT_MAX_AGE_SECONDS = 7_200n;
export const EXACT_99_READINESS_DEFAULT_LOG_BLOCK_SPAN = 2_000n;
export const EXACT_99_READINESS_MAX_LOG_BLOCK_SPAN = 50_000n;
export const EXACT_99_READINESS_MAX_JOIN_LOGS = 10_000;
export const EXACT_99_READINESS_MAX_DIRECT_POSITION_READS = 10_000n;
export const EXACT_99_READINESS_TARGETS = [5n, 20n, 50n, 99n, 100n] as const;

export const EXACT_99_READINESS_EXIT_CODES = Object.freeze({
  READY_TO_PREPARE: 0,
  READY_FOR_CHECKPOINT: 0,
  READY_FOR_MANUAL_100_CHECK: 0,
  STALE: 10,
  BLOCKED: 11,
  INCOMPLETE: 12,
  INVALID_PLAN: 13,
  INVALID_INPUT: 15,
});

export type Exact99ReadinessStatus =
  | "READY_TO_PREPARE"
  | "READY_FOR_CHECKPOINT"
  | "READY_FOR_MANUAL_100_CHECK"
  | "STALE"
  | "BLOCKED"
  | "INCOMPLETE"
  | "INVALID_INPUT";

export type Exact99ReadinessRevalidationStatus =
  | "VALID"
  | "STALE"
  | "BLOCKED"
  | "INCOMPLETE"
  | "INVALID_PLAN";

export type Exact99CandidateStatus =
  | "ELIGIBLE"
  | "INELIGIBLE"
  | "ROUTES_TO_DIFFERENT_POOL"
  | "INCOMPLETE"
  | "NOT_CHECKED";

export type Exact99ManifestStatus =
  | "MANIFEST_NOT_PROVIDED"
  | "VALID"
  | "INVALID"
  | "INCOMPLETE";

export type Exact99OwnerMappingStatus = "COMPLETE" | "INCOMPLETE";

export type Exact99CheckpointClassification =
  | "ALREADY_REACHED"
  | "NEXT_CHECKPOINT"
  | "FUTURE_CHECKPOINT"
  | "HARD_STOP_REACHED"
  | "MANUAL_ONLY"
  | "MANUAL_TARGET_REACHED";

export interface Exact99ReadinessCheckpoint {
  target: string;
  reached: boolean;
  remainingFromSnapshot: string;
  positionsInPhase: string;
  expectedEscrow: string;
  classification: Exact99CheckpointClassification;
  stopCriteria: readonly string[];
}

export interface Exact99JoinedLog {
  positionId: bigint;
  poolId: bigint;
  user: string;
  activePositionCount: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface Exact99PositionObservation {
  id: bigint;
  poolId: bigint;
  owner: string;
  active: boolean;
}

export interface Exact99OwnerMappingEntry {
  positionId: string;
  owner: string;
}

export interface Exact99OwnerMapping {
  status: Exact99OwnerMappingStatus;
  method:
    | "POSITION_COUNT_PLUS_GET_POSITION"
    | "POSITION_JOINED_LOGS_PLUS_GET_POSITION";
  deploymentBlock: string;
  snapshotBlock: string;
  logBlockSpan: string;
  joinedLogCount: string;
  uniquePositionCount: string;
  activeOwnerCount: string;
  entries: readonly Exact99OwnerMappingEntry[];
  fingerprint: string;
  warnings: readonly string[];
}

export interface Exact99PublicManifest {
  formatVersion: typeof EXACT_99_PUBLIC_MANIFEST_FORMAT_VERSION;
  purpose: typeof EXACT_99_PUBLIC_MANIFEST_PURPOSE;
  chainId: string;
  contractAddress: string;
  tokenAddress: string;
  poolId: string;
  addressCount: string;
  addresses: readonly string[];
  manual100Address: string;
  fingerprint: string;
}

export interface Exact99ManifestAssessment {
  status: Exact99ManifestStatus;
  fingerprint: string | null;
  addressCount: string | null;
  manual100Address: string | null;
  errors: readonly string[];
}

export interface Exact99CandidateAssessment {
  status: Exact99CandidateStatus;
  address: string | null;
  activePositionIdInSelectedPool: string | null;
  globalActivePositionCount: string | null;
  maxGlobalActivePositionCount: string | null;
  likelyPoolId: string | null;
  appearsInOwnerMapping: boolean | null;
  appearsInManifest: boolean | null;
  reasons: readonly string[];
}

export interface Exact99RoutingAssessment {
  openPoolIds: readonly string[];
  maxOpenPools: string;
  openPoolLimitReached: boolean;
  selectedPoolIsOldestForNewAddress: boolean;
  earlierOpenPoolCanAcceptJoin: boolean;
  assurance:
    | "CANDIDATE_CONFIRMED"
    | "LIKELY_FOR_NEW_ADDRESS"
    | "ROUTES_TO_DIFFERENT_POOL"
    | "BLOCKED"
    | "INCOMPLETE";
  explanation: string;
}

export interface Exact99ReadinessRisk {
  code: string;
  severity: "info" | "warning" | "critical";
  present: boolean;
  detail: string;
}

export interface Exact99ReadinessPlan {
  formatVersion: typeof EXACT_99_READINESS_FORMAT_VERSION;
  planId: string;
  fingerprint: string;
  createdAt: string;
  readOnly: true;
  safety: typeof EXACT_99_READINESS_SAFETY;
  identity: {
    chainId: string;
    contractAddress: string;
    contractInterface: string;
    tokenAddress: string;
  };
  source: {
    type: string;
    reference: string;
    rpcHost: string;
    snapshotBlockNumber: string;
    snapshotBlockTimestamp: string;
  };
  pool: {
    poolId: string;
    status: string;
    activePositionCount: string | null;
    capacity: string | null;
    escrowedAmount: string | null;
    lockedAt: string | null;
    completedDrawRoundCount: string | null;
    snapshotComplete: boolean;
    supervisorRecommendation: {
      action: string;
      reasonCode: string;
      severity: string;
    };
  };
  checkpoints: readonly Exact99ReadinessCheckpoint[];
  resources: {
    automaticPositionsTo99: string;
    manualPositionsTo100: string;
    newUniqueAddressesTo99: string;
    additionalManual100Addresses: string;
    anticipatedApproveCountTo99: string;
    anticipatedJoinCountTo99: string;
    anticipatedApproveCountThrough100: string;
    anticipatedJoinCountThrough100: string;
    requiredTestTokenTo99: string;
    requiredTestTokenThrough100: string;
    estimatedGasOperationsTo99: string;
    estimatedGasOperationsThrough100: string;
    testnetOnly: true;
    note: string;
  };
  ownerMapping: Exact99OwnerMapping;
  manifest: Exact99ManifestAssessment;
  candidate: Exact99CandidateAssessment;
  routing: Exact99RoutingAssessment;
  risks: readonly Exact99ReadinessRisk[];
  decision: {
    status: Exact99ReadinessStatus;
    nextCheckpoint: string | null;
    blockers: readonly string[];
    explanation: string;
    safety: typeof EXACT_99_READINESS_SAFETY;
  };
}

export interface Exact99ReadinessChange {
  field: string;
  expected: string | boolean | null;
  actual: string | boolean | null;
  severity: "warning" | "critical";
  explanation: string;
}

export interface Exact99ReadinessRevalidationResult {
  status: Exact99ReadinessRevalidationStatus;
  reasonCode: string;
  planId: string | null;
  poolId: string | null;
  baseBlockNumber: string | null;
  freshBlockNumber: string | null;
  checkedAt: string | null;
  changes: readonly Exact99ReadinessChange[];
  decision: string;
  safety: typeof EXACT_99_READINESS_SAFETY;
}

export interface Exact99ReadinessPublicClient {
  readPositionCount(blockNumber: bigint): Promise<bigint>;
  readOpenPoolIds(blockNumber: bigint): Promise<readonly bigint[]>;
  readMaxOpenPools(blockNumber: bigint): Promise<bigint>;
  readActivePositionId(
    poolId: bigint,
    user: Address,
    blockNumber: bigint,
  ): Promise<bigint>;
  readActivePositionsByUser(
    user: Address,
    blockNumber: bigint,
  ): Promise<bigint>;
  readMaxActivePositionsPerUser(blockNumber: bigint): Promise<bigint>;
  readOldestQualifyingPool(
    user: Address,
    blockNumber: bigint,
  ): Promise<bigint>;
  readPosition(
    positionId: bigint,
    blockNumber: bigint,
  ): Promise<Exact99PositionObservation>;
  readPositionJoinedLogs(input: {
    poolId: bigint;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly Exact99JoinedLog[]>;
}

export interface Exact99ReadinessLiveOptions {
  snapshot: SystemSnapshot;
  report: SupervisorReport;
  publicClient: Exact99ReadinessPublicClient;
  poolId: bigint;
  sourceReference: string;
  manifestJson?: string;
  candidateAddress?: string;
  deploymentBlock?: bigint;
  logBlockSpan?: bigint;
  retryOptions?: ReadOnlyRpcRetryOptions;
}

export class Exact99ReadinessInputError extends Error {
  override readonly name = "Exact99ReadinessInputError";

  constructor(message: string) {
    super(message);
  }
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeLifecyclePlanValue(value), "utf8")
    .digest("hex");
}

function decimal(value: bigint | undefined | null): string | null {
  return value === undefined || value === null ? null : value.toString();
}

function maxZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedPath(value: string): string {
  const path = resolve(value);
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isInsidePath(candidate: string, parent: string): boolean {
  const child = normalizedPath(candidate);
  const root = normalizedPath(parent);
  return child === root || child.startsWith(`${root}${sep}`);
}

function resolveJsonPath(input: string, workingDirectory: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Exact99ReadinessInputError("JSON path must not be empty.");
  if (extname(trimmed).toLowerCase() !== ".json") {
    throw new Exact99ReadinessInputError("JSON path must end with .json.");
  }
  const target = resolve(workingDirectory, trimmed);
  if (!isAbsolute(trimmed) && !isInsidePath(target, workingDirectory)) {
    throw new Exact99ReadinessInputError(
      "Relative JSON paths must remain inside the current working directory.",
    );
  }
  return target;
}

async function assertRegularNonSymlink(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Exact99ReadinessInputError(
      "Readiness input must be a regular non-symlink file.",
    );
  }
}

function normalizeAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Exact99ReadinessInputError(`${label} must be a valid EVM address.`);
  }
  return getAddress(value);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requirePositive(value: bigint, label: string): bigint {
  if (value <= 0n) {
    throw new Exact99ReadinessInputError(`${label} must be positive.`);
  }
  return value;
}

function requireLogBlockSpan(value: bigint): bigint {
  if (value <= 0n || value > EXACT_99_READINESS_MAX_LOG_BLOCK_SPAN) {
    throw new Exact99ReadinessInputError(
      `Log block span must be between 1 and ${EXACT_99_READINESS_MAX_LOG_BLOCK_SPAN}.`,
    );
  }
  return value;
}

export function buildExact99BoundedLogRanges(input: {
  deploymentBlock: bigint;
  snapshotBlock: bigint;
  blockSpan?: bigint;
}): ReadonlyArray<{ fromBlock: bigint; toBlock: bigint }> {
  const deploymentBlock = requirePositive(
    input.deploymentBlock,
    "Deployment block",
  );
  const snapshotBlock = requirePositive(input.snapshotBlock, "Snapshot block");
  const blockSpan = requireLogBlockSpan(
    input.blockSpan ?? EXACT_99_READINESS_DEFAULT_LOG_BLOCK_SPAN,
  );
  if (snapshotBlock < deploymentBlock) {
    throw new Exact99ReadinessInputError(
      "Snapshot block must not precede the canonical deployment block.",
    );
  }
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (
    let fromBlock = deploymentBlock;
    fromBlock <= snapshotBlock;
    fromBlock += blockSpan
  ) {
    const end = fromBlock + blockSpan - 1n;
    ranges.push({
      fromBlock,
      toBlock: end < snapshotBlock ? end : snapshotBlock,
    });
  }
  return ranges;
}

function ownerMappingFingerprint(input: {
  poolId: bigint;
  status: Exact99OwnerMappingStatus;
  method: Exact99OwnerMapping["method"];
  entries: readonly Exact99OwnerMappingEntry[];
}): string {
  return `sha256:${hashCanonical({
    poolId: input.poolId.toString(),
    status: input.status,
    method: input.method,
    entries: [...input.entries].sort((left, right) =>
      BigInt(left.positionId) < BigInt(right.positionId) ? -1 : 1),
  })}`;
}

export function buildExact99OwnerMapping(input: {
  poolId: bigint;
  deploymentBlock: bigint;
  snapshotBlock: bigint;
  logBlockSpan: bigint;
  joinedLogs: readonly Exact99JoinedLog[];
  positions: readonly Exact99PositionObservation[];
  expectedActivePositionCount: bigint;
  complete?: boolean;
  warnings?: readonly string[];
}): Exact99OwnerMapping {
  const warnings = [...(input.warnings ?? [])];
  const logByIdentity = new Map<string, Exact99JoinedLog>();
  const positionIds = new Set<string>();
  for (const log of input.joinedLogs) {
    if (
      log.poolId !== input.poolId ||
      log.blockNumber < input.deploymentBlock ||
      log.blockNumber > input.snapshotBlock ||
      !isAddress(log.user) ||
      log.logIndex < 0
    ) {
      warnings.push("A PositionJoined log is outside the canonical bounded scan.");
      continue;
    }
    const identity = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    const prior = logByIdentity.get(identity);
    if (prior) {
      if (canonicalizeLifecyclePlanValue(prior) !== canonicalizeLifecyclePlanValue(log)) {
        warnings.push("Conflicting duplicate PositionJoined log detected.");
      }
      continue;
    }
    if (positionIds.has(log.positionId.toString())) {
      warnings.push("A position ID appears in more than one PositionJoined log.");
      continue;
    }
    logByIdentity.set(identity, log);
    positionIds.add(log.positionId.toString());
  }

  const entries: Exact99OwnerMappingEntry[] = [];
  const owners = new Set<string>();
  const seenPositions = new Set<string>();
  for (const position of input.positions) {
    const id = position.id.toString();
    if (seenPositions.has(id)) {
      warnings.push(`Position ${id} was returned more than once.`);
      continue;
    }
    seenPositions.add(id);
    if (!positionIds.has(id) || position.poolId !== input.poolId) {
      warnings.push(`Position ${id} does not match the bounded join-log set.`);
      continue;
    }
    if (!isAddress(position.owner)) {
      warnings.push(`Position ${id} has an invalid public owner address.`);
      continue;
    }
    if (!position.active) continue;
    const owner = getAddress(position.owner);
    const ownerKey = owner.toLowerCase();
    if (owners.has(ownerKey)) {
      warnings.push("Two active positions in the selected pool share one owner.");
      continue;
    }
    owners.add(ownerKey);
    entries.push({ positionId: id, owner });
  }
  entries.sort((left, right) =>
    BigInt(left.positionId) < BigInt(right.positionId) ? -1 : 1);

  if (BigInt(entries.length) !== input.expectedActivePositionCount) {
    warnings.push(
      `Owner mapping contains ${entries.length} active positions but getPool reports ${input.expectedActivePositionCount}.`,
    );
  }
  if (BigInt(positionIds.size) < input.expectedActivePositionCount) {
    warnings.push(
      "Bounded PositionJoined logs contain fewer positions than the current pool count.",
    );
  }
  const status: Exact99OwnerMappingStatus =
    input.complete !== false && warnings.length === 0
      ? "COMPLETE"
      : "INCOMPLETE";
  return {
    status,
    method: "POSITION_JOINED_LOGS_PLUS_GET_POSITION",
    deploymentBlock: input.deploymentBlock.toString(),
    snapshotBlock: input.snapshotBlock.toString(),
    logBlockSpan: input.logBlockSpan.toString(),
    joinedLogCount: logByIdentity.size.toString(),
    uniquePositionCount: positionIds.size.toString(),
    activeOwnerCount: entries.length.toString(),
    entries,
    fingerprint: ownerMappingFingerprint({
      poolId: input.poolId,
      status,
      method: "POSITION_JOINED_LOGS_PLUS_GET_POSITION",
      entries,
    }),
    warnings,
  };
}

export function buildExact99DirectOwnerMapping(input: {
  poolId: bigint;
  deploymentBlock: bigint;
  snapshotBlock: bigint;
  positions: readonly Exact99PositionObservation[];
  expectedActivePositionCount: bigint;
  complete?: boolean;
  warnings?: readonly string[];
}): Exact99OwnerMapping {
  const warnings = [...(input.warnings ?? [])];
  const entries: Exact99OwnerMappingEntry[] = [];
  const owners = new Set<string>();
  const positions = new Set<string>();
  for (const position of input.positions) {
    const id = position.id.toString();
    if (positions.has(id)) {
      warnings.push(`Position ${id} was returned more than once.`);
      continue;
    }
    positions.add(id);
    if (position.poolId !== input.poolId || !position.active) continue;
    if (!isAddress(position.owner)) {
      warnings.push(`Position ${id} has an invalid public owner address.`);
      continue;
    }
    const owner = getAddress(position.owner);
    if (owners.has(owner.toLowerCase())) {
      warnings.push("Two active positions in the selected pool share one owner.");
      continue;
    }
    owners.add(owner.toLowerCase());
    entries.push({ positionId: id, owner });
  }
  entries.sort((left, right) =>
    BigInt(left.positionId) < BigInt(right.positionId) ? -1 : 1);
  if (BigInt(entries.length) !== input.expectedActivePositionCount) {
    warnings.push(
      `Direct owner mapping contains ${entries.length} active positions but getPool reports ${input.expectedActivePositionCount}.`,
    );
  }
  const status: Exact99OwnerMappingStatus =
    input.complete !== false && warnings.length === 0
      ? "COMPLETE"
      : "INCOMPLETE";
  return {
    status,
    method: "POSITION_COUNT_PLUS_GET_POSITION",
    deploymentBlock: input.deploymentBlock.toString(),
    snapshotBlock: input.snapshotBlock.toString(),
    logBlockSpan: "0",
    joinedLogCount: "0",
    uniquePositionCount: positions.size.toString(),
    activeOwnerCount: entries.length.toString(),
    entries,
    fingerprint: ownerMappingFingerprint({
      poolId: input.poolId,
      status,
      method: "POSITION_COUNT_PLUS_GET_POSITION",
      entries,
    }),
    warnings,
  };
}

function manifestPayload(
  manifest: Exact99PublicManifest,
): Omit<Exact99PublicManifest, "fingerprint"> {
  return Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "fingerprint"),
  ) as Omit<Exact99PublicManifest, "fingerprint">;
}

export function computeExact99PublicManifestFingerprint(
  manifest: Exact99PublicManifest,
): string {
  return `sha256:${hashCanonical(manifestPayload(manifest))}`;
}

export function buildExact99PublicManifest(input: {
  chainId?: bigint;
  contractAddress?: string;
  tokenAddress?: string;
  poolId: bigint;
  addresses: readonly string[];
  manual100Address: string;
}): Exact99PublicManifest {
  const addresses = input.addresses.map((address, index) =>
    normalizeAddress(address, `addresses[${index}]`));
  const manual100Address = normalizeAddress(
    input.manual100Address,
    "manual100Address",
  );
  const draft: Exact99PublicManifest = {
    formatVersion: EXACT_99_PUBLIC_MANIFEST_FORMAT_VERSION,
    purpose: EXACT_99_PUBLIC_MANIFEST_PURPOSE,
    chainId: (input.chainId ?? BigInt(DEMO_V1_CHAIN_ID)).toString(),
    contractAddress: normalizeAddress(
      input.contractAddress ?? DEMO_V1_CONTRACT_ADDRESS,
      "contractAddress",
    ),
    tokenAddress: normalizeAddress(
      input.tokenAddress ?? DEMO_V1_TOKEN_ADDRESS,
      "tokenAddress",
    ),
    poolId: requirePositive(input.poolId, "Pool ID").toString(),
    addressCount: addresses.length.toString(),
    addresses,
    manual100Address,
    fingerprint: "",
  };
  return {
    ...draft,
    fingerprint: computeExact99PublicManifestFingerprint(draft),
  };
}

const MANIFEST_KEYS = new Set([
  "formatVersion",
  "purpose",
  "chainId",
  "contractAddress",
  "tokenAddress",
  "poolId",
  "addressCount",
  "addresses",
  "manual100Address",
  "fingerprint",
]);
const FORBIDDEN_MANIFEST_KEY =
  /private.?key|mnemonic|seed|password|passphrase|secret|keystore|wallet.?store|ciphertext|signer|credential/i;
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i;
const THIRTY_TWO_BYTE_VALUE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const PLAN_ID = /^exact99-readiness:[0-9a-f]{64}$/;

function scanManifestSafety(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanManifestSafety(entry, `${path}[${index}]`, errors));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_MANIFEST_KEY.test(key)) {
        errors.push(`${path}.${key} is a forbidden secret-bearing field.`);
      }
      scanManifestSafety(nested, `${path}.${key}`, errors);
    }
    return;
  }
  if (
    typeof value === "string" &&
    (CREDENTIAL_URL.test(value) || THIRTY_TWO_BYTE_VALUE.test(value))
  ) {
    errors.push(`${path} contains a credential-shaped value.`);
  }
}

export function parseExact99PublicManifestJson(
  json: string,
  input: {
    chainId: bigint;
    contractAddress: string;
    tokenAddress: string;
    poolId: bigint;
    remainingTo99: bigint;
    ownerMapping: Exact99OwnerMapping;
  },
): {
  manifest: Exact99PublicManifest | null;
  assessment: Exact99ManifestAssessment;
} {
  const errors: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return {
      manifest: null,
      assessment: {
        status: "INVALID",
        fingerprint: null,
        addressCount: null,
        manual100Address: null,
        errors: ["Public manifest is not valid JSON."],
      },
    };
  }
  scanManifestSafety(value, "manifest", errors);
  const root = record(value);
  if (!root) {
    errors.push("Public manifest root must be an object.");
  } else {
    for (const key of Object.keys(root)) {
      if (!MANIFEST_KEYS.has(key)) errors.push(`manifest.${key} is not supported.`);
    }
    for (const key of MANIFEST_KEYS) {
      if (!(key in root)) errors.push(`manifest.${key} is required.`);
    }
  }
  const addressesValue = root?.addresses;
  if (!Array.isArray(addressesValue)) {
    errors.push("manifest.addresses must be an array.");
  }
  const addresses: string[] = [];
  for (const [index, entry] of (Array.isArray(addressesValue)
    ? addressesValue
    : []).entries()) {
    if (typeof entry !== "string" || !isAddress(entry)) {
      errors.push(`manifest.addresses[${index}] must be a valid EVM address.`);
    } else {
      addresses.push(getAddress(entry));
    }
  }
  const manualValue = root?.manual100Address;
  const manual100Address =
    typeof manualValue === "string" && isAddress(manualValue)
      ? getAddress(manualValue)
      : "";
  if (!manual100Address) {
    errors.push("manifest.manual100Address must be a valid public address.");
  }

  const candidate: Exact99PublicManifest = {
    formatVersion: EXACT_99_PUBLIC_MANIFEST_FORMAT_VERSION,
    purpose: EXACT_99_PUBLIC_MANIFEST_PURPOSE,
    chainId: typeof root?.chainId === "string" ? root.chainId : "",
    contractAddress:
      typeof root?.contractAddress === "string" && isAddress(root.contractAddress)
        ? getAddress(root.contractAddress)
        : "",
    tokenAddress:
      typeof root?.tokenAddress === "string" && isAddress(root.tokenAddress)
        ? getAddress(root.tokenAddress)
        : "",
    poolId: typeof root?.poolId === "string" ? root.poolId : "",
    addressCount: typeof root?.addressCount === "string"
      ? root.addressCount
      : "",
    addresses,
    manual100Address,
    fingerprint: typeof root?.fingerprint === "string" ? root.fingerprint : "",
  };
  if (root?.formatVersion !== EXACT_99_PUBLIC_MANIFEST_FORMAT_VERSION) {
    errors.push(
      `manifest.formatVersion must be ${EXACT_99_PUBLIC_MANIFEST_FORMAT_VERSION}.`,
    );
  }
  if (root?.purpose !== EXACT_99_PUBLIC_MANIFEST_PURPOSE) {
    errors.push(`manifest.purpose must be ${EXACT_99_PUBLIC_MANIFEST_PURPOSE}.`);
  }
  for (const [field, valueToCheck] of [
    ["chainId", candidate.chainId],
    ["poolId", candidate.poolId],
    ["addressCount", candidate.addressCount],
  ] as const) {
    if (!DECIMAL.test(valueToCheck)) {
      errors.push(`manifest.${field} must be an unsigned decimal string.`);
    }
  }
  if (!isAddress(candidate.contractAddress)) {
    errors.push("manifest.contractAddress must be a valid EVM address.");
  }
  if (!isAddress(candidate.tokenAddress)) {
    errors.push("manifest.tokenAddress must be a valid EVM address.");
  }
  if (candidate.chainId !== input.chainId.toString()) {
    errors.push("manifest.chainId does not match the readiness snapshot.");
  }
  if (
    !isAddress(candidate.contractAddress) ||
    !sameAddress(candidate.contractAddress, input.contractAddress)
  ) {
    errors.push("manifest.contractAddress does not match the readiness snapshot.");
  }
  if (
    !isAddress(candidate.tokenAddress) ||
    !sameAddress(candidate.tokenAddress, input.tokenAddress)
  ) {
    errors.push("manifest.tokenAddress does not match the canonical token.");
  }
  if (candidate.poolId !== input.poolId.toString()) {
    errors.push("manifest.poolId does not match the selected pool.");
  }
  if (candidate.addressCount !== addresses.length.toString()) {
    errors.push("manifest.addressCount does not match manifest.addresses.");
  }
  if (BigInt(addresses.length) !== input.remainingTo99) {
    errors.push(
      `manifest.addresses must contain exactly ${input.remainingTo99} addresses for the current snapshot.`,
    );
  }
  const normalized = addresses.map((address) => address.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    errors.push("manifest.addresses contains duplicate addresses.");
  }
  if (
    manual100Address &&
    normalized.includes(manual100Address.toLowerCase())
  ) {
    errors.push(
      "manifest.manual100Address must not appear in the automatic address list.",
    );
  }
  const owners = new Set(
    input.ownerMapping.entries.map((entry) => entry.owner.toLowerCase()),
  );
  if (normalized.some((address) => owners.has(address))) {
    errors.push("manifest.addresses overlaps an existing active pool owner.");
  }
  if (!SHA256.test(candidate.fingerprint)) {
    errors.push("manifest.fingerprint must be a lowercase SHA-256 value.");
  } else if (
    computeExact99PublicManifestFingerprint(candidate) !== candidate.fingerprint
  ) {
    errors.push("manifest.fingerprint does not match canonical manifest data.");
  }

  const status: Exact99ManifestStatus = errors.length > 0
    ? "INVALID"
    : input.ownerMapping.status === "INCOMPLETE"
      ? "INCOMPLETE"
      : "VALID";
  const assessment: Exact99ManifestAssessment = {
    status,
    fingerprint: SHA256.test(candidate.fingerprint)
      ? candidate.fingerprint
      : null,
    addressCount: candidate.addressCount || null,
    manual100Address: manual100Address || null,
    errors: status === "INCOMPLETE"
      ? ["Owner mapping is incomplete; manifest overlap cannot be proven."]
      : errors,
  };
  return {
    manifest: status === "INVALID" ? null : candidate,
    assessment,
  };
}

export function manifestNotProvided(): Exact99ManifestAssessment {
  return {
    status: "MANIFEST_NOT_PROVIDED",
    fingerprint: null,
    addressCount: null,
    manual100Address: null,
    errors: [],
  };
}

export function calculateExact99DynamicCheckpoints(
  activePositionCount: bigint,
  entryPrice = DEMO_V1_ENTRY_PRICE,
): readonly Exact99ReadinessCheckpoint[] {
  if (activePositionCount < 0n) {
    throw new Exact99ReadinessInputError(
      "Active position count must not be negative.",
    );
  }
  let previousTarget = 0n;
  return EXACT_99_READINESS_TARGETS.map((target) => {
    const reached = activePositionCount >= target;
    const remainingFromSnapshot = maxZero(target - activePositionCount);
    const phaseStart = activePositionCount > previousTarget
      ? activePositionCount
      : previousTarget;
    const positionsInPhase = maxZero(target - phaseStart);
    let classification: Exact99CheckpointClassification;
    if (target === 100n) {
      classification = reached ? "MANUAL_TARGET_REACHED" : "MANUAL_ONLY";
    } else if (target === 99n && activePositionCount === 99n) {
      classification = "HARD_STOP_REACHED";
    } else if (reached) {
      classification = "ALREADY_REACHED";
    } else if (activePositionCount >= previousTarget) {
      classification = "NEXT_CHECKPOINT";
    } else {
      classification = "FUTURE_CHECKPOINT";
    }
    const checkpoint: Exact99ReadinessCheckpoint = {
      target: target.toString(),
      reached,
      remainingFromSnapshot: remainingFromSnapshot.toString(),
      positionsInPhase: positionsInPhase.toString(),
      expectedEscrow: (target * entryPrice).toString(),
      classification,
      stopCriteria: target === 100n
        ? [
            "Manual procedure only; readiness never authorizes or executes Join.",
            "Stop if pool is not exactly 99/100 and Open immediately before the separate check.",
          ]
        : [
            "Stop on any count, status, escrow, owner, routing, manifest, or supervisor change.",
            "Create a fresh read-only snapshot before any separately authorized operation.",
          ],
    };
    previousTarget = target;
    return checkpoint;
  });
}

function nextCheckpoint(
  checkpoints: readonly Exact99ReadinessCheckpoint[],
): string | null {
  return checkpoints.find((checkpoint) =>
    checkpoint.classification === "NEXT_CHECKPOINT")?.target ?? null;
}

function resourcesFor(
  activePositionCount: bigint,
  entryPrice: bigint,
): Exact99ReadinessPlan["resources"] {
  const automatic = maxZero(99n - activePositionCount);
  const manual = activePositionCount < 100n ? 1n : 0n;
  return {
    automaticPositionsTo99: automatic.toString(),
    manualPositionsTo100: manual.toString(),
    newUniqueAddressesTo99: automatic.toString(),
    additionalManual100Addresses: manual.toString(),
    anticipatedApproveCountTo99: automatic.toString(),
    anticipatedJoinCountTo99: automatic.toString(),
    anticipatedApproveCountThrough100: (automatic + manual).toString(),
    anticipatedJoinCountThrough100: (automatic + manual).toString(),
    requiredTestTokenTo99: (automatic * entryPrice).toString(),
    requiredTestTokenThrough100: ((automatic + manual) * entryPrice).toString(),
    estimatedGasOperationsTo99: (automatic * 2n).toString(),
    estimatedGasOperationsThrough100: ((automatic + manual) * 2n).toString(),
    testnetOnly: true,
    note:
      "Technical Base Sepolia estimates for approve and Join only; test dUSDC is not real-money cost and no transaction is authorized.",
  };
}

function buildRoutingAssessment(input: {
  snapshot: SystemSnapshot;
  poolId: bigint;
  openPoolIds: readonly bigint[] | null;
  maxOpenPools: bigint | null;
  candidate: Exact99CandidateAssessment;
}): Exact99RoutingAssessment {
  if (!input.openPoolIds || input.maxOpenPools === null) {
    return {
      openPoolIds: [],
      maxOpenPools: "unknown",
      openPoolLimitReached: false,
      selectedPoolIsOldestForNewAddress: false,
      earlierOpenPoolCanAcceptJoin: false,
      assurance: "INCOMPLETE",
      explanation:
        "Open-pool routing data is incomplete; Join routing cannot be assessed.",
    };
  }
  const selectedIndex = input.openPoolIds.findIndex((id) => id === input.poolId);
  const selectedPoolIsOldestForNewAddress = selectedIndex === 0;
  const earlierOpenPoolCanAcceptJoin = selectedIndex > 0 &&
    input.openPoolIds.slice(0, selectedIndex).some((id) => {
      const pool = input.snapshot.pools.find((entry) => entry.poolId === id);
      return pool?.status === "Open" &&
        pool.activePositionCount !== undefined &&
        pool.maxPositionCount !== undefined &&
        pool.activePositionCount < pool.maxPositionCount;
    });
  let assurance: Exact99RoutingAssessment["assurance"];
  let explanation: string;
  if (input.candidate.status === "ELIGIBLE") {
    assurance = "CANDIDATE_CONFIRMED";
    explanation =
      "Pinned direct reads indicate that this public candidate currently routes to the selected pool; a future transaction can still race.";
  } else if (input.candidate.status === "ROUTES_TO_DIFFERENT_POOL") {
    assurance = "ROUTES_TO_DIFFERENT_POOL";
    explanation = "The candidate currently routes to another pool.";
  } else if (input.candidate.status === "INCOMPLETE") {
    assurance = "INCOMPLETE";
    explanation = "Candidate routing reads are incomplete.";
  } else if (
    input.candidate.status === "INELIGIBLE" ||
    selectedIndex < 0 ||
    earlierOpenPoolCanAcceptJoin
  ) {
    assurance = "BLOCKED";
    explanation = selectedIndex < 0
      ? "The selected pool is absent from the ordered open-pool index."
      : input.candidate.status === "INELIGIBLE"
        ? "The candidate is not currently eligible for Join."
        : "An earlier open pool can accept a generic new address.";
  } else if (selectedPoolIsOldestForNewAddress) {
    assurance = "LIKELY_FOR_NEW_ADDRESS";
    explanation =
      "The selected pool is first in the pinned open-pool order for a genuinely new address; this is not a guarantee against a later race.";
  } else {
    assurance = "BLOCKED";
    explanation =
      "The selected pool is not the oldest qualifying pool for a generic new address.";
  }
  return {
    openPoolIds: input.openPoolIds.map(String),
    maxOpenPools: input.maxOpenPools.toString(),
    openPoolLimitReached:
      BigInt(input.openPoolIds.length) >= input.maxOpenPools,
    selectedPoolIsOldestForNewAddress,
    earlierOpenPoolCanAcceptJoin,
    assurance,
    explanation,
  };
}

function risksFor(input: {
  snapshot: SystemSnapshot;
  ownerMapping: Exact99OwnerMapping;
  manifest: Exact99ManifestAssessment;
  candidate: Exact99CandidateAssessment;
  routing: Exact99RoutingAssessment;
}): readonly Exact99ReadinessRisk[] {
  return [
    {
      code: "EXTERNAL_JOIN_RACE",
      severity: "warning",
      present: true,
      detail: "An external Join can change the selected pool after this snapshot.",
    },
    {
      code: "COUNT_CHANGE_INVALIDATES_PLAN",
      severity: "warning",
      present: true,
      detail: "Any active-position count change requires a new dynamic plan.",
    },
    {
      code: "JOIN_ROUTING_RACE",
      severity: input.routing.assurance === "CANDIDATE_CONFIRMED"
        ? "warning"
        : "critical",
      present: true,
      detail:
        "join() chooses a pool at execution time and cannot bind an expected pool or count.",
    },
    {
      code: "OWNER_MAPPING_INCOMPLETE",
      severity: "critical",
      present: input.ownerMapping.status === "INCOMPLETE",
      detail: "Existing active owners could not be proven from bounded public data.",
    },
    {
      code: "MANIFEST_INCOMPLETE",
      severity: input.manifest.status === "INVALID" ? "critical" : "warning",
      present: input.manifest.status !== "VALID",
      detail: input.manifest.status === "MANIFEST_NOT_PROVIDED"
        ? "No public address manifest was supplied."
        : "The public manifest is invalid or cannot yet be fully checked.",
    },
    {
      code: "CANDIDATE_NOT_QUALIFIED",
      severity: input.candidate.status === "NOT_CHECKED" ? "info" : "critical",
      present: input.candidate.status !== "ELIGIBLE",
      detail: input.candidate.status === "NOT_CHECKED"
        ? "No optional public candidate address was checked."
        : "The candidate is ineligible, routes elsewhere, or has incomplete reads.",
    },
    {
      code: "SOURCE_MISMATCH",
      severity: "critical",
      present:
        input.snapshot.chainId !== BigInt(DEMO_V1_CHAIN_ID) ||
        !sameAddress(input.snapshot.contractAddress, DEMO_V1_CONTRACT_ADDRESS),
      detail: "Chain, contract, token, and interface identities must remain canonical.",
    },
    {
      code: "SNAPSHOT_STALE_OR_INCOMPLETE",
      severity: "critical",
      present: input.snapshot.metadata?.snapshotComplete === false,
      detail: "Readiness fails closed on incomplete or stale snapshots.",
    },
  ];
}

function planPayload(
  plan: Exact99ReadinessPlan,
): Omit<Exact99ReadinessPlan, "planId" | "fingerprint"> {
  return Object.fromEntries(
    Object.entries(plan).filter(([key]) =>
      key !== "planId" && key !== "fingerprint"),
  ) as Omit<Exact99ReadinessPlan, "planId" | "fingerprint">;
}

export function computeExact99ReadinessFingerprint(
  plan: Exact99ReadinessPlan,
): string {
  return `sha256:${hashCanonical(planPayload(plan))}`;
}

export function createExact99ReadinessPlan(input: {
  snapshot: SystemSnapshot;
  report: SupervisorReport;
  poolId: bigint;
  sourceReference: string;
  ownerMapping: Exact99OwnerMapping;
  manifest?: Exact99ManifestAssessment;
  candidate?: Exact99CandidateAssessment;
  openPoolIds: readonly bigint[] | null;
  maxOpenPools: bigint | null;
}): Exact99ReadinessPlan {
  if (input.snapshot.blockNumber === null) {
    throw new Exact99ReadinessInputError(
      "Readiness requires a concrete pinned snapshot block.",
    );
  }
  requirePositive(input.poolId, "Pool ID");
  const pool = input.snapshot.pools.find((entry) => entry.poolId === input.poolId);
  const supervisor = input.report.plans.find((entry) =>
    entry.poolId === input.poolId);
  if (!pool || !supervisor) {
    throw new Exact99ReadinessInputError(
      `Pool ${input.poolId} is absent from the complete snapshot or supervisor report.`,
    );
  }
  const count = pool.activePositionCount;
  const capacity = pool.maxPositionCount;
  const entryPrice = pool.entryPrice;
  const manifest = input.manifest ?? manifestNotProvided();
  const candidate = input.candidate ?? candidateNotChecked();
  const checkpoints = calculateExact99DynamicCheckpoints(
    count ?? 0n,
    entryPrice ?? DEMO_V1_ENTRY_PRICE,
  );
  const routing = buildRoutingAssessment({
    snapshot: input.snapshot,
    poolId: input.poolId,
    openPoolIds: input.openPoolIds,
    maxOpenPools: input.maxOpenPools,
    candidate,
  });
  const blockers: string[] = [];
  let incomplete = false;
  let invalidInput = false;
  const snapshotComplete =
    (input.snapshot.metadata?.snapshotComplete ?? true) &&
    input.report.systemDiagnostics.length === 0;
  if (!snapshotComplete) incomplete = true;
  if (
    count === undefined ||
    capacity === undefined ||
    entryPrice === undefined ||
    pool.escrowedAmount === undefined ||
    pool.lockedAt === undefined ||
    pool.completedDrawRoundCount === undefined
  ) {
    incomplete = true;
    blockers.push("Selected pool snapshot is missing required fields.");
  }
  if (input.ownerMapping.status === "INCOMPLETE") {
    incomplete = true;
    blockers.push("Owner mapping is incomplete.");
  }
  if (routing.assurance === "INCOMPLETE") {
    incomplete = true;
    blockers.push("Open-pool routing data is incomplete.");
  }
  if (candidate.status === "INCOMPLETE") {
    incomplete = true;
    blockers.push("Candidate reads are incomplete.");
  }
  if (manifest.status === "INCOMPLETE") {
    incomplete = true;
    blockers.push("Manifest overlap cannot be fully validated.");
  }
  if (manifest.status === "INVALID") {
    invalidInput = true;
    blockers.push(...manifest.errors);
  }
  if (pool.status !== "Open") blockers.push("Selected pool is not Open.");
  if (count !== undefined && capacity !== undefined && count > capacity) {
    blockers.push("Selected pool count exceeds capacity.");
  }
  if (
    count !== undefined &&
    entryPrice !== undefined &&
    pool.escrowedAmount !== undefined &&
    pool.escrowedAmount !== count * entryPrice
  ) {
    blockers.push("Selected pool escrow does not equal count multiplied by entry price.");
  }
  if (
    capacity !== undefined &&
    capacity !== DEMO_V1_POOL_CAPACITY
  ) {
    blockers.push("Selected pool capacity does not match canonical Demo V1.");
  }
  if (entryPrice !== undefined && entryPrice !== DEMO_V1_ENTRY_PRICE) {
    blockers.push("Selected pool entry price does not match canonical Demo V1.");
  }
  if (
    supervisor.severity === "critical" ||
    supervisor.diagnostics.length > 0 ||
    supervisor.nextAction !== "WAITING_FOR_PARTICIPANTS"
  ) {
    blockers.push("Lifecycle supervisor does not report a safe Open-pool wait state.");
  }
  if (
    routing.assurance === "BLOCKED" ||
    routing.assurance === "ROUTES_TO_DIFFERENT_POOL"
  ) {
    blockers.push(routing.explanation);
  }
  if (
    candidate.status === "INELIGIBLE" ||
    candidate.status === "ROUTES_TO_DIFFERENT_POOL"
  ) {
    blockers.push(...candidate.reasons);
  }
  if (
    input.snapshot.chainId !== BigInt(DEMO_V1_CHAIN_ID) ||
    !sameAddress(input.snapshot.contractAddress, DEMO_V1_CONTRACT_ADDRESS)
  ) {
    blockers.push("Snapshot identity is not canonical Base Sepolia Demo V1.");
  }

  let status: Exact99ReadinessStatus;
  if (invalidInput) {
    status = "INVALID_INPUT";
  } else if (incomplete) {
    status = "INCOMPLETE";
  } else if (blockers.length > 0) {
    status = "BLOCKED";
  } else if (count === 99n) {
    status = "READY_FOR_MANUAL_100_CHECK";
  } else if (manifest.status === "VALID") {
    status = "READY_FOR_CHECKPOINT";
  } else {
    status = "READY_TO_PREPARE";
  }
  const decisionExplanations: Record<Exact99ReadinessStatus, string> = {
    READY_TO_PREPARE:
      "The pinned public state is safe for preparing a public manifest and testnet resource plan only.",
    READY_FOR_CHECKPOINT:
      "Snapshot, owner mapping, routing assessment, and public manifest match the next checkpoint.",
    READY_FOR_MANUAL_100_CHECK:
      "The pool is exactly 99/100 and Open; begin only a separate manual-100 readiness check.",
    STALE: "The readiness plan no longer matches current public state.",
    BLOCKED: "A safety condition blocks preparation.",
    INCOMPLETE: "Public data is incomplete; readiness fails closed.",
    INVALID_INPUT: "A pool, address, manifest, or plan input is invalid.",
  };
  const draft: Exact99ReadinessPlan = {
    formatVersion: EXACT_99_READINESS_FORMAT_VERSION,
    planId: "",
    fingerprint: "",
    createdAt: input.snapshot.observedAt.toString(),
    readOnly: true,
    safety: EXACT_99_READINESS_SAFETY,
    identity: {
      chainId: input.snapshot.chainId.toString(),
      contractAddress: isAddress(input.snapshot.contractAddress)
        ? getAddress(input.snapshot.contractAddress)
        : input.snapshot.contractAddress,
      contractInterface: LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
      tokenAddress: DEMO_V1_TOKEN_ADDRESS,
    },
    source: {
      type: input.snapshot.source,
      reference: input.sourceReference,
      rpcHost: input.snapshot.metadata?.rpcHost ?? "not-applicable",
      snapshotBlockNumber: input.snapshot.blockNumber.toString(),
      snapshotBlockTimestamp: input.snapshot.observedAt.toString(),
    },
    pool: {
      poolId: input.poolId.toString(),
      status: pool.status,
      activePositionCount: decimal(count),
      capacity: decimal(capacity),
      escrowedAmount: decimal(pool.escrowedAmount),
      lockedAt: decimal(pool.lockedAt),
      completedDrawRoundCount: decimal(pool.completedDrawRoundCount),
      snapshotComplete,
      supervisorRecommendation: {
        action: supervisor.nextAction,
        reasonCode: supervisor.reasonCode,
        severity: supervisor.severity,
      },
    },
    checkpoints,
    resources: resourcesFor(
      count ?? 0n,
      entryPrice ?? DEMO_V1_ENTRY_PRICE,
    ),
    ownerMapping: input.ownerMapping,
    manifest,
    candidate,
    routing,
    risks: risksFor({
      snapshot: input.snapshot,
      ownerMapping: input.ownerMapping,
      manifest,
      candidate,
      routing,
    }),
    decision: {
      status,
      nextCheckpoint: nextCheckpoint(checkpoints),
      blockers: [...new Set(blockers)],
      explanation: decisionExplanations[status],
      safety: EXACT_99_READINESS_SAFETY,
    },
  };
  const digest = hashCanonical(planPayload(draft));
  return {
    ...draft,
    planId: `exact99-readiness:${digest}`,
    fingerprint: `sha256:${digest}`,
  };
}

function candidateNotChecked(): Exact99CandidateAssessment {
  return {
    status: "NOT_CHECKED",
    address: null,
    activePositionIdInSelectedPool: null,
    globalActivePositionCount: null,
    maxGlobalActivePositionCount: null,
    likelyPoolId: null,
    appearsInOwnerMapping: null,
    appearsInManifest: null,
    reasons: [],
  };
}

export function assessExact99Candidate(input: {
  address?: string;
  poolId: bigint;
  activePositionId?: bigint;
  globalActivePositionCount?: bigint;
  maxGlobalActivePositionCount?: bigint;
  likelyPoolId?: bigint;
  ownerMapping: Exact99OwnerMapping;
  manifest?: Exact99PublicManifest | null;
  complete?: boolean;
  error?: string;
}): Exact99CandidateAssessment {
  if (input.address === undefined) return candidateNotChecked();
  const address = normalizeAddress(input.address, "Candidate address");
  const appearsInOwnerMapping = input.ownerMapping.entries.some((entry) =>
    sameAddress(entry.owner, address));
  const appearsInManifest = input.manifest
    ? input.manifest.addresses.some((entry) => sameAddress(entry, address)) ||
      sameAddress(input.manifest.manual100Address, address)
    : false;
  if (
    input.complete === false ||
    input.activePositionId === undefined ||
    input.globalActivePositionCount === undefined ||
    input.maxGlobalActivePositionCount === undefined ||
    input.likelyPoolId === undefined
  ) {
    return {
      status: "INCOMPLETE",
      address,
      activePositionIdInSelectedPool: decimal(input.activePositionId),
      globalActivePositionCount: decimal(input.globalActivePositionCount),
      maxGlobalActivePositionCount: decimal(input.maxGlobalActivePositionCount),
      likelyPoolId: decimal(input.likelyPoolId),
      appearsInOwnerMapping,
      appearsInManifest,
      reasons: [input.error ?? "Candidate public reads are incomplete."],
    };
  }
  const reasons: string[] = [];
  if (input.activePositionId !== 0n || appearsInOwnerMapping) {
    reasons.push("Candidate already has an active position in the selected pool.");
  }
  if (input.globalActivePositionCount >= input.maxGlobalActivePositionCount) {
    reasons.push("Candidate reached the global active-position limit.");
  }
  let status: Exact99CandidateStatus;
  if (reasons.length > 0 || input.likelyPoolId === 0n) {
    if (input.likelyPoolId === 0n) {
      reasons.push(
        "Contract reports no currently qualifying existing pool for this address.",
      );
    }
    status = "INELIGIBLE";
  } else if (input.likelyPoolId !== input.poolId) {
    status = "ROUTES_TO_DIFFERENT_POOL";
    reasons.push(`Candidate currently routes to pool ${input.likelyPoolId}.`);
  } else {
    status = "ELIGIBLE";
  }
  return {
    status,
    address,
    activePositionIdInSelectedPool: input.activePositionId.toString(),
    globalActivePositionCount: input.globalActivePositionCount.toString(),
    maxGlobalActivePositionCount:
      input.maxGlobalActivePositionCount.toString(),
    likelyPoolId: input.likelyPoolId.toString(),
    appearsInOwnerMapping,
    appearsInManifest,
    reasons,
  };
}

function createExact99ReadinessPublicClient(
  rpcUrl: string,
  timeoutMs: number,
) {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl, { retryCount: 0, timeout: timeoutMs }),
  });
}

export class ViemExact99ReadinessPublicClient
implements Exact99ReadinessPublicClient {
  readonly #client: ReturnType<typeof createExact99ReadinessPublicClient>;

  constructor(
    rpcUrl: string,
    timeoutMs = LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  ) {
    const url = validateLifecycleSupervisorRpcUrl(rpcUrl);
    const timeout = validateLifecycleSupervisorTimeout(timeoutMs);
    this.#client = createExact99ReadinessPublicClient(url, timeout);
  }

  readPositionCount(blockNumber: bigint): Promise<bigint> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "positionCount",
      blockNumber,
    });
  }

  readOpenPoolIds(blockNumber: bigint): Promise<readonly bigint[]> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "getOpenPoolIds",
      blockNumber,
    });
  }

  readMaxOpenPools(blockNumber: bigint): Promise<bigint> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "MAX_OPEN_POOLS",
      blockNumber,
    });
  }

  readActivePositionId(
    poolId: bigint,
    user: Address,
    blockNumber: bigint,
  ): Promise<bigint> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "getActivePositionId",
      args: [poolId, user],
      blockNumber,
    });
  }

  readActivePositionsByUser(
    user: Address,
    blockNumber: bigint,
  ): Promise<bigint> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "activePositionsByUser",
      args: [user],
      blockNumber,
    });
  }

  readMaxActivePositionsPerUser(blockNumber: bigint): Promise<bigint> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "MAX_ACTIVE_POSITIONS_PER_USER",
      blockNumber,
    });
  }

  readOldestQualifyingPool(
    user: Address,
    blockNumber: bigint,
  ): Promise<bigint> {
    return this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "findOldestQualifyingPool",
      args: [user],
      blockNumber,
    });
  }

  async readPosition(
    positionId: bigint,
    blockNumber: bigint,
  ): Promise<Exact99PositionObservation> {
    const position = await this.#client.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "getPosition",
      args: [positionId],
      blockNumber,
    });
    return {
      id: position.id,
      poolId: position.poolId,
      owner: position.owner,
      active: position.active,
    };
  }

  async readPositionJoinedLogs(input: {
    poolId: bigint;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly Exact99JoinedLog[]> {
    const logs = await this.#client.getContractEvents({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      eventName: "PositionJoined",
      args: { poolId: input.poolId },
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
      strict: true,
    });
    return logs.map((log) => ({
      positionId: log.args.positionId,
      poolId: log.args.poolId,
      user: log.args.user,
      activePositionCount: log.args.activePositionCount,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    }));
  }
}

async function retried<T>(
  label: string,
  operation: () => Promise<T>,
  retryOptions: ReadOnlyRpcRetryOptions,
): Promise<T> {
  return withReadOnlyRpcRetry(label, operation, retryOptions);
}

export async function readExact99OwnerMapping(input: {
  client: Exact99ReadinessPublicClient;
  poolId: bigint;
  expectedActivePositionCount: bigint;
  snapshotBlock: bigint;
  deploymentBlock?: bigint;
  logBlockSpan?: bigint;
  retryOptions?: ReadOnlyRpcRetryOptions;
}): Promise<Exact99OwnerMapping> {
  const deploymentBlock =
    input.deploymentBlock ?? LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK;
  const logBlockSpan = requireLogBlockSpan(
    input.logBlockSpan ?? EXACT_99_READINESS_DEFAULT_LOG_BLOCK_SPAN,
  );
  const retryOptions = input.retryOptions ?? {};
  try {
    const positionCount = await retried(
      `positionCount at block ${input.snapshotBlock}`,
      () => input.client.readPositionCount(input.snapshotBlock),
      retryOptions,
    );
    if (positionCount > EXACT_99_READINESS_MAX_DIRECT_POSITION_READS) {
      throw new Error(
        `Direct position scan exceeds the safety cap ${EXACT_99_READINESS_MAX_DIRECT_POSITION_READS}.`,
      );
    }
    const positions: Exact99PositionObservation[] = [];
    for (let positionId = 1n; positionId <= positionCount; positionId += 1n) {
      positions.push(await retried(
        `getPosition(${positionId}) at block ${input.snapshotBlock}`,
        () => input.client.readPosition(positionId, input.snapshotBlock),
        retryOptions,
      ));
    }
    return buildExact99DirectOwnerMapping({
      poolId: input.poolId,
      deploymentBlock,
      snapshotBlock: input.snapshotBlock,
      positions,
      expectedActivePositionCount: input.expectedActivePositionCount,
    });
  } catch {
    // A bounded PositionJoined scan is the fail-closed fallback when direct
    // position enumeration is unavailable or exceeds its explicit safety cap.
  }
  try {
    const ranges = buildExact99BoundedLogRanges({
      deploymentBlock,
      snapshotBlock: input.snapshotBlock,
      blockSpan: logBlockSpan,
    });
    const logs: Exact99JoinedLog[] = [];
    for (const range of ranges) {
      logs.push(...await retried(
        `PositionJoined logs ${range.fromBlock}..${range.toBlock}`,
        () => input.client.readPositionJoinedLogs({
          poolId: input.poolId,
          ...range,
        }),
        retryOptions,
      ));
      if (logs.length > EXACT_99_READINESS_MAX_JOIN_LOGS) {
        throw new Error(
          `Bounded log scan exceeded ${EXACT_99_READINESS_MAX_JOIN_LOGS} PositionJoined records.`,
        );
      }
    }
    const uniqueIds = [...new Set(logs.map((log) => log.positionId.toString()))]
      .map(BigInt)
      .sort((left, right) => left < right ? -1 : 1);
    const positions: Exact99PositionObservation[] = [];
    for (const positionId of uniqueIds) {
      positions.push(await retried(
        `getPosition(${positionId}) at block ${input.snapshotBlock}`,
        () => input.client.readPosition(positionId, input.snapshotBlock),
        retryOptions,
      ));
    }
    return buildExact99OwnerMapping({
      poolId: input.poolId,
      deploymentBlock,
      snapshotBlock: input.snapshotBlock,
      logBlockSpan,
      joinedLogs: logs,
      positions,
      expectedActivePositionCount: input.expectedActivePositionCount,
    });
  } catch (error) {
    return buildExact99OwnerMapping({
      poolId: input.poolId,
      deploymentBlock,
      snapshotBlock: input.snapshotBlock,
      logBlockSpan,
      joinedLogs: [],
      positions: [],
      expectedActivePositionCount: input.expectedActivePositionCount,
      complete: false,
      warnings: [
        `Owner mapping read failed closed: ${sanitizeOperatorError(error)}`,
      ],
    });
  }
}

export async function readExact99CandidateAssessment(input: {
  client: Exact99ReadinessPublicClient;
  address?: string;
  poolId: bigint;
  snapshotBlock: bigint;
  ownerMapping: Exact99OwnerMapping;
  manifest?: Exact99PublicManifest | null;
  retryOptions?: ReadOnlyRpcRetryOptions;
}): Promise<Exact99CandidateAssessment> {
  if (input.address === undefined) return candidateNotChecked();
  const address = normalizeAddress(input.address, "Candidate address");
  const retryOptions = input.retryOptions ?? {};
  try {
    const [
      activePositionId,
      globalActivePositionCount,
      maxGlobalActivePositionCount,
      likelyPoolId,
    ] = await Promise.all([
      retried(
        `getActivePositionId(${input.poolId}, candidate)`,
        () => input.client.readActivePositionId(
          input.poolId,
          address,
          input.snapshotBlock,
        ),
        retryOptions,
      ),
      retried(
        "activePositionsByUser(candidate)",
        () => input.client.readActivePositionsByUser(
          address,
          input.snapshotBlock,
        ),
        retryOptions,
      ),
      retried(
        "MAX_ACTIVE_POSITIONS_PER_USER",
        () => input.client.readMaxActivePositionsPerUser(input.snapshotBlock),
        retryOptions,
      ),
      retried(
        "findOldestQualifyingPool(candidate)",
        () => input.client.readOldestQualifyingPool(
          address,
          input.snapshotBlock,
        ),
        retryOptions,
      ),
    ]);
    return assessExact99Candidate({
      address,
      poolId: input.poolId,
      activePositionId,
      globalActivePositionCount,
      maxGlobalActivePositionCount,
      likelyPoolId,
      ownerMapping: input.ownerMapping,
      manifest: input.manifest,
    });
  } catch (error) {
    return assessExact99Candidate({
      address,
      poolId: input.poolId,
      ownerMapping: input.ownerMapping,
      manifest: input.manifest,
      complete: false,
      error: sanitizeOperatorError(error),
    });
  }
}

export async function createLiveExact99ReadinessPlan(
  input: Exact99ReadinessLiveOptions,
): Promise<Exact99ReadinessPlan> {
  const blockNumber = input.snapshot.blockNumber;
  if (blockNumber === null) {
    throw new Exact99ReadinessInputError(
      "A live readiness plan requires a concrete snapshot block.",
    );
  }
  const pool = input.snapshot.pools.find((entry) => entry.poolId === input.poolId);
  if (!pool) {
    throw new Exact99ReadinessInputError(
      `Pool ${input.poolId} does not exist in the pinned snapshot.`,
    );
  }
  const expectedCount = pool.activePositionCount ?? 0n;
  const retryOptions = input.retryOptions ?? {};
  const ownerMapping = await readExact99OwnerMapping({
    client: input.publicClient,
    poolId: input.poolId,
    expectedActivePositionCount: expectedCount,
    snapshotBlock: blockNumber,
    deploymentBlock: input.deploymentBlock,
    logBlockSpan: input.logBlockSpan,
    retryOptions,
  });
  let manifest: Exact99PublicManifest | null = null;
  let manifestAssessment = manifestNotProvided();
  if (input.manifestJson !== undefined) {
    const parsed = parseExact99PublicManifestJson(input.manifestJson, {
      chainId: input.snapshot.chainId,
      contractAddress: input.snapshot.contractAddress,
      tokenAddress: DEMO_V1_TOKEN_ADDRESS,
      poolId: input.poolId,
      remainingTo99: maxZero(99n - expectedCount),
      ownerMapping,
    });
    manifest = parsed.manifest;
    manifestAssessment = parsed.assessment;
  }
  const candidate = await readExact99CandidateAssessment({
    client: input.publicClient,
    address: input.candidateAddress,
    poolId: input.poolId,
    snapshotBlock: blockNumber,
    ownerMapping,
    manifest,
    retryOptions,
  });
  let openPoolIds: readonly bigint[] | null = null;
  let maxOpenPools: bigint | null = null;
  try {
    [openPoolIds, maxOpenPools] = await Promise.all([
      retried(
        "getOpenPoolIds",
        () => input.publicClient.readOpenPoolIds(blockNumber),
        retryOptions,
      ),
      retried(
        "MAX_OPEN_POOLS",
        () => input.publicClient.readMaxOpenPools(blockNumber),
        retryOptions,
      ),
    ]);
  } catch {
    // The core marks routing incomplete and fails closed.
  }
  return createExact99ReadinessPlan({
    snapshot: input.snapshot,
    report: input.report,
    poolId: input.poolId,
    sourceReference: input.sourceReference,
    ownerMapping,
    manifest: manifestAssessment,
    candidate,
    openPoolIds,
    maxOpenPools,
  });
}

export function serializeExact99ReadinessPlan(
  plan: Exact99ReadinessPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function parseExact99ReadinessPlanJson(json: string): {
  ok: true;
  plan: Exact99ReadinessPlan;
} | {
  ok: false;
  errors: readonly string[];
} {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, errors: ["Readiness plan is not valid JSON."] };
  }
  const root = record(value);
  const errors: string[] = [];
  if (!root) return { ok: false, errors: ["Readiness plan root must be an object."] };
  if (root.formatVersion !== EXACT_99_READINESS_FORMAT_VERSION) {
    errors.push(
      `formatVersion must be ${EXACT_99_READINESS_FORMAT_VERSION}.`,
    );
  }
  if (root.readOnly !== true || root.safety !== EXACT_99_READINESS_SAFETY) {
    errors.push("Readiness safety markers are invalid.");
  }
  if (typeof root.planId !== "string" || !PLAN_ID.test(root.planId)) {
    errors.push("planId must be a canonical exact99 readiness ID.");
  }
  if (typeof root.fingerprint !== "string" || !SHA256.test(root.fingerprint)) {
    errors.push("fingerprint must be a lowercase SHA-256 value.");
  }
  const identity = record(root.identity);
  const source = record(root.source);
  const pool = record(root.pool);
  const decision = record(root.decision);
  const ownerMapping = record(root.ownerMapping);
  const manifest = record(root.manifest);
  const candidate = record(root.candidate);
  const routing = record(root.routing);
  for (const [name, nested] of [
    ["identity", identity],
    ["source", source],
    ["pool", pool],
    ["decision", decision],
    ["ownerMapping", ownerMapping],
    ["manifest", manifest],
    ["candidate", candidate],
    ["routing", routing],
  ] as const) {
    if (!nested) errors.push(`${name} must be an object.`);
  }
  for (const [label, nested] of [
    ["createdAt", root.createdAt],
    ["identity.chainId", identity?.chainId],
    ["source.snapshotBlockNumber", source?.snapshotBlockNumber],
    ["source.snapshotBlockTimestamp", source?.snapshotBlockTimestamp],
    ["pool.poolId", pool?.poolId],
  ] as const) {
    if (typeof nested !== "string" || !DECIMAL.test(nested)) {
      errors.push(`${label} must be an unsigned decimal string.`);
    }
  }
  if (
    typeof identity?.contractAddress !== "string" ||
    !isAddress(identity.contractAddress)
  ) {
    errors.push("identity.contractAddress must be a valid EVM address.");
  }
  if (
    typeof identity?.tokenAddress !== "string" ||
    !isAddress(identity.tokenAddress)
  ) {
    errors.push("identity.tokenAddress must be a valid EVM address.");
  }
  if (!Array.isArray(root.checkpoints) || !Array.isArray(root.risks)) {
    errors.push("checkpoints and risks must be arrays.");
  }
  if (errors.length > 0) return { ok: false, errors };
  const plan = value as Exact99ReadinessPlan;
  const expectedFingerprint = computeExact99ReadinessFingerprint(plan);
  if (plan.fingerprint !== expectedFingerprint) {
    errors.push("fingerprint does not match canonical readiness plan data.");
  }
  if (plan.planId !== expectedFingerprint.replace(
    "sha256:",
    "exact99-readiness:",
  )) {
    errors.push("planId does not match canonical readiness plan data.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan };
}

function invalidRevalidation(
  errors: readonly string[],
): Exact99ReadinessRevalidationResult {
  return {
    status: "INVALID_PLAN",
    reasonCode: "PLAN_VALIDATION_FAILED",
    planId: null,
    poolId: null,
    baseBlockNumber: null,
    freshBlockNumber: null,
    checkedAt: null,
    changes: errors.map((error) => ({
      field: "plan",
      expected: "valid canonical exact-99 readiness plan",
      actual: error,
      severity: "critical",
      explanation: "The saved readiness plan cannot be trusted.",
    })),
    decision: "Create a new read-only readiness plan from a complete snapshot.",
    safety: EXACT_99_READINESS_SAFETY,
  };
}

export function invalidExact99ReadinessPlanResult(
  errors: readonly string[],
): Exact99ReadinessRevalidationResult {
  return invalidRevalidation(errors);
}

function addChange(
  changes: Exact99ReadinessChange[],
  field: string,
  expected: string | boolean | null,
  actual: string | boolean | null,
  severity: "warning" | "critical",
  explanation: string,
): void {
  if (expected === actual) return;
  changes.push({ field, expected, actual, severity, explanation });
}

function revalidationResult(
  status: Exact99ReadinessRevalidationStatus,
  reasonCode: string,
  plan: Exact99ReadinessPlan,
  fresh: Exact99ReadinessPlan,
  changes: readonly Exact99ReadinessChange[],
): Exact99ReadinessRevalidationResult {
  const decisions: Record<Exact99ReadinessRevalidationStatus, string> = {
    VALID: "The saved readiness plan still matches fresh public state.",
    STALE: "Recalculate required addresses and create a new readiness plan.",
    BLOCKED: "Resolve the critical public-state condition before proceeding.",
    INCOMPLETE: "Obtain complete public reads before making a readiness decision.",
    INVALID_PLAN: "Create a new canonical readiness plan.",
  };
  return {
    status,
    reasonCode,
    planId: plan.planId,
    poolId: plan.pool.poolId,
    baseBlockNumber: plan.source.snapshotBlockNumber,
    freshBlockNumber: fresh.source.snapshotBlockNumber,
    checkedAt: fresh.source.snapshotBlockTimestamp,
    changes,
    decision: decisions[status],
    safety: EXACT_99_READINESS_SAFETY,
  };
}

export function revalidateExact99ReadinessPlan(
  untrustedPlan: Exact99ReadinessPlan,
  fresh: Exact99ReadinessPlan,
  options: { maxAgeSeconds?: bigint } = {},
): Exact99ReadinessRevalidationResult {
  const parsed = parseExact99ReadinessPlanJson(
    serializeExact99ReadinessPlan(untrustedPlan),
  );
  if (!parsed.ok) return invalidRevalidation(parsed.errors);
  const plan = parsed.plan;
  const changes: Exact99ReadinessChange[] = [];
  const maxAge =
    options.maxAgeSeconds ?? EXACT_99_READINESS_DEFAULT_MAX_AGE_SECONDS;
  if (maxAge < 0n) {
    throw new Exact99ReadinessInputError(
      "Maximum readiness plan age must not be negative.",
    );
  }
  for (const [field, expected, actual] of [
    ["identity.chainId", plan.identity.chainId, fresh.identity.chainId],
    [
      "identity.contractAddress",
      plan.identity.contractAddress.toLowerCase(),
      fresh.identity.contractAddress.toLowerCase(),
    ],
    [
      "identity.contractInterface",
      plan.identity.contractInterface,
      fresh.identity.contractInterface,
    ],
    [
      "identity.tokenAddress",
      plan.identity.tokenAddress.toLowerCase(),
      fresh.identity.tokenAddress.toLowerCase(),
    ],
    ["pool.poolId", plan.pool.poolId, fresh.pool.poolId],
  ] as const) {
    addChange(
      changes,
      field,
      expected,
      actual,
      "critical",
      "Readiness identity is immutable.",
    );
  }
  if (changes.length > 0) {
    return revalidationResult(
      "BLOCKED",
      "IDENTITY_MISMATCH",
      plan,
      fresh,
      changes,
    );
  }
  if (
    BigInt(fresh.source.snapshotBlockNumber) <
    BigInt(plan.source.snapshotBlockNumber)
  ) {
    addChange(
      changes,
      "source.snapshotBlockNumber",
      `>= ${plan.source.snapshotBlockNumber}`,
      fresh.source.snapshotBlockNumber,
      "critical",
      "Revalidation cannot move backwards.",
    );
    return revalidationResult(
      "BLOCKED",
      "BLOCK_REGRESSION",
      plan,
      fresh,
      changes,
    );
  }
  if (
    fresh.decision.status === "INCOMPLETE" ||
    !fresh.pool.snapshotComplete ||
    fresh.ownerMapping.status === "INCOMPLETE" ||
    fresh.candidate.status === "INCOMPLETE" ||
    fresh.manifest.status === "INCOMPLETE"
  ) {
    addChange(
      changes,
      "fresh.readiness",
      "complete",
      "incomplete",
      "critical",
      "Revalidation fails closed on missing public data.",
    );
    return revalidationResult(
      "INCOMPLETE",
      "FRESH_READINESS_INCOMPLETE",
      plan,
      fresh,
      changes,
    );
  }
  if (fresh.pool.status !== "Open") {
    addChange(
      changes,
      "pool.status",
      plan.pool.status,
      fresh.pool.status,
      "critical",
      "A non-Open pool blocks exact-99 preparation.",
    );
    return revalidationResult(
      "BLOCKED",
      "POOL_NOT_OPEN",
      plan,
      fresh,
      changes,
    );
  }
  if (
    fresh.decision.status === "BLOCKED" ||
    fresh.decision.status === "INVALID_INPUT"
  ) {
    addChange(
      changes,
      "fresh.decision",
      "non-blocking",
      fresh.decision.status,
      "critical",
      "Fresh readiness contains a blocking condition.",
    );
    return revalidationResult(
      "BLOCKED",
      "FRESH_READINESS_BLOCKED",
      plan,
      fresh,
      changes,
    );
  }
  for (const [field, expected, actual, explanation] of [
    [
      "pool.activePositionCount",
      plan.pool.activePositionCount,
      fresh.pool.activePositionCount,
      "Any count change requires recalculating address and phase totals.",
    ],
    [
      "pool.escrowedAmount",
      plan.pool.escrowedAmount,
      fresh.pool.escrowedAmount,
      "Pool escrow changed.",
    ],
    [
      "ownerMapping.fingerprint",
      plan.ownerMapping.fingerprint,
      fresh.ownerMapping.fingerprint,
      "The active owner mapping changed.",
    ],
    [
      "manifest.fingerprint",
      plan.manifest.fingerprint,
      fresh.manifest.fingerprint,
      "The supplied public manifest changed or no longer matches.",
    ],
    [
      "supervisor.action",
      plan.pool.supervisorRecommendation.action,
      fresh.pool.supervisorRecommendation.action,
      "Supervisor recommendation changed.",
    ],
    [
      "supervisor.reasonCode",
      plan.pool.supervisorRecommendation.reasonCode,
      fresh.pool.supervisorRecommendation.reasonCode,
      "Supervisor reason changed.",
    ],
    [
      "checkpoints",
      canonicalizeLifecyclePlanValue(plan.checkpoints),
      canonicalizeLifecyclePlanValue(fresh.checkpoints),
      "Dynamic checkpoint calculations changed.",
    ],
    [
      "candidate.status",
      plan.candidate.status,
      fresh.candidate.status,
      "Candidate qualification changed.",
    ],
    [
      "candidate.likelyPoolId",
      plan.candidate.likelyPoolId,
      fresh.candidate.likelyPoolId,
      "Candidate routing changed.",
    ],
  ] as const) {
    addChange(changes, field, expected, actual, "warning", explanation);
  }
  if (changes.length > 0) {
    return revalidationResult(
      "STALE",
      "READINESS_STATE_CHANGED",
      plan,
      fresh,
      changes,
    );
  }
  const freshTimestamp = BigInt(fresh.source.snapshotBlockTimestamp);
  const createdAt = BigInt(plan.createdAt);
  if (freshTimestamp < createdAt) {
    addChange(
      changes,
      "source.snapshotBlockTimestamp",
      `>= ${createdAt}`,
      freshTimestamp.toString(),
      "critical",
      "Fresh block timestamp regressed.",
    );
    return revalidationResult(
      "BLOCKED",
      "TIMESTAMP_REGRESSION",
      plan,
      fresh,
      changes,
    );
  }
  if (freshTimestamp - createdAt > maxAge) {
    addChange(
      changes,
      "plan.ageSeconds",
      `<= ${maxAge}`,
      (freshTimestamp - createdAt).toString(),
      "warning",
      "Saved readiness plan exceeded its configured maximum age.",
    );
    return revalidationResult(
      "STALE",
      "PLAN_MAX_AGE_EXCEEDED",
      plan,
      fresh,
      changes,
    );
  }
  return revalidationResult(
    "VALID",
    "READINESS_PLAN_STILL_CURRENT",
    plan,
    fresh,
    [],
  );
}

export function readinessExitCode(status: Exact99ReadinessStatus): number {
  return EXACT_99_READINESS_EXIT_CODES[status];
}

export function readinessRevalidationExitCode(
  status: Exact99ReadinessRevalidationStatus,
): number {
  return status === "VALID"
    ? 0
    : EXACT_99_READINESS_EXIT_CODES[status];
}

export function renderExact99ReadinessJson(
  plan: Exact99ReadinessPlan,
): string {
  return JSON.stringify(plan, null, 2);
}

export function renderExact99ReadinessText(
  plan: Exact99ReadinessPlan,
): string {
  const lines = [
    "POP33 EXACT-99 BASE SEPOLIA READINESS",
    EXACT_99_READINESS_SAFETY,
    `Plan: ${plan.planId}`,
    `Chain: ${plan.identity.chainId} | contract: ${plan.identity.contractAddress}`,
    `Block: ${plan.source.snapshotBlockNumber} | RPC host: ${plan.source.rpcHost}`,
    `Pool ${plan.pool.poolId}: ${plan.pool.status} ${plan.pool.activePositionCount ?? "?"}/${plan.pool.capacity ?? "?"} | escrow ${plan.pool.escrowedAmount ?? "?"}`,
    `Supervisor: ${plan.pool.supervisorRecommendation.action} (${plan.pool.supervisorRecommendation.severity})`,
    `Owner mapping: ${plan.ownerMapping.status} | ${plan.ownerMapping.activeOwnerCount} active owners | ${plan.ownerMapping.fingerprint}`,
    `Manifest: ${plan.manifest.status} | candidate: ${plan.candidate.status}`,
    `Routing: ${plan.routing.assurance} — ${plan.routing.explanation}`,
    "",
    "TARGET | REMAINING | IN PHASE | EXPECTED ESCROW | CLASSIFICATION",
    ...plan.checkpoints.map((checkpoint) =>
      `${checkpoint.target} | ${checkpoint.remainingFromSnapshot} | ${checkpoint.positionsInPhase} | ${checkpoint.expectedEscrow} | ${checkpoint.classification}`),
    "",
    `New unique addresses to 99: ${plan.resources.newUniqueAddressesTo99}`,
    `Test dUSDC units to 99: ${plan.resources.requiredTestTokenTo99}`,
    `Decision: ${plan.decision.status}`,
    plan.decision.explanation,
    ...plan.decision.blockers.map((blocker) => `BLOCKER: ${blocker}`),
    EXACT_99_READINESS_SAFETY,
  ];
  return lines.join("\n");
}

export function renderExact99ReadinessRevalidationJson(
  result: Exact99ReadinessRevalidationResult,
): string {
  return JSON.stringify(result, null, 2);
}

export function renderExact99ReadinessRevalidationText(
  result: Exact99ReadinessRevalidationResult,
): string {
  return [
    "POP33 EXACT-99 READINESS REVALIDATION",
    `Status: ${result.status}`,
    `Pool: ${result.poolId ?? "-"}`,
    `Base block: ${result.baseBlockNumber ?? "-"}`,
    `Fresh block: ${result.freshBlockNumber ?? "-"}`,
    ...result.changes.map((change) =>
      `${change.severity.toUpperCase()} ${change.field}: ${String(change.expected)} -> ${String(change.actual)} — ${change.explanation}`),
    result.decision,
    EXACT_99_READINESS_SAFETY,
  ].join("\n");
}

export async function readExact99PublicManifestFile(
  input: string,
  workingDirectory = process.cwd(),
): Promise<{ path: string; json: string }> {
  const path = resolveJsonPath(input, workingDirectory);
  await assertRegularNonSymlink(path);
  return { path, json: await readFile(path, "utf8") };
}

export async function readExact99ReadinessPlanFile(
  input: string,
  workingDirectory = process.cwd(),
): Promise<{ path: string; json: string }> {
  const path = resolveJsonPath(input, workingDirectory);
  await assertRegularNonSymlink(path);
  return { path, json: await readFile(path, "utf8") };
}

export async function writeExact99ReadinessPlanFile(
  input: string,
  plan: Exact99ReadinessPlan,
  options: {
    overwrite?: boolean;
    workingDirectory?: string;
  } = {},
): Promise<string> {
  const path = resolveJsonPath(
    input,
    options.workingDirectory ?? process.cwd(),
  );
  await withExclusiveFileLock(path, async () => {
    const exists = await pathIsRegularFile(path);
    if (exists && !options.overwrite) {
      throw new Exact99ReadinessInputError(
        "Readiness plan already exists. Use --overwrite-plan to replace it explicitly.",
      );
    }
    if (exists) await assertRegularNonSymlink(path);
    await atomicWritePrivateFile(path, serializeExact99ReadinessPlan(plan));
  });
  return path;
}

export function redactExact99ReadinessRpcHost(rpcUrl: string): string {
  return redactLifecycleSupervisorRpcUrl(rpcUrl);
}
