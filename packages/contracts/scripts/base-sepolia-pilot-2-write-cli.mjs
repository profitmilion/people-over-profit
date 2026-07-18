import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--write-pilot-2") {
  console.error("Usage: npm run operator:base-sepolia:pilot-2-write -- --write-pilot-2");
  process.exitCode = 2;
} else {
  const hardhatCli = fileURLToPath(new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url));
  const child = spawnSync(
    process.execPath,
    [hardhatCli, "--network", "baseSepoliaSmoke", "run", "scripts/base-sepolia-pilot-2-write.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, POP33_INTERNAL_PILOT_2_MODE: "write" },
      stdio: "inherit",
    },
  );
  if (child.error) {
    console.error("Unable to start the guarded pilot runner.");
    process.exitCode = 1;
  } else {
    process.exitCode = child.status ?? 1;
  }
}
