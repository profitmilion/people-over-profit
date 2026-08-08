import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { atomicWritePrivateFile, pathIsRegularFile, withExclusiveFileLock } from "./durable-file.js";
import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME,
  WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE,
  WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION,
  WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME,
  NodeCSPRNGProductionWalletGenerator,
  ProductionTtyPasswordProvider,
  buildTrustedWalletStoreIdentity,
  buildWalletStoreV2ProductionBundle,
  createUnverifiedWalletStoreV2ProductionBackupForCeremony,
  createWalletStoreV2ProductionBundleDirectory,
  readAndInspectWalletStoreV2ProductionBundleDirectory,
  verifyWalletStoreV2ProductionBackup,
  validateTrustedWalletStoreIdentity,
  type TrustedWalletStoreIdentity,
  type WalletStoreV2CeremonyFileSecurity,
  type WalletStoreV2ProductionBundle,
  type WalletStoreV2PublicInspection,
} from "./guarded-checkpoint-20-wallet-store-v2.js";
import { createDefaultWindowsWalletStoreV2ProductionSecurity } from "./wallet-store-v2-windows-security.js";

const STATE_PURPOSE = "pop33-wallet-store-v2-production-ceremony-state" as const;
const MAX_STATE_BYTES = 32 * 1024;
const MAX_IDENTITY_BYTES = 16 * 1024;

export type WalletStoreV2CeremonyStage =
  | "prepared"
  | "paths-verified"
  | "keys-generating"
  | "keys-generated"
  | "store-written"
  | "identity-written"
  | "backup-written"
  | "backup-verified"
  | "final-verified"
  | "complete";

export type WalletStoreV2CeremonyFaultBoundary =
  | "after-prepared"
  | "after-paths-verified"
  | "after-keys-generating"
  | "after-keys-generated"
  | "before-store-commit"
  | "during-store-commit"
  | "after-store-written"
  | "before-identity-write"
  | "during-identity-write"
  | "after-identity-written"
  | "before-backup-write"
  | "during-backup-write"
  | "after-backup-written"
  | "after-backup-verified"
  | "before-final-verification"
  | "after-final-verification";

export interface WalletStoreV2CeremonyPaths {
  checkpointRoot: string;
  activeRoot: string;
  backupRoot: string;
  identityRoot: string;
  activeBundleDirectory: string;
  backupBundleDirectory: string;
  trustedIdentityFile: string;
  stateFile: string;
}

export interface WalletStoreV2CeremonyState {
  formatVersion: 1;
  purpose: typeof STATE_PURPOSE;
  stage: WalletStoreV2CeremonyStage;
  revision: number;
  createdAt: string;
  updatedAt: string;
  paths: WalletStoreV2CeremonyPaths;
  trustedIdentity: TrustedWalletStoreIdentity | null;
  fingerprint: string;
}

export interface WalletStoreV2CeremonyReceipt {
  kind: "wallet-store-v2-production-ceremony-receipt";
  stage: "complete";
  storeId: string;
  activeBundleDirectory: string;
  backupBundleDirectory: string;
  trustedIdentityFile: string;
  stateFile: string;
  bindingFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  trustedIdentityFingerprint: string;
  addresses: readonly string[];
  activeVerified: true;
  backupVerified: true;
  trustedIdentityVerified: true;
  regenerationBlocked: true;
}

interface WalletStoreV2ActiveCeremonyMetadata {
  formatVersion: 1;
  purpose: typeof WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE;
  storeId: string;
  trustedIdentityFile: string;
  stateFile: string;
  trustedIdentityFingerprint: string;
  fingerprint: string;
}

export interface WalletStoreV2CeremonyDependencies {
  paths: WalletStoreV2CeremonyPaths;
  activeSecurity: WalletStoreV2CeremonyFileSecurity;
  backupSecurity: WalletStoreV2CeremonyFileSecurity;
  identitySecurity: WalletStoreV2CeremonyFileSecurity;
  buildBundle(createdAt: string): Promise<WalletStoreV2ProductionBundle>;
  now(): string;
  fault?(boundary: WalletStoreV2CeremonyFaultBoundary): Promise<void> | void;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function withoutFingerprint(state: WalletStoreV2CeremonyState): Omit<WalletStoreV2CeremonyState, "fingerprint"> {
  const base: Partial<WalletStoreV2CeremonyState> = { ...state };
  delete base.fingerprint;
  return base as Omit<WalletStoreV2CeremonyState, "fingerprint">;
}

function checkedIso(value: unknown, label: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function normalizePaths(input: WalletStoreV2CeremonyPaths): WalletStoreV2CeremonyPaths {
  const paths = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, resolve(value)]),
  ) as unknown as WalletStoreV2CeremonyPaths;
  if (paths.activeRoot !== resolve(paths.checkpointRoot, "active")) {
    throw new Error("Wallet Store v2 ceremony active root is invalid.");
  }
  if (paths.backupRoot !== resolve(paths.checkpointRoot, "backup")) {
    throw new Error("Wallet Store v2 ceremony backup root is invalid.");
  }
  if (paths.identityRoot !== resolve(paths.checkpointRoot, "identity")) {
    throw new Error("Wallet Store v2 ceremony identity root is invalid.");
  }
  if (
    paths.activeBundleDirectory !== resolve(paths.activeRoot, `active${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`) ||
    paths.backupBundleDirectory !== resolve(paths.backupRoot, `backup${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`) ||
    paths.trustedIdentityFile !== resolve(paths.identityRoot, WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME) ||
    paths.stateFile !== resolve(paths.identityRoot, WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME)
  ) throw new Error("Wallet Store v2 ceremony artifact paths are invalid.");
  return paths;
}

export function walletStoreV2CeremonyPaths(checkpointRootInput: string): WalletStoreV2CeremonyPaths {
  const checkpointRoot = resolve(checkpointRootInput);
  const activeRoot = resolve(checkpointRoot, "active");
  const backupRoot = resolve(checkpointRoot, "backup");
  const identityRoot = resolve(checkpointRoot, "identity");
  return normalizePaths({
    checkpointRoot,
    activeRoot,
    backupRoot,
    identityRoot,
    activeBundleDirectory: resolve(activeRoot, `active${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`),
    backupBundleDirectory: resolve(backupRoot, `backup${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}`),
    trustedIdentityFile: resolve(identityRoot, WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME),
    stateFile: resolve(identityRoot, WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME),
  });
}

function buildState(input: {
  previous?: WalletStoreV2CeremonyState;
  stage: WalletStoreV2CeremonyStage;
  paths: WalletStoreV2CeremonyPaths;
  trustedIdentity: TrustedWalletStoreIdentity | null;
  now: string;
}): WalletStoreV2CeremonyState {
  const base: Omit<WalletStoreV2CeremonyState, "fingerprint"> = {
    formatVersion: 1,
    purpose: STATE_PURPOSE,
    stage: input.stage,
    revision: (input.previous?.revision ?? -1) + 1,
    createdAt: input.previous?.createdAt ?? input.now,
    updatedAt: input.now,
    paths: normalizePaths(input.paths),
    trustedIdentity: input.trustedIdentity === null
      ? null
      : validateTrustedWalletStoreIdentity(input.trustedIdentity),
  };
  return { ...base, fingerprint: fingerprint(base) };
}

function buildActiveMetadata(
  paths: WalletStoreV2CeremonyPaths,
  identity: TrustedWalletStoreIdentity,
): WalletStoreV2ActiveCeremonyMetadata {
  const base: Omit<WalletStoreV2ActiveCeremonyMetadata, "fingerprint"> = {
    formatVersion: 1,
    purpose: WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE,
    storeId: identity.storeId,
    trustedIdentityFile: paths.trustedIdentityFile,
    stateFile: paths.stateFile,
    trustedIdentityFingerprint: identity.fingerprint,
  };
  return { ...base, fingerprint: fingerprint(base) };
}

function validateActiveMetadata(
  value: unknown,
  paths: WalletStoreV2CeremonyPaths,
  identity: TrustedWalletStoreIdentity,
): WalletStoreV2ActiveCeremonyMetadata {
  const expected = buildActiveMetadata(paths, identity);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet Store v2 active ceremony metadata is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(expected) as Array<keyof WalletStoreV2ActiveCeremonyMetadata>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => record[key] !== expected[key])
  ) throw new Error("Wallet Store v2 active ceremony metadata does not match the trusted identity.");
  return expected;
}

function validateState(value: unknown, expectedPaths: WalletStoreV2CeremonyPaths): WalletStoreV2CeremonyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet Store v2 ceremony state is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "formatVersion", "purpose", "stage", "revision", "createdAt", "updatedAt",
    "paths", "trustedIdentity", "fingerprint",
  ];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error("Wallet Store v2 ceremony state shape is invalid.");
  }
  const stages: readonly WalletStoreV2CeremonyStage[] = [
    "prepared", "paths-verified", "keys-generating", "keys-generated", "store-written",
    "identity-written", "backup-written", "backup-verified", "final-verified", "complete",
  ];
  if (
    record.formatVersion !== 1 || record.purpose !== STATE_PURPOSE ||
    typeof record.stage !== "string" || !stages.includes(record.stage as WalletStoreV2CeremonyStage) ||
    !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 ||
    typeof record.fingerprint !== "string"
  ) throw new Error("Wallet Store v2 ceremony state values are invalid.");
  const state: WalletStoreV2CeremonyState = {
    formatVersion: 1,
    purpose: STATE_PURPOSE,
    stage: record.stage as WalletStoreV2CeremonyStage,
    revision: record.revision as number,
    createdAt: checkedIso(record.createdAt, "Wallet Store v2 ceremony creation time"),
    updatedAt: checkedIso(record.updatedAt, "Wallet Store v2 ceremony update time"),
    paths: normalizePaths(record.paths as WalletStoreV2CeremonyPaths),
    trustedIdentity: record.trustedIdentity === null
      ? null
      : validateTrustedWalletStoreIdentity(record.trustedIdentity),
    fingerprint: record.fingerprint,
  };
  if (canonicalJson(state.paths) !== canonicalJson(normalizePaths(expectedPaths))) {
    throw new Error("Wallet Store v2 ceremony state paths do not match this invocation.");
  }
  if (fingerprint(withoutFingerprint(state)) !== state.fingerprint) {
    throw new Error("Wallet Store v2 ceremony state fingerprint mismatch.");
  }
  const preGeneration = state.stage === "prepared" || state.stage === "paths-verified" || state.stage === "keys-generating";
  if (preGeneration !== (state.trustedIdentity === null)) {
    throw new Error("Wallet Store v2 ceremony state identity phase is inconsistent.");
  }
  return state;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readBoundedJson(path: string, maximumBytes: number): Promise<unknown> {
  if (!(await pathIsRegularFile(path))) throw new Error("Wallet Store v2 ceremony file is missing.");
  const bytes = await readFile(path);
  try {
    if (bytes.length > maximumBytes) throw new Error("Wallet Store v2 ceremony file exceeds its size limit.");
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    bytes.fill(0);
  }
}

async function loadState(dependencies: WalletStoreV2CeremonyDependencies): Promise<WalletStoreV2CeremonyState | null> {
  if (!(await exists(dependencies.paths.stateFile))) return null;
  await dependencies.identitySecurity.assertPublicFileBeforeOpen(dependencies.paths.stateFile, "ceremony-state");
  return validateState(await readBoundedJson(dependencies.paths.stateFile, MAX_STATE_BYTES), dependencies.paths);
}

async function persistState(
  dependencies: WalletStoreV2CeremonyDependencies,
  previous: WalletStoreV2CeremonyState | undefined,
  stage: WalletStoreV2CeremonyStage,
  trustedIdentity: TrustedWalletStoreIdentity | null,
): Promise<WalletStoreV2CeremonyState> {
  const now = checkedIso(dependencies.now(), "Wallet Store v2 ceremony clock");
  const state = buildState({ previous, stage, paths: dependencies.paths, trustedIdentity, now });
  if (previous) {
    await dependencies.identitySecurity.assertPublicFileBeforeOpen(dependencies.paths.stateFile, "ceremony-state");
  } else {
    await dependencies.identitySecurity.assertPublicFileBeforeCreate(dependencies.paths.stateFile, "ceremony-state");
  }
  await atomicWritePrivateFile(dependencies.paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await dependencies.identitySecurity.assertPublicFileAfterCommit(dependencies.paths.stateFile, "ceremony-state");
  return validateState(await readBoundedJson(dependencies.paths.stateFile, MAX_STATE_BYTES), dependencies.paths);
}

async function persistTrustedIdentity(
  dependencies: WalletStoreV2CeremonyDependencies,
  identityInput: TrustedWalletStoreIdentity,
): Promise<TrustedWalletStoreIdentity> {
  const identity = validateTrustedWalletStoreIdentity(identityInput);
  await dependencies.identitySecurity.assertPublicFileBeforeCreate(
    dependencies.paths.trustedIdentityFile,
    "trusted-identity",
  );
  await dependencies.fault?.("before-identity-write");
  await atomicWritePrivateFile(
    dependencies.paths.trustedIdentityFile,
    `${JSON.stringify(identity, null, 2)}\n`,
    { afterFileSync: () => dependencies.fault?.("during-identity-write") },
  );
  await dependencies.identitySecurity.assertPublicFileAfterCommit(
    dependencies.paths.trustedIdentityFile,
    "trusted-identity",
  );
  return loadTrustedIdentity(dependencies);
}

async function loadTrustedIdentity(dependencies: WalletStoreV2CeremonyDependencies): Promise<TrustedWalletStoreIdentity> {
  await dependencies.identitySecurity.assertPublicFileBeforeOpen(
    dependencies.paths.trustedIdentityFile,
    "trusted-identity",
  );
  return validateTrustedWalletStoreIdentity(
    await readBoundedJson(dependencies.paths.trustedIdentityFile, MAX_IDENTITY_BYTES),
  );
}

async function loadActiveMetadata(
  dependencies: WalletStoreV2CeremonyDependencies,
  identity: TrustedWalletStoreIdentity,
): Promise<WalletStoreV2ActiveCeremonyMetadata> {
  return validateActiveMetadata(
    await readBoundedJson(
      resolve(dependencies.paths.activeBundleDirectory, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME),
      MAX_IDENTITY_BYTES,
    ),
    dependencies.paths,
    identity,
  );
}

function assertInspectionIdentity(
  inspection: WalletStoreV2PublicInspection,
  identity: TrustedWalletStoreIdentity,
): void {
  if (
    inspection.storeId !== identity.storeId ||
    inspection.bindingFingerprint !== identity.bindingFingerprint ||
    inspection.encryptedStoreFingerprint !== identity.encryptedStoreFingerprint ||
    inspection.manifestFingerprint !== identity.manifestFingerprint ||
    inspection.artifactClass !== "production"
  ) throw new Error("Wallet Store v2 ceremony artifact does not match the trusted identity.");
}

function receipt(
  dependencies: WalletStoreV2CeremonyDependencies,
  identity: TrustedWalletStoreIdentity,
  addresses: readonly string[],
): WalletStoreV2CeremonyReceipt {
  return {
    kind: "wallet-store-v2-production-ceremony-receipt",
    stage: "complete",
    storeId: identity.storeId,
    activeBundleDirectory: dependencies.paths.activeBundleDirectory,
    backupBundleDirectory: dependencies.paths.backupBundleDirectory,
    trustedIdentityFile: dependencies.paths.trustedIdentityFile,
    stateFile: dependencies.paths.stateFile,
    bindingFingerprint: identity.bindingFingerprint,
    encryptedStoreFingerprint: identity.encryptedStoreFingerprint,
    manifestFingerprint: identity.manifestFingerprint,
    trustedIdentityFingerprint: identity.fingerprint,
    addresses: [...addresses],
    activeVerified: true,
    backupVerified: true,
    trustedIdentityVerified: true,
    regenerationBlocked: true,
  };
}

async function assertNoMaterialArtifacts(paths: WalletStoreV2CeremonyPaths): Promise<void> {
  if (
    await exists(paths.activeBundleDirectory) ||
    await exists(paths.backupBundleDirectory) ||
    await exists(paths.trustedIdentityFile)
  ) throw new Error("Wallet Store v2 ceremony found partial artifacts and refuses regeneration.");
  for (const directory of [paths.activeRoot, paths.backupRoot]) {
    if (!(await exists(directory))) continue;
    if ((await readdir(directory)).length !== 0) {
      throw new Error("Wallet Store v2 ceremony found an orphan or unexpected artifact and refuses regeneration.");
    }
  }
  if (await exists(paths.identityRoot)) {
    const allowed = new Set([
      WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME,
      `${WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME}.lock`,
    ]);
    if ((await readdir(paths.identityRoot)).some((entry) => !allowed.has(entry))) {
      throw new Error("Wallet Store v2 ceremony found an unexpected identity artifact and refuses regeneration.");
    }
  }
}

async function verifyCompletedCeremony(
  dependencies: WalletStoreV2CeremonyDependencies,
  state: WalletStoreV2CeremonyState,
): Promise<WalletStoreV2CeremonyReceipt> {
  if (!state.trustedIdentity) throw new Error("Completed Wallet Store v2 ceremony has no trusted identity.");
  const persistedIdentity = await loadTrustedIdentity(dependencies);
  if (persistedIdentity.fingerprint !== state.trustedIdentity.fingerprint) {
    throw new Error("Wallet Store v2 ceremony state and trusted identity disagree.");
  }
  const active = await readAndInspectWalletStoreV2ProductionBundleDirectory({
    directory: dependencies.paths.activeBundleDirectory,
    productionSecurity: dependencies.activeSecurity,
  });
  const backup = await readAndInspectWalletStoreV2ProductionBundleDirectory({
    directory: dependencies.paths.backupBundleDirectory,
    productionSecurity: dependencies.backupSecurity,
  });
  assertInspectionIdentity(active, persistedIdentity);
  assertInspectionIdentity(backup, persistedIdentity);
  await loadActiveMetadata(dependencies, persistedIdentity);
  await verifyWalletStoreV2ProductionBackup({
    backupDirectory: dependencies.paths.backupBundleDirectory,
    expectedIdentity: persistedIdentity,
    backupSecurity: dependencies.backupSecurity,
  });
  return receipt(dependencies, persistedIdentity, active.addresses);
}

async function runCeremonyCore(
  dependenciesInput: WalletStoreV2CeremonyDependencies,
): Promise<WalletStoreV2CeremonyReceipt> {
  const dependencies = { ...dependenciesInput, paths: normalizePaths(dependenciesInput.paths) };
  const stateExists = await exists(dependencies.paths.stateFile);
  if (stateExists) {
    await dependencies.identitySecurity.assertPublicFileBeforeOpen(dependencies.paths.stateFile, "ceremony-state");
  } else {
    await dependencies.identitySecurity.assertPublicFileBeforeCreate(dependencies.paths.stateFile, "ceremony-state");
  }
  return withExclusiveFileLock(dependencies.paths.stateFile, async () => {
    let state = await loadState(dependencies);
    if (state?.stage === "complete") return verifyCompletedCeremony(dependencies, state);
    if (state && state.stage !== "prepared" && state.stage !== "paths-verified") {
      throw new Error(
        `Wallet Store v2 ceremony stopped at ${state.stage}; regeneration is forbidden and operator recovery is required.`,
      );
    }
    await assertNoMaterialArtifacts(dependencies.paths);
    if (!state) {
      state = await persistState(dependencies, undefined, "prepared", null);
      await dependencies.fault?.("after-prepared");
    }
    await dependencies.activeSecurity.assertBeforeCreate(dependencies.paths.activeBundleDirectory);
    await dependencies.backupSecurity.assertBeforeCreate(dependencies.paths.backupBundleDirectory);
    await dependencies.identitySecurity.assertPublicFileBeforeCreate(
      dependencies.paths.trustedIdentityFile,
      "trusted-identity",
    );
    if (state.stage !== "paths-verified") {
      state = await persistState(dependencies, state, "paths-verified", null);
      await dependencies.fault?.("after-paths-verified");
    }
    state = await persistState(dependencies, state, "keys-generating", null);
    await dependencies.fault?.("after-keys-generating");
    const bundle = await dependencies.buildBundle(state.createdAt);
    const identity = buildTrustedWalletStoreIdentity(bundle.manifest);
    state = await persistState(dependencies, state, "keys-generated", identity);
    await dependencies.fault?.("after-keys-generated");
    await dependencies.fault?.("before-store-commit");
    const active = await createWalletStoreV2ProductionBundleDirectory({
      directory: dependencies.paths.activeBundleDirectory,
      bundle,
      productionSecurity: dependencies.activeSecurity,
      hooks: { afterStoreWrite: () => dependencies.fault?.("during-store-commit") },
      ceremonyMetadata: buildActiveMetadata(dependencies.paths, identity),
    });
    assertInspectionIdentity(active, identity);
    state = await persistState(dependencies, state, "store-written", identity);
    await dependencies.fault?.("after-store-written");
    const persistedIdentity = await persistTrustedIdentity(dependencies, identity);
    state = await persistState(dependencies, state, "identity-written", persistedIdentity);
    await dependencies.fault?.("after-identity-written");
    await dependencies.fault?.("before-backup-write");
    await createUnverifiedWalletStoreV2ProductionBackupForCeremony({
      sourceDirectory: dependencies.paths.activeBundleDirectory,
      backupDirectory: dependencies.paths.backupBundleDirectory,
      expectedIdentity: persistedIdentity,
      sourceSecurity: dependencies.activeSecurity,
      backupSecurity: dependencies.backupSecurity,
      hooks: { afterStoreWrite: () => dependencies.fault?.("during-backup-write") },
    });
    state = await persistState(dependencies, state, "backup-written", persistedIdentity);
    await dependencies.fault?.("after-backup-written");
    await verifyWalletStoreV2ProductionBackup({
      backupDirectory: dependencies.paths.backupBundleDirectory,
      expectedIdentity: persistedIdentity,
      backupSecurity: dependencies.backupSecurity,
    });
    const backup = await readAndInspectWalletStoreV2ProductionBundleDirectory({
      directory: dependencies.paths.backupBundleDirectory,
      productionSecurity: dependencies.backupSecurity,
    });
    assertInspectionIdentity(backup, persistedIdentity);
    state = await persistState(dependencies, state, "backup-verified", persistedIdentity);
    await dependencies.fault?.("after-backup-verified");
    await dependencies.fault?.("before-final-verification");
    const rereadActive = await readAndInspectWalletStoreV2ProductionBundleDirectory({
      directory: dependencies.paths.activeBundleDirectory,
      productionSecurity: dependencies.activeSecurity,
    });
    const rereadIdentity = await loadTrustedIdentity(dependencies);
    await loadActiveMetadata(dependencies, rereadIdentity);
    assertInspectionIdentity(rereadActive, rereadIdentity);
    assertInspectionIdentity(backup, rereadIdentity);
    state = await persistState(dependencies, state, "final-verified", rereadIdentity);
    await dependencies.fault?.("after-final-verification");
    state = await persistState(dependencies, state, "complete", rereadIdentity);
    return receipt(dependencies, rereadIdentity, rereadActive.addresses);
  });
}

export async function runWalletStoreV2ProductionCeremony(input: {
  authorization: string;
  now?: () => string;
}): Promise<WalletStoreV2CeremonyReceipt> {
  if (input.authorization !== WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION) {
    throw new Error("Production Wallet Store v2 ceremony authorization is required.");
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is required for production Wallet Store v2 ceremony.");
  const paths = walletStoreV2CeremonyPaths(resolve(localAppData, "POP33", "operator", "checkpoint-20"));
  const passwordProvider = ProductionTtyPasswordProvider.create(input.authorization);
  const walletGenerator = NodeCSPRNGProductionWalletGenerator.create(input.authorization);
  return runCeremonyCore({
    paths,
    activeSecurity: createDefaultWindowsWalletStoreV2ProductionSecurity(paths.activeRoot),
    backupSecurity: createDefaultWindowsWalletStoreV2ProductionSecurity(paths.backupRoot),
    identitySecurity: createDefaultWindowsWalletStoreV2ProductionSecurity(paths.identityRoot),
    buildBundle: (createdAt) => buildWalletStoreV2ProductionBundle({
      passwordProvider,
      walletGenerator,
      createdAt,
      authorization: input.authorization,
    }),
    now: input.now ?? (() => new Date().toISOString()),
  });
}

export async function runWalletStoreV2ProductionFormatFixtureCeremony(input: {
  authorization: string;
  dependencies: WalletStoreV2CeremonyDependencies;
}): Promise<WalletStoreV2CeremonyReceipt> {
  if (input.authorization !== WALLET_STORE_V2_FIXTURE_AUTHORIZATION) {
    throw new Error("Production-format ceremony fixture requires test-only authorization.");
  }
  return runCeremonyCore(input.dependencies);
}
