import { createHash } from "node:crypto";

export const SUPERVISOR_SCHEMA_VERSION = 1 as const;
export const DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS = 900n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const POOL_STATUSES = [
  "Open",
  "Locked",
  "Drawing",
  "Claimable",
  "Finished",
] as const;

export type PoolStatus = (typeof POOL_STATUSES)[number];
export type SnapshotSource = "fixture" | "local" | "base-sepolia-read-only";
export type RoundStatus = "Pending" | "Finalized" | string;
export type NextAction =
  | "WAITING_FOR_PARTICIPANTS"
  | "WAITING_FOR_FIRST_DRAW"
  | "WAITING_FOR_NEXT_DRAW"
  | "DRAW_DUE"
  | "DRAW_OVERDUE"
  | "CLAIMS_OUTSTANDING"
  | "FINISHED"
  | "INCONSISTENT_STATE"
  | "NO_ACTION";
export type Severity = "info" | "warning" | "critical";

export interface DrawRoundSnapshot {
  number?: bigint;
  scheduledAt?: bigint;
  executedAt?: bigint;
  status?: RoundStatus;
  winningPositionId?: bigint;
  winner?: string;
  prizeAmount?: bigint;
  temporaryRequestId?: bigint;
  claimed?: boolean;
}

export interface PoolSnapshot {
  poolId: bigint;
  status: string;
  activePositionCount?: bigint;
  escrowedAmount?: bigint;
  openedAt?: bigint;
  lockedAt?: bigint;
  drawInterval?: bigint;
  entryPrice?: bigint;
  prizePerRound?: bigint;
  totalPrizeAmount?: bigint;
  maxPositionCount?: bigint;
  drawRoundCount?: bigint;
  completedDrawRoundCount?: bigint;
  claimedPrizeCount?: bigint;
  assignedPrizeAmount?: bigint;
  claimedPrizeAmount?: bigint;
  rounds: readonly DrawRoundSnapshot[];
}

export interface SnapshotReadMetadata {
  network: string;
  rpcHost: string;
  requestedPoolRange: {
    fromPoolId: bigint;
    toPoolId: bigint;
  } | null;
  snapshotComplete: boolean;
  warnings: readonly string[];
}

export interface SystemSnapshot {
  chainId: bigint;
  contractAddress: string;
  blockNumber: bigint | null;
  observedAt: bigint;
  poolCount: bigint;
  source: SnapshotSource;
  pools: readonly PoolSnapshot[];
  metadata?: SnapshotReadMetadata;
}

export interface LifecycleSnapshotAdapter {
  readonly source: SnapshotSource;
  readSnapshot(): Promise<SystemSnapshot>;
}

export interface SupervisorConfig {
  drawOverdueThresholdSeconds: bigint;
}

export interface ConsistencyIssue {
  code: string;
  severity: "critical";
  detail: string;
  roundNumber: bigint | null;
}

export interface OperatorVerificationData {
  chainId: bigint;
  contractAddress: string;
  blockNumber: bigint | null;
  observedAt: bigint;
  snapshotSource: SnapshotSource;
  inputStatus: string;
  completedDrawRoundCount: bigint | null;
  claimedPrizeCount: bigint | null;
  escrowedAmount: bigint | null;
  elapsedPendingSchedules: bigint;
}

export interface PoolPlan {
  planId: string;
  poolId: bigint;
  currentStatus: string;
  nextAction: NextAction;
  explanation: string;
  dueAt: bigint | null;
  observedAt: bigint;
  secondsRemaining: bigint | null;
  secondsOverdue: bigint | null;
  nextRoundNumber: bigint | null;
  missingDrawCount: bigint | null;
  missingClaimCount: bigint | null;
  outstandingWinners: readonly string[];
  severity: Severity;
  reasonCode: string;
  diagnostics: readonly ConsistencyIssue[];
  verification: OperatorVerificationData;
}

export interface SupervisorSummary {
  poolCount: bigint;
  analyzedPoolCount: bigint;
  statusCounts: Record<PoolStatus, bigint>;
  unknownStatusCount: bigint;
  actionableCount: bigint;
  warningCount: bigint;
  criticalCount: bigint;
}

export interface SupervisorReport {
  schemaVersion: typeof SUPERVISOR_SCHEMA_VERSION;
  readOnly: true;
  safety: "READ_ONLY_NO_KEYS_NO_TRANSACTIONS";
  snapshot: {
    chainId: bigint;
    contractAddress: string;
    blockNumber: bigint | null;
    observedAt: bigint;
    poolCount: bigint;
    source: SnapshotSource;
    metadata?: SnapshotReadMetadata;
  };
  config: SupervisorConfig;
  systemDiagnostics: readonly ConsistencyIssue[];
  summary: SupervisorSummary;
  plans: readonly PoolPlan[];
}

export interface SupervisorFilter {
  poolId?: bigint;
  onlyActionable?: boolean;
  onlyWarnings?: boolean;
}

type CompleteRound = Required<DrawRoundSnapshot>;
type CompletePool = PoolSnapshot & {
  activePositionCount: bigint;
  escrowedAmount: bigint;
  openedAt: bigint;
  lockedAt: bigint;
  drawInterval: bigint;
  entryPrice: bigint;
  prizePerRound: bigint;
  totalPrizeAmount: bigint;
  maxPositionCount: bigint;
  drawRoundCount: bigint;
  completedDrawRoundCount: bigint;
  claimedPrizeCount: bigint;
  assignedPrizeAmount: bigint;
  claimedPrizeAmount: bigint;
};

const REQUIRED_POOL_FIELDS = [
  "activePositionCount",
  "escrowedAmount",
  "openedAt",
  "lockedAt",
  "drawInterval",
  "entryPrice",
  "prizePerRound",
  "totalPrizeAmount",
  "maxPositionCount",
  "drawRoundCount",
  "completedDrawRoundCount",
  "claimedPrizeCount",
  "assignedPrizeAmount",
  "claimedPrizeAmount",
] as const;

const REQUIRED_ROUND_FIELDS = [
  "number",
  "scheduledAt",
  "executedAt",
  "status",
  "winningPositionId",
  "winner",
  "prizeAmount",
  "temporaryRequestId",
  "claimed",
] as const;

const ACTIONABLE = new Set<NextAction>([
  "DRAW_DUE",
  "DRAW_OVERDUE",
  "CLAIMS_OUTSTANDING",
  "INCONSISTENT_STATE",
]);

function isKnownPoolStatus(value: string): value is PoolStatus {
  return POOL_STATUSES.includes(value as PoolStatus);
}

function isCompletePool(pool: PoolSnapshot): pool is CompletePool {
  return REQUIRED_POOL_FIELDS.every((field) => pool[field] !== undefined);
}

function isCompleteRound(round: DrawRoundSnapshot): round is CompleteRound {
  return REQUIRED_ROUND_FIELDS.every((field) => round[field] !== undefined);
}

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO_ADDRESS;
}

function issue(
  issues: ConsistencyIssue[],
  code: string,
  detail: string,
  roundNumber: bigint | null = null,
): void {
  issues.push({ code, severity: "critical", detail, roundNumber });
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function createPlanId(input: {
  snapshot: SystemSnapshot;
  pool: PoolSnapshot;
  nextAction: NextAction;
  nextRoundNumber: bigint | null;
}): string {
  const canonical = JSON.stringify(canonicalize({
    schemaVersion: SUPERVISOR_SCHEMA_VERSION,
    chainId: input.snapshot.chainId,
    contractAddress: input.snapshot.contractAddress.toLowerCase(),
    blockNumber: input.snapshot.blockNumber,
    observedAt: input.snapshot.observedAt,
    source: input.snapshot.source,
    pool: input.pool,
    nextAction: input.nextAction,
    nextRoundNumber: input.nextRoundNumber,
  }));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function createVerification(
  snapshot: SystemSnapshot,
  pool: PoolSnapshot,
  elapsedPendingSchedules: bigint,
): OperatorVerificationData {
  return {
    chainId: snapshot.chainId,
    contractAddress: snapshot.contractAddress,
    blockNumber: snapshot.blockNumber,
    observedAt: snapshot.observedAt,
    snapshotSource: snapshot.source,
    inputStatus: pool.status,
    completedDrawRoundCount: pool.completedDrawRoundCount ?? null,
    claimedPrizeCount: pool.claimedPrizeCount ?? null,
    escrowedAmount: pool.escrowedAmount ?? null,
    elapsedPendingSchedules,
  };
}

function makePlan(
  snapshot: SystemSnapshot,
  pool: PoolSnapshot,
  values: Omit<PoolPlan, "planId" | "poolId" | "currentStatus" | "observedAt" | "verification"> & {
    elapsedPendingSchedules?: bigint;
  },
): PoolPlan {
  const elapsedPendingSchedules = values.elapsedPendingSchedules ?? 0n;
  const planWithoutExtra = {
    nextAction: values.nextAction,
    explanation: values.explanation,
    dueAt: values.dueAt,
    secondsRemaining: values.secondsRemaining,
    secondsOverdue: values.secondsOverdue,
    nextRoundNumber: values.nextRoundNumber,
    missingDrawCount: values.missingDrawCount,
    missingClaimCount: values.missingClaimCount,
    outstandingWinners: values.outstandingWinners,
    severity: values.severity,
    reasonCode: values.reasonCode,
    diagnostics: values.diagnostics,
  };
  return {
    planId: createPlanId({
      snapshot,
      pool,
      nextAction: values.nextAction,
      nextRoundNumber: values.nextRoundNumber,
    }),
    poolId: pool.poolId,
    currentStatus: pool.status,
    observedAt: snapshot.observedAt,
    ...planWithoutExtra,
    verification: createVerification(snapshot, pool, elapsedPendingSchedules),
  };
}

function incompletePlan(
  snapshot: SystemSnapshot,
  pool: PoolSnapshot,
  issues: ConsistencyIssue[],
): PoolPlan {
  return makePlan(snapshot, pool, {
    nextAction: "INCONSISTENT_STATE",
    explanation: "The snapshot lacks data required for a safe lifecycle diagnosis.",
    dueAt: null,
    secondsRemaining: null,
    secondsOverdue: null,
    nextRoundNumber: null,
    missingDrawCount: null,
    missingClaimCount: null,
    outstandingWinners: [],
    severity: "critical",
    reasonCode: issues[0]?.code ?? "MISSING_REQUIRED_DATA",
    diagnostics: issues,
  });
}

function validateRounds(pool: CompletePool, issues: ConsistencyIssue[]): CompleteRound[] {
  const completeRounds: CompleteRound[] = [];
  const seenNumbers = new Set<string>();

  for (const round of pool.rounds) {
    if (!isCompleteRound(round)) {
      const missing = REQUIRED_ROUND_FIELDS.filter((field) => round[field] === undefined);
      issue(
        issues,
        "MISSING_REQUIRED_ROUND_DATA",
        `Round snapshot is missing: ${missing.join(", ")}.`,
        round.number ?? null,
      );
      continue;
    }
    const numberKey = round.number.toString();
    if (seenNumbers.has(numberKey)) {
      issue(
        issues,
        "DUPLICATE_ROUND_NUMBER",
        `Round ${numberKey} appears more than once.`,
        round.number,
      );
    }
    seenNumbers.add(numberKey);
    completeRounds.push(round);
  }

  if (pool.status !== "Open" && BigInt(pool.rounds.length) !== pool.drawRoundCount) {
    issue(
      issues,
      "ROUND_COUNT_MISMATCH",
      `Expected ${pool.drawRoundCount} round snapshots but received ${pool.rounds.length}.`,
    );
  }

  completeRounds.sort((left, right) =>
    left.number < right.number ? -1 : left.number > right.number ? 1 : 0,
  );

  let pendingSeen = false;
  const winningPositions = new Set<string>();
  const winningAddresses = new Set<string>();
  for (let index = 0; index < completeRounds.length; index += 1) {
    const round = completeRounds[index];
    const expectedNumber = BigInt(index + 1);
    if (round.number !== expectedNumber) {
      issue(
        issues,
        "ROUND_SEQUENCE_GAP",
        `Expected round ${expectedNumber} at sequence index ${index}, received ${round.number}.`,
        round.number,
      );
    }
    if (round.number < 1n || round.number > pool.drawRoundCount) {
      issue(
        issues,
        "ROUND_NUMBER_OUT_OF_RANGE",
        `Round ${round.number} is outside 1..${pool.drawRoundCount}.`,
        round.number,
      );
    }

    if (pool.status !== "Open") {
      const expectedSchedule = pool.lockedAt + round.number * pool.drawInterval;
      if (round.scheduledAt !== expectedSchedule) {
        issue(
          issues,
          "INVALID_ROUND_SCHEDULE",
          `Round ${round.number} schedule ${round.scheduledAt} does not equal ${expectedSchedule}.`,
          round.number,
        );
      }
    }

    if (round.status === "Pending") {
      pendingSeen = true;
      if (
        round.executedAt !== 0n ||
        round.winningPositionId !== 0n ||
        !isZeroAddress(round.winner) ||
        round.temporaryRequestId !== 0n
      ) {
        issue(
          issues,
          "PENDING_ROUND_HAS_RESULT",
          `Pending round ${round.number} contains finalized result data.`,
          round.number,
        );
      }
      if (round.claimed) {
        issue(
          issues,
          "CLAIM_BEFORE_DRAW",
          `Pending round ${round.number} is marked claimed.`,
          round.number,
        );
      }
    } else if (round.status === "Finalized") {
      if (pendingSeen) {
        issue(
          issues,
          "DRAW_SEQUENCE_GAP",
          `Round ${round.number} is finalized after an earlier pending round.`,
          round.number,
        );
      }
      if (
        round.executedAt === 0n ||
        round.winningPositionId === 0n ||
        isZeroAddress(round.winner) ||
        round.temporaryRequestId === 0n
      ) {
        issue(
          issues,
          "FINALIZED_ROUND_MISSING_RESULT",
          `Finalized round ${round.number} lacks required result data.`,
          round.number,
        );
      }
      if (round.executedAt < round.scheduledAt) {
        issue(
          issues,
          "ROUND_EXECUTED_EARLY",
          `Round ${round.number} executed before its scheduled timestamp.`,
          round.number,
        );
      }
      if (round.prizeAmount !== pool.prizePerRound) {
        issue(
          issues,
          "ROUND_PRIZE_MISMATCH",
          `Round ${round.number} prize does not match the pool snapshot.`,
          round.number,
        );
      }
      const positionKey = round.winningPositionId.toString();
      if (winningPositions.has(positionKey)) {
        issue(
          issues,
          "DUPLICATE_WINNING_POSITION",
          `Winning position ${positionKey} appears in multiple rounds.`,
          round.number,
        );
      }
      winningPositions.add(positionKey);
      const addressKey = round.winner.toLowerCase();
      if (winningAddresses.has(addressKey)) {
        issue(
          issues,
          "DUPLICATE_WINNER_ADDRESS",
          `Winner ${round.winner} appears in multiple rounds despite one position per wallet per pool.`,
          round.number,
        );
      }
      winningAddresses.add(addressKey);
    } else {
      issue(
        issues,
        "UNKNOWN_ROUND_STATUS",
        `Round ${round.number} has unknown status ${round.status}.`,
        round.number,
      );
    }
  }

  return completeRounds;
}

function expectedEscrow(pool: CompletePool): bigint {
  if (pool.status === "Open") {
    return pool.activePositionCount * pool.entryPrice;
  }
  if (pool.status === "Finished") return 0n;
  return pool.totalPrizeAmount - pool.claimedPrizeAmount;
}

function validatePool(
  pool: CompletePool,
  rounds: readonly CompleteRound[],
  issues: ConsistencyIssue[],
): void {
  if (pool.poolId <= 0n) {
    issue(issues, "INVALID_POOL_ID", "Pool ID must be positive.");
  }
  if (!isKnownPoolStatus(pool.status)) {
    issue(issues, "UNKNOWN_POOL_STATUS", `Unknown pool status ${pool.status}.`);
    return;
  }
  if (
    pool.activePositionCount < 0n ||
    pool.maxPositionCount <= 0n ||
    pool.drawRoundCount <= 0n ||
    pool.drawInterval <= 0n ||
    pool.entryPrice <= 0n ||
    pool.prizePerRound <= 0n ||
    pool.totalPrizeAmount <= 0n
  ) {
    issue(issues, "INVALID_POOL_CONFIGURATION", "Pool configuration contains non-positive or negative values.");
  }
  if (pool.activePositionCount > pool.maxPositionCount) {
    issue(
      issues,
      "POSITION_CAPACITY_EXCEEDED",
      `Pool has ${pool.activePositionCount} positions with capacity ${pool.maxPositionCount}.`,
    );
  }
  if (pool.drawRoundCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    issue(
      issues,
      "ROUND_COUNT_UNSUPPORTED",
      "Round count is too large to safely index in this runtime.",
    );
  }

  const finalized = rounds.filter((round) => round.status === "Finalized");
  const claimed = rounds.filter((round) => round.claimed);
  if (BigInt(finalized.length) !== pool.completedDrawRoundCount) {
    issue(
      issues,
      "COMPLETED_DRAW_COUNT_MISMATCH",
      `Pool reports ${pool.completedDrawRoundCount} completed draws but rounds show ${finalized.length}.`,
    );
  }
  if (BigInt(claimed.length) !== pool.claimedPrizeCount) {
    issue(
      issues,
      "CLAIM_COUNT_MISMATCH",
      `Pool reports ${pool.claimedPrizeCount} claims but rounds show ${claimed.length}.`,
    );
  }
  if (pool.completedDrawRoundCount > pool.drawRoundCount) {
    issue(issues, "TOO_MANY_COMPLETED_DRAWS", "Completed draw count exceeds the configured limit.");
  }
  if (pool.claimedPrizeCount > pool.completedDrawRoundCount) {
    issue(issues, "CLAIMS_EXCEED_DRAWS", "Claim count exceeds completed draw count.");
  }
  if (pool.assignedPrizeAmount !== pool.completedDrawRoundCount * pool.prizePerRound) {
    issue(issues, "ASSIGNED_PRIZE_ACCOUNTING_MISMATCH", "Assigned prize amount does not match completed draws.");
  }
  if (pool.claimedPrizeAmount !== pool.claimedPrizeCount * pool.prizePerRound) {
    issue(issues, "CLAIMED_PRIZE_ACCOUNTING_MISMATCH", "Claimed prize amount does not match claims.");
  }
  if (pool.totalPrizeAmount !== pool.drawRoundCount * pool.prizePerRound) {
    issue(issues, "TOTAL_PRIZE_CONFIGURATION_MISMATCH", "Total prize amount does not match rounds multiplied by prize.");
  }
  const escrow = expectedEscrow(pool);
  if (pool.escrowedAmount !== escrow) {
    issue(
      issues,
      "UNEXPECTED_ACCOUNTED_ESCROW",
      `Accounted pool escrow ${pool.escrowedAmount} does not equal expected ${escrow}.`,
    );
  }

  switch (pool.status) {
    case "Open":
      if (pool.activePositionCount >= pool.maxPositionCount) {
        issue(issues, "OPEN_POOL_AT_OR_ABOVE_CAPACITY", "Open pool must remain below capacity.");
      }
      if (pool.lockedAt !== 0n) {
        issue(issues, "OPEN_POOL_HAS_LOCK_TIMESTAMP", "Open pool must not have lockedAt.");
      }
      if (pool.completedDrawRoundCount !== 0n || finalized.length > 0) {
        issue(issues, "OPEN_POOL_HAS_DRAWS", "Open pool contains completed draw rounds.");
      }
      if (pool.claimedPrizeCount !== 0n) {
        issue(issues, "OPEN_POOL_HAS_CLAIMS", "Open pool contains claims.");
      }
      break;
    case "Locked":
      if (pool.activePositionCount !== pool.maxPositionCount) {
        issue(issues, "LOCKED_POOL_NOT_FULL", "Locked pool must contain exactly the configured position capacity.");
      }
      if (pool.lockedAt === 0n) {
        issue(issues, "LOCKED_POOL_MISSING_LOCK_TIMESTAMP", "Locked pool has no lockedAt timestamp.");
      }
      if (pool.completedDrawRoundCount !== 0n) {
        issue(issues, "LOCKED_POOL_HAS_DRAWS", "Locked status is only valid before the first draw.");
      }
      if (pool.claimedPrizeCount !== 0n) {
        issue(issues, "LOCKED_POOL_HAS_CLAIMS", "Locked pool cannot contain claims.");
      }
      break;
    case "Drawing":
      if (pool.activePositionCount !== pool.maxPositionCount) {
        issue(issues, "DRAWING_POOL_NOT_FULL", "Drawing pool must retain all active positions.");
      }
      if (pool.lockedAt === 0n) {
        issue(issues, "DRAWING_POOL_MISSING_LOCK_TIMESTAMP", "Drawing pool has no lockedAt timestamp.");
      }
      if (pool.completedDrawRoundCount === 0n || pool.completedDrawRoundCount >= pool.drawRoundCount) {
        issue(issues, "DRAWING_PROGRESS_INVALID", "Drawing requires between one and roundCount - 1 completed rounds.");
      }
      break;
    case "Claimable":
      if (pool.activePositionCount !== pool.maxPositionCount) {
        issue(issues, "CLAIMABLE_POOL_NOT_FULL", "Claimable pool must retain all active positions.");
      }
      if (pool.completedDrawRoundCount !== pool.drawRoundCount) {
        issue(issues, "CLAIMABLE_WITHOUT_ALL_DRAWS", "Claimable pool must have all draws finalized.");
      }
      if (pool.claimedPrizeCount >= pool.drawRoundCount) {
        issue(issues, "CLAIMABLE_WITHOUT_OUTSTANDING_CLAIMS", "All claims are complete but pool status is not Finished.");
      }
      break;
    case "Finished":
      if (pool.activePositionCount !== 0n) {
        issue(issues, "FINISHED_POOL_HAS_ACTIVE_POSITIONS", "Finished pool must have released all active positions.");
      }
      if (pool.completedDrawRoundCount !== pool.drawRoundCount) {
        issue(issues, "FINISHED_WITHOUT_ALL_DRAWS", "Finished pool must have all draws finalized.");
      }
      if (pool.claimedPrizeCount !== pool.drawRoundCount) {
        issue(issues, "FINISHED_WITHOUT_ALL_CLAIMS", "Current Demo V1 requires every prize to be claimed before Finished.");
      }
      break;
  }
}

function analyzeCompletePool(
  snapshot: SystemSnapshot,
  pool: CompletePool,
  config: SupervisorConfig,
): PoolPlan {
  const issues: ConsistencyIssue[] = [];
  const rounds = validateRounds(pool, issues);
  validatePool(pool, rounds, issues);

  const finalizedCount = BigInt(rounds.filter((round) => round.status === "Finalized").length);
  const claimedCount = BigInt(rounds.filter((round) => round.claimed).length);
  const missingDrawCount = pool.drawRoundCount >= finalizedCount
    ? pool.drawRoundCount - finalizedCount
    : 0n;
  const missingClaimCount = pool.drawRoundCount >= claimedCount
    ? pool.drawRoundCount - claimedCount
    : 0n;
  const outstandingWinners = rounds
    .filter((round) => round.status === "Finalized" && !round.claimed && !isZeroAddress(round.winner))
    .map((round) => round.winner);
  const pendingRounds = rounds.filter((round) => round.status === "Pending");
  const elapsedPendingSchedules = BigInt(
    pendingRounds.filter((round) => round.scheduledAt <= snapshot.observedAt).length,
  );

  if (issues.length > 0) {
    return makePlan(snapshot, pool, {
      nextAction: "INCONSISTENT_STATE",
      explanation: `Unsafe lifecycle snapshot: ${issues[0].detail}`,
      dueAt: null,
      secondsRemaining: null,
      secondsOverdue: null,
      nextRoundNumber: null,
      missingDrawCount,
      missingClaimCount,
      outstandingWinners,
      severity: "critical",
      reasonCode: issues[0].code,
      diagnostics: issues,
      elapsedPendingSchedules,
    });
  }

  if (pool.status === "Open") {
    return makePlan(snapshot, pool, {
      nextAction: "WAITING_FOR_PARTICIPANTS",
      explanation: `Pool is Open with ${pool.activePositionCount}/${pool.maxPositionCount} active positions.`,
      dueAt: null,
      secondsRemaining: null,
      secondsOverdue: null,
      nextRoundNumber: null,
      missingDrawCount,
      missingClaimCount,
      outstandingWinners,
      severity: "info",
      reasonCode: "OPEN_POOL_BELOW_CAPACITY",
      diagnostics: [],
    });
  }

  if (pool.status === "Claimable") {
    return makePlan(snapshot, pool, {
      nextAction: "CLAIMS_OUTSTANDING",
      explanation: `${missingClaimCount} winner claim(s) remain before current Demo V1 can finish.`,
      dueAt: null,
      secondsRemaining: null,
      secondsOverdue: null,
      nextRoundNumber: null,
      missingDrawCount,
      missingClaimCount,
      outstandingWinners,
      severity: "warning",
      reasonCode: "WINNER_CLAIMS_PENDING",
      diagnostics: [],
    });
  }

  if (pool.status === "Finished") {
    return makePlan(snapshot, pool, {
      nextAction: "FINISHED",
      explanation: "All configured rounds and claims are complete and accounted escrow is zero.",
      dueAt: null,
      secondsRemaining: null,
      secondsOverdue: null,
      nextRoundNumber: null,
      missingDrawCount,
      missingClaimCount,
      outstandingWinners,
      severity: "info",
      reasonCode: "POOL_LIFECYCLE_COMPLETE",
      diagnostics: [],
    });
  }

  const nextRound = pendingRounds[0];
  if (!nextRound) {
    return makePlan(snapshot, pool, {
      nextAction: "INCONSISTENT_STATE",
      explanation: "Drawable pool has no pending sequential round.",
      dueAt: null,
      secondsRemaining: null,
      secondsOverdue: null,
      nextRoundNumber: null,
      missingDrawCount,
      missingClaimCount,
      outstandingWinners,
      severity: "critical",
      reasonCode: "NO_PENDING_DRAW_ROUND",
      diagnostics: [{
        code: "NO_PENDING_DRAW_ROUND",
        severity: "critical",
        detail: "Drawable pool has no pending sequential round.",
        roundNumber: null,
      }],
      elapsedPendingSchedules,
    });
  }

  if (snapshot.observedAt < nextRound.scheduledAt) {
    const first = pool.status === "Locked";
    return makePlan(snapshot, pool, {
      nextAction: first ? "WAITING_FOR_FIRST_DRAW" : "WAITING_FOR_NEXT_DRAW",
      explanation: `Round ${nextRound.number} is not due yet.`,
      dueAt: nextRound.scheduledAt,
      secondsRemaining: nextRound.scheduledAt - snapshot.observedAt,
      secondsOverdue: null,
      nextRoundNumber: nextRound.number,
      missingDrawCount,
      missingClaimCount,
      outstandingWinners,
      severity: "info",
      reasonCode: first ? "FIRST_DRAW_NOT_DUE" : "NEXT_DRAW_NOT_DUE",
      diagnostics: [],
      elapsedPendingSchedules,
    });
  }

  const overdueSeconds = snapshot.observedAt - nextRound.scheduledAt;
  const overdue = overdueSeconds > config.drawOverdueThresholdSeconds;
  return makePlan(snapshot, pool, {
    nextAction: overdue ? "DRAW_OVERDUE" : "DRAW_DUE",
    explanation: overdue
      ? `Round ${nextRound.number} is overdue; only this single next sequential round may be executed.`
      : `Round ${nextRound.number} is due; only this single next sequential round may be executed.`,
    dueAt: nextRound.scheduledAt,
    secondsRemaining: null,
    secondsOverdue: overdueSeconds,
    nextRoundNumber: nextRound.number,
    missingDrawCount,
    missingClaimCount,
    outstandingWinners,
    severity: overdue ? "critical" : "warning",
    reasonCode: overdue ? "NEXT_DRAW_OVERDUE" : "NEXT_DRAW_DUE",
    diagnostics: [],
    elapsedPendingSchedules,
  });
}

export function analyzeLifecycleSnapshot(
  snapshot: SystemSnapshot,
  config: SupervisorConfig = {
    drawOverdueThresholdSeconds: DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
  },
): SupervisorReport {
  if (snapshot.observedAt < 0n) throw new Error("observedAt must not be negative.");
  if (config.drawOverdueThresholdSeconds < 0n) {
    throw new Error("drawOverdueThresholdSeconds must not be negative.");
  }

  const systemDiagnostics: ConsistencyIssue[] = [];
  if (snapshot.chainId <= 0n) {
    issue(systemDiagnostics, "INVALID_CHAIN_ID", "Snapshot chain ID must be positive.");
  }
  if (snapshot.contractAddress.trim() === "") {
    issue(systemDiagnostics, "MISSING_CONTRACT_ADDRESS", "Snapshot contract address is missing.");
  }
  if (snapshot.blockNumber !== null && snapshot.blockNumber < 0n) {
    issue(systemDiagnostics, "INVALID_BLOCK_NUMBER", "Snapshot block number must not be negative.");
  }
  const expectedPoolRecords = snapshot.metadata?.requestedPoolRange
    ? snapshot.metadata.requestedPoolRange.toPoolId -
      snapshot.metadata.requestedPoolRange.fromPoolId +
      1n
    : snapshot.poolCount;
  if (expectedPoolRecords !== BigInt(snapshot.pools.length)) {
    issue(
      systemDiagnostics,
      "POOL_COUNT_MISMATCH",
      `Snapshot selection expects ${expectedPoolRecords} pool records but contains ${snapshot.pools.length}.`,
    );
  }
  if (snapshot.metadata && !snapshot.metadata.snapshotComplete) {
    issue(
      systemDiagnostics,
      "INCOMPLETE_SNAPSHOT",
      "The data adapter marked this snapshot incomplete.",
    );
  }
  const poolIds = new Set<string>();
  for (const pool of snapshot.pools) {
    const key = pool.poolId.toString();
    if (poolIds.has(key)) {
      issue(systemDiagnostics, "DUPLICATE_POOL_ID", `Pool ID ${key} appears more than once.`);
    }
    poolIds.add(key);
  }

  const plans = snapshot.pools.map((pool) => {
    const issues: ConsistencyIssue[] = [];
    const missingFields = REQUIRED_POOL_FIELDS.filter((field) => pool[field] === undefined);
    if (missingFields.length > 0 || !isCompletePool(pool)) {
      issue(
        issues,
        "MISSING_REQUIRED_DATA",
        `Pool snapshot is missing: ${missingFields.join(", ")}.`,
      );
      return incompletePlan(snapshot, pool, issues);
    }
    return analyzeCompletePool(snapshot, pool, config);
  });

  return {
    schemaVersion: SUPERVISOR_SCHEMA_VERSION,
    readOnly: true,
    safety: "READ_ONLY_NO_KEYS_NO_TRANSACTIONS",
    snapshot: {
      chainId: snapshot.chainId,
      contractAddress: snapshot.contractAddress,
      blockNumber: snapshot.blockNumber,
      observedAt: snapshot.observedAt,
      poolCount: snapshot.poolCount,
      source: snapshot.source,
      ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
    },
    config,
    systemDiagnostics,
    summary: summarize(snapshot.poolCount, plans, systemDiagnostics),
    plans,
  };
}

function summarize(
  poolCount: bigint,
  plans: readonly PoolPlan[],
  systemDiagnostics: readonly ConsistencyIssue[],
): SupervisorSummary {
  const statusCounts: Record<PoolStatus, bigint> = {
    Open: 0n,
    Locked: 0n,
    Drawing: 0n,
    Claimable: 0n,
    Finished: 0n,
  };
  let unknownStatusCount = 0n;
  let actionableCount = 0n;
  let warningCount = 0n;
  let criticalCount = BigInt(systemDiagnostics.length);
  for (const plan of plans) {
    if (isKnownPoolStatus(plan.currentStatus)) statusCounts[plan.currentStatus] += 1n;
    else unknownStatusCount += 1n;
    if (ACTIONABLE.has(plan.nextAction)) actionableCount += 1n;
    if (plan.severity === "warning") warningCount += 1n;
    if (plan.severity === "critical") criticalCount += 1n;
  }
  return {
    poolCount,
    analyzedPoolCount: BigInt(plans.length),
    statusCounts,
    unknownStatusCount,
    actionableCount,
    warningCount,
    criticalCount,
  };
}

export function filterSupervisorReport(
  report: SupervisorReport,
  filter: SupervisorFilter,
): SupervisorReport {
  const plans = report.plans.filter((plan) => {
    if (filter.poolId !== undefined && plan.poolId !== filter.poolId) return false;
    if (filter.onlyActionable && !ACTIONABLE.has(plan.nextAction)) return false;
    if (filter.onlyWarnings && plan.severity === "info") return false;
    return true;
  });
  return {
    ...report,
    summary: summarize(report.snapshot.poolCount, plans, report.systemDiagnostics),
    plans,
  };
}

export function renderSupervisorJson(report: SupervisorReport): string {
  return JSON.stringify(report, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value, 2);
}

function formatTime(value: bigint | null): string {
  return value === null ? "-" : `${value} (${new Date(Number(value) * 1_000).toISOString()})`;
}

export function renderSupervisorText(report: SupervisorReport): string {
  const counts = report.summary.statusCounts;
  const lines = [
    "POP33 LIFECYCLE SUPERVISOR — READ ONLY",
    `Source: ${report.snapshot.source} | chain ${report.snapshot.chainId} | block ${report.snapshot.blockNumber ?? "n/a"} | observed ${formatTime(report.snapshot.observedAt)}`,
    ...(report.snapshot.metadata
      ? [
          `Network: ${report.snapshot.metadata.network} | RPC host: ${report.snapshot.metadata.rpcHost} | snapshot complete: ${report.snapshot.metadata.snapshotComplete}`,
        ]
      : []),
    `Pools: ${report.summary.poolCount} total, ${report.summary.analyzedPoolCount} shown | Open ${counts.Open} | Locked ${counts.Locked} | Drawing ${counts.Drawing} | Claimable ${counts.Claimable} | Finished ${counts.Finished} | Unknown ${report.summary.unknownStatusCount}`,
    `Signals: ${report.summary.actionableCount} actionable | ${report.summary.warningCount} warning | ${report.summary.criticalCount} critical`,
    `Overdue threshold: ${report.config.drawOverdueThresholdSeconds} seconds`,
    ...report.systemDiagnostics.map((diagnostic) =>
      `SYSTEM ! ${diagnostic.code}: ${diagnostic.detail}`),
    "",
    "POOL | STATUS | NEXT ACTION | ROUND | DUE AT | TIME | DRAWS LEFT | CLAIMS LEFT | SEVERITY",
  ];
  for (const plan of report.plans) {
    const time = plan.secondsRemaining !== null
      ? `${plan.secondsRemaining}s remaining`
      : plan.secondsOverdue !== null
        ? `${plan.secondsOverdue}s overdue`
        : "-";
    lines.push(
      `${plan.poolId} | ${plan.currentStatus} | ${plan.nextAction} | ${plan.nextRoundNumber ?? "-"} | ${formatTime(plan.dueAt)} | ${time} | ${plan.missingDrawCount ?? "-"} | ${plan.missingClaimCount ?? "-"} | ${plan.severity}`,
    );
    lines.push(`  ${plan.reasonCode}: ${plan.explanation}`);
    if (plan.verification.elapsedPendingSchedules > 1n) {
      lines.push(
        `  ${plan.verification.elapsedPendingSchedules} pending schedules have elapsed; the next operation is still exactly one sequential round.`,
      );
    }
    for (const diagnostic of plan.diagnostics) {
      lines.push(`  ! ${diagnostic.code}: ${diagnostic.detail}`);
    }
  }
  if (report.plans.length === 0) lines.push("(no pools match the selected filters)");
  lines.push("", "Snapshot only. Re-read pool state and the proposed round before any separately authorized transaction.");
  return lines.join("\n");
}
