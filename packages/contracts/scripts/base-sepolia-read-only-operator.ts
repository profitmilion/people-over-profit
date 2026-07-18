import { getAddress } from "ethers";

import {
  JsonCheckpointStore,
  readCheckpointPathFromEnvironment,
  type OperatorCheckpoint,
} from "./operator/checkpoint.js";
import {
  PUBLIC_OPERATOR_CHAIN_ID,
  PUBLIC_OPERATOR_CONTRACT_ADDRESS,
  PUBLIC_OPERATOR_DEFAULT_RPC_URL,
  PUBLIC_OPERATOR_TOKEN_ADDRESS,
  assertPublicOperatorMode,
  assertPublicOperatorWalletCount,
  renderPublicOperatorText,
  runBaseSepoliaReadOnlyOperator,
  validatePublicOperatorRpcUrl,
  type ArtifactAudit,
  type ArtifactCheck,
} from "./operator/base-sepolia-read-only-operator.js";
import { inspectExistingEncryptedWalletStore } from "./operator/encrypted-wallet-store.js";
import { EthersBaseSepoliaReadOnlyRuntime } from "./operator/ethers-base-sepolia-read-only-runtime.js";
import {
  inspectExistingTransactionJournal,
  readJournalPathFromEnvironment,
  sanitizeOperatorError,
  type TransactionJournalData,
} from "./operator/transaction-journal.js";

const RECOVERY_STATUSES = new Set([
  "prepared",
  "ready_to_broadcast",
  "broadcast",
  "pending",
  "requires_manual_review",
]);

function environmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function minimumConfirmations(): number {
  const raw = process.env.OPERATOR_REQUIRED_CONFIRMATIONS?.trim() ?? "3";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("OPERATOR_REQUIRED_CONFIRMATIONS must be an integer between 1 and 100.");
  }
  return parsed;
}

function checkpointMatchesWallets(checkpoint: OperatorCheckpoint, addresses: readonly string[]): boolean {
  return checkpoint.wallets.length === addresses.length && checkpoint.wallets.every(
    (wallet, index) => getAddress(wallet.address) === getAddress(addresses[index]),
  );
}

async function auditArtifacts(latestBlock: number): Promise<ArtifactAudit> {
  const checks: ArtifactCheck[] = [];
  let walletAddresses: string[] = [];
  let checkpoint: OperatorCheckpoint | undefined;
  let journal: TransactionJournalData | undefined;

  try {
    const store = await inspectExistingEncryptedWalletStore({
      filePath: environmentValue("OPERATOR_WALLET_STORE_PATH"),
      password: environmentValue("OPERATOR_WALLET_STORE_PASSWORD"),
    });
    walletAddresses = store.addresses;
    checks.push({
      name: "wallet-store",
      ok: true,
      detail: `Existing encrypted store ${store.storeId} validated with ${store.walletCount} unique wallets.`,
    });
  } catch (error) {
    checks.push({ name: "wallet-store", ok: false, detail: sanitizeOperatorError(error) });
  }

  try {
    checkpoint = await new JsonCheckpointStore(readCheckpointPathFromEnvironment(process.env)).load();
    if (!checkpoint) throw new Error("Checkpoint does not exist; read-only inspection will not create it.");
    if (
      checkpoint.chainId !== PUBLIC_OPERATOR_CHAIN_ID.toString() ||
      getAddress(checkpoint.contractAddress) !== PUBLIC_OPERATOR_CONTRACT_ADDRESS ||
      getAddress(checkpoint.tokenAddress) !== PUBLIC_OPERATOR_TOKEN_ADDRESS
    ) {
      throw new Error("Checkpoint project identity does not match the recorded Base Sepolia deployment.");
    }
    checks.push({ name: "checkpoint", ok: true, detail: `Checkpoint revision ${checkpoint.revision} validated.` });
  } catch (error) {
    checks.push({ name: "checkpoint", ok: false, detail: sanitizeOperatorError(error) });
  }

  try {
    journal = await inspectExistingTransactionJournal(
      readJournalPathFromEnvironment(process.env),
      {
        chainId: PUBLIC_OPERATOR_CHAIN_ID,
        contractAddress: PUBLIC_OPERATOR_CONTRACT_ADDRESS,
        tokenAddress: PUBLIC_OPERATOR_TOKEN_ADDRESS,
      },
    );
    checks.push({ name: "journal", ok: true, detail: `Journal revision ${journal.revision} validated.` });
  } catch (error) {
    checks.push({ name: "journal", ok: false, detail: sanitizeOperatorError(error) });
  }

  const projectIdentityOk = Boolean(
    checkpoint && journal && walletAddresses.length > 0 && checkpointMatchesWallets(checkpoint, walletAddresses),
  );
  checks.push({
    name: "project-identity",
    ok: projectIdentityOk,
    detail: projectIdentityOk
      ? "Wallet order, checkpoint, journal, chain, token, and contract identities match."
      : "Wallet order cannot be bound to both the checkpoint and journal for this project.",
  });

  const recoveryOperations = journal?.operations.filter((operation) => RECOVERY_STATUSES.has(operation.status)) ?? [];
  checks.push({
    name: "recovery",
    ok: recoveryOperations.length === 0,
    detail: recoveryOperations.length === 0
      ? "No prepared, pending, ambiguous, or manual-review journal operations exist."
      : `${recoveryOperations.length} operation(s) require recovery review before any future execution.`,
  });
  const confirmedDepths = journal?.operations
    .filter((operation) => operation.status === "confirmed" && operation.receipt)
    .map((operation) => Math.max(0, latestBlock - operation.receipt!.blockNumber + 1)) ?? [];
  const journalStatesByWallet: Record<string, string[]> = {};
  for (const operation of journal?.operations ?? []) {
    const key = operation.walletAddress.toLowerCase();
    (journalStatesByWallet[key] ??= []).push(`${operation.action}:${operation.status}`);
  }
  return {
    walletAddresses,
    checks,
    pendingRecoveryOperations: recoveryOperations.length,
    minimumConfirmations: minimumConfirmations(),
    leastConfirmedDepth: confirmedDepths.length > 0 ? Math.min(...confirmedDepths) : null,
    journalStatesByWallet,
  };
}

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
  const artifacts = await auditArtifacts(await runtime.getLatestBlockNumber());
  const report = await runBaseSepoliaReadOnlyOperator({
    runtime,
    mode,
    walletCount,
    startIndex,
    rpcHost: new URL(rpcUrl).host,
    artifacts,
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
