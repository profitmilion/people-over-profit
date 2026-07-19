import { lstat, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { getAddress, isAddress } from "ethers";

import { assertSafeExternalFilePath, pathIsRegularFile } from "./durable-file.js";
import {
  createEncryptedWalletStoreFile,
  inspectExistingEncryptedWalletStore,
  type EncryptedWalletStoreInspection,
} from "./encrypted-wallet-store.js";

export const FULL_LIFECYCLE_WALLET_COUNT = 99;
export const FULL_LIFECYCLE_99_CONFIRMATION =
  "CREATE POP33 BASE SEPOLIA FULL LIFECYCLE 99";
export const FULL_LIFECYCLE_99_STORE_FILE_NAME =
  "full-lifecycle-99.operator-wallets.enc.json";

const STORE_SUFFIX = ".operator-wallets.enc.json";
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

export interface FullLifecycle99DryRun {
  mode: "dry-run";
  targetFile: string;
  walletCount: 99;
  targetExists: boolean;
  safeguards: readonly string[];
  writePerformed: false;
  walletMaterialGenerated: false;
}

export interface PublicWalletEntry {
  index: number;
  address: string;
}

export interface FullLifecycle99Inspection {
  mode: "local-read-only";
  formatVersion: number;
  storeId: string;
  walletCount: number;
  createdAt: null;
  fingerprint: string;
  wallets: PublicWalletEntry[];
  missingIndices: number[];
  duplicateAddresses: string[];
  exactly99Wallets: boolean;
  structureValid: boolean;
  validationErrors: string[];
  rpcUsed: false;
  writePerformed: false;
}

export interface FullLifecycle99InitializationResult {
  targetFile: string;
  walletCount: 99;
  storeId: string;
  fingerprint: string;
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

async function assertIsolatedTargetDirectory(targetDirectory: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(resolve(targetDirectory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const unexpected = entries.filter((entry) => entry !== FULL_LIFECYCLE_99_STORE_FILE_NAME);
  if (unexpected.length > 0) {
    throw new Error(
      "Full-lifecycle target directory must be isolated from every existing operator artifact.",
    );
  }
}

export function assertFullLifecycle99WalletCount(walletCount: number): asserts walletCount is 99 {
  if (walletCount !== FULL_LIFECYCLE_WALLET_COUNT) {
    throw new Error(`Full-lifecycle store must contain exactly ${FULL_LIFECYCLE_WALLET_COUNT} wallets.`);
  }
}

export function assertFullLifecycle99Passwords(first: string, second: string): void {
  if (first !== second) {
    throw new Error("Full-lifecycle wallet-store password entries do not match.");
  }
  if (first.length < 12) {
    throw new Error("Full-lifecycle wallet-store password must contain at least 12 characters.");
  }
}

export function assertFullLifecycle99Confirmation(value: string): void {
  if (value !== FULL_LIFECYCLE_99_CONFIRMATION) {
    throw new Error(
      `Full-lifecycle initialization requires exact confirmation: ${FULL_LIFECYCLE_99_CONFIRMATION}`,
    );
  }
}

export async function resolveFullLifecycle99StorePath(
  targetDirectory: string,
): Promise<string> {
  const targetFile = resolve(join(targetDirectory, FULL_LIFECYCLE_99_STORE_FILE_NAME));
  if (basename(targetFile) !== FULL_LIFECYCLE_99_STORE_FILE_NAME) {
    throw new Error("Full-lifecycle wallet-store file name is invalid.");
  }
  return assertSafeExternalFilePath(targetFile, STORE_SUFFIX);
}

export async function planFullLifecycle99Initialization(input: {
  targetDirectory: string;
}): Promise<FullLifecycle99DryRun> {
  const targetFile = await resolveFullLifecycle99StorePath(input.targetDirectory);
  await assertIsolatedTargetDirectory(input.targetDirectory);
  return {
    mode: "dry-run",
    targetFile,
    walletCount: FULL_LIFECYCLE_WALLET_COUNT,
    targetExists: await pathExists(targetFile),
    safeguards: Object.freeze([
      "external path isolated from every existing operator store",
      "AES-256-GCM with scrypt using the existing store format",
      "create-only atomic temporary-file validation and final rename",
      "exact operator confirmation and two matching hidden password entries",
      "no RPC, funding, signing, transaction, checkpoint, or journal capability",
    ]),
    writePerformed: false,
    walletMaterialGenerated: false,
  };
}

export function buildFullLifecycle99Inspection(
  inspection: EncryptedWalletStoreInspection,
): FullLifecycle99Inspection {
  const validationErrors: string[] = [];
  const missingIndices: number[] = [];
  const duplicateAddresses: string[] = [];
  const wallets: PublicWalletEntry[] = [];
  const seen = new Set<string>();
  const upperBound = Math.max(inspection.walletCount, inspection.addresses.length);

  for (let index = 0; index < upperBound; index += 1) {
    const candidate = inspection.addresses[index];
    if (typeof candidate !== "string" || !isAddress(candidate)) {
      missingIndices.push(index);
      continue;
    }
    const address = getAddress(candidate);
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) duplicateAddresses.push(address);
    seen.add(normalized);
    wallets.push({ index, address });
  }

  if (inspection.addresses.length !== inspection.walletCount) {
    validationErrors.push("Wallet count does not match the public address list length.");
  }
  if (missingIndices.length > 0) {
    validationErrors.push("One or more wallet addresses are missing or invalid.");
  }
  if (duplicateAddresses.length > 0) {
    validationErrors.push("One or more wallet addresses are duplicated.");
  }
  if (!FINGERPRINT.test(inspection.fingerprint)) {
    validationErrors.push("Encrypted store fingerprint is invalid.");
  }

  const exactly99Wallets =
    inspection.walletCount === FULL_LIFECYCLE_WALLET_COUNT &&
    inspection.addresses.length === FULL_LIFECYCLE_WALLET_COUNT &&
    missingIndices.length === 0 &&
    duplicateAddresses.length === 0;
  if (!exactly99Wallets) {
    validationErrors.push(`Store does not contain exactly ${FULL_LIFECYCLE_WALLET_COUNT} unique wallets.`);
  }

  return {
    mode: "local-read-only",
    formatVersion: inspection.formatVersion,
    storeId: inspection.storeId,
    walletCount: inspection.walletCount,
    createdAt: null,
    fingerprint: inspection.fingerprint,
    wallets,
    missingIndices,
    duplicateAddresses,
    exactly99Wallets,
    structureValid: validationErrors.length === 0,
    validationErrors,
    rpcUsed: false,
    writePerformed: false,
  };
}

export async function inspectFullLifecycle99Store(input: {
  targetDirectory: string;
  password: string;
}): Promise<FullLifecycle99Inspection> {
  const targetFile = await resolveFullLifecycle99StorePath(input.targetDirectory);
  await assertIsolatedTargetDirectory(input.targetDirectory);
  const inspection = await inspectExistingEncryptedWalletStore({
    filePath: targetFile,
    password: input.password,
    expectedWalletCount: FULL_LIFECYCLE_WALLET_COUNT,
  });
  return buildFullLifecycle99Inspection(inspection);
}

export async function initializeFullLifecycle99Store(input: {
  targetDirectory: string;
  password: string;
  repeatedPassword: string;
  confirmation: string;
  walletCount?: number;
}): Promise<FullLifecycle99InitializationResult> {
  const walletCount = input.walletCount ?? FULL_LIFECYCLE_WALLET_COUNT;
  assertFullLifecycle99WalletCount(walletCount);
  assertFullLifecycle99Passwords(input.password, input.repeatedPassword);
  assertFullLifecycle99Confirmation(input.confirmation);
  const targetFile = await resolveFullLifecycle99StorePath(input.targetDirectory);
  await assertIsolatedTargetDirectory(input.targetDirectory);
  if (await pathIsRegularFile(targetFile)) {
    throw new Error("Full-lifecycle wallet store already exists; initialization will not overwrite it.");
  }

  const inspection = await createEncryptedWalletStoreFile({
    filePath: targetFile,
    password: input.password,
    walletCount,
  });
  const report = buildFullLifecycle99Inspection(inspection);
  if (!report.structureValid || !report.exactly99Wallets) {
    throw new Error("Full-lifecycle wallet store failed public validation after creation.");
  }
  return {
    targetFile,
    walletCount: FULL_LIFECYCLE_WALLET_COUNT,
    storeId: report.storeId,
    fingerprint: report.fingerprint,
  };
}

export function fullLifecycle99DryRunSummary(plan: FullLifecycle99DryRun): string {
  return [
    "POP33 Base Sepolia full-lifecycle 99-wallet initializer dry-run",
    `Planned file: ${plan.targetFile}`,
    `Planned wallet count: ${plan.walletCount}`,
    `Target exists: ${plan.targetExists ? "YES" : "NO"}`,
    ...plan.safeguards.map((safeguard) => `Safeguard: ${safeguard}`),
    "No file was written and no wallet material was generated.",
  ].join("\n");
}

export function fullLifecycle99InitializationSummary(
  result: FullLifecycle99InitializationResult,
): string {
  return [
    "POP33 Base Sepolia full-lifecycle wallet store initialized",
    `File: ${result.targetFile}`,
    `Wallet count: ${result.walletCount}`,
    `Store ID: ${result.storeId}`,
    `Fingerprint: ${result.fingerprint}`,
    "Private keys, encrypted contents, and password were not printed.",
    "No checkpoint or transaction journal was created.",
    "No wallet was funded and no transaction was signed or sent.",
  ].join("\n");
}

export function fullLifecycle99InspectionSummary(report: FullLifecycle99Inspection): string {
  return [
    "POP33 full-lifecycle wallet store inspection (local read-only)",
    `Format version: ${report.formatVersion}`,
    `Store ID: ${report.storeId}`,
    `Wallet count: ${report.walletCount}`,
    `Created at: ${report.createdAt ?? "not stored by format version 1"}`,
    `Fingerprint: ${report.fingerprint}`,
    `Exactly 99 unique wallets: ${report.exactly99Wallets ? "YES" : "NO"}`,
    `Structure valid: ${report.structureValid ? "YES" : "NO"}`,
    `Duplicate addresses: ${report.duplicateAddresses.length}`,
    `Missing/invalid indices: ${report.missingIndices.length}`,
    ...report.wallets.map((wallet) => `Wallet ${wallet.index}: ${wallet.address}`),
    ...report.validationErrors.map((error) => `Validation error: ${error}`),
    "No private key, password, plaintext store, or encrypted payload was printed.",
    "No RPC connection or write was performed.",
  ].join("\n");
}
