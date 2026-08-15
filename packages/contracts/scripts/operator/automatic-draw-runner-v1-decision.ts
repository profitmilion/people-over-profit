import { getAddress, isAddress, ZeroAddress } from "ethers";

import {
  DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
  analyzeLifecycleSnapshot,
  type LifecycleSnapshotAdapter,
  type NextAction,
  type SnapshotSource,
} from "./lifecycle-supervisor.js";

export type AutomaticDrawReadOnlyDecisionStatus =
  | "NO_ACTION"
  | "DRAW_DUE"
  | "AMBIGUOUS"
  | "INCONSISTENT"
  | "READ_FAILED";

export interface AutomaticDrawReadOnlyScope {
  chainId: bigint;
  contractAddress: string;
  poolId: bigint;
}

interface AutomaticDrawReadOnlyDecisionBase {
  status: AutomaticDrawReadOnlyDecisionStatus;
  readOnly: true;
  safety: "READ_ONLY_NO_KEYS_NO_TRANSACTIONS";
  chainId: bigint;
  contractAddress: string;
  poolId: bigint;
  source: SnapshotSource;
  sourceBlock: bigint | null;
  nextAction: NextAction | null;
  reason: string;
}

export interface AutomaticDrawNoActionDecision
  extends AutomaticDrawReadOnlyDecisionBase {
  status: "NO_ACTION";
}

export interface AutomaticDrawDueDecision
  extends AutomaticDrawReadOnlyDecisionBase {
  status: "DRAW_DUE";
  roundNumber: bigint;
  scheduledAt: bigint;
  logicalDrawKey: string;
}

export interface AutomaticDrawAmbiguousDecision
  extends AutomaticDrawReadOnlyDecisionBase {
  status: "AMBIGUOUS";
}

export interface AutomaticDrawInconsistentDecision
  extends AutomaticDrawReadOnlyDecisionBase {
  status: "INCONSISTENT";
}

export interface AutomaticDrawReadFailedDecision
  extends AutomaticDrawReadOnlyDecisionBase {
  status: "READ_FAILED";
}

export type AutomaticDrawReadOnlyDecision =
  | AutomaticDrawNoActionDecision
  | AutomaticDrawDueDecision
  | AutomaticDrawAmbiguousDecision
  | AutomaticDrawInconsistentDecision
  | AutomaticDrawReadFailedDecision;

export interface AutomaticDrawReadOnlyDecisionCycleOptions {
  scope: AutomaticDrawReadOnlyScope;
  adapter: LifecycleSnapshotAdapter;
  drawOverdueThresholdSeconds?: bigint;
}

function requireScope(scope: AutomaticDrawReadOnlyScope): {
  chainId: bigint;
  contractAddress: string;
  poolId: bigint;
} {
  if (scope.chainId <= 0n) throw new Error("Decision scope chain ID must be positive.");
  if (!isAddress(scope.contractAddress)) {
    throw new Error("Decision scope contract must be an EVM address.");
  }
  const contractAddress = getAddress(scope.contractAddress);
  if (contractAddress === ZeroAddress) {
    throw new Error("Decision scope contract must not be the zero address.");
  }
  if (scope.poolId <= 0n) throw new Error("Decision scope pool ID must be positive.");
  return {
    chainId: scope.chainId,
    contractAddress,
    poolId: scope.poolId,
  };
}

export function logicalDrawKey(input: {
  chainId: bigint;
  contractAddress: string;
  poolId: bigint;
  roundNumber: bigint;
}): string {
  const scope = requireScope(input);
  if (input.roundNumber <= 0n) {
    throw new Error("Logical Draw round number must be positive.");
  }
  return [
    "pop33",
    "action=Draw",
    `chainId=${scope.chainId}`,
    `contract=${scope.contractAddress}`,
    `poolId=${scope.poolId}`,
    `round=${input.roundNumber}`,
  ].join(":");
}

function hasIncompleteReadDiagnostic(codes: readonly string[]): boolean {
  return codes.some((code) =>
    /MISSING|INCOMPLETE|PARTIAL|DECODE|BYTECODE|BLOCK_NUMBER/.test(code));
}

export async function runAutomaticDrawReadOnlyDecisionCycle(
  options: AutomaticDrawReadOnlyDecisionCycleOptions,
): Promise<AutomaticDrawReadOnlyDecision> {
  const scope = requireScope(options.scope);
  const base = {
    readOnly: true as const,
    safety: "READ_ONLY_NO_KEYS_NO_TRANSACTIONS" as const,
    ...scope,
    source: options.adapter.source,
    sourceBlock: null,
    nextAction: null,
  };

  let snapshot;
  try {
    snapshot = await options.adapter.readSnapshot();
  } catch {
    return {
      ...base,
      status: "READ_FAILED",
      reason: "The read-only lifecycle snapshot could not be obtained.",
    };
  }

  const observed = { ...base, sourceBlock: snapshot.blockNumber };
  if (
    snapshot.blockNumber === null ||
    snapshot.metadata?.snapshotComplete === false ||
    snapshot.source !== options.adapter.source
  ) {
    return {
      ...observed,
      status: "READ_FAILED",
      reason: "The read-only lifecycle snapshot is incomplete or has no trusted source block.",
    };
  }
  if (
    snapshot.chainId !== scope.chainId ||
    !isAddress(snapshot.contractAddress) ||
    getAddress(snapshot.contractAddress) !== scope.contractAddress
  ) {
    return {
      ...observed,
      status: "INCONSISTENT",
      reason: "The snapshot chain or contract does not match the explicit decision scope.",
    };
  }
  if (snapshot.pools.length > 1) {
    return {
      ...observed,
      status: "AMBIGUOUS",
      reason: "Phase 1 accepts exactly one explicitly scoped pool snapshot.",
    };
  }
  if (snapshot.pools.length === 0) {
    return {
      ...observed,
      status: "READ_FAILED",
      reason: "The explicitly scoped pool is absent from the snapshot.",
    };
  }
  if (snapshot.pools[0].poolId !== scope.poolId) {
    return {
      ...observed,
      status: "INCONSISTENT",
      reason: "The snapshot pool does not match the explicit decision scope.",
    };
  }

  let report;
  try {
    report = analyzeLifecycleSnapshot(snapshot, {
      drawOverdueThresholdSeconds:
        options.drawOverdueThresholdSeconds ??
        DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
    });
  } catch {
    return {
      ...observed,
      status: "READ_FAILED",
      reason: "The read-only lifecycle snapshot could not be analyzed safely.",
    };
  }

  const matchingPlans = report.plans.filter((plan) => plan.poolId === scope.poolId);
  const diagnosticCodes = [
    ...report.systemDiagnostics.map((diagnostic) => diagnostic.code),
    ...matchingPlans.flatMap((plan) =>
      plan.diagnostics.map((diagnostic) => diagnostic.code)),
  ];
  if (hasIncompleteReadDiagnostic(diagnosticCodes)) {
    return {
      ...observed,
      status: "READ_FAILED",
      reason: "The lifecycle analysis contains incomplete or untrusted read data.",
    };
  }
  if (report.systemDiagnostics.length > 0) {
    return {
      ...observed,
      status: "INCONSISTENT",
      reason: report.systemDiagnostics[0].detail,
    };
  }
  if (matchingPlans.length !== 1) {
    return {
      ...observed,
      status: matchingPlans.length > 1 ? "AMBIGUOUS" : "READ_FAILED",
      reason: matchingPlans.length > 1
        ? "More than one lifecycle plan matches the explicit pool scope."
        : "No lifecycle plan matches the explicit pool scope.",
    };
  }

  const plan = matchingPlans[0];
  const decided = { ...observed, nextAction: plan.nextAction };
  if (plan.nextAction === "INCONSISTENT_STATE" || plan.diagnostics.length > 0) {
    return {
      ...decided,
      status: "INCONSISTENT",
      reason: plan.diagnostics[0]?.detail ?? plan.explanation,
    };
  }
  if (plan.nextAction === "DRAW_DUE" || plan.nextAction === "DRAW_OVERDUE") {
    if (plan.nextRoundNumber === null || plan.dueAt === null) {
      return {
        ...decided,
        status: "READ_FAILED",
        reason: "A due Draw has no trusted round number or due timestamp.",
      };
    }
    return {
      ...decided,
      status: "DRAW_DUE",
      roundNumber: plan.nextRoundNumber,
      scheduledAt: plan.dueAt,
      logicalDrawKey: logicalDrawKey({
        ...scope,
        roundNumber: plan.nextRoundNumber,
      }),
      reason: plan.explanation,
    };
  }
  if (
    plan.nextAction === "WAITING_FOR_PARTICIPANTS" ||
    plan.nextAction === "WAITING_FOR_FIRST_DRAW" ||
    plan.nextAction === "WAITING_FOR_NEXT_DRAW" ||
    plan.nextAction === "CLAIMS_OUTSTANDING" ||
    plan.nextAction === "FINISHED" ||
    plan.nextAction === "NO_ACTION"
  ) {
    return {
      ...decided,
      status: "NO_ACTION",
      reason: plan.explanation,
    };
  }
  return {
    ...decided,
    status: "AMBIGUOUS",
    reason: "The lifecycle supervisor returned an unsupported decision.",
  };
}
