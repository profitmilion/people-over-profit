import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 2) {
  console.error("This initializer accepts no CLI arguments. Use the reviewed PowerShell launcher.");
  process.exit(2);
}

const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    name.startsWith("POP33_PILOT_") ||
    !/(?:private|secret|mnemonic|password|passphrase|deployer|confirm|api.?key)/i.test(name),
  ),
);
const hardhatCli = fileURLToPath(new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url));
const child = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--no-compile", "scripts/initialize-base-sepolia-pilot-5.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: childEnvironment,
    stdio: "inherit",
  },
);
delete childEnvironment.POP33_PILOT_PASSWORD_FIRST;
delete childEnvironment.POP33_PILOT_PASSWORD_SECOND;
delete childEnvironment.POP33_PILOT_INITIALIZER_CONFIRMATION;
delete childEnvironment.POP33_PILOT_TARGET_DIRECTORY;
delete process.env.POP33_PILOT_TARGET_DIRECTORY;
delete process.env.POP33_PILOT_PASSWORD_FIRST;
delete process.env.POP33_PILOT_PASSWORD_SECOND;
delete process.env.POP33_PILOT_INITIALIZER_CONFIRMATION;
if (child.error) {
  console.error("Unable to start the pilot operator-set initializer.");
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}
