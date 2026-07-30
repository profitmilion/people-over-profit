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
  ViemLifecycleSupervisorPublicClient,
  redactLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./operator/lifecycle-supervisor-base-sepolia.js";

function readUnsignedBigInt(name: string, value: string | undefined): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const source = process.env.POP33_INTERNAL_SUPERVISOR_SOURCE?.trim() ?? "fixtures";
  if (source !== "fixtures" && source !== "base-sepolia") {
    throw new Error("Supervisor source must be fixtures or base-sepolia.");
  }
  const format = process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error("Supervisor output format must be text or json.");
  }

  const poolId = readUnsignedBigInt(
    "Pool ID",
    process.env.POP33_INTERNAL_SUPERVISOR_POOL_ID?.trim(),
  );
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
  let adapter;
  if (source === "fixtures") {
    if (fromPoolId !== undefined || blockNumber !== undefined) {
      throw new Error("Pool ranges and block overrides are available only for base-sepolia.");
    }
    const fixtureName = assertLifecycleFixtureName(
      process.env.POP33_INTERNAL_SUPERVISOR_FIXTURE?.trim() ?? "multi-pool",
    );
    adapter = new FixtureLifecycleSnapshotAdapter(loadLifecycleFixture(fixtureName));
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
  }
  const snapshot = await adapter.readSnapshot();
  const report = filterSupervisorReport(
    analyzeLifecycleSnapshot(snapshot, {
      drawOverdueThresholdSeconds:
        configuredThreshold ?? DEFAULT_DRAW_OVERDUE_THRESHOLD_SECONDS,
    }),
    {
      poolId,
      onlyActionable:
        process.env.POP33_INTERNAL_SUPERVISOR_ONLY_ACTIONABLE === "true",
      onlyWarnings:
        process.env.POP33_INTERNAL_SUPERVISOR_ONLY_WARNINGS === "true",
    },
  );

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
  process.exitCode = 1;
});
