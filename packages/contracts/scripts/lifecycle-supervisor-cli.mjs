import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let fixture = "multi-pool";
let format = "text";
let poolId = "";
let onlyActionable = false;
let onlyWarnings = false;
let overdueThreshold = "";

function usage() {
  return [
    "Usage: npm run supervisor -- [--fixture NAME] [--json] [--pool ID]",
    "  [--only-actionable] [--only-warnings] [--overdue-threshold SECONDS]",
  ].join(" ");
}

while (args.length > 0) {
  const flag = args.shift();
  if (flag === "--json") format = "json";
  else if (flag === "--only-actionable") onlyActionable = true;
  else if (flag === "--only-warnings") onlyWarnings = true;
  else if (flag === "--help") {
    console.log(usage());
    process.exit(0);
  } else if (flag === "--fixture" || flag === "--pool" || flag === "--overdue-threshold") {
    const value = args.shift();
    if (!value) {
      console.error(usage());
      process.exit(2);
    }
    if (flag === "--fixture") fixture = value;
    else if (flag === "--pool") poolId = value;
    else overdueThreshold = value;
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
const child = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--no-compile", "scripts/lifecycle-supervisor.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...childEnvironment,
      POP33_INTERNAL_SUPERVISOR_FIXTURE: fixture,
      POP33_INTERNAL_SUPERVISOR_FORMAT: format,
      POP33_INTERNAL_SUPERVISOR_POOL_ID: poolId,
      POP33_INTERNAL_SUPERVISOR_ONLY_ACTIONABLE: String(onlyActionable),
      POP33_INTERNAL_SUPERVISOR_ONLY_WARNINGS: String(onlyWarnings),
      POP33_INTERNAL_SUPERVISOR_OVERDUE_THRESHOLD: overdueThreshold,
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
