import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let mode = "preflight";
let walletCount = "2";
let startIndex = "0";
let format = "both";

if (args[0] && !args[0].startsWith("--")) mode = args.shift();
while (args.length > 0) {
  const flag = args.shift();
  const value = args.shift();
  if (flag === "--wallet-count" && value) walletCount = value;
  else if (flag === "--start-index" && value) startIndex = value;
  else if (flag === "--format" && value) format = value;
  else {
    console.error("Usage: npm run operator:base-sepolia:read-only -- [preflight|status|plan|dry-run] [--start-index N] [--wallet-count 2|5|100|N] [--format text|json|both]");
    process.exit(2);
  }
}

const hardhatCli = fileURLToPath(new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url));
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    name === "OPERATOR_WALLET_STORE_PASSWORD" ||
    !/(?:private|secret|mnemonic|password|passphrase|deployer|confirm|api.?key)/i.test(name),
  ),
);
const child = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--no-compile", "scripts/base-sepolia-read-only-operator.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...childEnvironment,
      POP33_INTERNAL_OPERATOR_MODE: mode,
      POP33_INTERNAL_OPERATOR_WALLET_COUNT: walletCount,
      POP33_INTERNAL_OPERATOR_START_INDEX: startIndex,
      POP33_INTERNAL_OPERATOR_FORMAT: format,
    },
    stdio: "inherit",
  },
);
if (child.error) {
  console.error("Unable to start the Base Sepolia read-only operator.");
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}
