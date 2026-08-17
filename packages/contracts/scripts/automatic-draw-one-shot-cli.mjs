import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let mode = "";
let pool = "";
let plan = "";
let confirmChain = "";
let confirmContract = "";
let confirmPool = "";
let confirmRound = "";

function usage() {
  return [
    "Usage: npm run automatic-draw-one-shot -- --mode prepare --pool ID --plan FILE.json",
    "   or: npm run automatic-draw-one-shot -- --mode execute-once --plan FILE.json",
    "       --confirm-chain 84532 --confirm-contract ADDRESS",
    "       --confirm-pool ID --confirm-round NUMBER",
  ].join("\n");
}

while (args.length > 0) {
  const flag = args.shift();
  if (flag === "--help") {
    console.log(usage());
    process.exit(0);
  }
  if (![
    "--mode",
    "--pool",
    "--plan",
    "--confirm-chain",
    "--confirm-contract",
    "--confirm-pool",
    "--confirm-round",
  ].includes(flag)) {
    console.error(usage());
    process.exit(2);
  }
  const value = args.shift();
  if (!value) {
    console.error(usage());
    process.exit(2);
  }
  if (flag === "--mode") mode = value;
  else if (flag === "--pool") pool = value;
  else if (flag === "--plan") plan = value;
  else if (flag === "--confirm-chain") confirmChain = value;
  else if (flag === "--confirm-contract") confirmContract = value;
  else if (flag === "--confirm-pool") confirmPool = value;
  else if (flag === "--confirm-round") confirmRound = value;
}

const hasConfirmation = Boolean(
  confirmChain || confirmContract || confirmPool || confirmRound,
);
const validPrepare =
  mode === "prepare" && pool && plan && !hasConfirmation;
const validExecute =
  mode === "execute-once" &&
  !pool &&
  plan &&
  confirmChain &&
  confirmContract &&
  confirmPool &&
  confirmRound;
if (!validPrepare && !validExecute) {
  console.error(usage());
  process.exit(2);
}

process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_INVOKE = "true";
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_MODE = mode;
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_POOL = pool;
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_PLAN = plan;
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_CHAIN = confirmChain;
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_CONTRACT =
  confirmContract;
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_POOL = confirmPool;
process.env.POP33_INTERNAL_AUTOMATIC_DRAW_ONE_SHOT_CONFIRM_ROUND = confirmRound;
if (mode === "prepare") {
  delete process.env.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY;
}

const hardhatCli = fileURLToPath(
  new URL("../node_modules/hardhat/dist/src/cli.js", import.meta.url),
);
const child = spawnSync(
  process.execPath,
  [hardhatCli, "run", "--no-compile", "scripts/automatic-draw-one-shot.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
  },
);

if (child.error) {
  console.error("Unable to start the automatic Draw one-shot runner.");
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}
