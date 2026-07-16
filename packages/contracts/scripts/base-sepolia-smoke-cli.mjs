import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argumentsAfterScript = process.argv.slice(2);
let mode = "read-only";
if (argumentsAfterScript.length === 1 && argumentsAfterScript[0] === "--write-smoke") {
  mode = "write";
} else if (argumentsAfterScript.length !== 0) {
  console.error("Usage: npm run smoke:base-sepolia -- [--write-smoke]");
  process.exitCode = 2;
} else {
  const hardhatCli = fileURLToPath(
    new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    [hardhatCli, "--network", "baseSepoliaSmoke", "run", "scripts/base-sepolia-smoke.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, POP33_INTERNAL_SMOKE_CLI_MODE: mode },
      stdio: "inherit",
    },
  );
  if (child.error) {
    console.error("Unable to start the local smoke harness runner.");
    process.exitCode = 1;
  } else {
    process.exitCode = child.status ?? 1;
  }
}

if (mode === "write" && process.exitCode === undefined) {
  const hardhatCli = fileURLToPath(
    new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    [hardhatCli, "--network", "baseSepoliaSmoke", "run", "scripts/base-sepolia-smoke.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, POP33_INTERNAL_SMOKE_CLI_MODE: mode },
      stdio: "inherit",
    },
  );
  if (child.error) {
    console.error("Unable to start the local smoke harness runner.");
    process.exitCode = 1;
  } else {
    process.exitCode = child.status ?? 1;
  }
}
