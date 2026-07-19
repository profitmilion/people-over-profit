import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function runFullLifecycle99WalletStoreCli() {
  if (process.argv.length !== 2) {
    console.error("This command accepts no CLI arguments. Use the reviewed PowerShell launcher.");
    return 2;
  }

  const childEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      name.startsWith("POP33_FULL_LIFECYCLE_") ||
      !/(?:private|secret|mnemonic|password|passphrase|deployer|confirm|api.?key|rpc)/i.test(name),
    ),
  );
  const hardhatCli = fileURLToPath(new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url));
  const child = spawnSync(
    process.execPath,
    [hardhatCli, "run", "--no-compile", "scripts/full-lifecycle-99-wallet-store-command.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: childEnvironment,
      stdio: "inherit",
    },
  );
  for (const name of [
    "POP33_FULL_LIFECYCLE_MODE",
    "POP33_FULL_LIFECYCLE_TARGET_DIRECTORY",
    "POP33_FULL_LIFECYCLE_PASSWORD_FIRST",
    "POP33_FULL_LIFECYCLE_PASSWORD_SECOND",
    "POP33_FULL_LIFECYCLE_CONFIRMATION",
  ]) {
    delete childEnvironment[name];
    delete process.env[name];
  }
  if (child.error) {
    console.error("Unable to start the full-lifecycle wallet-store command.");
    return 1;
  }
  return child.status ?? 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = runFullLifecycle99WalletStoreCli();
}
