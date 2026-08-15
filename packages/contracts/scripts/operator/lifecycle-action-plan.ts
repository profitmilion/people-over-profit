import { createHash } from "node:crypto";

import { getAddress, isAddress } from "viem";

import {
  isSnapshotSourceIdentifier,
  type NextAction,
  type PoolPlan,
  type PoolSnapshot,
  type SnapshotSource,
  type SupervisorReport,
  type SystemSnapshot,
} from "./lifecycle-supervisor.js";

export const LIFECYCLE_ACTION_PLAN_FORMAT_VERSION = 1 as const;
export const LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE =
  "Pop33BasicV1:src/demo-v1/abi:v1";
export const DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS = 7_200n;

export const LIFECYCLE_REVALIDATION_EXIT_CODES = Object.freeze({
  VALID: 0,
  STALE: 10,
  BLOCKED: 11,
  INCOMPLETE: 12,
  INVALID_PLAN: 13,
  RPC_FAILURE: 14,
});

export type LifecyclePlanClassification =
  | "informational"
  | "actionable"
  | "blocked"
  | "invalid";
export type LifecyclePlannedAction =
  | "WAIT"
  | "DRAW"
  | "CLAIM_MONITORING"
  | "COMPLETE"
  | "NONE";
export type LifecycleRevalidationStatus =
  | "VALID"
  | "STALE"
  | "BLOCKED"
  | "INCOMPLETE"
  | "INVALID_PLAN";
export type LifecycleChangeSeverity = "info" | "warning" | "critical";

export interface LifecyclePlanAssumptions {
  snapshotComplete: boolean;
  activePositionCount: string | null;
  maxPositionCount: string | null;
  drawRoundCount: string | null;
  completedDrawRoundCount: string | null;
  claimedPrizeCount: string | null;
  escrowedAmount: string | null;
  assignedPrizeAmount: string | null;
  claimedPrizeAmount: string | null;
  nextRoundScheduledAt: string | null;
  nextRoundStatus: string | null;
  nextRoundWinningPositionId: string | null;
  nextRoundClaimed: boolean | null;
}

export interface LifecycleActionPlan {
  formatVersion: typeof LIFECYCLE_ACTION_PLAN_FORMAT_VERSION;
  planId: string;
  fingerprint: string;
  createdAt: string;
  source: {
    type: SnapshotSource;
    reference: string;
  };
  identity: {
    chainId: string;
    contractAddress: string;
    contractInterface: string;
    baseBlockNumber: string;
    baseBlockTimestamp: string;
  };
  scope: {
    poolId: string;
    expectedPoolStatus: string;
    supervisorAction: NextAction;
    supervisorReasonCode: string;
    classification: LifecyclePlanClassification;
    plannedAction: LifecyclePlannedAction;
    roundNumber: string | null;
    winningPositionId: string | null;
  };
  assumptions: LifecyclePlanAssumptions;
}

export interface LifecyclePlanChange {
  field: string;
  expected: string | boolean | null;
  actual: string | boolean | null;
  severity: LifecycleChangeSeverity;
  explanation: string;
}

export interface LifecycleRevalidationResult {
  status: LifecycleRevalidationStatus;
  reasonCode: string;
  planId: string | null;
  poolId: string | null;
  baseBlockNumber: string | null;
  freshBlockNumber: string | null;
  checkedAt: string | null;
  changes: readonly LifecyclePlanChange[];
  decision: string;
}

export interface LifecycleActionPlanOptions {
  sourceReference?: string;
  contractInterface?: string;
}

export interface LifecycleRevalidationOptions {
  maxPlanAgeSeconds?: bigint;
  freshSourceReference?: string;
  contractInterface?: string;
}

export type LifecycleActionPlanParseResult =
  | { ok: true; plan: LifecycleActionPlan }
  | { ok: false; errors: readonly string[] };

const DECIMAL = /^(?:0|[1-9]\d*)$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const PLAN_ID = /^lifecycle-plan:[0-9a-f]{64}$/;
const NEXT_ACTIONS = new Set<NextAction>([
  "WAITING_FOR_PARTICIPANTS",
  "WAITING_FOR_FIRST_DRAW",
  "WAITING_FOR_NEXT_DRAW",
  "DRAW_DUE",
  "DRAW_OVERDUE",
  "CLAIMS_OUTSTANDING",
  "FINISHED",
  "INCONSISTENT_STATE",
  "NO_ACTION",
]);
const CLASSIFICATIONS = new Set<LifecyclePlanClassification>([
  "informational",
  "actionable",
  "blocked",
  "invalid",
]);
const PLANNED_ACTIONS = new Set<LifecyclePlannedAction>([
  "WAIT",
  "DRAW",
  "CLAIM_MONITORING",
  "COMPLETE",
  "NONE",
]);

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON does not support non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalValue(nested)}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON does not support ${typeof value}.`);
}

export function canonicalizeLifecyclePlanValue(value: unknown): string {
  return canonicalValue(value);
}

function integrityPayload(plan: LifecycleActionPlan): Omit<
  LifecycleActionPlan,
  "planId" | "fingerprint"
> {
  return Object.fromEntries(
    Object.entries(plan).filter(([key]) =>
      key !== "planId" && key !== "fingerprint"),
  ) as Omit<LifecycleActionPlan, "planId" | "fingerprint">;
}

function integrityDigest(plan: LifecycleActionPlan): string {
  return createHash("sha256")
    .update(canonicalValue(integrityPayload(plan)), "utf8")
    .digest("hex");
}

export function computeLifecycleActionPlanFingerprint(
  plan: LifecycleActionPlan,
): string {
  return `sha256:${integrityDigest(plan)}`;
}

function expectedPlanId(plan: LifecycleActionPlan): string {
  return `lifecycle-plan:${integrityDigest(plan)}`;
}

function decimal(value: bigint | undefined | null): string | null {
  return value === undefined || value === null ? null : value.toString();
}

function snapshotIsComplete(snapshot: SystemSnapshot): boolean {
  return snapshot.metadata?.snapshotComplete ?? true;
}

function relevantRound(pool: PoolSnapshot, plan: PoolPlan) {
  if (plan.nextRoundNumber === null) return undefined;
  return pool.rounds.find((round) => round.number === plan.nextRoundNumber);
}

function classify(plan: PoolPlan, complete: boolean): {
  classification: LifecyclePlanClassification;
  plannedAction: LifecyclePlannedAction;
} {
  if (!complete) return { classification: "invalid", plannedAction: "NONE" };
  if (plan.nextAction === "INCONSISTENT_STATE") {
    return { classification: "blocked", plannedAction: "NONE" };
  }
  if (plan.nextAction === "DRAW_DUE" || plan.nextAction === "DRAW_OVERDUE") {
    return { classification: "actionable", plannedAction: "DRAW" };
  }
  if (
    plan.nextAction === "WAITING_FOR_PARTICIPANTS" ||
    plan.nextAction === "WAITING_FOR_FIRST_DRAW" ||
    plan.nextAction === "WAITING_FOR_NEXT_DRAW"
  ) {
    return { classification: "informational", plannedAction: "WAIT" };
  }
  if (plan.nextAction === "CLAIMS_OUTSTANDING") {
    return {
      classification: "informational",
      plannedAction: "CLAIM_MONITORING",
    };
  }
  if (plan.nextAction === "FINISHED") {
    return { classification: "informational", plannedAction: "COMPLETE" };
  }
  return { classification: "informational", plannedAction: "NONE" };
}

export function createLifecycleActionPlan(
  snapshot: SystemSnapshot,
  report: SupervisorReport,
  poolId: bigint,
  options: LifecycleActionPlanOptions = {},
): LifecycleActionPlan {
  if (snapshot.blockNumber === null) {
    throw new Error("A lifecycle action plan requires a concrete base block number.");
  }
  const pool = snapshot.pools.find((candidate) => candidate.poolId === poolId);
  const supervisorPlan = report.plans.find((candidate) => candidate.poolId === poolId);
  if (!pool || !supervisorPlan) {
    throw new Error(`Pool ${poolId} is absent from the snapshot or supervisor report.`);
  }
  if (!isAddress(snapshot.contractAddress)) {
    throw new Error("Snapshot contract address must be a valid EVM address.");
  }
  const complete = snapshotIsComplete(snapshot) &&
    report.systemDiagnostics.length === 0 &&
    !incompleteDiagnostics(report);
  const round = relevantRound(pool, supervisorPlan);
  const classification = classify(supervisorPlan, complete);
  const draft: LifecycleActionPlan = {
    formatVersion: LIFECYCLE_ACTION_PLAN_FORMAT_VERSION,
    planId: "",
    fingerprint: "",
    createdAt: snapshot.observedAt.toString(),
    source: {
      type: snapshot.source,
      reference: options.sourceReference ?? snapshot.source,
    },
    identity: {
      chainId: snapshot.chainId.toString(),
      contractAddress: getAddress(snapshot.contractAddress),
      contractInterface:
        options.contractInterface ?? LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
      baseBlockNumber: snapshot.blockNumber.toString(),
      baseBlockTimestamp: snapshot.observedAt.toString(),
    },
    scope: {
      poolId: poolId.toString(),
      expectedPoolStatus: pool.status,
      supervisorAction: supervisorPlan.nextAction,
      supervisorReasonCode: supervisorPlan.reasonCode,
      ...classification,
      roundNumber: decimal(supervisorPlan.nextRoundNumber),
      winningPositionId: decimal(round?.winningPositionId),
    },
    assumptions: {
      snapshotComplete: complete,
      activePositionCount: decimal(pool.activePositionCount),
      maxPositionCount: decimal(pool.maxPositionCount),
      drawRoundCount: decimal(pool.drawRoundCount),
      completedDrawRoundCount: decimal(pool.completedDrawRoundCount),
      claimedPrizeCount: decimal(pool.claimedPrizeCount),
      escrowedAmount: decimal(pool.escrowedAmount),
      assignedPrizeAmount: decimal(pool.assignedPrizeAmount),
      claimedPrizeAmount: decimal(pool.claimedPrizeAmount),
      nextRoundScheduledAt: decimal(round?.scheduledAt),
      nextRoundStatus: round?.status ?? null,
      nextRoundWinningPositionId: decimal(round?.winningPositionId),
      nextRoundClaimed: round?.claimed ?? null,
    },
  };
  const digest = integrityDigest(draft);
  return {
    ...draft,
    planId: `lifecycle-plan:${digest}`,
    fingerprint: `sha256:${digest}`,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireString(
  object: Record<string, unknown> | null,
  key: string,
  path: string,
  errors: string[],
): string {
  const value = object?.[key];
  if (typeof value !== "string") {
    errors.push(`${path}.${key} must be a string.`);
    return "";
  }
  return value;
}

function requireDecimal(
  object: Record<string, unknown> | null,
  key: string,
  path: string,
  errors: string[],
  nullable = false,
): string | null {
  const value = object?.[key];
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    errors.push(`${path}.${key} must be an unsigned decimal string${nullable ? " or null" : ""}.`);
    return nullable ? null : "";
  }
  return value;
}

function requireBoolean(
  object: Record<string, unknown> | null,
  key: string,
  path: string,
  errors: string[],
  nullable = false,
): boolean | null {
  const value = object?.[key];
  if (nullable && value === null) return null;
  if (typeof value !== "boolean") {
    errors.push(`${path}.${key} must be a boolean${nullable ? " or null" : ""}.`);
    return nullable ? null : false;
  }
  return value;
}

function requireExactKeys(
  object: Record<string, unknown> | null,
  path: string,
  keys: readonly string[],
  errors: string[],
): void {
  if (!object) return;
  const expected = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!expected.has(key)) errors.push(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!(key in object)) errors.push(`${path}.${key} is required.`);
  }
}

function parseLifecycleActionPlan(value: unknown): LifecycleActionPlanParseResult {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { ok: false, errors: ["Plan root must be a JSON object."] };
  if (root.formatVersion !== LIFECYCLE_ACTION_PLAN_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${LIFECYCLE_ACTION_PLAN_FORMAT_VERSION}.`);
  }
  const source = record(root.source);
  const identity = record(root.identity);
  const scope = record(root.scope);
  const assumptions = record(root.assumptions);
  if (!source) errors.push("source must be an object.");
  if (!identity) errors.push("identity must be an object.");
  if (!scope) errors.push("scope must be an object.");
  if (!assumptions) errors.push("assumptions must be an object.");
  requireExactKeys(
    root,
    "plan",
    [
      "formatVersion",
      "planId",
      "fingerprint",
      "createdAt",
      "source",
      "identity",
      "scope",
      "assumptions",
    ],
    errors,
  );
  requireExactKeys(source, "source", ["type", "reference"], errors);
  requireExactKeys(
    identity,
    "identity",
    [
      "chainId",
      "contractAddress",
      "contractInterface",
      "baseBlockNumber",
      "baseBlockTimestamp",
    ],
    errors,
  );
  requireExactKeys(
    scope,
    "scope",
    [
      "poolId",
      "expectedPoolStatus",
      "supervisorAction",
      "supervisorReasonCode",
      "classification",
      "plannedAction",
      "roundNumber",
      "winningPositionId",
    ],
    errors,
  );
  requireExactKeys(
    assumptions,
    "assumptions",
    [
      "snapshotComplete",
      "activePositionCount",
      "maxPositionCount",
      "drawRoundCount",
      "completedDrawRoundCount",
      "claimedPrizeCount",
      "escrowedAmount",
      "assignedPrizeAmount",
      "claimedPrizeAmount",
      "nextRoundScheduledAt",
      "nextRoundStatus",
      "nextRoundWinningPositionId",
      "nextRoundClaimed",
    ],
    errors,
  );

  const sourceType = requireString(source, "type", "source", errors);
  const classification = requireString(
    scope,
    "classification",
    "scope",
    errors,
  );
  const plannedAction = requireString(scope, "plannedAction", "scope", errors);
  const supervisorAction = requireString(
    scope,
    "supervisorAction",
    "scope",
    errors,
  );
  if (!isSnapshotSourceIdentifier(sourceType)) {
    errors.push("source.type is invalid.");
  }
  if (!CLASSIFICATIONS.has(classification as LifecyclePlanClassification)) {
    errors.push("scope.classification is unsupported.");
  }
  if (!PLANNED_ACTIONS.has(plannedAction as LifecyclePlannedAction)) {
    errors.push("scope.plannedAction is unsupported.");
  }
  if (!NEXT_ACTIONS.has(supervisorAction as NextAction)) {
    errors.push("scope.supervisorAction is unsupported.");
  }

  const contractAddress = requireString(
    identity,
    "contractAddress",
    "identity",
    errors,
  );
  if (!isAddress(contractAddress)) {
    errors.push("identity.contractAddress must be a valid EVM address.");
  }

  const candidate = {
    formatVersion: LIFECYCLE_ACTION_PLAN_FORMAT_VERSION,
    planId: requireString(root, "planId", "plan", errors),
    fingerprint: requireString(root, "fingerprint", "plan", errors),
    createdAt: requireDecimal(root, "createdAt", "plan", errors) ?? "",
    source: {
      type: sourceType as SnapshotSource,
      reference: requireString(source, "reference", "source", errors),
    },
    identity: {
      chainId: requireDecimal(identity, "chainId", "identity", errors) ?? "",
      contractAddress,
      contractInterface: requireString(
        identity,
        "contractInterface",
        "identity",
        errors,
      ),
      baseBlockNumber:
        requireDecimal(identity, "baseBlockNumber", "identity", errors) ?? "",
      baseBlockTimestamp:
        requireDecimal(identity, "baseBlockTimestamp", "identity", errors) ?? "",
    },
    scope: {
      poolId: requireDecimal(scope, "poolId", "scope", errors) ?? "",
      expectedPoolStatus: requireString(
        scope,
        "expectedPoolStatus",
        "scope",
        errors,
      ),
      supervisorAction: supervisorAction as NextAction,
      supervisorReasonCode: requireString(
        scope,
        "supervisorReasonCode",
        "scope",
        errors,
      ),
      classification: classification as LifecyclePlanClassification,
      plannedAction: plannedAction as LifecyclePlannedAction,
      roundNumber: requireDecimal(scope, "roundNumber", "scope", errors, true),
      winningPositionId: requireDecimal(
        scope,
        "winningPositionId",
        "scope",
        errors,
        true,
      ),
    },
    assumptions: {
      snapshotComplete:
        requireBoolean(assumptions, "snapshotComplete", "assumptions", errors) ?? false,
      activePositionCount: requireDecimal(
        assumptions,
        "activePositionCount",
        "assumptions",
        errors,
        true,
      ),
      maxPositionCount: requireDecimal(
        assumptions,
        "maxPositionCount",
        "assumptions",
        errors,
        true,
      ),
      drawRoundCount: requireDecimal(
        assumptions,
        "drawRoundCount",
        "assumptions",
        errors,
        true,
      ),
      completedDrawRoundCount: requireDecimal(
        assumptions,
        "completedDrawRoundCount",
        "assumptions",
        errors,
        true,
      ),
      claimedPrizeCount: requireDecimal(
        assumptions,
        "claimedPrizeCount",
        "assumptions",
        errors,
        true,
      ),
      escrowedAmount: requireDecimal(
        assumptions,
        "escrowedAmount",
        "assumptions",
        errors,
        true,
      ),
      assignedPrizeAmount: requireDecimal(
        assumptions,
        "assignedPrizeAmount",
        "assumptions",
        errors,
        true,
      ),
      claimedPrizeAmount: requireDecimal(
        assumptions,
        "claimedPrizeAmount",
        "assumptions",
        errors,
        true,
      ),
      nextRoundScheduledAt: requireDecimal(
        assumptions,
        "nextRoundScheduledAt",
        "assumptions",
        errors,
        true,
      ),
      nextRoundStatus: assumptions?.nextRoundStatus === null
        ? null
        : requireString(assumptions, "nextRoundStatus", "assumptions", errors),
      nextRoundWinningPositionId: requireDecimal(
        assumptions,
        "nextRoundWinningPositionId",
        "assumptions",
        errors,
        true,
      ),
      nextRoundClaimed: requireBoolean(
        assumptions,
        "nextRoundClaimed",
        "assumptions",
        errors,
        true,
      ),
    },
  } satisfies LifecycleActionPlan;

  if (candidate.identity.chainId === "0") errors.push("identity.chainId must be positive.");
  if (candidate.identity.baseBlockNumber === "0") {
    errors.push("identity.baseBlockNumber must be positive.");
  }
  if (candidate.scope.poolId === "0") errors.push("scope.poolId must be positive.");
  if (candidate.createdAt !== candidate.identity.baseBlockTimestamp) {
    errors.push("createdAt must equal identity.baseBlockTimestamp.");
  }
  if (!SHA256.test(candidate.fingerprint)) {
    errors.push("fingerprint must be a lowercase SHA-256 value.");
  }
  if (!PLAN_ID.test(candidate.planId)) {
    errors.push("planId must be a lifecycle plan identifier.");
  }
  if (errors.length === 0) {
    if (computeLifecycleActionPlanFingerprint(candidate) !== candidate.fingerprint) {
      errors.push("fingerprint does not match the canonical plan payload.");
    }
    if (expectedPlanId(candidate) !== candidate.planId) {
      errors.push("planId does not match the canonical plan payload.");
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, plan: candidate };
}

export function parseLifecycleActionPlanJson(
  json: string,
): LifecycleActionPlanParseResult {
  try {
    return parseLifecycleActionPlan(JSON.parse(json) as unknown);
  } catch {
    return { ok: false, errors: ["Plan file is not valid JSON."] };
  }
}

export function serializeLifecycleActionPlan(plan: LifecycleActionPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function change(
  changes: LifecyclePlanChange[],
  field: string,
  expected: string | boolean | null,
  actual: string | boolean | null,
  severity: LifecycleChangeSeverity,
  explanation: string,
): void {
  if (expected === actual) return;
  changes.push({ field, expected, actual, severity, explanation });
}

function invalidResult(errors: readonly string[]): LifecycleRevalidationResult {
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
      expected: "valid canonical lifecycle plan",
      actual: error,
      severity: "critical",
      explanation: "The saved plan cannot be trusted or safely revalidated.",
    })),
    decision: "Do not use the saved plan. Create a new plan from a complete snapshot.",
  };
}

export function invalidLifecycleActionPlanResult(
  errors: readonly string[],
): LifecycleRevalidationResult {
  return invalidResult(errors);
}

function result(
  status: LifecycleRevalidationStatus,
  reasonCode: string,
  plan: LifecycleActionPlan,
  snapshot: SystemSnapshot,
  changes: readonly LifecyclePlanChange[],
): LifecycleRevalidationResult {
  const decisions: Record<LifecycleRevalidationStatus, string> = {
    VALID: "The saved plan still matches the fresh read-only snapshot.",
    STALE: "Do not use the saved plan. Generate a new plan from the fresh snapshot.",
    BLOCKED: "Do not use the saved plan. Resolve the critical condition and re-read state.",
    INCOMPLETE: "Do not use the saved plan. Obtain a complete fresh snapshot.",
    INVALID_PLAN: "Do not use the saved plan. Create a new canonical plan.",
  };
  return {
    status,
    reasonCode,
    planId: plan.planId,
    poolId: plan.scope.poolId,
    baseBlockNumber: plan.identity.baseBlockNumber,
    freshBlockNumber: decimal(snapshot.blockNumber),
    checkedAt: snapshot.observedAt.toString(),
    changes,
    decision: decisions[status],
  };
}

function incompleteDiagnostics(report: SupervisorReport): boolean {
  const codes = [
    ...report.systemDiagnostics.map((entry) => entry.code),
    ...report.plans.flatMap((plan) => plan.diagnostics.map((entry) => entry.code)),
  ];
  return codes.some((code) =>
    /MISSING|INCOMPLETE|PARTIAL|DECODE|BYTECODE|BLOCK_NUMBER/.test(code));
}

function currentAssumptions(
  snapshot: SystemSnapshot,
  pool: PoolSnapshot,
  supervisorPlan: PoolPlan,
  complete: boolean,
): LifecyclePlanAssumptions {
  const round = relevantRound(pool, supervisorPlan);
  return {
    snapshotComplete: complete,
    activePositionCount: decimal(pool.activePositionCount),
    maxPositionCount: decimal(pool.maxPositionCount),
    drawRoundCount: decimal(pool.drawRoundCount),
    completedDrawRoundCount: decimal(pool.completedDrawRoundCount),
    claimedPrizeCount: decimal(pool.claimedPrizeCount),
    escrowedAmount: decimal(pool.escrowedAmount),
    assignedPrizeAmount: decimal(pool.assignedPrizeAmount),
    claimedPrizeAmount: decimal(pool.claimedPrizeAmount),
    nextRoundScheduledAt: decimal(round?.scheduledAt),
    nextRoundStatus: round?.status ?? null,
    nextRoundWinningPositionId: decimal(round?.winningPositionId),
    nextRoundClaimed: round?.claimed ?? null,
  };
}

export function revalidateLifecycleActionPlan(
  untrustedPlan: LifecycleActionPlan,
  snapshot: SystemSnapshot,
  report: SupervisorReport,
  options: LifecycleRevalidationOptions = {},
): LifecycleRevalidationResult {
  const parsed = parseLifecycleActionPlan(untrustedPlan);
  if (!parsed.ok) return invalidResult(parsed.errors);
  const plan = parsed.plan;
  const changes: LifecyclePlanChange[] = [];
  const maxAge =
    options.maxPlanAgeSeconds ?? DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS;
  if (maxAge < 0n) throw new Error("Maximum plan age must not be negative.");

  change(
    changes,
    "identity.chainId",
    plan.identity.chainId,
    snapshot.chainId.toString(),
    "critical",
    "A plan is bound to one chain.",
  );
  change(
    changes,
    "identity.contractAddress",
    plan.identity.contractAddress.toLowerCase(),
    isAddress(snapshot.contractAddress)
      ? getAddress(snapshot.contractAddress).toLowerCase()
      : snapshot.contractAddress,
    "critical",
    "A plan is bound to one contract address.",
  );
  change(
    changes,
    "identity.contractInterface",
    plan.identity.contractInterface,
    options.contractInterface ?? LIFECYCLE_ACTION_PLAN_CONTRACT_INTERFACE,
    "critical",
    "The contract interface identity must match.",
  );
  change(
    changes,
    "source.type",
    plan.source.type,
    snapshot.source,
    "critical",
    "The fresh snapshot must use the expected source type.",
  );
  if (options.freshSourceReference !== undefined) {
    change(
      changes,
      "source.reference",
      plan.source.reference,
      options.freshSourceReference,
      "critical",
      "The fresh fixture or public source reference must match.",
    );
  }
  if (changes.length > 0) {
    return result("BLOCKED", "IDENTITY_MISMATCH", plan, snapshot, changes);
  }

  if (snapshot.blockNumber === null) {
    change(
      changes,
      "fresh.blockNumber",
      `>= ${plan.identity.baseBlockNumber}`,
      null,
      "critical",
      "Freshness cannot be established without a concrete block number.",
    );
    return result("INCOMPLETE", "MISSING_FRESH_BLOCK", plan, snapshot, changes);
  }
  if (snapshot.blockNumber < BigInt(plan.identity.baseBlockNumber)) {
    change(
      changes,
      "fresh.blockNumber",
      `>= ${plan.identity.baseBlockNumber}`,
      snapshot.blockNumber.toString(),
      "critical",
      "Revalidation cannot move backwards to an older block.",
    );
    return result("BLOCKED", "BLOCK_REGRESSION", plan, snapshot, changes);
  }

  const complete = snapshotIsComplete(snapshot) &&
    !incompleteDiagnostics(report);
  if (!complete) {
    change(
      changes,
      "assumptions.snapshotComplete",
      true,
      false,
      "critical",
      "Missing or partial data must fail closed.",
    );
    return result("INCOMPLETE", "FRESH_SNAPSHOT_INCOMPLETE", plan, snapshot, changes);
  }

  const poolId = BigInt(plan.scope.poolId);
  const pool = snapshot.pools.find((candidate) => candidate.poolId === poolId);
  const freshPlan = report.plans.find((candidate) => candidate.poolId === poolId);
  if (!pool || !freshPlan) {
    change(
      changes,
      "scope.poolId",
      plan.scope.poolId,
      null,
      "critical",
      "The planned pool is absent from the fresh snapshot.",
    );
    return result("STALE", "POOL_NO_LONGER_PRESENT", plan, snapshot, changes);
  }

  if (
    report.systemDiagnostics.length > 0 ||
    freshPlan.nextAction === "INCONSISTENT_STATE" ||
    freshPlan.diagnostics.length > 0
  ) {
    change(
      changes,
      "supervisor.safety",
      "no critical diagnostics",
      freshPlan.reasonCode,
      "critical",
      "A higher-priority supervisor alert blocks the saved plan.",
    );
    return result("BLOCKED", "FRESH_SUPERVISOR_BLOCKED", plan, snapshot, changes);
  }

  if (
    plan.scope.plannedAction === "DRAW" &&
    pool.status === plan.scope.expectedPoolStatus &&
    decimal(pool.completedDrawRoundCount) ===
      plan.assumptions.completedDrawRoundCount &&
    (
      freshPlan.nextAction === "WAITING_FOR_FIRST_DRAW" ||
      freshPlan.nextAction === "WAITING_FOR_NEXT_DRAW"
    )
  ) {
    change(
      changes,
      "scope.supervisorAction",
      plan.scope.supervisorAction,
      freshPlan.nextAction,
      "critical",
      "The planned Draw is not currently allowed.",
    );
    return result("BLOCKED", "DRAW_NOT_CURRENTLY_ALLOWED", plan, snapshot, changes);
  }

  change(
    changes,
    "scope.expectedPoolStatus",
    plan.scope.expectedPoolStatus,
    pool.status,
    "critical",
    "The pool lifecycle status changed.",
  );
  change(
    changes,
    "scope.supervisorAction",
    plan.scope.supervisorAction,
    freshPlan.nextAction,
    "critical",
    "The supervisor now recommends a different action.",
  );
  change(
    changes,
    "scope.supervisorReasonCode",
    plan.scope.supervisorReasonCode,
    freshPlan.reasonCode,
    "warning",
    "The supervisor reason changed.",
  );
  change(
    changes,
    "scope.roundNumber",
    plan.scope.roundNumber,
    decimal(freshPlan.nextRoundNumber),
    "critical",
    "The next sequential round changed.",
  );
  const freshAssumptions = currentAssumptions(
    snapshot,
    pool,
    freshPlan,
    complete,
  );
  for (const key of Object.keys(plan.assumptions) as Array<
    keyof LifecyclePlanAssumptions
  >) {
    change(
      changes,
      `assumptions.${key}`,
      plan.assumptions[key],
      freshAssumptions[key],
      key === "snapshotComplete" ? "critical" : "warning",
      "A critical lifecycle assumption changed since plan creation.",
    );
  }
  if (changes.length > 0) {
    return result("STALE", "LIFECYCLE_STATE_CHANGED", plan, snapshot, changes);
  }

  if (snapshot.observedAt < BigInt(plan.identity.baseBlockTimestamp)) {
    change(
      changes,
      "fresh.blockTimestamp",
      `>= ${plan.identity.baseBlockTimestamp}`,
      snapshot.observedAt.toString(),
      "critical",
      "The fresh block timestamp regressed.",
    );
    return result("BLOCKED", "TIMESTAMP_REGRESSION", plan, snapshot, changes);
  }
  const age = snapshot.observedAt - BigInt(plan.createdAt);
  if (age > maxAge) {
    change(
      changes,
      "plan.ageSeconds",
      `<= ${maxAge}`,
      age.toString(),
      "warning",
      "The plan exceeded the configured maximum age.",
    );
    return result("STALE", "PLAN_MAX_AGE_EXCEEDED", plan, snapshot, changes);
  }

  return result("VALID", "PLAN_STILL_CURRENT", plan, snapshot, []);
}

export function renderLifecycleActionPlanText(plan: LifecycleActionPlan): string {
  return [
    "POP33 LIFECYCLE ACTION PLAN — READ ONLY",
    `Plan: ${plan.planId}`,
    `Source: ${plan.source.type} (${plan.source.reference})`,
    `Chain: ${plan.identity.chainId} | contract: ${plan.identity.contractAddress}`,
    `Base block: ${plan.identity.baseBlockNumber} | timestamp: ${plan.identity.baseBlockTimestamp}`,
    `Pool: ${plan.scope.poolId} | status: ${plan.scope.expectedPoolStatus}`,
    `Supervisor: ${plan.scope.supervisorAction} | planned: ${plan.scope.plannedAction} | ${plan.scope.classification}`,
    `Round: ${plan.scope.roundNumber ?? "-"}`,
    `Fingerprint: ${plan.fingerprint}`,
    "This file is read-only planning data. It does not authorize or execute a transaction.",
  ].join("\n");
}

export function renderLifecycleRevalidationJson(
  resultValue: LifecycleRevalidationResult,
): string {
  return JSON.stringify(resultValue, null, 2);
}

export function renderLifecycleRevalidationText(
  resultValue: LifecycleRevalidationResult,
): string {
  const lines = [
    `Plan status: ${resultValue.status}`,
    `Pool: ${resultValue.poolId ?? "-"}`,
    `Base block: ${resultValue.baseBlockNumber ?? "-"}`,
    `Fresh block: ${resultValue.freshBlockNumber ?? "-"}`,
    "",
    "Changed:",
    ...(resultValue.changes.length === 0
      ? ["- none"]
      : resultValue.changes.map((entry) =>
          `- ${entry.field}: ${String(entry.expected)} -> ${String(entry.actual)} [${entry.severity}] ${entry.explanation}`)),
    "",
    "Decision:",
    resultValue.decision,
  ];
  return lines.join("\n");
}

export function lifecycleRevalidationExitCode(
  status: LifecycleRevalidationStatus,
): number {
  return LIFECYCLE_REVALIDATION_EXIT_CODES[status];
}
