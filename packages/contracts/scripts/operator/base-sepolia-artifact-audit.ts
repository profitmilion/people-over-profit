import { getAddress } from "ethers";

import {
  JsonCheckpointStore,
  readCheckpointPathFromEnvironment,
  type OperatorCheckpoint,
} from "./checkpoint.js";
import {
  PUBLIC_OPERATOR_CHAIN_ID,
  PUBLIC_OPERATOR_CONTRACT_ADDRESS,
  PUBLIC_OPERATOR_TOKEN_ADDRESS,
  type ArtifactAudit,
  type ArtifactCheck,
} from "./base-sepolia-read-only-operator.js";
import { inspectExistingEncryptedWalletStore } from "./encrypted-wallet-store.js";
import {
  assertMatchingOperatorSetBindings,
  walletOrderDigest,
  type OperatorSetManifest,
} from "./operator-set-identity.js";
import {
  readOperatorSetManifest,
  readOperatorSetManifestPathFromEnvironment,
} from "./operator-set-manifest.js";
import {
  inspectExistingTransactionJournal,
  readJournalPathFromEnvironment,
  sanitizeOperatorError,
  type TransactionJournalData,
} from "./transaction-journal.js";

export {
  preflightExact99OperatorArtifacts,
  renderExact99Preflight,
  type Exact99PreflightReport,
} from "./exact-99-operator-artifacts.js";

const RECOVERY_STATUSES = new Set([
  "prepared",
  "ready_to_broadcast",
  "broadcast",
  "pending",
  "requires_manual_review",
]);

function environmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function minimumConfirmations(env: NodeJS.ProcessEnv): number {
  const raw = env.OPERATOR_REQUIRED_CONFIRMATIONS?.trim() ?? "3";
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

export async function auditBaseSepoliaOperatorArtifacts(
  latestBlock: number,
  env: NodeJS.ProcessEnv,
): Promise<ArtifactAudit> {
  const checks: ArtifactCheck[] = [];
  let walletAddresses: string[] = [];
  let storeId: string | undefined;
  let manifest: OperatorSetManifest | undefined;
  let checkpoint: OperatorCheckpoint | undefined;
  let journal: TransactionJournalData | undefined;

  try {
    const store = await inspectExistingEncryptedWalletStore({
      filePath: environmentValue(env, "OPERATOR_WALLET_STORE_PATH"),
      password: environmentValue(env, "OPERATOR_WALLET_STORE_PASSWORD"),
    });
    storeId = store.storeId;
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
    manifest = await readOperatorSetManifest(readOperatorSetManifestPathFromEnvironment(env));
    checks.push({
      name: "manifest",
      ok: true,
      detail: `Bound operator-set manifest ${manifest.binding.storeId} validated.`,
    });
  } catch (error) {
    checks.push({ name: "manifest", ok: false, detail: sanitizeOperatorError(error) });
  }

  try {
    checkpoint = await new JsonCheckpointStore(readCheckpointPathFromEnvironment(env)).load();
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
      readJournalPathFromEnvironment(env),
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

  let projectIdentityOk = false;
  let projectIdentityDetail = "Wallet store, manifest, checkpoint, and journal are not bound to one operator set.";
  try {
    if (!storeId || !manifest || !checkpoint || !journal || walletAddresses.length === 0) {
      throw new Error(projectIdentityDetail);
    }
    if (storeId !== manifest.binding.storeId) throw new Error("Wallet store ID does not match the manifest.");
    if (walletOrderDigest(walletAddresses) !== manifest.binding.walletOrderDigest) {
      throw new Error("Wallet order does not match the manifest binding.");
    }
    if (!checkpointMatchesWallets(checkpoint, walletAddresses)) {
      throw new Error("Checkpoint wallet order does not match the encrypted store.");
    }
    if (checkpoint.schemaVersion !== 2 || !checkpoint.setBinding) {
      throw new Error("Checkpoint has no operator-set binding.");
    }
    if (journal.formatVersion !== 2 || !journal.setBinding) {
      throw new Error("Journal has no operator-set binding.");
    }
    assertMatchingOperatorSetBindings(manifest.binding, checkpoint.setBinding, "Checkpoint");
    assertMatchingOperatorSetBindings(manifest.binding, journal.setBinding, "Journal");
    projectIdentityOk = true;
    projectIdentityDetail = "Store ID, wallet order, manifest, checkpoint, journal, chain, token, and contract identities match.";
  } catch (error) {
    projectIdentityDetail = sanitizeOperatorError(error);
  }
  checks.push({ name: "project-identity", ok: projectIdentityOk, detail: projectIdentityDetail });

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
    minimumConfirmations: minimumConfirmations(env),
    leastConfirmedDepth: confirmedDepths.length > 0 ? Math.min(...confirmedDepths) : null,
    journalStatesByWallet,
  };
}
