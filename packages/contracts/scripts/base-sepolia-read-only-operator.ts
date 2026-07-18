import { auditBaseSepoliaOperatorArtifacts } from "./operator/base-sepolia-artifact-audit.js";
import {
  PUBLIC_OPERATOR_DEFAULT_RPC_URL,
  assertPublicOperatorMode,
  assertPublicOperatorWalletCount,
  renderPublicOperatorText,
  runBaseSepoliaReadOnlyOperator,
  validatePublicOperatorRpcUrl,
} from "./operator/base-sepolia-read-only-operator.js";
import { EthersBaseSepoliaReadOnlyRuntime } from "./operator/ethers-base-sepolia-read-only-runtime.js";
import {
  sanitizeOperatorError,
} from "./operator/transaction-journal.js";

async function main(): Promise<void> {
  const mode = assertPublicOperatorMode(process.env.POP33_INTERNAL_OPERATOR_MODE?.trim() ?? "preflight");
  const walletCount = assertPublicOperatorWalletCount(
    Number(process.env.POP33_INTERNAL_OPERATOR_WALLET_COUNT?.trim() ?? "2"),
  );
  const startIndex = Number(process.env.POP33_INTERNAL_OPERATOR_START_INDEX?.trim() ?? "0");
  const format = process.env.POP33_INTERNAL_OPERATOR_FORMAT?.trim() ?? "both";
  if (!new Set(["text", "json", "both"]).has(format)) {
    throw new Error("Output format must be text, json, or both.");
  }
  const rpcUrl = validatePublicOperatorRpcUrl(
    process.env.BASE_SEPOLIA_OPERATOR_RPC_URL?.trim() ?? PUBLIC_OPERATOR_DEFAULT_RPC_URL,
  );
  const runtime = new EthersBaseSepoliaReadOnlyRuntime(rpcUrl);
  const artifacts = await auditBaseSepoliaOperatorArtifacts(
    await runtime.getLatestBlockNumber(),
    process.env,
  );
  const report = await runBaseSepoliaReadOnlyOperator({
    runtime,
    mode,
    walletCount,
    startIndex,
    rpcHost: new URL(rpcUrl).host,
    artifacts,
    walletPacingMs: 200,
  });
  if (format === "text" || format === "both") console.log(renderPublicOperatorText(report));
  if (format === "both") console.log("\n--- JSON REPORT ---");
  if (format === "json" || format === "both") console.log(JSON.stringify(report, null, 2));
  if (!report.readyForSeparatelyAuthorizedPilot) process.exitCode = 2;
}

void main().catch((error: unknown) => {
  console.error(`Base Sepolia read-only operator stopped: ${sanitizeOperatorError(error)}`);
  console.error("Safety result: no signing or broadcast path was loaded.");
  process.exitCode = 1;
});
