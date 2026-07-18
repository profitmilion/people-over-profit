import { network } from "hardhat";

import { auditBaseSepoliaOperatorArtifacts } from "./operator/base-sepolia-artifact-audit.js";
import {
  JsonCheckpointStore,
  readCheckpointPathFromEnvironment,
  type OperatorCheckpoint,
  type TransactionCheckpoint,
} from "./operator/checkpoint.js";
import { EncryptedWalletProvider } from "./operator/encrypted-wallet-store.js";
import {
  PILOT_2_FLOW_CONFIRMATION,
  PILOT_2_NETWORK_CONFIRMATION,
  PILOT_2_POOL_ID,
  PILOT_2_WALLET_INDICES,
  WalletScopedTransactionJournal,
  assertPilot2JournalScope,
  assertPilot2SequentialState,
  assertPilot2WriteAuthorization,
  selectPilot2Addresses,
} from "./operator/base-sepolia-pilot-2-write.js";
import { PILOT_SET_WALLET_COUNT } from "./operator/operator-set-identity.js";
import { assertMatchingOperatorSetBindings } from "./operator/operator-set-identity.js";
import {
  readOperatorSetManifest,
  readOperatorSetManifestPathFromEnvironment,
} from "./operator/operator-set-manifest.js";
import { EthersBaseSepoliaReadOnlyRuntime } from "./operator/ethers-base-sepolia-read-only-runtime.js";
import {
  JsonTransactionJournal,
  readJournalPathFromEnvironment,
  sanitizeOperatorError,
  type JournalOperation,
} from "./operator/transaction-journal.js";
import {
  BASE_SEPOLIA_SMOKE_CHAIN_ID,
  BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
  BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  runSmokeReadOnlyPreflight,
  runSmokeWriteFlow,
} from "./smoke/base-sepolia-smoke.js";
import { EthersBaseSepoliaSmokeRuntime } from "./smoke/ethers-smoke-runtime.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function checkpointOperation(operation: JournalOperation): TransactionCheckpoint {
  if (
    operation.status !== "confirmed" || !operation.transactionHash ||
    operation.nonce == null || !operation.receipt || operation.receipt.status === null
  ) {
    throw new Error("Checkpoint cannot record a journal operation without confirmed receipt evidence.");
  }
  const names = {
    faucet: "dripped",
    approve: "approved",
    join: "joined",
    withdraw: "withdrawn",
  } as const;
  const mapped = names[operation.action as keyof typeof names];
  if (!mapped) throw new Error("Checkpoint refuses a prohibited pilot operation.");
  const receiptStatus = operation.receipt.status;
  const nonce = operation.nonce;
  if (receiptStatus === null) throw new Error("Checkpoint receipt status is missing.");
  if (nonce === null) throw new Error("Checkpoint transaction nonce is missing.");
  return {
    operation: mapped,
    hash: operation.transactionHash,
    blockNumber: operation.receipt.blockNumber,
    receiptStatus,
    nonce,
  };
}

async function saveCompletedWallet(input: {
  store: JsonCheckpointStore;
  checkpoint: OperatorCheckpoint;
  index: number;
  nativeBalance: bigint;
  tokenBalance: bigint;
  allowance: bigint;
  poolStatus: bigint;
  poolActive: bigint;
  poolEscrow: bigint;
  completedDrawRoundCount: bigint;
  claimedPrizeCount: bigint;
  journalOperations: readonly JournalOperation[];
}): Promise<OperatorCheckpoint> {
  const wallet = input.checkpoint.wallets[input.index];
  const operations = input.journalOperations
    .filter((operation) => operation.walletAddress.toLowerCase() === wallet.address.toLowerCase())
    .map(checkpointOperation);
  if (
    operations.length !== 4 ||
    operations.some((operation, index) =>
      operation.operation !== (["dripped", "approved", "joined", "withdrawn"] as const)[index])
  ) {
    throw new Error("Checkpoint refuses an incomplete or out-of-order pilot transaction sequence.");
  }
  const next: OperatorCheckpoint = structuredClone(input.checkpoint);
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  next.poolStatus = input.poolStatus.toString();
  next.activePositionCount = input.poolActive.toString();
  next.escrowedAmount = input.poolEscrow.toString();
  next.completedDrawRoundCount = input.completedDrawRoundCount.toString();
  next.claimedPrizeCount = input.claimedPrizeCount.toString();
  next.wallets[input.index] = {
    ...next.wallets[input.index],
    stage: "withdrawn",
    nativeBalance: input.nativeBalance.toString(),
    tokenBalance: input.tokenBalance.toString(),
    allowance: input.allowance.toString(),
    activePositionId: "0",
    poolId: PILOT_2_POOL_ID.toString(),
    transactions: operations,
  };
  await input.store.save(next);
  return next;
}

async function main(): Promise<void> {
  assertPilot2WriteAuthorization(process.env.POP33_INTERNAL_PILOT_2_MODE === "write", process.env);
  const rpcUrl = required("BASE_SEPOLIA_SMOKE_RPC_URL");
  let password = required("OPERATOR_WALLET_STORE_PASSWORD");
  const { ethers } = await network.create({ network: "baseSepoliaSmoke", chainType: "op" });
  const audit = await auditBaseSepoliaOperatorArtifacts(await ethers.provider.getBlockNumber(), process.env);
  const failedIdentityChecks = audit.checks.filter((check) => !check.ok && check.name !== "recovery");
  if (failedIdentityChecks.length > 0) {
    throw new Error(`Pilot artifact validation failed: ${failedIdentityChecks.map((check) => check.name).join(", ")}.`);
  }
  const selectedAddresses = selectPilot2Addresses(audit.walletAddresses);
  const walletProvider = await EncryptedWalletProvider.openExistingSelected({
    filePath: required("OPERATOR_WALLET_STORE_PATH"),
    password,
    walletCount: PILOT_SET_WALLET_COUNT,
    walletIndices: PILOT_2_WALLET_INDICES,
    provider: ethers.provider,
  });
  password = "";
  delete process.env.OPERATOR_WALLET_STORE_PASSWORD;
  const signers = walletProvider.listWallets();
  if (signers.length !== 2 || signers.some((wallet, index) => wallet.address !== selectedAddresses[index])) {
    throw new Error("Decrypted signer selection does not match pilot wallet indices 0 and 1.");
  }
  const journal = await JsonTransactionJournal.openExisting(readJournalPathFromEnvironment(process.env), {
    chainId: BASE_SEPOLIA_SMOKE_CHAIN_ID,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  });
  assertPilot2JournalScope(journal.snapshot(), selectedAddresses);
  assertPilot2SequentialState(journal.snapshot(), selectedAddresses);
  const checkpointStore = new JsonCheckpointStore(readCheckpointPathFromEnvironment(process.env));
  let checkpoint = await checkpointStore.load();
  if (!checkpoint) throw new Error("Pilot checkpoint does not exist; write pilot will not create it.");
  const manifest = await readOperatorSetManifest(readOperatorSetManifestPathFromEnvironment(process.env));
  const journalData = journal.snapshot();
  if (!checkpoint.setBinding || !journalData.setBinding) {
    throw new Error("Pilot checkpoint and journal must both retain their operator-set binding.");
  }
  assertMatchingOperatorSetBindings(manifest.binding, checkpoint.setBinding, "Pilot checkpoint");
  assertMatchingOperatorSetBindings(manifest.binding, journalData.setBinding, "Pilot journal");
  if (
    checkpoint.wallets.length !== manifest.walletAddresses.length ||
    checkpoint.wallets.some((wallet, index) =>
      wallet.address.toLowerCase() !== manifest.walletAddresses[index].toLowerCase()) ||
    selectedAddresses.some((address, index) =>
      address.toLowerCase() !== manifest.walletAddresses[index].toLowerCase())
  ) {
    throw new Error("Pilot manifest, checkpoint, and selected signer wallet order do not match.");
  }
  const publicRuntime = new EthersBaseSepoliaReadOnlyRuntime(rpcUrl);
  const initialPool = await publicRuntime.getPool(PILOT_2_POOL_ID);
  if (initialPool.status !== 0n) throw new Error("Pilot stopped: pool #1 is not Open.");

  console.log("POP33 guarded Base Sepolia two-wallet pilot");
  console.log("  Scope: wallet indices 0 and 1, pool #1, faucet -> approve 33 -> join -> withdraw");
  console.log("  Funding: manual only; no funding-wallet key is accepted");

  for (const index of PILOT_2_WALLET_INDICES) {
    assertPilot2SequentialState(journal.snapshot(), selectedAddresses);
    const signer = signers[index];
    const runtime = new EthersBaseSepoliaSmokeRuntime(ethers.provider, signer.address, signer);
    const preflight = await runSmokeReadOnlyPreflight(runtime);
    if (preflight.pool.id !== PILOT_2_POOL_ID) throw new Error("Pilot stopped: the selected open pool is not pool #1.");
    const existingOperations = journal.snapshot().operations.filter(
      (operation) => operation.walletAddress.toLowerCase() === signer.address.toLowerCase(),
    );
    if (
      existingOperations.length === 0 &&
      (preflight.tokenState.balance !== 0n || preflight.tokenState.allowance !== 0n || preflight.activePositionId !== 0n)
    ) {
      throw new Error(`Wallet ${index} fresh pilot state is not zeroed; stop for manual review.`);
    }
    console.log(`  Wallet ${index}: ${signer.address}`);
    console.log(`    Buffered gas requirement: ${preflight.gasPlan.requiredNativeBalance} wei`);
    const scopedJournal = new WalletScopedTransactionJournal(journal, signer.address, selectedAddresses);
    const result = await runSmokeWriteFlow({ runtime, journal: scopedJournal, preflight });
    const finalWallet = await publicRuntime.getWallet(signer.address, PILOT_2_POOL_ID);
    const finalPool = await publicRuntime.getPool(PILOT_2_POOL_ID);
    if (
      finalWallet.activePositions !== 0n || finalWallet.activePositionId !== 0n ||
      finalWallet.allowance !== 0n || finalWallet.claimablePrizes !== 0n || finalPool.status !== 0n
    ) {
      throw new Error(`Wallet ${index} final-state verification failed; pilot stopped.`);
    }
    checkpoint = await saveCompletedWallet({
      store: checkpointStore,
      checkpoint,
      index,
      nativeBalance: finalWallet.nativeBalance,
      tokenBalance: result.finalTokenBalance,
      allowance: result.finalAllowance,
      poolStatus: finalPool.status,
      poolActive: finalPool.activePositionCount,
      poolEscrow: finalPool.escrowedAmount,
      completedDrawRoundCount: finalPool.completedDrawRoundCount,
      claimedPrizeCount: finalPool.claimedPrizeCount,
      journalOperations: journal.snapshot().operations,
    });
    console.log(`    COMPLETE: no active position, allowance 0, claimable 0`);
    for (const hash of result.transactionHashes) console.log(`    Transaction: ${hash}`);
  }
  assertPilot2SequentialState(journal.snapshot(), selectedAddresses);
  const unresolved = journal.snapshot().operations.filter((operation) => operation.status !== "confirmed");
  if (unresolved.length > 0) throw new Error("Pilot ended with unresolved journal operations.");
  const finalPool = await publicRuntime.getPool(PILOT_2_POOL_ID);
  if (
    finalPool.status !== 0n ||
    finalPool.activePositionCount !== initialPool.activePositionCount ||
    finalPool.escrowedAmount !== initialPool.escrowedAmount
  ) {
    throw new Error("Pilot final pool count or escrow did not return to its initial state.");
  }
  console.log("PILOT COMPLETE: both wallets are withdrawn and checkpoint/journal are consistent.");
}

void main().catch((error: unknown) => {
  console.error(`Base Sepolia pilot stopped: ${sanitizeOperatorError(error)}`);
  console.error("No automatic write retry will be attempted. Inspect journal and chain state before rerun.");
  process.exitCode = 1;
});

export { PILOT_2_FLOW_CONFIRMATION, PILOT_2_NETWORK_CONFIRMATION };
