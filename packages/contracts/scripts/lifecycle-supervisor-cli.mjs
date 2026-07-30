import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let source = "fixtures";
let sourceExplicit = false;
let fixture = "multi-pool";
let format = "text";
let poolId = "";
let fromPoolId = "";
let toPoolId = "";
let blockNumber = "";
let contractAddress = "";
let timeoutMs = "";
let onlyActionable = false;
let onlyWarnings = false;
let overdueThreshold = "";
let createPlan = "";
let revalidatePlan = "";
let overwritePlan = false;
let maxPlanAge = "";
let inspectDraw = "";
let simulateDraw = "";
let executeDraw = "";
let confirmChain = "";
let confirmContract = "";
let confirmPool = "";
let confirmRound = "";
let auditLog = "";
let exact99Readiness = false;
let candidateAddress = "";
let manifest = "";
let createReadinessPlan = "";
let revalidateReadinessPlan = "";

function usage() {
  return [
    "Usage: npm run supervisor -- [--source fixtures|base-sepolia] [--fixture NAME]",
    "  [--json] [--pool ID | --from-pool ID --to-pool ID] [--block NUMBER]",
    "  [--contract ADDRESS] [--timeout-ms MS] [--only-actionable]",
    "  [--only-warnings] [--overdue-threshold SECONDS]",
    "  [--create-plan FILE.json [--overwrite-plan] | --revalidate-plan FILE.json]",
    "  [--max-plan-age SECONDS]",
    "  [--inspect-draw FILE.json | --simulate-draw FILE.json |",
    "   --execute-draw FILE.json --confirm-chain 84532 --confirm-contract ADDRESS",
    "   --confirm-pool ID --confirm-round NUMBER] [--audit-log FILE.guarded-draw-audit.json]",
    "  [--exact99-readiness --pool ID [--candidate-address ADDRESS]",
    "   [--manifest FILE.json] [--create-readiness-plan FILE.json [--overwrite-plan]]",
    "   | --revalidate-readiness-plan FILE.json [--manifest FILE.json]]",
  ].join(" ");
}

while (args.length > 0) {
  const flag = args.shift();
  if (flag === "--json") format = "json";
  else if (flag === "--only-actionable") onlyActionable = true;
  else if (flag === "--only-warnings") onlyWarnings = true;
  else if (flag === "--overwrite-plan") overwritePlan = true;
  else if (flag === "--exact99-readiness") exact99Readiness = true;
  else if (flag === "--help") {
    console.log(usage());
    process.exit(0);
  } else if (
    flag === "--source" ||
    flag === "--fixture" ||
    flag === "--pool" ||
    flag === "--from-pool" ||
    flag === "--to-pool" ||
    flag === "--block" ||
    flag === "--contract" ||
    flag === "--timeout-ms" ||
    flag === "--overdue-threshold" ||
    flag === "--create-plan" ||
    flag === "--revalidate-plan" ||
    flag === "--max-plan-age" ||
    flag === "--inspect-draw" ||
    flag === "--simulate-draw" ||
    flag === "--execute-draw" ||
    flag === "--confirm-chain" ||
    flag === "--confirm-contract" ||
    flag === "--confirm-pool" ||
    flag === "--confirm-round" ||
    flag === "--audit-log" ||
    flag === "--candidate-address" ||
    flag === "--manifest" ||
    flag === "--create-readiness-plan" ||
    flag === "--revalidate-readiness-plan"
  ) {
    const value = args.shift();
    if (!value) {
      console.error(usage());
      process.exit(2);
    }
    if (flag === "--source") {
      source = value;
      sourceExplicit = true;
    }
    else if (flag === "--fixture") fixture = value;
    else if (flag === "--pool") poolId = value;
    else if (flag === "--from-pool") fromPoolId = value;
    else if (flag === "--to-pool") toPoolId = value;
    else if (flag === "--block") blockNumber = value;
    else if (flag === "--contract") contractAddress = value;
    else if (flag === "--timeout-ms") timeoutMs = value;
    else if (flag === "--overdue-threshold") overdueThreshold = value;
    else if (flag === "--create-plan") createPlan = value;
    else if (flag === "--revalidate-plan") revalidatePlan = value;
    else if (flag === "--inspect-draw") inspectDraw = value;
    else if (flag === "--simulate-draw") simulateDraw = value;
    else if (flag === "--execute-draw") executeDraw = value;
    else if (flag === "--confirm-chain") confirmChain = value;
    else if (flag === "--confirm-contract") confirmContract = value;
    else if (flag === "--confirm-pool") confirmPool = value;
    else if (flag === "--confirm-round") confirmRound = value;
    else if (flag === "--audit-log") auditLog = value;
    else if (flag === "--candidate-address") candidateAddress = value;
    else if (flag === "--manifest") manifest = value;
    else if (flag === "--create-readiness-plan") {
      createReadinessPlan = value;
      exact99Readiness = true;
    }
    else if (flag === "--revalidate-readiness-plan") {
      revalidateReadinessPlan = value;
      exact99Readiness = true;
    }
    else maxPlanAge = value;
  } else {
    console.error(usage());
    process.exit(2);
  }
}

const hardhatCli = fileURLToPath(
  new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url),
);
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/(?:private|secret|mnemonic|password|passphrase|deployer|confirm|api.?key)/i.test(name),
  ),
);
const guardedDrawModeCount = [inspectDraw, simulateDraw, executeDraw]
  .filter(Boolean).length;
if (guardedDrawModeCount > 1) {
  console.error(usage());
  process.exit(2);
}
if (
  !executeDraw &&
  (confirmChain || confirmContract || confirmPool || confirmRound)
) {
  console.error("Draw confirmations require --execute-draw.");
  process.exit(2);
}
if (
  executeDraw &&
  (!confirmChain || !confirmContract || !confirmPool || !confirmRound)
) {
  console.error(
    "--execute-draw requires exact chain, contract, pool, and round confirmations.",
  );
  process.exit(2);
}
if (
  exact99Readiness &&
  guardedDrawModeCount > 0
) {
  console.error("Exact-99 readiness cannot be combined with guarded Draw modes.");
  process.exit(2);
}
if (
  exact99Readiness &&
  (createPlan || revalidatePlan || onlyActionable || onlyWarnings ||
    fromPoolId || toPoolId || overdueThreshold || fixture !== "multi-pool")
) {
  console.error(
    "Exact-99 readiness cannot be combined with lifecycle-plan, filter, range, or fixture options.",
  );
  process.exit(2);
}
if (createReadinessPlan && revalidateReadinessPlan) {
  console.error(
    "--create-readiness-plan and --revalidate-readiness-plan are mutually exclusive.",
  );
  process.exit(2);
}
if (
  !exact99Readiness &&
  (candidateAddress || manifest || createReadinessPlan || revalidateReadinessPlan)
) {
  console.error("Candidate and manifest options require exact-99 readiness mode.");
  process.exit(2);
}
if (exact99Readiness && sourceExplicit && source !== "base-sepolia") {
  console.error("Exact-99 readiness supports only --source base-sepolia.");
  process.exit(2);
}
if (exact99Readiness) source = "base-sepolia";
const guardedDrawMode = inspectDraw
  ? "inspect"
  : simulateDraw
    ? "simulate"
    : executeDraw
      ? "execute"
      : "";
const effectiveAuditLog = auditLog
  ? resolve(auditLog)
  : guardedDrawMode
    ? fileURLToPath(new URL(
        `../operator-reports/${Date.now()}-${guardedDrawMode}.guarded-draw-audit.json`,
        import.meta.url,
      ))
    : "";
const child = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--no-compile", "scripts/lifecycle-supervisor.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...childEnvironment,
      POP33_INTERNAL_SUPERVISOR_SOURCE: source,
      POP33_INTERNAL_SUPERVISOR_SOURCE_EXPLICIT: String(sourceExplicit),
      POP33_INTERNAL_SUPERVISOR_FIXTURE: fixture,
      POP33_INTERNAL_SUPERVISOR_FORMAT: format,
      POP33_INTERNAL_SUPERVISOR_POOL_ID: poolId,
      POP33_INTERNAL_SUPERVISOR_FROM_POOL_ID: fromPoolId,
      POP33_INTERNAL_SUPERVISOR_TO_POOL_ID: toPoolId,
      POP33_INTERNAL_SUPERVISOR_BLOCK_NUMBER: blockNumber,
      POP33_INTERNAL_SUPERVISOR_CONTRACT_ADDRESS: contractAddress,
      POP33_INTERNAL_SUPERVISOR_TIMEOUT_MS: timeoutMs,
      POP33_INTERNAL_SUPERVISOR_ONLY_ACTIONABLE: String(onlyActionable),
      POP33_INTERNAL_SUPERVISOR_ONLY_WARNINGS: String(onlyWarnings),
      POP33_INTERNAL_SUPERVISOR_OVERDUE_THRESHOLD: overdueThreshold,
      POP33_INTERNAL_SUPERVISOR_CREATE_PLAN: createPlan,
      POP33_INTERNAL_SUPERVISOR_REVALIDATE_PLAN: revalidatePlan,
      POP33_INTERNAL_SUPERVISOR_OVERWRITE_PLAN: String(overwritePlan),
      POP33_INTERNAL_SUPERVISOR_MAX_PLAN_AGE: maxPlanAge,
      POP33_INTERNAL_GUARDED_DRAW_INSPECT: inspectDraw,
      POP33_INTERNAL_GUARDED_DRAW_SIMULATE: simulateDraw,
      POP33_INTERNAL_GUARDED_DRAW_EXECUTE: executeDraw,
      POP33_INTERNAL_GUARDED_DRAW_CONFIRM_CHAIN: confirmChain,
      POP33_INTERNAL_GUARDED_DRAW_CONFIRM_CONTRACT: confirmContract,
      POP33_INTERNAL_GUARDED_DRAW_CONFIRM_POOL: confirmPool,
      POP33_INTERNAL_GUARDED_DRAW_CONFIRM_ROUND: confirmRound,
      POP33_INTERNAL_GUARDED_DRAW_AUDIT_PATH: effectiveAuditLog,
      POP33_INTERNAL_EXACT99_READINESS: String(exact99Readiness),
      POP33_INTERNAL_EXACT99_CANDIDATE_ADDRESS: candidateAddress,
      POP33_INTERNAL_EXACT99_MANIFEST: manifest,
      POP33_INTERNAL_EXACT99_CREATE_READINESS_PLAN: createReadinessPlan,
      POP33_INTERNAL_EXACT99_REVALIDATE_READINESS_PLAN: revalidateReadinessPlan,
      ...(executeDraw && process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY
        ? {
            BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY:
              process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY,
          }
        : {}),
    },
    stdio: "inherit",
  },
);

if (child.error) {
  console.error("Unable to start the lifecycle supervisor.");
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}
