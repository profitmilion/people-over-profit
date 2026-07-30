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

function readUnsignedBigInt(name: string, value: string | undefined): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer.`);
  return BigInt(value);
}

async function main(): Promise<void> {
  const fixtureName = assertLifecycleFixtureName(
    process.env.POP33_INTERNAL_SUPERVISOR_FIXTURE?.trim() ?? "multi-pool",
  );
  const format = process.env.POP33_INTERNAL_SUPERVISOR_FORMAT?.trim() ?? "text";
  if (format !== "text" && format !== "json") {
    throw new Error("Supervisor output format must be text or json.");
  }

  const poolId = readUnsignedBigInt(
    "Pool ID",
    process.env.POP33_INTERNAL_SUPERVISOR_POOL_ID?.trim(),
  );
  if (poolId !== undefined && poolId === 0n) throw new Error("Pool ID must be positive.");
  const configuredThreshold = readUnsignedBigInt(
    "Overdue threshold",
    process.env.POP33_INTERNAL_SUPERVISOR_OVERDUE_THRESHOLD?.trim(),
  );
  const adapter = new FixtureLifecycleSnapshotAdapter(loadLifecycleFixture(fixtureName));
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
