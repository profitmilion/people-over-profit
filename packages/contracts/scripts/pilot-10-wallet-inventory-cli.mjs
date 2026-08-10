import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let input = "config/pilot-10-wallets.json";
let format = "both";
while (args.length > 0) {
  const flag = args.shift();
  const value = args.shift();
  if (flag === "--input" && value) input = value;
  else if (flag === "--format" && value && ["text", "json", "both"].includes(value)) format = value;
  else {
    console.error("Usage: npm run inventory:pilot-10 -- [--input path/to/public-wallets.json] [--format text|json|both]");
    process.exit(2);
  }
}

const hardhatCli = fileURLToPath(new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url));
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    !/(?:private|secret|mnemonic|password|passphrase|deployer|confirm|api.?key)/i.test(name),
  ),
);
const child = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--no-compile", "scripts/pilot-10-wallet-inventory.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...childEnvironment,
      POP33_INTERNAL_PILOT_10_INVENTORY_PATH: input,
      POP33_INTERNAL_PILOT_10_INVENTORY_FORMAT: format,
    },
    stdio: "inherit",
  },
);
if (child.error) {
  console.error("Unable to start the Pilot 10 wallet inventory inspector.");
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}
