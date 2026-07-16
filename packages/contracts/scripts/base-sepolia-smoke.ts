import { Wallet } from "ethers";
import { network } from "hardhat";

import { JsonTransactionJournal, sanitizeOperatorError } from "./operator/transaction-journal.js";
import {
  BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION,
  BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION,
  BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
  BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  assertSmokeWriteAuthorization,
  readDedicatedSmokePrivateKey,
  readSmokeReadConfiguration,
  runSmokeReadOnlyPreflight,
  runSmokeWriteFlow,
} from "./smoke/base-sepolia-smoke.js";
import { EthersBaseSepoliaSmokeRuntime } from "./smoke/ethers-smoke-runtime.js";

function printPreflight(report: Awaited<ReturnType<typeof runSmokeReadOnlyPreflight>>): void {
  console.log("POP33 Base Sepolia single-wallet smoke preflight");
  console.log("  Mode: read-only (no signing or broadcast performed)");
  console.log(`  Chain ID: ${report.chainId}`);
  console.log(`  Smoke wallet: ${report.walletAddress}`);
  console.log(`  dUSDC: ${report.tokenAddress}`);
  console.log(`  POP33: ${report.contractAddress}`);
  console.log(`  Native balance: ${report.nativeBalance} wei`);
  console.log(`  dUSDC balance: ${report.tokenState.balance} units`);
  console.log(`  Faucet next available at: ${report.tokenState.nextDripAt}`);
  console.log(`  Current pool: ${report.pool.id}`);
  console.log(`  Current pool status: ${report.pool.status === 0n ? "Open" : report.pool.status}`);
  console.log(`  Current pool active positions: ${report.pool.activePositionCount}`);
  console.log(`  Existing smoke position: ${report.activePositionId}`);
  console.log(`  Faucet gas estimate: ${report.gasPlan.faucet}`);
  console.log(`  Approve gas estimate: ${report.gasPlan.approve}`);
  console.log(`  Join gas safety budget: ${report.gasPlan.join}`);
  console.log(`  Withdraw gas safety budget: ${report.gasPlan.withdraw}`);
  console.log(`  Buffered native requirement: ${report.gasPlan.requiredNativeBalance} wei`);
  if (report.blockers.length === 0) {
    console.log("  Result: READY for separately authorized write smoke");
  } else {
    console.log("  Result: NOT READY for write smoke");
    for (const blocker of report.blockers) console.log(`  Blocker: ${blocker}`);
  }
  console.log("  Planned flow: dUSDC faucet -> exact 33 dUSDC approve -> join -> verify -> withdraw -> verify refund");
}

async function main(): Promise<void> {
  const configuration = readSmokeReadConfiguration(process.env);
  const { ethers } = await network.create({ network: "baseSepoliaSmoke", chainType: "op" });
  const readRuntime = new EthersBaseSepoliaSmokeRuntime(
    ethers.provider,
    configuration.walletAddress,
  );
  const preflight = await runSmokeReadOnlyPreflight(readRuntime);
  printPreflight(preflight);

  const writeRequested = process.env.POP33_INTERNAL_SMOKE_CLI_MODE === "write";
  if (!writeRequested) return;

  assertSmokeWriteAuthorization(writeRequested, process.env);
  const privateKey = readDedicatedSmokePrivateKey(process.env, configuration.walletAddress);
  const signer = new Wallet(privateKey, ethers.provider);
  const writeRuntime = new EthersBaseSepoliaSmokeRuntime(
    ethers.provider,
    configuration.walletAddress,
    signer,
  );
  const journalPath = process.env.BASE_SEPOLIA_SMOKE_JOURNAL_PATH?.trim();
  if (!journalPath) throw new Error("BASE_SEPOLIA_SMOKE_JOURNAL_PATH is required for write smoke.");
  const journal = await JsonTransactionJournal.open(journalPath, {
    chainId: preflight.chainId,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  });
  const result = await runSmokeWriteFlow({ runtime: writeRuntime, journal, preflight });
  console.log("POP33 Base Sepolia reversible smoke completed");
  console.log(`  Smoke wallet: ${result.walletAddress}`);
  console.log(`  Pool: ${result.poolId}`);
  console.log(`  Withdrawn position: ${result.positionId}`);
  console.log(`  Final dUSDC balance: ${result.finalTokenBalance} units`);
  console.log(`  Final allowance: ${result.finalAllowance} units`);
  for (const hash of result.transactionHashes) console.log(`  Test transaction: ${hash}`);
}

void main().catch((error: unknown) => {
  console.error(`Base Sepolia smoke harness stopped: ${sanitizeOperatorError(error)}`);
  console.error("No automatic broadcast retry will be attempted.");
  process.exitCode = 1;
});

export { BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION, BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION };
