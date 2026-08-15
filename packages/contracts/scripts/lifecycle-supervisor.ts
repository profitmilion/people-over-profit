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
  ResilientViemLifecycleSupervisorPublicClient,
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
import {
  executeGuardedSingleDraw,
  inspectGuardedSingleDraw,
  renderGuardedDrawJson,
  renderGuardedDrawText,
  simulateGuardedSingleDraw,
  type GuardedDrawMode,
} from "./operator/guarded-single-draw.js";
import {
  createBaseSepoliaGuardedDrawDependencies,
} from "./operator/guarded-single-draw-base-sepolia.js";
import {
  EXACT_99_READINESS_SAFETY,
  Exact99ReadinessInputError,
  ViemExact99ReadinessPublicClient,
  createLiveExact99ReadinessPlan,
  invalidExact99ReadinessPlanResult,
  parseExact99ReadinessPlanJson,
  readExact99PublicManifestFile,
  readExact99ReadinessPlanFile,
  readinessExitCode,
  readinessRevalidationExitCode,
  renderExact99ReadinessJson,
  renderExact99ReadinessRevalidationJson,
  renderExact99ReadinessRevalidationText,
  renderExact99ReadinessText,
  revalidateExact99ReadinessPlan,
  writeExact99ReadinessPlanFile,
} from "./operator/exact-99-base-sepolia-readiness.js";

function readUnsignedBigInt(name: string, value: string | undefined): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer.`);
  return BigInt(value);
}

function supervisorRpcUrls(): string[] {
  const primary = validateLifecycleSupervisorRpcUrl(
    process.env.BASE_SEPOLIA_SUPERVISOR_RPC_URL?.trim() ??
      LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL,
  );
  const fallbackValue =
    process.env.BASE_SEPOLIA_SUPERVISOR_RPC_URL_FALLBACK?.trim();
  const urls = fallbackValue
    ? [primary, validateLifecycleSupervisorRpcUrl(fallbackValue)]
    : [primary];
  return [...new Set(urls)];
}

async function runGuardedDraw(mode: GuardedDrawMode, planPath: string): Promise<void> {
  const file = await readLifecyclePlanFile(planPath);
  let poolId = 1n;
  try {
    const value = JSON.parse(file.json) as { scope?: { poolId?: unknown } };
    if (
      typeof value.scope?.poolId === "string" &&
      /^\d+$/.test(value.scope.poolId) &&
      BigInt(value.scope.poolId) > 0n
    ) {
      poolId = BigInt(value.scope.poolId);
    }
  } catch {
    // The guarded core returns INVALID_PLAN without touching the network.
  }
  const rpcUrls = supervisorRpcUrls();
  const rawTimeout = process.env.POP33_INTERNAL_SUPERVISOR_TIMEOUT_MS?.trim();
  const timeoutMs = validateLifecycleSupervisorTimeout(
    rawTimeout ? Number(rawTimeout) : LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  );
  const dependencies = createBaseSepoliaGuardedDrawDependencies({
    rpcUrl: rpcUrls[0],
    fallbackRpcUrl: rpcUrls[1],
    timeoutMs,
    poolId,
    operatorAddress:
      process.env.BASE_SEPOLIA_DRAW_OPERATOR_ADDRESS?.trim() || undefined,
    auditPath:
      process.env.POP33_INTERNAL_GUARDED_DRAW_AUDIT_PATH?.trim() || undefined,
  });
  const common = {
    planJson: file.json,
    operatorAddress:
      process.env.BASE_SEPOLIA_DRAW_OPERATOR_ADDRESS?.trim() || undefined,
    maxPlanAgeSeconds: readUnsignedBigInt(
      "Maximum plan age",
      process.env.POP33_INTERNAL_SUPERVISOR_MAX_PLAN_AGE?.trim(),
    ),
  };
  const outcome = mode === "inspect"
    ? await inspectGuardedSingleDraw(common, dependencies)
    : mode === "simulate"
      ? await simulateGuardedSingleDraw(common, dependencies)
      : await executeGuardedSingleDraw({
          ...common,
          confirmation: {
            chainId:
              process.env.POP33_INTERNAL_GUARDED_DRAW_CONFIRM_CHAIN?.trim() ?? "",
            contractAddress:
              process.env.POP33_INTERNAL_GUARDED_DRAW_CONFIRM_CONTRACT?.trim() ??
                "",
            poolId:
              process.env.POP33_INTERNAL_GUARDED_DRAW_CONFIRM_POOL?.trim() ?? "",
            roundNumber:
              process.env.POP33_INTERNAL_GUARDED_DRAW_CONFIRM_ROUND?.trim() ??
                "",
          },
        }, dependencies);
  const format = process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() ?? "text";
  console.log(
    format === "json"
      ? renderGuardedDrawJson(outcome)
      : renderGuardedDrawText(outcome),
  );
  process.exitCode = outcome.exitCode;
}

async function runExact99Readiness(): Promise<void> {
  const createPath =
    process.env.POP33_INTERNAL_EXACT99_CREATE_READINESS_PLAN?.trim() ?? "";
  const revalidatePath =
    process.env.POP33_INTERNAL_EXACT99_REVALIDATE_READINESS_PLAN?.trim() ?? "";
  const manifestPath =
    process.env.POP33_INTERNAL_EXACT99_MANIFEST?.trim() ?? "";
  const explicitCandidate =
    process.env.POP33_INTERNAL_EXACT99_CANDIDATE_ADDRESS?.trim() ?? "";
  const format = process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error("Readiness output format must be text or json.");
  }
  if (createPath && revalidatePath) {
    throw new Error(
      "--create-readiness-plan and --revalidate-readiness-plan cannot be combined.",
    );
  }
  if (
    process.env.POP33_INTERNAL_SUPERVISOR_OVERWRITE_PLAN === "true" &&
    !createPath
  ) {
    throw new Error("--overwrite-plan requires --create-readiness-plan.");
  }
  if (
    process.env.POP33_INTERNAL_SUPERVISOR_SOURCE_EXPLICIT === "true" &&
    process.env.POP33_INTERNAL_SUPERVISOR_SOURCE?.trim() !== "base-sepolia"
  ) {
    throw new Error("Exact-99 readiness supports only --source base-sepolia.");
  }

  let savedPlan;
  if (revalidatePath) {
    const file = await readExact99ReadinessPlanFile(revalidatePath);
    const parsed = parseExact99ReadinessPlanJson(file.json);
    if (!parsed.ok) {
      const invalid = invalidExact99ReadinessPlanResult(parsed.errors);
      console.log(
        format === "json"
          ? renderExact99ReadinessRevalidationJson(invalid)
          : renderExact99ReadinessRevalidationText(invalid),
      );
      process.exitCode = readinessRevalidationExitCode(invalid.status);
      return;
    }
    savedPlan = parsed.plan;
    if (
      savedPlan.manifest.status !== "MANIFEST_NOT_PROVIDED" &&
      !manifestPath
    ) {
      throw new Error(
        "A manifest-bound readiness plan requires --manifest during revalidation.",
      );
    }
  }

  let poolId = readUnsignedBigInt(
    "Pool ID",
    process.env.POP33_INTERNAL_SUPERVISOR_POOL_ID?.trim(),
  );
  if (savedPlan) {
    const savedPoolId = BigInt(savedPlan.pool.poolId);
    if (poolId !== undefined && poolId !== savedPoolId) {
      throw new Error("--pool must match the pool ID stored in the readiness plan.");
    }
    poolId = savedPoolId;
  }
  if (poolId === undefined || poolId <= 0n) {
    throw new Error("Exact-99 readiness requires exactly one positive --pool ID.");
  }
  const candidateAddress =
    explicitCandidate || savedPlan?.candidate.address || undefined;
  if (
    explicitCandidate &&
    savedPlan?.candidate.address &&
    explicitCandidate.toLowerCase() !== savedPlan.candidate.address.toLowerCase()
  ) {
    throw new Error(
      "--candidate-address must match the address stored in the readiness plan.",
    );
  }
  const manifestJson = manifestPath
    ? (await readExact99PublicManifestFile(manifestPath)).json
    : undefined;
  const rpcUrls = supervisorRpcUrls();
  const rawTimeout = process.env.POP33_INTERNAL_SUPERVISOR_TIMEOUT_MS?.trim();
  const timeoutMs = validateLifecycleSupervisorTimeout(
    rawTimeout ? Number(rawTimeout) : LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  );
  const blockNumber = readUnsignedBigInt(
    "Block number",
    process.env.POP33_INTERNAL_SUPERVISOR_BLOCK_NUMBER?.trim(),
  );
  if (blockNumber === 0n) throw new Error("Block number must be positive.");
  const snapshot = await new BaseSepoliaLifecycleSnapshotAdapter({
    client: new ResilientViemLifecycleSupervisorPublicClient(rpcUrls, timeoutMs),
    rpcHost: rpcUrls.length > 1
      ? "base-sepolia-rpc-failover"
      : redactLifecycleSupervisorRpcUrl(rpcUrls[0]),
    contractAddress:
      process.env.POP33_INTERNAL_SUPERVISOR_CONTRACT_ADDRESS?.trim() ||
      process.env.BASE_SEPOLIA_SUPERVISOR_CONTRACT_ADDRESS?.trim() ||
      undefined,
    blockNumber,
  }).readSnapshot();
  const report = analyzeLifecycleSnapshot(snapshot);
  const plan = await createLiveExact99ReadinessPlan({
    snapshot,
    report,
    publicClient: new ViemExact99ReadinessPublicClient(rpcUrls[0], timeoutMs),
    poolId,
    sourceReference: "base-sepolia",
    manifestJson,
    candidateAddress,
  });

  if (savedPlan) {
    const result = revalidateExact99ReadinessPlan(savedPlan, plan, {
      maxAgeSeconds: readUnsignedBigInt(
        "Maximum readiness plan age",
        process.env.POP33_INTERNAL_SUPERVISOR_MAX_PLAN_AGE?.trim(),
      ),
    });
    console.log(
      format === "json"
        ? renderExact99ReadinessRevalidationJson(result)
        : renderExact99ReadinessRevalidationText(result),
    );
    process.exitCode = readinessRevalidationExitCode(result.status);
    return;
  }

  if (createPath) {
    const savedPath = await writeExact99ReadinessPlanFile(createPath, plan, {
      overwrite:
        process.env.POP33_INTERNAL_SUPERVISOR_OVERWRITE_PLAN === "true",
    });
    console.log(
      format === "json"
        ? renderExact99ReadinessJson(plan)
        : `${renderExact99ReadinessText(plan)}\nSaved: ${savedPath}`,
    );
  } else {
    console.log(
      format === "json"
        ? renderExact99ReadinessJson(plan)
        : renderExact99ReadinessText(plan),
    );
  }
  process.exitCode = readinessExitCode(plan.decision.status);
}

async function main(): Promise<void> {
  const drawModes = [
    ["inspect", process.env.POP33_INTERNAL_GUARDED_DRAW_INSPECT?.trim()],
    ["simulate", process.env.POP33_INTERNAL_GUARDED_DRAW_SIMULATE?.trim()],
    ["execute", process.env.POP33_INTERNAL_GUARDED_DRAW_EXECUTE?.trim()],
  ].filter((entry): entry is [GuardedDrawMode, string] => Boolean(entry[1]));
  if (drawModes.length > 1) {
    throw new Error(
      "--inspect-draw, --simulate-draw, and --execute-draw are mutually exclusive.",
    );
  }
  if (drawModes.length === 1) {
    await runGuardedDraw(drawModes[0][0], drawModes[0][1]);
    return;
  }
  const readinessRequested =
    process.env.POP33_INTERNAL_EXACT99_READINESS === "true" ||
    Boolean(
      process.env.POP33_INTERNAL_EXACT99_CREATE_READINESS_PLAN?.trim() ||
      process.env.POP33_INTERNAL_EXACT99_REVALIDATE_READINESS_PLAN?.trim(),
    );
  if (readinessRequested) {
    await runExact99Readiness();
    return;
  }
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
    const rpcUrls = supervisorRpcUrls();
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
      client: new ResilientViemLifecycleSupervisorPublicClient(rpcUrls, timeoutMs),
      rpcHost: rpcUrls.length > 1
        ? "base-sepolia-rpc-failover"
        : redactLifecycleSupervisorRpcUrl(rpcUrls[0]),
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
  const readinessMode =
    process.env.POP33_INTERNAL_EXACT99_READINESS === "true" ||
    Boolean(
      process.env.POP33_INTERNAL_EXACT99_CREATE_READINESS_PLAN?.trim() ||
      process.env.POP33_INTERNAL_EXACT99_REVALIDATE_READINESS_PLAN?.trim(),
    );
  if (readinessMode) {
    const status = error instanceof Exact99ReadinessInputError ||
        /requires|cannot be combined|must match|must be positive|supports only/i
          .test(message)
      ? "INVALID_INPUT"
      : "INCOMPLETE";
    const output = {
      status,
      reasonCode: status === "INVALID_INPUT"
        ? "READINESS_INPUT_INVALID"
        : "READINESS_PUBLIC_READ_FAILED",
      message,
      safety: EXACT_99_READINESS_SAFETY,
    };
    if (process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() === "json") {
      console.error(JSON.stringify(output, null, 2));
    } else {
      console.error(`Exact-99 readiness stopped: ${message}`);
      console.error(EXACT_99_READINESS_SAFETY);
    }
    process.exitCode = readinessExitCode(status);
    return;
  }
  console.error(`Lifecycle supervisor stopped: ${message}`);
  console.error("Safety result: no key or transaction path was loaded.");
  process.exitCode =
    process.env.POP33_INTERNAL_SUPERVISOR_REVALIDATE_PLAN?.trim() &&
      error instanceof LifecycleSupervisorAdapterError
      ? LIFECYCLE_REVALIDATION_EXIT_CODES.RPC_FAILURE
      : 1;
});
