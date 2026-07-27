import { createHash } from "node:crypto";

export const EXACT_99_PUBLIC_PROTOCOL_VERSION = 1;
export const EXACT_99_JOURNAL_V2_SCHEMA_VERSION = 2;
export const EXACT_99_BOUNDARY_INDEX = 98;
export const EXACT_99_REJECTED_MANUAL_INDEX = 99;
export const EXACT_99_BOUNDARY_AUTHORIZATION =
  "AUTHORIZE POP33 EXACT 99 BOUNDARY WALLET 98";
export const EXACT_99_BOUNDARY_THREAT_ACKNOWLEDGMENT =
  "ACKNOWLEDGE POP33 BOUNDARY 99 TESTNET RACE";
export const EXACT_99_REPLACEMENT_AUTHORIZATION =
  "AUTHORIZE POP33 FIXTURE REPLACEMENT REVIEW";
export const EXACT_99_STALE_LOCK_TAKEOVER_AUTHORIZATION =
  "AUTHORIZE POP33 FIXTURE STALE LOCK TAKEOVER";

export const EXACT_99_PUBLIC_PROTOCOL_STEPS = [
  "acquire-global-run-lock",
  "local-artifact-preflight",
  "dual-source-block-tagged-snapshot",
  "prepare-operation-request",
  "persist-prepared",
  "reserve-nonce",
  "persist-nonce-reserved",
  "prepare-gas-and-fee-caps",
  "persist-full-unsigned-request",
  "simulate-sign",
  "calculate-signed-transaction-hash-locally",
  "persist-signed-before-broadcast",
  "simulate-broadcast",
  "persist-broadcast-attempted",
  "persist-pending",
  "persist-mined-receipt",
  "semantic-reconciliation",
  "wait-required-confirmation-depth",
  "recheck-canonical-block-hash",
  "persist-confirmed",
  "persist-checkpoint-final",
  "derive-checkpoint-update",
  "close-fixture-signer-session-and-release-run-lock",
] as const;

export const EXACT_99_PROTOCOL_FAULT_POINTS = [
  "before-lock-acquire",
  "after-lock-acquire",
  "before-prepared",
  "after-prepared",
  "after-nonce-reservation",
  "before-simulated-sign",
  "after-simulated-sign-before-signed-persist",
  "after-signed-before-broadcast",
  "during-broadcast-no-response",
  "after-broadcast-hash",
  "after-receipt-before-mined-persist",
  "after-mined-before-reconciliation",
  "after-reconciliation-before-confirmed",
  "after-confirmed-before-checkpoint",
  "before-lock-update",
  "after-lock-update",
  "before-lock-release",
  "after-lock-release",
] as const;

export type Exact99ProtocolFaultPoint = (typeof EXACT_99_PROTOCOL_FAULT_POINTS)[number];

export type Exact99JournalV2State =
  | "planned"
  | "prepared"
  | "nonce-reserved"
  | "signed"
  | "broadcast-attempted"
  | "pending"
  | "mined"
  | "reconciling"
  | "confirmed"
  | "checkpoint-final"
  | "failed"
  | "ambiguous"
  | "replaced"
  | "cancelled"
  | "reorged"
  | "manual-review";

export type Exact99RecoveryDecision =
  | "safe-to-prepare"
  | "safe-to-broadcast-signed-transaction"
  | "wait-pending"
  | "reconcile-mined"
  | "wait-confirmations"
  | "confirmed"
  | "checkpoint-final"
  | "failed-consumed-nonce"
  | "investigate-replacement"
  | "investigate-cancellation"
  | "investigate-reorg"
  | "ambiguous"
  | "manual-review"
  | "do-not-retry";

export type Exact99JournalV2Operation =
  | "funding"
  | "faucet"
  | "approve"
  | "join"
  | "draw"
  | "claim";

export type Exact99JournalV2Finality =
  | "unmined"
  | "mined"
  | "canonical"
  | "confirmed"
  | "checkpoint-final"
  | "reorged";

export type Exact99SemanticReconciliation =
  | "not-run"
  | "matched"
  | "mismatched"
  | "inconclusive";

export type Exact99JournalV2RecoveryStatus =
  | "clean"
  | "pending"
  | "manual-review"
  | "do-not-retry"
  | "failed-consumed-nonce";

export interface Exact99UnsignedTransactionRequest {
  chainId: string;
  target: string;
  valueWei: string;
  calldataDigest: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  totalFeeCapWei: string;
}

export interface Exact99JournalV2Attempt {
  sequence: number;
  journalSchemaVersion: 2;
  setId: string;
  storeId: string;
  runId: string;
  manifestFingerprint: string;
  checkpoint: string;
  rangeStart: number;
  rangeEnd: number;
  walletIndex: number;
  walletAddress: string;
  operationId: string;
  attemptId: string;
  replacementOfAttemptId: string | null;
  operationType: Exact99JournalV2Operation;
  signerRole: "funding" | "participant" | "piotr-manual";
  chainId: string;
  contractAddress: string;
  tokenAddress: string | null;
  target: string;
  valueWei: string;
  calldataDigest: string;
  requestDigest: string | null;
  unsignedRequest: Exact99UnsignedTransactionRequest | null;
  nonce: number | null;
  gasLimit: string | null;
  maxFeePerGasWei: string | null;
  maxPriorityFeePerGasWei: string | null;
  totalFeeCapWei: string | null;
  signedTransactionHash: string | null;
  rawTransactionCreated: boolean;
  broadcastAttempted: boolean;
  broadcastRpcIdentity: string | null;
  transportTransactionHash: string | null;
  blockNumber: number | null;
  blockHash: string | null;
  transactionIndex: number | null;
  receiptStatus: 0 | 1 | null;
  confirmationDepth: number;
  finalityState: Exact99JournalV2Finality;
  semanticReconciliation: Exact99SemanticReconciliation;
  beforeStateDigest: string;
  afterStateDigest: string | null;
  canonicalRecheckEvidenceDigest: string | null;
  recoveryStatus: Exact99JournalV2RecoveryStatus;
  manualReviewReason: string | null;
  state: Exact99JournalV2State;
  createdAt: string;
  updatedAt: string;
  stateRecordedAt: string;
}

export interface Exact99JournalV2 {
  journalSchemaVersion: 2;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  runId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  entries: Exact99JournalV2Attempt[];
  checksum: string;
}

export interface Exact99JournalV2Identity {
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  runId: string;
}

export interface Exact99PlannedAttemptInput extends Exact99JournalV2Identity {
  checkpoint: string;
  rangeStart: number;
  rangeEnd: number;
  walletIndex: number;
  walletAddress: string;
  operationId: string;
  attemptId: string;
  replacementOfAttemptId?: string | null;
  operationType: Exact99JournalV2Operation;
  signerRole: "funding" | "participant" | "piotr-manual";
  chainId: string;
  contractAddress: string;
  tokenAddress?: string | null;
  target: string;
  valueWei: string;
  calldataDigest: string;
  beforeStateDigest: string;
  timestamp: string;
}

export interface Exact99DualSourceSnapshot {
  sourceId: string;
  chainId: string;
  blockNumber: number;
  blockHash: string;
  parentHash: string;
  timestamp: string;
  contractCodeHash: string;
  tokenCodeHash: string;
  abiDigest: string;
  contractParametersDigest: string;
  operationStateDigest: string;
}

export interface Exact99DualSourceEvidence {
  sourceA: Exact99DualSourceSnapshot;
  sourceB: Exact99DualSourceSnapshot;
  evidenceDigest: string;
}

export interface Exact99ManifestEvidenceIdentity {
  chainId: string;
  contractCodeHash: string;
  tokenCodeHash: string;
  abiDigest: string;
  contractParametersDigest: string;
}

export interface Exact99FixtureNonceTransaction {
  attemptId: string | null;
  nonce: number;
  transactionHash: string;
  source: "journal" | "external";
  state: "pending" | "mined" | "replaced" | "cancelled" | "dropped";
  replacementOfAttemptId: string | null;
}

export interface Exact99FixtureNonceSnapshot {
  signerRole: "funding" | "participant" | "piotr-manual";
  signerAddress: string;
  latestNonce: number;
  pendingNonce: number;
  journalExpectedNonce: number | null;
  knownTransactions: Exact99FixtureNonceTransaction[];
}

export interface Exact99FixtureNonceDecision {
  allowed: boolean;
  nonce: number | null;
  decision:
    | "reserve-next"
    | "wait-known-pending"
    | "block-foreign-pending"
    | "block-unresolved"
    | "block-inconsistent-journal"
    | "block-cancellation"
    | "block-dropped"
    | "manual-review";
  reason: string;
  mutexNamespace: string;
}

export interface Exact99FixtureFeeLimits {
  fixtureOnly: true;
  profileName: string;
  maxOperationGasLimit: string;
  maxEstimationMultiplierBps: number;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  maxOperationCostWei: string;
  maxWalletCostWei: string;
  maxCheckpointCostWei: string;
  maxRunCostWei: string;
  fundingSignerReserveWei: string;
  participantReserveWei: string;
  laterClaimReserveWei: string | null;
}

export interface Exact99FixtureFeeRequest {
  signerRole: "funding" | "participant";
  estimationComplete: boolean;
  estimatedGasLimit: string | null;
  gasLimit: string | null;
  maxFeePerGasWei: string | null;
  maxPriorityFeePerGasWei: string | null;
  additionalLayerFeeCapWei: string | null;
  walletSpentWei: string;
  checkpointSpentWei: string;
  runSpentWei: string;
  walletBalanceWei: string;
  signerBalanceWei: string;
  requestedAutomaticCapIncrease: boolean;
}

export interface Exact99FixtureFeeDecision {
  allowed: boolean;
  totalFeeCapWei: string | null;
  blockers: string[];
}

export interface Exact99GlobalRunLock {
  runId: string;
  setId: string;
  storeId: string;
  manifestFingerprint: string;
  journalChecksum: string;
  journalRevision: number;
  pid: number;
  hostId: string;
  startedAt: string;
  checkpoint: string;
  signerRole: "none" | "funding" | "participant" | "piotr-manual";
  walletIndex: number | null;
  operationId: string | null;
  state: "active" | "manual-review";
  manualReviewReason: string | null;
}

export type Exact99LockFaultHook = (point: Exact99ProtocolFaultPoint) => void;

export interface Exact99FinalityPolicy {
  fixtureOnly: true;
  requiredConfirmationDepth: number;
  checkpointFinalConfirmationDepth: number;
}

export interface Exact99FinalityObservation {
  transactionHash: string;
  receiptFoundBySourceA: boolean;
  receiptFoundBySourceB: boolean;
  blockNumberBySourceA: number | null;
  blockNumberBySourceB: number | null;
  blockHashBySourceA: string | null;
  blockHashBySourceB: string | null;
  recordedBlockNumber: number;
  recordedBlockHash: string;
  headBlockNumber: number;
  semanticReconciliation: Exact99SemanticReconciliation;
  checkpointRecheck: boolean;
}

export interface Exact99FinalityAssessment {
  finalityState: Exact99JournalV2Finality;
  confirmationDepth: number;
  mayConfirm: boolean;
  mayFinalizeCheckpoint: boolean;
  reorgDetected: boolean;
  reason: string;
}

export interface Exact99RecoveryEvidence {
  transportLookup:
    | "not-checked"
    | "found-pending"
    | "found-mined"
    | "not-found-one-source"
    | "not-found-two-sources";
  receiptStatus: 0 | 1 | null;
  semanticReconciliation: Exact99SemanticReconciliation;
  finalityAssessment: Exact99FinalityAssessment | null;
  broadcastMayHaveOccurred: boolean;
}

export interface Exact99Boundary99Input {
  authorizationPhrase: string;
  threatAcknowledgment: string;
  walletIndex: number;
  activePositionCount: number;
  expectedPoolAmount: string;
  observedPoolAmount: string;
  poolStatus: "Open" | "Locked" | "Finished";
  lockedAt: string;
  escrowExpected: string;
  escrowObserved: string;
  foreignEventSinceCheckpoint: boolean;
  piotrWalletReady: boolean;
  participantNonceDecision: Exact99FixtureNonceDecision;
  pendingTransaction: boolean;
  snapshotId: string;
  snapshotCreatedAt: string;
  evaluatedAt: string;
  maximumSnapshotAgeSeconds: number;
  previouslyUsedSnapshotIds: readonly string[];
  beforeEvidence: Exact99DualSourceEvidence;
  afterEvidence: Exact99DualSourceEvidence;
}

export interface Exact99Boundary99Decision {
  allowed: boolean;
  mode: "boundary-99";
  walletIndex: 98;
  nextStage: "awaiting-manual-100" | "blocked";
  oneUseSnapshotDigest: string | null;
  blockers: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d*)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;
const FORBIDDEN_JOURNAL_KEY =
  /private.?key|mnemonic|seed|password|passphrase|credential|rawSignedTransaction|rawTransactionBytes/i;

const TERMINAL_MANUAL_STATES = new Set<Exact99JournalV2State>([
  "ambiguous",
  "replaced",
  "cancelled",
  "reorged",
  "manual-review",
]);

const TRANSITIONS: Record<Exact99JournalV2State, ReadonlySet<Exact99JournalV2State>> = {
  planned: new Set(["prepared", "failed", "manual-review"]),
  prepared: new Set(["nonce-reserved", "failed", "manual-review"]),
  "nonce-reserved": new Set(["signed", "failed", "ambiguous", "manual-review"]),
  signed: new Set(["broadcast-attempted", "ambiguous", "failed", "manual-review"]),
  "broadcast-attempted": new Set(["pending", "ambiguous", "failed", "manual-review"]),
  pending: new Set(["mined", "ambiguous", "replaced", "cancelled", "failed", "manual-review"]),
  mined: new Set(["reconciling", "reorged", "failed", "manual-review"]),
  reconciling: new Set(["confirmed", "reorged", "failed", "manual-review"]),
  confirmed: new Set(["checkpoint-final", "reorged", "manual-review"]),
  "checkpoint-final": new Set(["reorged", "manual-review"]),
  failed: new Set(),
  ambiguous: new Set(),
  replaced: new Set(),
  cancelled: new Set(),
  reorged: new Set(),
  "manual-review": new Set(),
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function exact99FixtureDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertAddress(value: string, label: string): void {
  if (!ADDRESS.test(value)) throw new Error(`${label} must be an address.`);
}

function assertHash(value: string, label: string): void {
  if (!HASH.test(value)) throw new Error(`${label} must be a 32-byte hash.`);
}

function assertDigest(value: string, label: string): void {
  if (!DIGEST.test(value)) throw new Error(`${label} must be a sha256 digest.`);
}

function assertDecimal(value: string, label: string): void {
  if (!DECIMAL.test(value)) throw new Error(`${label} must be an unsigned decimal string.`);
}

function decimal(value: string, label: string): bigint {
  assertDecimal(value, label);
  return BigInt(value);
}

function assertInteger(value: number, label: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer at least ${minimum}.`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
}

function assertNoForbiddenJournalMaterial(value: unknown, path = "journal"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenJournalMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_JOURNAL_KEY.test(key)) {
        throw new Error(`${path}.${key} is forbidden in journal v2.`);
      }
      assertNoForbiddenJournalMaterial(child, `${path}.${key}`);
    }
  }
}

function journalChecksumValue(journal: Omit<Exact99JournalV2, "checksum">): string {
  return exact99FixtureDigest(journal);
}

function withJournalChecksum(journal: Omit<Exact99JournalV2, "checksum">): Exact99JournalV2 {
  return { ...journal, checksum: journalChecksumValue(journal) };
}

function appendJournalEntry(
  journal: Exact99JournalV2,
  entry: Exact99JournalV2Attempt,
  timestamp: string,
): Exact99JournalV2 {
  const { checksum: ignored, ...withoutChecksum } = journal;
  void ignored;
  return withJournalChecksum({
    ...withoutChecksum,
    revision: journal.revision + 1,
    updatedAt: timestamp,
    entries: [...journal.entries, entry],
  });
}

export function buildEmptyExact99JournalV2(
  identity: Exact99JournalV2Identity,
  timestamp: string,
): Exact99JournalV2 {
  assertUuid(identity.setId, "setId");
  assertUuid(identity.storeId, "storeId");
  assertUuid(identity.runId, "runId");
  assertDigest(identity.manifestFingerprint, "manifestFingerprint");
  assertTimestamp(timestamp, "timestamp");
  return withJournalChecksum({
    journalSchemaVersion: EXACT_99_JOURNAL_V2_SCHEMA_VERSION,
    ...identity,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    entries: [],
  });
}

export function serializeExact99JournalV2(journal: Exact99JournalV2): string {
  return `${JSON.stringify(validateExact99JournalV2(journal), null, 2)}\n`;
}

export function parseExact99JournalV2(serialized: string): Exact99JournalV2 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Journal v2 is incomplete or invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Journal v2 root must be an object.");
  }
  return validateExact99JournalV2(value as Exact99JournalV2);
}

function assertAttemptShape(attempt: Exact99JournalV2Attempt): void {
  if (attempt.journalSchemaVersion !== 2) throw new Error("Attempt journal schema is not v2.");
  assertInteger(attempt.sequence, "attempt.sequence", 1);
  assertUuid(attempt.setId, "attempt.setId");
  assertUuid(attempt.storeId, "attempt.storeId");
  assertUuid(attempt.runId, "attempt.runId");
  assertUuid(attempt.operationId, "attempt.operationId");
  assertUuid(attempt.attemptId, "attempt.attemptId");
  if (attempt.replacementOfAttemptId) assertUuid(attempt.replacementOfAttemptId, "replacementOfAttemptId");
  assertDigest(attempt.manifestFingerprint, "attempt.manifestFingerprint");
  assertAddress(attempt.walletAddress, "attempt.walletAddress");
  assertAddress(attempt.contractAddress, "attempt.contractAddress");
  if (attempt.tokenAddress) assertAddress(attempt.tokenAddress, "attempt.tokenAddress");
  assertAddress(attempt.target, "attempt.target");
  assertInteger(attempt.walletIndex, "attempt.walletIndex");
  assertInteger(attempt.rangeStart, "attempt.rangeStart");
  assertInteger(attempt.rangeEnd, "attempt.rangeEnd");
  if (attempt.rangeStart > attempt.walletIndex || attempt.walletIndex > attempt.rangeEnd) {
    throw new Error("Attempt wallet index is outside its range.");
  }
  assertDecimal(attempt.valueWei, "attempt.valueWei");
  assertDigest(attempt.calldataDigest, "attempt.calldataDigest");
  assertDigest(attempt.beforeStateDigest, "attempt.beforeStateDigest");
  if (attempt.afterStateDigest) assertDigest(attempt.afterStateDigest, "attempt.afterStateDigest");
  if (attempt.requestDigest) assertDigest(attempt.requestDigest, "attempt.requestDigest");
  if (attempt.signedTransactionHash) assertHash(attempt.signedTransactionHash, "signedTransactionHash");
  if (attempt.transportTransactionHash) assertHash(attempt.transportTransactionHash, "transportTransactionHash");
  if (attempt.blockHash) assertHash(attempt.blockHash, "blockHash");
  if (attempt.canonicalRecheckEvidenceDigest) {
    assertDigest(attempt.canonicalRecheckEvidenceDigest, "canonicalRecheckEvidenceDigest");
  }
  if (
    attempt.transportTransactionHash &&
    attempt.signedTransactionHash &&
    attempt.transportTransactionHash.toLowerCase() !== attempt.signedTransactionHash.toLowerCase()
  ) throw new Error("Transport transaction hash differs from the locally calculated signed hash.");
  if (
    attempt.broadcastRpcIdentity !== null &&
    (!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(attempt.broadcastRpcIdentity) ||
      /:\/\//.test(attempt.broadcastRpcIdentity))
  ) throw new Error("Broadcast identity must be a redacted non-endpoint label.");
  if (attempt.nonce !== null) assertInteger(attempt.nonce, "attempt.nonce");
  if (attempt.blockNumber !== null) assertInteger(attempt.blockNumber, "attempt.blockNumber");
  if (attempt.transactionIndex !== null) assertInteger(attempt.transactionIndex, "attempt.transactionIndex");
  assertInteger(attempt.confirmationDepth, "attempt.confirmationDepth");
  for (const [label, value] of [
    ["gasLimit", attempt.gasLimit],
    ["maxFeePerGasWei", attempt.maxFeePerGasWei],
    ["maxPriorityFeePerGasWei", attempt.maxPriorityFeePerGasWei],
    ["totalFeeCapWei", attempt.totalFeeCapWei],
  ] as const) {
    if (value !== null) assertDecimal(value, `attempt.${label}`);
  }
  assertTimestamp(attempt.createdAt, "attempt.createdAt");
  assertTimestamp(attempt.updatedAt, "attempt.updatedAt");
  assertTimestamp(attempt.stateRecordedAt, "attempt.stateRecordedAt");

  if (attempt.state === "nonce-reserved" || attempt.state === "signed" ||
      attempt.state === "broadcast-attempted" || attempt.state === "pending" ||
      attempt.state === "mined" || attempt.state === "reconciling" ||
      attempt.state === "confirmed" || attempt.state === "checkpoint-final") {
    if (attempt.nonce === null || !attempt.unsignedRequest || !attempt.requestDigest) {
      throw new Error(`${attempt.state} requires a nonce and full unsigned request.`);
    }
    if (exact99FixtureDigest(attempt.unsignedRequest) !== attempt.requestDigest) {
      throw new Error("Unsigned request digest is inconsistent.");
    }
    if (
      attempt.unsignedRequest.nonce !== attempt.nonce ||
      attempt.unsignedRequest.chainId !== attempt.chainId ||
      attempt.unsignedRequest.target.toLowerCase() !== attempt.target.toLowerCase() ||
      attempt.unsignedRequest.valueWei !== attempt.valueWei ||
      attempt.unsignedRequest.calldataDigest !== attempt.calldataDigest ||
      attempt.unsignedRequest.gasLimit !== attempt.gasLimit ||
      attempt.unsignedRequest.maxFeePerGasWei !== attempt.maxFeePerGasWei ||
      attempt.unsignedRequest.maxPriorityFeePerGasWei !== attempt.maxPriorityFeePerGasWei ||
      attempt.unsignedRequest.totalFeeCapWei !== attempt.totalFeeCapWei
    ) {
      throw new Error("Unsigned request identity is inconsistent.");
    }
  }
  if (attempt.state === "signed" || attempt.state === "broadcast-attempted" ||
      attempt.state === "pending" || attempt.state === "mined" ||
      attempt.state === "reconciling" || attempt.state === "confirmed" ||
      attempt.state === "checkpoint-final") {
    if (!attempt.rawTransactionCreated || !attempt.signedTransactionHash) {
      throw new Error(`${attempt.state} requires the locally calculated signed hash.`);
    }
  }
  if (attempt.state === "broadcast-attempted" || attempt.state === "pending" ||
      attempt.state === "mined" || attempt.state === "reconciling" ||
      attempt.state === "confirmed" || attempt.state === "checkpoint-final") {
    if (!attempt.broadcastAttempted || !attempt.broadcastRpcIdentity) {
      throw new Error(`${attempt.state} requires persisted broadcast identity.`);
    }
  }
  if (attempt.state === "mined" || attempt.state === "reconciling" ||
      attempt.state === "confirmed" || attempt.state === "checkpoint-final") {
    if (
      attempt.blockNumber === null || !attempt.blockHash ||
      attempt.transactionIndex === null || attempt.receiptStatus === null
    ) {
      throw new Error(`${attempt.state} requires complete receipt identity.`);
    }
  }
  if (attempt.state === "confirmed" || attempt.state === "checkpoint-final") {
    if (
      attempt.receiptStatus !== 1 ||
      attempt.semanticReconciliation !== "matched" ||
      attempt.finalityState !== (attempt.state === "confirmed" ? "confirmed" : "checkpoint-final")
    ) {
      throw new Error(`${attempt.state} requires a successful receipt and matched reconciliation.`);
    }
  }
  if (attempt.state === "checkpoint-final" && !attempt.canonicalRecheckEvidenceDigest) {
    throw new Error("checkpoint-final requires a canonical recheck evidence digest.");
  }
  if (TERMINAL_MANUAL_STATES.has(attempt.state) && !attempt.manualReviewReason) {
    throw new Error(`${attempt.state} requires a manual-review reason.`);
  }
  if (
    attempt.state === "failed" && attempt.broadcastAttempted &&
    attempt.recoveryStatus !== "failed-consumed-nonce"
  ) {
    throw new Error("A broadcast failed transaction must record consumed-nonce recovery.");
  }
}

export function validateExact99JournalV2(value: Exact99JournalV2): Exact99JournalV2 {
  assertNoForbiddenJournalMaterial(value);
  if (value.journalSchemaVersion !== 2) throw new Error("Unsupported exact-99 journal schema.");
  assertUuid(value.setId, "journal.setId");
  assertUuid(value.storeId, "journal.storeId");
  assertUuid(value.runId, "journal.runId");
  assertDigest(value.manifestFingerprint, "journal.manifestFingerprint");
  assertTimestamp(value.createdAt, "journal.createdAt");
  assertTimestamp(value.updatedAt, "journal.updatedAt");
  assertInteger(value.revision, "journal.revision");
  if (value.revision !== value.entries.length) {
    throw new Error("Journal revision must equal its append-only entry count.");
  }
  const { checksum: ignored, ...withoutChecksum } = value;
  void ignored;
  if (journalChecksumValue(withoutChecksum) !== value.checksum) {
    throw new Error("Journal v2 checksum mismatch.");
  }
  const histories = new Map<string, Exact99JournalV2Attempt[]>();
  value.entries.forEach((entry, index) => {
    assertAttemptShape(entry);
    if (entry.sequence !== index + 1) throw new Error("Journal v2 sequence is not append-only.");
    if (
      entry.setId !== value.setId ||
      entry.storeId !== value.storeId ||
      entry.runId !== value.runId ||
      entry.manifestFingerprint !== value.manifestFingerprint
    ) {
      throw new Error("Journal attempt identity differs from journal identity.");
    }
    const history = histories.get(entry.attemptId) ?? [];
    const previous = history.at(-1);
    if (previous) {
      if (!TRANSITIONS[previous.state].has(entry.state)) {
        throw new Error(`Invalid forward transition ${previous.state} -> ${entry.state}.`);
      }
      for (const key of [
        "setId", "storeId", "runId", "manifestFingerprint", "checkpoint",
        "rangeStart", "rangeEnd", "walletIndex", "walletAddress", "operationId",
        "attemptId", "replacementOfAttemptId", "operationType", "signerRole",
        "chainId", "contractAddress", "tokenAddress", "target", "valueWei",
        "calldataDigest", "beforeStateDigest", "createdAt",
      ] as const) {
        if (entry[key] !== previous[key]) throw new Error(`Attempt immutable field changed: ${key}.`);
      }
      if (previous.nonce !== null && entry.nonce !== previous.nonce) {
        throw new Error("Attempt nonce cannot change.");
      }
      if (
        previous.signedTransactionHash !== null &&
        entry.signedTransactionHash !== previous.signedTransactionHash
      ) {
        throw new Error("Attempt signed transaction hash cannot change.");
      }
    } else if (entry.state !== "planned") {
      throw new Error("A new attempt must start in planned state.");
    }
    history.push(entry);
    histories.set(entry.attemptId, history);
  });

  const latest = [...histories.values()].map((history) => history.at(-1)!);
  for (const attempt of latest) {
    if (attempt.replacementOfAttemptId) {
      const original = latest.find((candidate) => candidate.attemptId === attempt.replacementOfAttemptId);
      if (!original || original.operationId !== attempt.operationId) {
        throw new Error("Replacement must link to an existing attempt for the same operation.");
      }
      if (attempt.nonce !== null && original.nonce !== null && attempt.nonce !== original.nonce) {
        throw new Error("Replacement must retain the original nonce.");
      }
    }
    if (attempt.nonce === null) continue;
    const duplicates = latest.filter((candidate) =>
      candidate.attemptId !== attempt.attemptId &&
      candidate.signerRole === attempt.signerRole &&
      candidate.walletAddress.toLowerCase() === attempt.walletAddress.toLowerCase() &&
      candidate.nonce === attempt.nonce);
    for (const duplicate of duplicates) {
      const linked =
        attempt.replacementOfAttemptId === duplicate.attemptId ||
        duplicate.replacementOfAttemptId === attempt.attemptId ||
        (attempt.replacementOfAttemptId !== null &&
          attempt.replacementOfAttemptId === duplicate.replacementOfAttemptId);
      if (!linked) throw new Error("Nonce reused by attempts without explicit replacement linkage.");
    }
  }
  return structuredClone(value);
}

export function appendPlannedExact99Attempt(
  journal: Exact99JournalV2,
  input: Exact99PlannedAttemptInput,
): Exact99JournalV2 {
  validateExact99JournalV2(journal);
  if (
    input.setId !== journal.setId || input.storeId !== journal.storeId ||
    input.runId !== journal.runId || input.manifestFingerprint !== journal.manifestFingerprint
  ) {
    throw new Error("Planned attempt identity differs from journal.");
  }
  if (input.walletIndex === EXACT_99_REJECTED_MANUAL_INDEX) {
    throw new Error("Wallet index 99 is outside every automatic protocol.");
  }
  const attempt: Exact99JournalV2Attempt = {
    sequence: journal.entries.length + 1,
    journalSchemaVersion: 2,
    setId: input.setId,
    storeId: input.storeId,
    runId: input.runId,
    manifestFingerprint: input.manifestFingerprint,
    checkpoint: input.checkpoint,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    walletIndex: input.walletIndex,
    walletAddress: input.walletAddress,
    operationId: input.operationId,
    attemptId: input.attemptId,
    replacementOfAttemptId: input.replacementOfAttemptId ?? null,
    operationType: input.operationType,
    signerRole: input.signerRole,
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    tokenAddress: input.tokenAddress ?? null,
    target: input.target,
    valueWei: input.valueWei,
    calldataDigest: input.calldataDigest,
    requestDigest: null,
    unsignedRequest: null,
    nonce: null,
    gasLimit: null,
    maxFeePerGasWei: null,
    maxPriorityFeePerGasWei: null,
    totalFeeCapWei: null,
    signedTransactionHash: null,
    rawTransactionCreated: false,
    broadcastAttempted: false,
    broadcastRpcIdentity: null,
    transportTransactionHash: null,
    blockNumber: null,
    blockHash: null,
    transactionIndex: null,
    receiptStatus: null,
    confirmationDepth: 0,
    finalityState: "unmined",
    semanticReconciliation: "not-run",
    beforeStateDigest: input.beforeStateDigest,
    afterStateDigest: null,
    canonicalRecheckEvidenceDigest: null,
    recoveryStatus: "clean",
    manualReviewReason: null,
    state: "planned",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    stateRecordedAt: input.timestamp,
  };
  assertAttemptShape(attempt);
  return validateExact99JournalV2(appendJournalEntry(journal, attempt, input.timestamp));
}

function latestAttempt(journal: Exact99JournalV2, attemptId: string): Exact99JournalV2Attempt {
  const attempt = journal.entries.filter((entry) => entry.attemptId === attemptId).at(-1);
  if (!attempt) throw new Error(`Attempt ${attemptId} does not exist.`);
  return attempt;
}

export function transitionExact99Attempt(
  journal: Exact99JournalV2,
  attemptId: string,
  nextState: Exact99JournalV2State,
  patch: Partial<Omit<Exact99JournalV2Attempt,
    "sequence" | "journalSchemaVersion" | "attemptId" | "state" | "createdAt" | "stateRecordedAt">>,
  timestamp: string,
): Exact99JournalV2 {
  validateExact99JournalV2(journal);
  assertTimestamp(timestamp, "transition timestamp");
  const previous = latestAttempt(journal, attemptId);
  if (!TRANSITIONS[previous.state].has(nextState)) {
    throw new Error(`Invalid forward transition ${previous.state} -> ${nextState}.`);
  }
  const next: Exact99JournalV2Attempt = {
    ...previous,
    ...patch,
    sequence: journal.entries.length + 1,
    journalSchemaVersion: 2,
    attemptId,
    state: nextState,
    createdAt: previous.createdAt,
    updatedAt: timestamp,
    stateRecordedAt: timestamp,
  };
  assertAttemptShape(next);
  return validateExact99JournalV2(appendJournalEntry(journal, next, timestamp));
}

export function createExact99ReplacementAttempt(input: {
  journal: Exact99JournalV2;
  originalAttemptId: string;
  newAttemptId: string;
  authorizationPhrase: string;
  timestamp: string;
}): Exact99JournalV2 {
  if (input.authorizationPhrase !== EXACT_99_REPLACEMENT_AUTHORIZATION) {
    throw new Error("Replacement requires explicit fixture authorization.");
  }
  const original = latestAttempt(input.journal, input.originalAttemptId);
  if (original.state !== "replaced") {
    throw new Error("Replacement requires the original attempt to be durably marked replaced.");
  }
  if (input.journal.entries.some((entry) => entry.attemptId === input.newAttemptId)) {
    throw new Error("Replacement attempt ID must be new.");
  }
  return appendPlannedExact99Attempt(input.journal, {
    setId: original.setId,
    storeId: original.storeId,
    runId: original.runId,
    manifestFingerprint: original.manifestFingerprint,
    checkpoint: original.checkpoint,
    rangeStart: original.rangeStart,
    rangeEnd: original.rangeEnd,
    walletIndex: original.walletIndex,
    walletAddress: original.walletAddress,
    operationId: original.operationId,
    attemptId: input.newAttemptId,
    replacementOfAttemptId: original.attemptId,
    operationType: original.operationType,
    signerRole: original.signerRole,
    chainId: original.chainId,
    contractAddress: original.contractAddress,
    tokenAddress: original.tokenAddress,
    target: original.target,
    valueWei: original.valueWei,
    calldataDigest: original.calldataDigest,
    beforeStateDigest: original.beforeStateDigest,
    timestamp: input.timestamp,
  });
}

function assertSnapshot(snapshot: Exact99DualSourceSnapshot, label: string): void {
  if (!snapshot.sourceId.trim() || /:\/\//.test(snapshot.sourceId)) {
    throw new Error(`${label}.sourceId must be a non-endpoint identity.`);
  }
  assertInteger(snapshot.blockNumber, `${label}.blockNumber`);
  assertHash(snapshot.blockHash, `${label}.blockHash`);
  assertHash(snapshot.parentHash, `${label}.parentHash`);
  assertTimestamp(snapshot.timestamp, `${label}.timestamp`);
  assertDigest(snapshot.contractCodeHash, `${label}.contractCodeHash`);
  assertDigest(snapshot.tokenCodeHash, `${label}.tokenCodeHash`);
  assertDigest(snapshot.abiDigest, `${label}.abiDigest`);
  assertDigest(snapshot.contractParametersDigest, `${label}.contractParametersDigest`);
  assertDigest(snapshot.operationStateDigest, `${label}.operationStateDigest`);
}

export function buildExact99DualSourceEvidence(input: {
  sourceA: Exact99DualSourceSnapshot | null;
  sourceB: Exact99DualSourceSnapshot | null;
  manifestIdentity: Exact99ManifestEvidenceIdentity;
}): Exact99DualSourceEvidence {
  if (!input.sourceA || !input.sourceB) throw new Error("Both fixture read sources are required.");
  assertSnapshot(input.sourceA, "sourceA");
  assertSnapshot(input.sourceB, "sourceB");
  const a = input.sourceA;
  const b = input.sourceB;
  if (a.sourceId === b.sourceId) throw new Error("Dual-source evidence requires two distinct sources.");
  for (const key of [
    "chainId", "blockNumber", "blockHash", "parentHash", "timestamp", "contractCodeHash",
    "tokenCodeHash", "abiDigest", "contractParametersDigest", "operationStateDigest",
  ] as const) {
    if (a[key] !== b[key]) throw new Error(`Dual-source mismatch at ${key}.`);
  }
  for (const key of [
    "chainId", "contractCodeHash", "tokenCodeHash", "abiDigest",
    "contractParametersDigest",
  ] as const) {
    if (a[key] !== input.manifestIdentity[key]) {
      throw new Error(`Fixture evidence does not match manifest identity at ${key}.`);
    }
  }
  return {
    sourceA: structuredClone(a),
    sourceB: structuredClone(b),
    evidenceDigest: exact99FixtureDigest({ sourceA: a, sourceB: b }),
  };
}

function unresolvedNonceTransaction(transaction: Exact99FixtureNonceTransaction): boolean {
  return transaction.state === "pending" || transaction.state === "dropped";
}

export function inspectExact99FixtureNonce(
  snapshot: Exact99FixtureNonceSnapshot,
): Exact99FixtureNonceDecision {
  assertAddress(snapshot.signerAddress, "nonce signerAddress");
  assertInteger(snapshot.latestNonce, "latestNonce");
  assertInteger(snapshot.pendingNonce, "pendingNonce");
  if (snapshot.pendingNonce < snapshot.latestNonce) {
    return {
      allowed: false, nonce: null, decision: "manual-review",
      reason: "pendingNonce is below latestNonce.",
      mutexNamespace: `${snapshot.signerRole}:${snapshot.signerAddress.toLowerCase()}`,
    };
  }
  const namespace = `${snapshot.signerRole}:${snapshot.signerAddress.toLowerCase()}`;
  const unresolved = snapshot.knownTransactions.filter(unresolvedNonceTransaction);
  if (unresolved.length > 1) {
    return {
      allowed: false, nonce: null, decision: "block-unresolved",
      reason: "More than one unresolved transaction exists for this signer.",
      mutexNamespace: namespace,
    };
  }
  const foreign = snapshot.knownTransactions.find((transaction) =>
    transaction.source === "external" &&
    (transaction.state === "pending" || transaction.state === "dropped"));
  if (foreign) {
    return {
      allowed: false, nonce: null, decision: "block-foreign-pending",
      reason: "A manual or foreign transaction occupies this signer nonce space.",
      mutexNamespace: namespace,
    };
  }
  const cancellation = snapshot.knownTransactions.find((transaction) =>
    transaction.state === "cancelled");
  if (cancellation) {
    return {
      allowed: false, nonce: null, decision: "block-cancellation",
      reason: "Cancellation evidence requires manual review.",
      mutexNamespace: namespace,
    };
  }
  const dropped = snapshot.knownTransactions.find((transaction) =>
    transaction.state === "dropped");
  if (dropped) {
    return {
      allowed: false, nonce: null, decision: "block-dropped",
      reason: "A dropped transaction is not proof that the nonce is reusable.",
      mutexNamespace: namespace,
    };
  }
  if (snapshot.latestNonce !== snapshot.pendingNonce) {
    const known = unresolved[0];
    if (
      known?.source === "journal" &&
      known.state === "pending" &&
      known.nonce === snapshot.latestNonce &&
      snapshot.pendingNonce === snapshot.latestNonce + 1 &&
      snapshot.journalExpectedNonce === known.nonce
    ) {
      return {
        allowed: false, nonce: known.nonce, decision: "wait-known-pending",
        reason: "Pending nonce exactly matches the journal; wait instead of creating another attempt.",
        mutexNamespace: namespace,
      };
    }
    return {
      allowed: false, nonce: null, decision: "block-foreign-pending",
      reason: "latestNonce and pendingNonce differ without an exact journal match.",
      mutexNamespace: namespace,
    };
  }
  if (
    snapshot.journalExpectedNonce !== null &&
    snapshot.journalExpectedNonce !== snapshot.pendingNonce
  ) {
    return {
      allowed: false, nonce: null, decision: "block-inconsistent-journal",
      reason: "Journal expected nonce differs from the fixture snapshot.",
      mutexNamespace: namespace,
    };
  }
  return {
    allowed: true,
    nonce: snapshot.pendingNonce,
    decision: "reserve-next",
    reason: "Fixture nonce is free and consistent.",
    mutexNamespace: namespace,
  };
}

export function evaluateExact99FixtureFeeGuard(input: {
  limits: Exact99FixtureFeeLimits;
  request: Exact99FixtureFeeRequest;
}): Exact99FixtureFeeDecision {
  const blockers: string[] = [];
  const { limits, request } = input;
  if (limits.fixtureOnly !== true || !limits.profileName.includes("fixture")) {
    blockers.push("Fee profile must be explicitly fixture-only.");
  }
  if (!request.estimationComplete || request.estimatedGasLimit === null ||
      request.gasLimit === null || request.maxFeePerGasWei === null ||
      request.maxPriorityFeePerGasWei === null || request.additionalLayerFeeCapWei === null) {
    return { allowed: false, totalFeeCapWei: null, blockers: [...blockers, "Fee estimation is incomplete."] };
  }
  if (request.requestedAutomaticCapIncrease) {
    blockers.push("Automatic fee cap increases are forbidden.");
  }
  const estimated = decimal(request.estimatedGasLimit, "estimatedGasLimit");
  const gasLimit = decimal(request.gasLimit, "gasLimit");
  const maxGas = decimal(limits.maxOperationGasLimit, "maxOperationGasLimit");
  const maxFee = decimal(request.maxFeePerGasWei, "maxFeePerGasWei");
  const maxPriority = decimal(request.maxPriorityFeePerGasWei, "maxPriorityFeePerGasWei");
  const allowedMaxFee = decimal(limits.maxFeePerGasWei, "limits.maxFeePerGasWei");
  const allowedPriority = decimal(limits.maxPriorityFeePerGasWei, "limits.maxPriorityFeePerGasWei");
  const layerFee = decimal(request.additionalLayerFeeCapWei, "additionalLayerFeeCapWei");
  if (!Number.isSafeInteger(limits.maxEstimationMultiplierBps) ||
      limits.maxEstimationMultiplierBps < 10_000) {
    blockers.push("Estimation multiplier is invalid.");
  } else if (gasLimit * 10_000n > estimated * BigInt(limits.maxEstimationMultiplierBps)) {
    blockers.push("Gas limit exceeds the approved estimation multiplier.");
  }
  if (gasLimit > maxGas) blockers.push("Operation gas limit cap exceeded.");
  if (maxFee > allowedMaxFee) blockers.push("Max fee per gas cap exceeded.");
  if (maxPriority > allowedPriority) blockers.push("Priority fee cap exceeded.");
  if (maxPriority > maxFee) blockers.push("Priority fee cannot exceed max fee.");
  const totalFeeCap = gasLimit * maxFee + layerFee;
  if (totalFeeCap > decimal(limits.maxOperationCostWei, "maxOperationCostWei")) {
    blockers.push("Operation cost cap exceeded.");
  }
  if (
    decimal(request.walletSpentWei, "walletSpentWei") + totalFeeCap >
    decimal(limits.maxWalletCostWei, "maxWalletCostWei")
  ) blockers.push("Wallet cumulative cost cap exceeded.");
  if (
    decimal(request.checkpointSpentWei, "checkpointSpentWei") + totalFeeCap >
    decimal(limits.maxCheckpointCostWei, "maxCheckpointCostWei")
  ) blockers.push("Checkpoint cost cap exceeded.");
  if (
    decimal(request.runSpentWei, "runSpentWei") + totalFeeCap >
    decimal(limits.maxRunCostWei, "maxRunCostWei")
  ) blockers.push("Run cost cap exceeded.");
  if (request.signerRole === "participant") {
    const participantReserve =
      decimal(limits.participantReserveWei, "participantReserveWei") +
      decimal(limits.laterClaimReserveWei ?? "0", "laterClaimReserveWei");
    if (decimal(request.walletBalanceWei, "walletBalanceWei") < totalFeeCap + participantReserve) {
      blockers.push("Participant reserve would be violated.");
    }
  } else if (
    decimal(request.signerBalanceWei, "signerBalanceWei") <
    totalFeeCap + decimal(limits.fundingSignerReserveWei, "fundingSignerReserveWei")
  ) {
    blockers.push("Funding signer reserve would be violated.");
  }
  return {
    allowed: blockers.length === 0,
    totalFeeCapWei: totalFeeCap.toString(),
    blockers,
  };
}

export class FixtureExact99GlobalRunLockRegistry {
  private readonly locksBySet = new Map<string, Exact99GlobalRunLock>();

  acquire(lock: Exact99GlobalRunLock, hook?: Exact99LockFaultHook): Exact99GlobalRunLock {
    hook?.("before-lock-acquire");
    const existing = this.locksBySet.get(lock.setId);
    if (existing) throw new Error("An exact-99 global run lock already exists for this set.");
    if (lock.state !== "active" || lock.manualReviewReason !== null) {
      throw new Error("A new global run lock must start active.");
    }
    assertUuid(lock.runId, "lock.runId");
    assertUuid(lock.setId, "lock.setId");
    assertUuid(lock.storeId, "lock.storeId");
    assertDigest(lock.manifestFingerprint, "lock.manifestFingerprint");
    assertDigest(lock.journalChecksum, "lock.journalChecksum");
    assertInteger(lock.journalRevision, "lock.journalRevision");
    assertInteger(lock.pid, "lock.pid", 1);
    assertTimestamp(lock.startedAt, "lock.startedAt");
    this.locksBySet.set(lock.setId, structuredClone(lock));
    hook?.("after-lock-acquire");
    return structuredClone(lock);
  }

  inspect(setId: string): Exact99GlobalRunLock | null {
    const lock = this.locksBySet.get(setId);
    return lock ? structuredClone(lock) : null;
  }

  update(input: {
    setId: string;
    runId: string;
    expectedJournalRevision: number;
    nextJournalChecksum: string;
    nextJournalRevision: number;
    checkpoint: string;
    signerRole: Exact99GlobalRunLock["signerRole"];
    walletIndex: number | null;
    operationId: string | null;
    hook?: Exact99LockFaultHook;
  }): Exact99GlobalRunLock {
    input.hook?.("before-lock-update");
    const lock = this.locksBySet.get(input.setId);
    if (!lock || lock.runId !== input.runId) throw new Error("Global run lock ownership mismatch.");
    if (lock.state !== "active") throw new Error("Global run lock is under manual review.");
    if (lock.journalRevision !== input.expectedJournalRevision) {
      throw new Error("Journal revision conflict under global run lock.");
    }
    assertDigest(input.nextJournalChecksum, "nextJournalChecksum");
    const next: Exact99GlobalRunLock = {
      ...lock,
      journalChecksum: input.nextJournalChecksum,
      journalRevision: input.nextJournalRevision,
      checkpoint: input.checkpoint,
      signerRole: input.signerRole,
      walletIndex: input.walletIndex,
      operationId: input.operationId,
    };
    this.locksBySet.set(input.setId, next);
    input.hook?.("after-lock-update");
    return structuredClone(next);
  }

  markStaleForManualReview(setId: string, reason: string): Exact99GlobalRunLock {
    const lock = this.locksBySet.get(setId);
    if (!lock) throw new Error("Global run lock does not exist.");
    if (!reason.trim()) throw new Error("Stale lock review requires a reason.");
    const next: Exact99GlobalRunLock = {
      ...lock,
      state: "manual-review",
      manualReviewReason: reason,
    };
    this.locksBySet.set(setId, next);
    return structuredClone(next);
  }

  takeOver(input: {
    setId: string;
    authorizationPhrase: string;
    replacement: Exact99GlobalRunLock;
  }): Exact99GlobalRunLock {
    const existing = this.locksBySet.get(input.setId);
    if (!existing || existing.state !== "manual-review") {
      throw new Error("Only a reviewed stale lock may be taken over.");
    }
    if (input.authorizationPhrase !== EXACT_99_STALE_LOCK_TAKEOVER_AUTHORIZATION) {
      throw new Error("Stale lock takeover requires explicit authorization.");
    }
    if (
      input.replacement.setId !== existing.setId ||
      input.replacement.storeId !== existing.storeId ||
      input.replacement.manifestFingerprint !== existing.manifestFingerprint
    ) throw new Error("Stale lock takeover cannot change artifact identity.");
    this.locksBySet.set(input.setId, structuredClone(input.replacement));
    return structuredClone(input.replacement);
  }

  release(input: {
    setId: string;
    runId: string;
    expectedJournalChecksum: string;
    expectedJournalRevision: number;
    hook?: Exact99LockFaultHook;
  }): void {
    input.hook?.("before-lock-release");
    const lock = this.locksBySet.get(input.setId);
    if (!lock || lock.runId !== input.runId) throw new Error("Global run lock ownership mismatch.");
    if (
      lock.journalChecksum !== input.expectedJournalChecksum ||
      lock.journalRevision !== input.expectedJournalRevision
    ) throw new Error("Artifact revision conflict prevents lock release.");
    this.locksBySet.delete(input.setId);
    input.hook?.("after-lock-release");
  }
}

export function assessExact99FixtureFinality(input: {
  policy: Exact99FinalityPolicy;
  observation: Exact99FinalityObservation;
}): Exact99FinalityAssessment {
  const { policy, observation } = input;
  if (
    policy.fixtureOnly !== true ||
    !Number.isSafeInteger(policy.requiredConfirmationDepth) ||
    policy.requiredConfirmationDepth < 1 ||
    !Number.isSafeInteger(policy.checkpointFinalConfirmationDepth) ||
    policy.checkpointFinalConfirmationDepth < policy.requiredConfirmationDepth
  ) throw new Error("Fixture finality policy is invalid.");
  const confirmationDepth = Math.max(0, observation.headBlockNumber - observation.recordedBlockNumber + 1);
  const missing = !observation.receiptFoundBySourceA || !observation.receiptFoundBySourceB;
  const moved =
    observation.blockNumberBySourceA !== observation.recordedBlockNumber ||
    observation.blockNumberBySourceB !== observation.recordedBlockNumber;
  const changed =
    observation.blockHashBySourceA !== observation.recordedBlockHash ||
    observation.blockHashBySourceB !== observation.recordedBlockHash;
  if (missing || moved || changed) {
    return {
      finalityState: "reorged",
      confirmationDepth,
      mayConfirm: false,
      mayFinalizeCheckpoint: false,
      reorgDetected: true,
      reason: missing
        ? "Receipt disappeared from at least one fixture source."
        : moved
          ? "Transaction moved to a different block."
          : "Canonical block hash changed.",
    };
  }
  if (observation.semanticReconciliation !== "matched") {
    return {
      finalityState: "canonical",
      confirmationDepth,
      mayConfirm: false,
      mayFinalizeCheckpoint: false,
      reorgDetected: false,
      reason: "Canonical receipt exists but semantic reconciliation is not matched.",
    };
  }
  const mayConfirm = confirmationDepth >= policy.requiredConfirmationDepth;
  const mayFinalizeCheckpoint =
    mayConfirm &&
    observation.checkpointRecheck &&
    confirmationDepth >= policy.checkpointFinalConfirmationDepth;
  return {
    finalityState: mayFinalizeCheckpoint
      ? "checkpoint-final"
      : mayConfirm ? "confirmed" : "canonical",
    confirmationDepth,
    mayConfirm,
    mayFinalizeCheckpoint,
    reorgDetected: false,
    reason: mayFinalizeCheckpoint
      ? "Checkpoint threshold and canonical recheck are satisfied."
      : mayConfirm
        ? "Confirmation threshold is satisfied; checkpoint finality still requires its recheck."
        : "Waiting for the configured fixture confirmation threshold.",
  };
}

export function inspectExact99Recovery(input: {
  attempt: Exact99JournalV2Attempt;
  evidence: Exact99RecoveryEvidence;
}): Exact99RecoveryDecision {
  const { attempt, evidence } = input;
  if (attempt.state === "replaced") return "investigate-replacement";
  if (attempt.state === "cancelled") return "investigate-cancellation";
  if (attempt.state === "reorged" || evidence.finalityAssessment?.reorgDetected) {
    return "investigate-reorg";
  }
  if (attempt.state === "ambiguous") return "ambiguous";
  if (attempt.state === "manual-review") return "manual-review";
  if (attempt.state === "failed") {
    return attempt.broadcastAttempted ? "failed-consumed-nonce" : "do-not-retry";
  }
  if (attempt.state === "planned" || attempt.state === "prepared") return "safe-to-prepare";
  if (attempt.state === "nonce-reserved") return "manual-review";
  if (attempt.state === "signed") {
    if (evidence.broadcastMayHaveOccurred ||
        evidence.transportLookup === "not-found-one-source") return "ambiguous";
    if (evidence.transportLookup === "found-mined") return "reconcile-mined";
    if (evidence.transportLookup === "found-pending") return "wait-pending";
    return "safe-to-broadcast-signed-transaction";
  }
  if (attempt.state === "broadcast-attempted" || attempt.state === "pending") {
    if (evidence.transportLookup === "found-mined") return "reconcile-mined";
    if (evidence.transportLookup === "found-pending") return "wait-pending";
    return "ambiguous";
  }
  if (attempt.state === "mined" || attempt.state === "reconciling") {
    if (evidence.receiptStatus === 0) return "failed-consumed-nonce";
    if (evidence.semanticReconciliation !== "matched") return "reconcile-mined";
    if (!evidence.finalityAssessment?.mayConfirm) return "wait-confirmations";
    return evidence.finalityAssessment.mayFinalizeCheckpoint ? "checkpoint-final" : "confirmed";
  }
  if (attempt.state === "confirmed") {
    return evidence.finalityAssessment?.mayFinalizeCheckpoint ? "checkpoint-final" : "confirmed";
  }
  return "checkpoint-final";
}

export function evaluateExact99Boundary99(input: Exact99Boundary99Input): Exact99Boundary99Decision {
  const blockers: string[] = [];
  if (input.walletIndex === EXACT_99_REJECTED_MANUAL_INDEX) {
    blockers.push("Index 99 is rejected by boundary mode.");
  }
  if (input.walletIndex !== EXACT_99_BOUNDARY_INDEX) blockers.push("Boundary mode only accepts index 98.");
  if (input.authorizationPhrase !== EXACT_99_BOUNDARY_AUTHORIZATION) {
    blockers.push("Boundary authorization phrase is missing.");
  }
  if (input.threatAcknowledgment !== EXACT_99_BOUNDARY_THREAT_ACKNOWLEDGMENT) {
    blockers.push("Boundary threat acknowledgment is missing.");
  }
  if (input.activePositionCount !== 98) blockers.push("Boundary mode requires exactly 98 positions.");
  if (input.expectedPoolAmount !== input.observedPoolAmount) blockers.push("Pool amount is inconsistent.");
  if (input.poolStatus !== "Open") blockers.push("Pool must remain Open.");
  if (input.lockedAt !== "0") blockers.push("lockedAt must equal zero before boundary-99.");
  if (input.escrowExpected !== input.escrowObserved) blockers.push("Escrow is inconsistent.");
  if (input.foreignEventSinceCheckpoint) blockers.push("A foreign event appeared after the checkpoint.");
  if (!input.piotrWalletReady) blockers.push("Piotr wallet is not ready for the future manual 100th join.");
  if (!input.participantNonceDecision.allowed || input.participantNonceDecision.nonce === null) {
    blockers.push("Participant nonce is not available.");
  }
  if (input.pendingTransaction) blockers.push("A pending transaction exists.");
  if (input.previouslyUsedSnapshotIds.includes(input.snapshotId)) {
    blockers.push("Boundary snapshot cannot be reused.");
  }
  const ageSeconds = (Date.parse(input.evaluatedAt) - Date.parse(input.snapshotCreatedAt)) / 1_000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > input.maximumSnapshotAgeSeconds) {
    blockers.push("Boundary snapshot is stale.");
  }
  if (
    input.beforeEvidence.sourceA.blockNumber !== input.afterEvidence.sourceA.blockNumber ||
    input.beforeEvidence.sourceA.blockHash !== input.afterEvidence.sourceA.blockHash ||
    input.beforeEvidence.evidenceDigest !== input.afterEvidence.evidenceDigest
  ) {
    blockers.push("External state changed between the two boundary fixture snapshots.");
  }
  const oneUseSnapshotDigest = blockers.length === 0
    ? exact99FixtureDigest({
        snapshotId: input.snapshotId,
        evidenceDigest: input.beforeEvidence.evidenceDigest,
        walletIndex: input.walletIndex,
        activePositionCount: input.activePositionCount,
        evaluatedAt: input.evaluatedAt,
      })
    : null;
  return {
    allowed: blockers.length === 0,
    mode: "boundary-99",
    walletIndex: 98,
    nextStage: blockers.length === 0 ? "awaiting-manual-100" : "blocked",
    oneUseSnapshotDigest,
    blockers,
  };
}

export const EXACT_99_PUBLIC_ACCUMULATION_RANGES = [
  { checkpoint: "checkpoint-5", startIndex: 0, endIndex: 4, targetPositionCount: 5 },
  { checkpoint: "checkpoint-20", startIndex: 5, endIndex: 19, targetPositionCount: 20 },
  { checkpoint: "checkpoint-50", startIndex: 20, endIndex: 49, targetPositionCount: 50 },
  { checkpoint: "checkpoint-99-normal", startIndex: 50, endIndex: 97, targetPositionCount: 98 },
  { checkpoint: "boundary-99", startIndex: 98, endIndex: 98, targetPositionCount: 99 },
] as const;

export function buildExact99UnsignedRequest(input: Exact99UnsignedTransactionRequest): {
  request: Exact99UnsignedTransactionRequest;
  requestDigest: string;
} {
  assertAddress(input.target, "unsignedRequest.target");
  assertDigest(input.calldataDigest, "unsignedRequest.calldataDigest");
  assertInteger(input.nonce, "unsignedRequest.nonce");
  for (const [label, value] of [
    ["valueWei", input.valueWei],
    ["gasLimit", input.gasLimit],
    ["maxFeePerGasWei", input.maxFeePerGasWei],
    ["maxPriorityFeePerGasWei", input.maxPriorityFeePerGasWei],
    ["totalFeeCapWei", input.totalFeeCapWei],
  ] as const) assertDecimal(value, `unsignedRequest.${label}`);
  return {
    request: structuredClone(input),
    requestDigest: exact99FixtureDigest(input),
  };
}

export function deriveExact99FixtureCheckpointUpdate(
  attempt: Exact99JournalV2Attempt,
): {
  derivedOnly: true;
  operationId: string;
  attemptId: string;
  walletIndex: number;
  transactionHash: string;
  blockNumber: number;
  journalSequence: number;
  evidenceDigest: string;
} {
  if (
    attempt.state !== "checkpoint-final" ||
    !attempt.transportTransactionHash ||
    attempt.blockNumber === null ||
    !attempt.canonicalRecheckEvidenceDigest
  ) throw new Error("Only a checkpoint-final attempt can derive a checkpoint update.");
  return {
    derivedOnly: true,
    operationId: attempt.operationId,
    attemptId: attempt.attemptId,
    walletIndex: attempt.walletIndex,
    transactionHash: attempt.transportTransactionHash,
    blockNumber: attempt.blockNumber,
    journalSequence: attempt.sequence,
    evidenceDigest: attempt.canonicalRecheckEvidenceDigest,
  };
}
