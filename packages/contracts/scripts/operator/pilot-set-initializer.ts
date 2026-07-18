import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import type { Provider } from "ethers";

import {
  JsonCheckpointStore,
  type OperatorCheckpoint,
} from "./checkpoint.js";
import { assertSafeExternalFilePath, withExclusiveFileLock } from "./durable-file.js";
import {
  EncryptedWalletProvider,
  inspectExistingEncryptedWalletStore,
} from "./encrypted-wallet-store.js";
import {
  PILOT_SET_CHAIN_ID,
  PILOT_SET_CONTRACT_ADDRESS,
  PILOT_SET_PROJECT,
  PILOT_SET_PURPOSE,
  PILOT_SET_TOKEN_ADDRESS,
  PILOT_SET_WALLET_COUNT,
  assertMatchingOperatorSetBindings,
  createPilotSetBinding,
  walletOrderDigest,
  type OperatorSetBinding,
  type OperatorSetManifest,
} from "./operator-set-identity.js";
import {
  readOperatorSetManifest,
  writeOperatorSetManifest,
} from "./operator-set-manifest.js";
import {
  JsonTransactionJournal,
  inspectExistingTransactionJournal,
  type TransactionJournalData,
} from "./transaction-journal.js";

export const PILOT_INITIALIZER_CONFIRMATION = "CREATE POP33 BASE SEPOLIA PILOT 5";
export const PILOT_SET_FILES = Object.freeze({
  walletStore: "pilot-5.operator-wallets.enc.json",
  checkpoint: "pilot-5.operator-checkpoint.json",
  transactionJournal: "pilot-5.operator-journal.json",
  manifest: "pilot-5.operator-set-manifest.json",
});

export interface OpenedPilotOperatorSet {
  directory: string;
  binding: OperatorSetBinding;
  manifest: OperatorSetManifest;
  checkpoint: OperatorCheckpoint;
  journal: TransactionJournalData;
  walletAddresses: string[];
}

export interface PilotInitializationResult {
  directory: string;
  binding: OperatorSetBinding;
  walletCount: number;
  files: typeof PILOT_SET_FILES;
}

export function assertMatchingPilotPasswords(first: string, second: string): void {
  if (first !== second) throw new Error("Pilot wallet-store password entries do not match.");
  if (first.length < 12) throw new Error("Pilot wallet-store password must contain at least 12 characters.");
}

export function assertPilotInitializerConfirmation(value: string): void {
  if (value !== PILOT_INITIALIZER_CONFIRMATION) {
    throw new Error(`Pilot initialization requires exact confirmation: ${PILOT_INITIALIZER_CONFIRMATION}`);
  }
}

function pilotPaths(directory: string) {
  return {
    walletStore: join(directory, PILOT_SET_FILES.walletStore),
    checkpoint: join(directory, PILOT_SET_FILES.checkpoint),
    transactionJournal: join(directory, PILOT_SET_FILES.transactionJournal),
    manifest: join(directory, PILOT_SET_FILES.manifest),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function validatePilotDirectoryTarget(directoryValue: string): Promise<string> {
  if (!isAbsolute(directoryValue)) throw new Error("Pilot set directory must be absolute.");
  const directory = resolve(directoryValue);
  const paths = pilotPaths(directory);
  await Promise.all([
    assertSafeExternalFilePath(paths.walletStore, ".operator-wallets.enc.json"),
    assertSafeExternalFilePath(paths.checkpoint, ".operator-checkpoint.json"),
    assertSafeExternalFilePath(paths.transactionJournal, ".operator-journal.json"),
    assertSafeExternalFilePath(paths.manifest, ".operator-set-manifest.json"),
  ]);
  return directory;
}

function initialCheckpoint(
  binding: OperatorSetBinding,
  addresses: readonly string[],
  createdAt: string,
): OperatorCheckpoint {
  return {
    schemaVersion: 2,
    setBinding: binding,
    revision: 0,
    chainId: PILOT_SET_CHAIN_ID.toString(),
    tokenAddress: PILOT_SET_TOKEN_ADDRESS,
    contractAddress: PILOT_SET_CONTRACT_ADDRESS,
    poolId: "1",
    poolStatus: "0",
    activePositionCount: "0",
    escrowedAmount: "0",
    completedDrawRoundCount: "0",
    claimedPrizeCount: "0",
    updatedAt: createdAt,
    operatorTransactions: [],
    wallets: addresses.map((address, index) => ({
      index,
      address,
      stage: "discovered",
      nativeBalance: "0",
      tokenBalance: "0",
      allowance: "0",
      activePositionId: "0",
      poolId: "1",
      winningRounds: [],
      claimedRounds: [],
      transactions: [],
    })),
  };
}

function assertAddressOrder(expected: readonly string[], actual: readonly string[], label: string): void {
  if (expected.length !== actual.length) throw new Error(`${label} wallet count mismatch.`);
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].toLowerCase() !== actual[index].toLowerCase()) {
      throw new Error(`${label} wallet order mismatch at index ${index}.`);
    }
  }
}

export async function openPilotOperatorSet(input: {
  directory: string;
  password: string;
}): Promise<OpenedPilotOperatorSet> {
  const directory = await validatePilotDirectoryTarget(input.directory);
  const paths = pilotPaths(directory);
  const manifest = await readOperatorSetManifest(paths.manifest);
  for (const key of Object.keys(PILOT_SET_FILES) as Array<keyof typeof PILOT_SET_FILES>) {
    if (manifest.files[key] !== PILOT_SET_FILES[key]) {
      throw new Error(`Pilot manifest file mapping mismatch at ${key}.`);
    }
  }
  const store = await inspectExistingEncryptedWalletStore({
    filePath: paths.walletStore,
    password: input.password,
    expectedWalletCount: PILOT_SET_WALLET_COUNT,
  });
  if (store.storeId !== manifest.binding.storeId) throw new Error("Pilot wallet store ID mismatch.");
  assertAddressOrder(manifest.walletAddresses, store.addresses, "Pilot wallet store");
  if (walletOrderDigest(store.addresses) !== manifest.binding.walletOrderDigest) {
    throw new Error("Pilot wallet store order digest mismatch.");
  }

  const checkpoint = await new JsonCheckpointStore(paths.checkpoint).load();
  if (!checkpoint) throw new Error("Pilot checkpoint does not exist.");
  if (checkpoint.schemaVersion !== 2 || !checkpoint.setBinding) {
    throw new Error("Pilot checkpoint is not bound to an operator set.");
  }
  assertMatchingOperatorSetBindings(manifest.binding, checkpoint.setBinding, "Pilot checkpoint");
  assertAddressOrder(manifest.walletAddresses, checkpoint.wallets.map((wallet) => wallet.address), "Pilot checkpoint");

  const journal = await inspectExistingTransactionJournal(paths.transactionJournal, {
    chainId: PILOT_SET_CHAIN_ID,
    contractAddress: PILOT_SET_CONTRACT_ADDRESS,
    tokenAddress: PILOT_SET_TOKEN_ADDRESS,
  });
  if (journal.formatVersion !== 2 || !journal.setBinding) {
    throw new Error("Pilot transaction journal is not bound to an operator set.");
  }
  assertMatchingOperatorSetBindings(manifest.binding, journal.setBinding, "Pilot journal");
  if (journal.operations.length !== 0) throw new Error("New pilot journal must be empty.");

  return {
    directory,
    binding: manifest.binding,
    manifest,
    checkpoint,
    journal,
    walletAddresses: store.addresses,
  };
}

export async function initializePilotOperatorSet(input: {
  targetDirectory: string;
  password: string;
  repeatedPassword: string;
  confirmation: string;
}): Promise<PilotInitializationResult> {
  assertMatchingPilotPasswords(input.password, input.repeatedPassword);
  assertPilotInitializerConfirmation(input.confirmation);
  const targetDirectory = await validatePilotDirectoryTarget(input.targetDirectory);
  const parent = dirname(targetDirectory);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const lockTarget = `${targetDirectory}.operator-pilot-initialization`;

  return withExclusiveFileLock(lockTarget, async () => {
    if (await pathExists(targetDirectory)) {
      throw new Error("Pilot target directory already exists; initialization will not overwrite it.");
    }
    const temporaryDirectory = join(parent, `.${basename(targetDirectory)}.${randomUUID()}.tmp`);
    const normalizedParent = `${resolve(parent)}${sep}`.toLowerCase();
    if (!resolve(temporaryDirectory).toLowerCase().startsWith(normalizedParent)) {
      throw new Error("Pilot temporary directory escaped its validated parent.");
    }
    await mkdir(temporaryDirectory, { recursive: false, mode: 0o700 });
    let completed = false;
    try {
      const paths = pilotPaths(temporaryDirectory);
      await EncryptedWalletProvider.openOrCreate({
        filePath: paths.walletStore,
        password: input.password,
        walletCount: PILOT_SET_WALLET_COUNT,
        provider: null as unknown as Provider,
      });
      const store = await inspectExistingEncryptedWalletStore({
        filePath: paths.walletStore,
        password: input.password,
        expectedWalletCount: PILOT_SET_WALLET_COUNT,
      });
      const binding = createPilotSetBinding(store.storeId, store.addresses);
      const createdAt = new Date().toISOString();
      await new JsonCheckpointStore(paths.checkpoint).save(
        initialCheckpoint(binding, store.addresses, createdAt),
      );
      await JsonTransactionJournal.createBound(paths.transactionJournal, {
        chainId: PILOT_SET_CHAIN_ID,
        contractAddress: PILOT_SET_CONTRACT_ADDRESS,
        tokenAddress: PILOT_SET_TOKEN_ADDRESS,
      }, binding);
      await writeOperatorSetManifest(paths.manifest, {
        formatVersion: 1,
        createdAt,
        binding,
        walletAddresses: store.addresses,
        files: PILOT_SET_FILES,
      });
      await openPilotOperatorSet({ directory: temporaryDirectory, password: input.password });
      if (await pathExists(targetDirectory)) {
        throw new Error("Pilot target appeared during initialization; refusing to overwrite it.");
      }
      await rename(temporaryDirectory, targetDirectory);
      completed = true;
      return {
        directory: targetDirectory,
        binding,
        walletCount: store.walletCount,
        files: PILOT_SET_FILES,
      };
    } finally {
      if (!completed) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  });
}

export function pilotSetPublicSummary(result: PilotInitializationResult): string {
  return [
    "POP33 Base Sepolia pilot operator set initialized",
    `Project: ${PILOT_SET_PROJECT}`,
    `Purpose: ${PILOT_SET_PURPOSE}`,
    `Chain ID: ${PILOT_SET_CHAIN_ID}`,
    `Wallet count: ${result.walletCount}`,
    `Store ID: ${result.binding.storeId}`,
    `Directory: ${result.directory}`,
    "Private keys and password were not printed.",
    "No wallet was funded and no Base Sepolia transaction was sent.",
  ].join("\n");
}
