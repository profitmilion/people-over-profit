import {
  DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
  analyzeLifecycleSnapshot,
  filterSupervisorReport,
  renderSupervisorJson,
  renderSupervisorText,
} from "./operator/lifecycle-supervisor.js";
import {
  FixtureLifecycleSnapshotAdapter,
  assertLifecycleFixtureName,
  loadLifecycleFixture,
} from "./operator/lifecycle-supervisor-fixtures.js";
import {
  BaseSepoliaLifecycleSnapshotAdapter,
  LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
  LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  LifecycleSupervisorAdapterError,
  ViemLifecycleSupervisorPublicClient,
  redactLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./operator/lifecycle-supervisor-base-sepolia.js";
import {
  DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS,
  LIFECYCLE_REVALIDATION_EXIT_CODES,
  createLifecycleActionPlan,
  invalidLifecycleActionPlanResult,
  lifecycleRevalidationExitCode,
  parseLifecycleActionPlanJson,
  renderLifecycleActionPlanText,
  renderLifecycleRevalidationJson,
  renderLifecycleRevalidationText,
  revalidateLifecycleActionPlan,
  serializeLifecycleActionPlan,
  type LifecycleActionPlan,
} from "./operator/lifecycle-action-plan.js";
import {
  readLifecyclePlanFile,
  writeLifecyclePlanFile,
} from "./operator/lifecycle-plan-file.js";

function readUnsignedBigInt(name: string, value: string | undefined): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const createPlanPath =
    process.env.POP33_INTERNAL_SUPERVISOR_CREATE_PLAN?.trim() ?? "";
  const revalidatePlanPath =
    process.env.POP33_INTERNAL_SUPERVISOR_REVALIDATE_PLAN?.trim() ?? "";
  if (createPlanPath && revalidatePlanPath) {
    throw new Error("--create-plan and --revalidate-plan cannot be combined.");
  }
  if (
    process.env.POP33_INTERNAL_SUPERVISOR_OVERWRITE_PLAN === "true" &&
    !createPlanPath
  ) {
    throw new Error("--overwrite-plan requires --create-plan.");
  }

  let savedPlan: LifecycleActionPlan | undefined;
  if (revalidatePlanPath) {
    const file = await readLifecyclePlanFile(revalidatePlanPath);
    const parsed = parseLifecycleActionPlanJson(file.json);
    if (!parsed.ok) {
      const invalid = invalidLifecycleActionPlanResult(parsed.errors);
      const format =
        process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() ?? "text";
      console.log(
        format === "json"
          ? renderLifecycleRevalidationJson(invalid)
          : renderLifecycleRevalidationText(invalid),
      );
      process.exitCode = lifecycleRevalidationExitCode(invalid.status);
      return;
    }
    savedPlan = parsed.plan;
  }

  const sourceWasExplicit =
    process.env.POP33_INTERNAL_SUPERVISOR_SOURCE_EXPLICIT === "true";
  let source = process.env.POP33_INTERNAL_SUPERVISOR_SOURCE?.trim() ?? "fixtures";
  if (savedPlan && !sourceWasExplicit) {
    source = savedPlan.source.type === "base-sepolia-read-only"
      ? "base-sepolia"
      : "fixtures";
  }
  if (source !== "fixtures" && source !== "base-sepolia") {
    throw new Error("Supervisor source must be fixtures or base-sepolia.");
  }
  const format = process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error("Supervisor output format must be text or json.");
  }

  let poolId = readUnsignedBigInt(
    "Pool ID",
    process.env.POP33_INTERNAL_SUPERVISOR_POOL_ID?.trim(),
  );
  if (savedPlan) {
    const savedPoolId = BigInt(savedPlan.scope.poolId);
    if (poolId !== undefined && poolId !== savedPoolId) {
      throw new Error("--pool must match the pool ID stored in the plan.");
    }
    poolId = savedPoolId;
  }
  if (poolId !== undefined && poolId === 0n) throw new Error("Pool ID must be positive.");
  const fromPoolId = readUnsignedBigInt(
    "From pool ID",
    process.env.POP33_INTERNAL_SUPERVISOR_FROM_POOL_ID?.trim(),
  );
  const toPoolId = readUnsignedBigInt(
    "To pool ID",
    process.env.POP33_INTERNAL_SUPERVISOR_TO_POOL_ID?.trim(),
  );
  if ((fromPoolId === undefined) !== (toPoolId === undefined)) {
    throw new Error("--from-pool and --to-pool must be supplied together.");
  }
  if (poolId !== undefined && fromPoolId !== undefined) {
    throw new Error("--pool cannot be combined with --from-pool and --to-pool.");
  }
  const blockNumber = readUnsignedBigInt(
    "Block number",
    process.env.POP33_INTERNAL_SUPERVISOR_BLOCK_NUMBER?.trim(),
  );
  if (blockNumber === 0n) throw new Error("Block number must be positive.");
  const configuredThreshold = readUnsignedBigInt(
    "Overdue threshold",
    process.env.POP33_INTERNAL_SUPERVISOR_OVERDUE_THRESHOLD?.trim(),
  );
  const maxPlanAge = readUnsignedBigInt(
    "Maximum plan age",
    process.env.POP33_INTERNAL_SUPERVISOR_MAX_PLAN_AGE?.trim(),
  );
  if (createPlanPath && poolId === undefined) {
    throw new Error("--create-plan requires exactly one --pool ID.");
  }
  if (savedPlan && fromPoolId !== undefined) {
    throw new Error("--revalidate-plan cannot be combined with a pool range.");
  }
  let adapter;
  let sourceReference: string;
  if (source === "fixtures") {
    if (fromPoolId !== undefined || blockNumber !== undefined) {
      throw new Error("Pool ranges and block overrides are available only for base-sepolia.");
    }
    const fixtureName = assertLifecycleFixtureName(
      savedPlan?.source.type === "fixture"
      ? savedPlan.source.reference
      : process.env.POP33_INTERNAL_SUPERVISOR_FIXTURE?.trim() ?? "multi-pool");
    adapter = new FixtureLifecycleSnapshotAdapter(loadLifecycleFixture(fixtureName));
    sourceReference = fixtureName;
  } else {
    const rpcUrl = validateLifecycleSupervisorRpcUrl(
      process.env.BASE_SEPOLIA_SUPERVISOR_RPC_URL?.trim() ??
        LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
    );
    const rawTimeout = process.env.POP33_INTERNAL_SUPERVISOR_TIMEOUT_MS?.trim();
    const timeoutMs = validateLifecycleSupervisorTimeout(
      rawTimeout ? Number(rawTimeout) : LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
    );
    const contractOverride =
      process.env.POP33_INTERNAL_SUPERVISOR_CONTRACT_ADDRESS?.trim() ||
      process.env.BASE_SEPOLIA_SUPERVISOR_CONTRACT_ADDRESS?.trim() ||
      savedPlan?.identity.contractAddress ||
      undefined;
    adapter = new BaseSepoliaLifecycleSnapshotAdapter({
      client: new ViemLifecycleSupervisorPublicClient(rpcUrl, timeoutMs),
      rpcHost: redactLifecycleSupervisorRpcUrl(rpcUrl),
      contractAddress: contractOverride,
      blockNumber,
      poolRange: poolId !== undefined
        ? { fromPoolId: poolId, toPoolId: poolId }
        : fromPoolId !== undefined && toPoolId !== undefined
          ? { fromPoolId, toPoolId }
          : undefined,
    });
    sourceReference = "base-sepolia";
  }
  const snapshot = await adapter.readSnapshot();
  const fullReport = analyzeLifecycleSnapshot(snapshot, {
      drawOverdueThresholdSeconds:
        configuredThreshold ?? DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
    });
  const report = filterSupervisorReport(
    fullReport,
    {
      poolId,
      onlyActionable:
        process.env.POP33_INTERNAL_SUPERVISOR_ONLY_ACTIONABLE === "true",
      onlyWarnings:
        process.env.POP33_INTERNAL_SUPERVISOR_ONLY_WARNINGS === "true",
    },
  );

  if (savedPlan) {
    const revalidation = revalidateLifecycleActionPlan(
      savedPlan,
      snapshot,
      fullReport,
      {
        maxPlanAgeSeconds:
          maxPlanAge ?? DEFAULT_LIFECYCLE_PLAN_MAX_AGE_SECONDS,
        freshSourceReference: sourceReference,
      },
    );
    console.log(
      format === "json"
        ? renderLifecycleRevalidationJson(revalidation)
        : renderLifecycleRevalidationText(revalidation),
    );
    process.exitCode = lifecycleRevalidationExitCode(revalidation.status);
    return;
  }

  if (createPlanPath) {
    const plan = createLifecycleActionPlan(
      snapshot,
      fullReport,
      poolId as bigint,
      { sourceReference },
    );
    const savedPath = await writeLifecyclePlanFile(createPlanPath, plan, {
      overwrite:
        process.env.POP33_INTERNAL_SUPERVISOR_OVERWRITE_PLAN === "true",
    });
    console.log(
      format === "json"
        ? serializeLifecycleActionPlan(plan).trimEnd()
        : `${renderLifecycleActionPlanText(plan)}\nSaved: ${savedPath}`,
    );
    return;
  }

  console.log(
    format === "json"
      ? renderSupervisorJson(report)
      : renderSupervisorText(report),
  );
  if (
    report.systemDiagnostics.length > 0 ||
    report.plans.some((plan) => plan.nextAction === "INCONSISTENT_STATE")
  ) {
    process.exitCode = 2;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lifecycle supervisor stopped: ${message}`);
  console.error("Safety result: no key or transaction path was loaded.");
  process.exitCode =
    process.env.POP33_INTERNAL_SUPERVISOR_REVALIDATE_PLAN?.trim() &&
      error instanceof LifecycleSupervisorAdapterError
      ? LIFECYCLE_REVALIDATION_EXIT_CODES.RPC_FAILURE
      : 1;
});
