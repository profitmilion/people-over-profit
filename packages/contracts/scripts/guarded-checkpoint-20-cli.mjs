import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let mode = "plan";
let format = "text";
let candidate = "";

function usage() {
  return "Usage: npm run operator:base-sepolia:checkpoint-20 -- [--plan|--inspect|--simulate] [--candidate ADDRESS] [--json]";
}

while (args.length > 0) {
  const flag = args.shift();
  if (flag === "--plan") mode = "plan";
  else if (flag === "--inspect") mode = "inspect";
  else if (flag === "--simulate") mode = "simulate";
  else if (flag === "--json") format = "json";
  else if (flag === "--candidate") {
    candidate = args.shift() ?? "";
    if (!candidate) {
      console.error(usage());
      process.exit(2);
    }
  } else if (flag === "--execute" || flag?.startsWith("--execute=")) {
    console.error("EXECUTE is not implemented or authorized for checkpoint 20.");
    process.exit(20);
  } else if (flag === "--help") {
    console.log(usage());
    process.exit(0);
  } else {
    console.error(usage());
    process.exit(2);
  }
}

if (candidate && mode !== "inspect") {
  console.error("--candidate is accepted only by read-only --inspect.");
  process.exit(2);
}

const hardhatCli = fileURLToPath(new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url));
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(
  ([name]) => !/(?:private|secret|mnemonic|seed|password|passphrase|credential|api.?key|confirm)/i.test(name),
));
childEnvironment.POP33_CHECKPOINT_20_MODE = mode;
childEnvironment.POP33_CHECKPOINT_20_FORMAT = format;
if (candidate) childEnvironment.POP33_CHECKPOINT_20_CANDIDATE = candidate;

const result = spawnSync(process.execPath, [
  hardhatCli,
  "run",
  "--no-compile",
  "scripts/guarded-checkpoint-20-command.ts",
], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: childEnvironment,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
