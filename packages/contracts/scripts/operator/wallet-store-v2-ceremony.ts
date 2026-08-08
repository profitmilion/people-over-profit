import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { atomicWritePrivateFile, pathIsRegularFile, withExclusiveFileLock } from "./durable-file.js";
import {
  WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX,
  WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME,
  WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE,
  WALLET_STORE_V2_CEREMONY_START_MARKER_FILE_NAME,
  WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME,
  WALLET_STORE_V2_FIXTURE_AUTHORIZATION,
  WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME,
  assertWalletStoreV2ProductionCeremonyRuntimeCapability,
  buildTrustedWalletStoreIdentity,
  createUnverifiedWalletStoreV2ProductionBackupForCeremony,
  createUnverifiedWalletStoreV2ProductionFormatFixtureBackupForCeremony,
  createWalletStoreV2ProductionBundleDirectory,
  createWalletStoreV2ProductionFormatFixtureBundleDirectory,
  readAndInspectWalletStoreV2ProductionBundleDirectory,
  readAndInspectWalletStoreV2ProductionFormatFixtureBundleDirectory,
  runWalletStoreV2ProductionCeremonyRuntime,
  verifyWalletStoreV2ProductionBackup,
  verifyWalletStoreV2ProductionFormatFixtureBackup,
  validateTrustedWalletStoreIdentity,
  type TrustedWalletStoreIdentity,
  type WalletStoreV2CeremonyFileSecurity,
  type WalletStoreV2ProductionFormatFixtureBundle,
  type WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
  type WalletStoreV2ProductionBundle,
  type WalletStoreV2PublicInspection,
} from "./guarded-checkpoint-20-wallet-store-v2.js";

const STATE_PURPOSE = "pop33-wallet-store-v2-ceremony-state" as const;
const START_MARKER_PURPOSE = "pop33-wallet-store-v2-ceremony-start-marker" as const;
const MAX_STATE_BYTES = 32 * 1024;
const MAX_IDENTITY_BYTES = 16 * 1024;
const MAX_START_MARKER_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WalletStoreV2CeremonyArtifactClass = "production-format-fixture" | "production";
type WalletStoreV2CeremonyBundle =
  | WalletStoreV2ProductionFormatFixtureBundle
  | WalletStoreV2ProductionBundle;
type WalletStoreV2AnyCeremonyFileSecurity =
  | WalletStoreV2CeremonyFileSecurity
  | WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity;

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

const CEREMONY_STAGES: readonly WalletStoreV2CeremonyStage[] = [
  "prepared", "paths-verified", "keys-generating", "keys-generated", "store-written",
  "identity-written", "backup-written", "backup-verified", "final-verified", "complete",
];

export type WalletStoreV2CeremonyFaultBoundary =
  | "after-start-marker"
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
  startMarkerFile: string;
  stateFile: string;
}

export interface WalletStoreV2CeremonyStartMarker {
  formatVersion: 1;
  purpose: typeof START_MARKER_PURPOSE;
  ceremonyId: string;
  artifactClass: WalletStoreV2CeremonyArtifactClass;
  createdAt: string;
  checkpointId: "checkpoint-5-to-20";
  activeRoot: string;
  backupRoot: string;
  identityRoot: string;
  fingerprint: string;
}

export interface WalletStoreV2CeremonyState {
  formatVersion: 1;
  purpose: typeof STATE_PURPOSE;
  ceremonyId: string;
  artifactClass: WalletStoreV2CeremonyArtifactClass;
  stage: WalletStoreV2CeremonyStage;
  revision: number;
  createdAt: string;
  updatedAt: string;
  paths: WalletStoreV2CeremonyPaths;
  trustedIdentity: TrustedWalletStoreIdentity | null;
  fingerprint: string;
}

export interface WalletStoreV2CeremonyReceipt {
  kind: "wallet-store-v2-ceremony-receipt";
  stage: "complete";
  ceremonyId: string;
  artifactClass: WalletStoreV2CeremonyArtifactClass;
  storeId: string;
  activeBundleDirectory: string;
  backupBundleDirectory: string;
  trustedIdentityFile: string;
  startMarkerFile: string;
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
  artifactClass: WalletStoreV2CeremonyArtifactClass;
  ceremonyId: string;
  storeId: string;
  trustedIdentityFile: string;
  stateFile: string;
  trustedIdentityFingerprint: string;
  fingerprint: string;
}

export interface WalletStoreV2CeremonyDependencies {
  artifactClass: WalletStoreV2CeremonyArtifactClass;
  runtimeCapability?: unknown;
  paths: WalletStoreV2CeremonyPaths;
  activeSecurity: WalletStoreV2AnyCeremonyFileSecurity;
  backupSecurity: WalletStoreV2AnyCeremonyFileSecurity;
  identitySecurity: WalletStoreV2AnyCeremonyFileSecurity;
  buildBundle(createdAt: string, ceremonyId: string): Promise<WalletStoreV2CeremonyBundle>;
  createCeremonyId(): string;
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

function assertProductionFormatFixtureCeremonyTempRoot(paths: WalletStoreV2CeremonyPaths): void {
  const temporaryRoot = resolve(tmpdir());
  const child = relative(temporaryRoot, resolve(paths.checkpointRoot));
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error("Production-format fixture ceremony requires an approved temporary test root.");
  }
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
    paths.startMarkerFile !== resolve(paths.identityRoot, WALLET_STORE_V2_CEREMONY_START_MARKER_FILE_NAME) ||
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
    startMarkerFile: resolve(identityRoot, WALLET_STORE_V2_CEREMONY_START_MARKER_FILE_NAME),
    stateFile: resolve(identityRoot, WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME),
  });
}

function buildStartMarker(input: {
  ceremonyId: string;
  artifactClass: WalletStoreV2CeremonyArtifactClass;
  createdAt: string;
  paths: WalletStoreV2CeremonyPaths;
}): WalletStoreV2CeremonyStartMarker {
  if (!UUID.test(input.ceremonyId)) throw new Error("Wallet Store v2 ceremony ID is invalid.");
  const paths = normalizePaths(input.paths);
  const base: Omit<WalletStoreV2CeremonyStartMarker, "fingerprint"> = {
    formatVersion: 1,
    purpose: START_MARKER_PURPOSE,
    ceremonyId: input.ceremonyId,
    artifactClass: input.artifactClass,
    createdAt: checkedIso(input.createdAt, "Wallet Store v2 ceremony marker creation time"),
    checkpointId: "checkpoint-5-to-20",
    activeRoot: paths.activeRoot,
    backupRoot: paths.backupRoot,
    identityRoot: paths.identityRoot,
  };
  return { ...base, fingerprint: fingerprint(base) };
}

function validateStartMarker(
  value: unknown,
  artifactClass: WalletStoreV2CeremonyArtifactClass,
  pathsInput: WalletStoreV2CeremonyPaths,
): WalletStoreV2CeremonyStartMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet Store v2 ceremony start marker is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "formatVersion", "purpose", "ceremonyId", "artifactClass", "createdAt", "checkpointId",
    "activeRoot", "backupRoot", "identityRoot", "fingerprint",
  ];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error("Wallet Store v2 ceremony start marker shape is invalid.");
  }
  if (
    record.formatVersion !== 1 || record.purpose !== START_MARKER_PURPOSE ||
    record.artifactClass !== artifactClass || typeof record.ceremonyId !== "string" ||
    !UUID.test(record.ceremonyId) || record.checkpointId !== "checkpoint-5-to-20" ||
    typeof record.fingerprint !== "string"
  ) throw new Error("Wallet Store v2 ceremony start marker values are invalid.");
  const paths = normalizePaths(pathsInput);
  const marker = buildStartMarker({
    ceremonyId: record.ceremonyId,
    artifactClass,
    createdAt: checkedIso(record.createdAt, "Wallet Store v2 ceremony marker creation time"),
    paths,
  });
  if (
    record.activeRoot !== paths.activeRoot || record.backupRoot !== paths.backupRoot ||
    record.identityRoot !== paths.identityRoot || record.fingerprint !== marker.fingerprint
  ) throw new Error("Wallet Store v2 ceremony start marker does not match this invocation.");
  return marker;
}

function buildState(input: {
  previous?: WalletStoreV2CeremonyState;
  marker: WalletStoreV2CeremonyStartMarker;
  stage: WalletStoreV2CeremonyStage;
  paths: WalletStoreV2CeremonyPaths;
  trustedIdentity: TrustedWalletStoreIdentity | null;
  now: string;
}): WalletStoreV2CeremonyState {
  const expectedIndex = input.previous === undefined
    ? 0
    : CEREMONY_STAGES.indexOf(input.previous.stage) + 1;
  if (CEREMONY_STAGES[expectedIndex] !== input.stage) {
    throw new Error("Wallet Store v2 ceremony state transition is not monotonic.");
  }
  const base: Omit<WalletStoreV2CeremonyState, "fingerprint"> = {
    formatVersion: 1,
    purpose: STATE_PURPOSE,
    ceremonyId: input.marker.ceremonyId,
    artifactClass: input.marker.artifactClass,
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
    artifactClass: identity.artifactClass as WalletStoreV2CeremonyArtifactClass,
    ceremonyId: identity.ceremonyId,
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

function validateState(
  value: unknown,
  expectedPaths: WalletStoreV2CeremonyPaths,
  marker: WalletStoreV2CeremonyStartMarker,
): WalletStoreV2CeremonyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet Store v2 ceremony state is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "formatVersion", "purpose", "ceremonyId", "artifactClass", "stage", "revision", "createdAt", "updatedAt",
    "paths", "trustedIdentity", "fingerprint",
  ];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error("Wallet Store v2 ceremony state shape is invalid.");
  }
  if (
    record.formatVersion !== 1 || record.purpose !== STATE_PURPOSE ||
    record.ceremonyId !== marker.ceremonyId || record.artifactClass !== marker.artifactClass ||
    typeof record.stage !== "string" || !CEREMONY_STAGES.includes(record.stage as WalletStoreV2CeremonyStage) ||
    !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 ||
    typeof record.fingerprint !== "string"
  ) throw new Error("Wallet Store v2 ceremony state values are invalid.");
  const state: WalletStoreV2CeremonyState = {
    formatVersion: 1,
    purpose: STATE_PURPOSE,
    ceremonyId: marker.ceremonyId,
    artifactClass: marker.artifactClass,
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
  if (state.revision !== CEREMONY_STAGES.indexOf(state.stage)) {
    throw new Error("Wallet Store v2 ceremony state transition revision is invalid.");
  }
  if (canonicalJson(state.paths) !== canonicalJson(normalizePaths(expectedPaths))) {
    throw new Error("Wallet Store v2 ceremony state paths do not match this invocation.");
  }
  if (state.createdAt !== marker.createdAt) {
    throw new Error("Wallet Store v2 ceremony state and start marker creation time disagree.");
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

async function loadStartMarker(
  dependencies: WalletStoreV2CeremonyDependencies,
): Promise<WalletStoreV2CeremonyStartMarker | null> {
  if (!(await exists(dependencies.paths.startMarkerFile))) return null;
  await dependencies.identitySecurity.assertPublicFileBeforeOpen(
    dependencies.paths.startMarkerFile,
    "ceremony-start-marker",
  );
  return validateStartMarker(
    await readBoundedJson(dependencies.paths.startMarkerFile, MAX_START_MARKER_BYTES),
    dependencies.artifactClass,
    dependencies.paths,
  );
}

async function persistStartMarker(
  dependencies: WalletStoreV2CeremonyDependencies,
  ceremonyId: string,
  createdAt: string,
): Promise<WalletStoreV2CeremonyStartMarker> {
  const marker = buildStartMarker({
    ceremonyId,
    artifactClass: dependencies.artifactClass,
    createdAt,
    paths: dependencies.paths,
  });
  await dependencies.identitySecurity.assertPublicFileBeforeCreate(
    dependencies.paths.startMarkerFile,
    "ceremony-start-marker",
  );
  await atomicWritePrivateFile(
    dependencies.paths.startMarkerFile,
    `${JSON.stringify(marker, null, 2)}\n`,
  );
  await dependencies.identitySecurity.assertPublicFileAfterCommit(
    dependencies.paths.startMarkerFile,
    "ceremony-start-marker",
  );
  return validateStartMarker(
    await readBoundedJson(dependencies.paths.startMarkerFile, MAX_START_MARKER_BYTES),
    dependencies.artifactClass,
    dependencies.paths,
  );
}

async function loadState(
  dependencies: WalletStoreV2CeremonyDependencies,
  marker: WalletStoreV2CeremonyStartMarker,
): Promise<WalletStoreV2CeremonyState | null> {
  if (!(await exists(dependencies.paths.stateFile))) return null;
  await dependencies.identitySecurity.assertPublicFileBeforeOpen(dependencies.paths.stateFile, "ceremony-state");
  return validateState(
    await readBoundedJson(dependencies.paths.stateFile, MAX_STATE_BYTES),
    dependencies.paths,
    marker,
  );
}

async function persistState(
  dependencies: WalletStoreV2CeremonyDependencies,
  previous: WalletStoreV2CeremonyState | undefined,
  marker: WalletStoreV2CeremonyStartMarker,
  stage: WalletStoreV2CeremonyStage,
  trustedIdentity: TrustedWalletStoreIdentity | null,
): Promise<WalletStoreV2CeremonyState> {
  const now = checkedIso(dependencies.now(), "Wallet Store v2 ceremony clock");
  const state = buildState({ previous, marker, stage, paths: dependencies.paths, trustedIdentity, now });
  if (previous) {
    await dependencies.identitySecurity.assertPublicFileBeforeOpen(dependencies.paths.stateFile, "ceremony-state");
  } else {
    await dependencies.identitySecurity.assertPublicFileBeforeCreate(dependencies.paths.stateFile, "ceremony-state");
  }
  await atomicWritePrivateFile(dependencies.paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await dependencies.identitySecurity.assertPublicFileAfterCommit(dependencies.paths.stateFile, "ceremony-state");
  return validateState(
    await readBoundedJson(dependencies.paths.stateFile, MAX_STATE_BYTES),
    dependencies.paths,
    marker,
  );
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
    inspection.artifactClass !== identity.artifactClass ||
    inspection.ceremonyId !== identity.ceremonyId
  ) throw new Error("Wallet Store v2 ceremony artifact does not match the trusted identity.");
}

function receipt(
  dependencies: WalletStoreV2CeremonyDependencies,
  identity: TrustedWalletStoreIdentity,
  addresses: readonly string[],
): WalletStoreV2CeremonyReceipt {
  return {
    kind: "wallet-store-v2-ceremony-receipt",
    stage: "complete",
    ceremonyId: identity.ceremonyId,
    artifactClass: dependencies.artifactClass,
    storeId: identity.storeId,
    activeBundleDirectory: dependencies.paths.activeBundleDirectory,
    backupBundleDirectory: dependencies.paths.backupBundleDirectory,
    trustedIdentityFile: dependencies.paths.trustedIdentityFile,
    startMarkerFile: dependencies.paths.startMarkerFile,
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
      WALLET_STORE_V2_CEREMONY_START_MARKER_FILE_NAME,
    ]);
    if ((await readdir(paths.identityRoot)).some((entry) => !allowed.has(entry))) {
      throw new Error("Wallet Store v2 ceremony found an unexpected identity artifact and refuses regeneration.");
    }
  }
}

async function readCeremonyBundle(
  dependencies: WalletStoreV2CeremonyDependencies,
  directory: string,
  security: WalletStoreV2AnyCeremonyFileSecurity,
): Promise<WalletStoreV2PublicInspection> {
  if (dependencies.artifactClass === "production") {
    return readAndInspectWalletStoreV2ProductionBundleDirectory({
      directory,
      productionSecurity: security as WalletStoreV2CeremonyFileSecurity,
    });
  }
  return readAndInspectWalletStoreV2ProductionFormatFixtureBundleDirectory({
    directory,
    fixtureSecurity: security as WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
  });
}

async function writeActiveBundle(
  dependencies: WalletStoreV2CeremonyDependencies,
  bundle: WalletStoreV2CeremonyBundle,
  identity: TrustedWalletStoreIdentity,
): Promise<WalletStoreV2PublicInspection> {
  const common = {
    directory: dependencies.paths.activeBundleDirectory,
    hooks: { afterStoreWrite: () => dependencies.fault?.("during-store-commit") },
    ceremonyMetadata: buildActiveMetadata(dependencies.paths, identity),
  };
  if (dependencies.artifactClass === "production") {
    assertWalletStoreV2ProductionCeremonyRuntimeCapability(dependencies.runtimeCapability);
    return createWalletStoreV2ProductionBundleDirectory({
      ...common,
      bundle: bundle as WalletStoreV2ProductionBundle,
      productionSecurity: dependencies.activeSecurity as WalletStoreV2CeremonyFileSecurity,
      runtimeCapability: dependencies.runtimeCapability,
    });
  }
  return createWalletStoreV2ProductionFormatFixtureBundleDirectory({
    ...common,
    bundle: bundle as WalletStoreV2ProductionFormatFixtureBundle,
    fixtureSecurity: dependencies.activeSecurity as WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
  });
}

async function writeUnverifiedBackup(
  dependencies: WalletStoreV2CeremonyDependencies,
  identity: TrustedWalletStoreIdentity,
): Promise<void> {
  const common = {
    sourceDirectory: dependencies.paths.activeBundleDirectory,
    backupDirectory: dependencies.paths.backupBundleDirectory,
    expectedIdentity: identity,
    hooks: { afterStoreWrite: () => dependencies.fault?.("during-backup-write") },
  };
  if (dependencies.artifactClass === "production") {
    assertWalletStoreV2ProductionCeremonyRuntimeCapability(dependencies.runtimeCapability);
    return createUnverifiedWalletStoreV2ProductionBackupForCeremony({
      ...common,
      sourceSecurity: dependencies.activeSecurity as WalletStoreV2CeremonyFileSecurity,
      backupSecurity: dependencies.backupSecurity as WalletStoreV2CeremonyFileSecurity,
      runtimeCapability: dependencies.runtimeCapability,
    });
  }
  return createUnverifiedWalletStoreV2ProductionFormatFixtureBackupForCeremony({
    ...common,
    sourceSecurity: dependencies.activeSecurity as WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
    backupSecurity: dependencies.backupSecurity as WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
  });
}

async function verifyCeremonyBackup(
  dependencies: WalletStoreV2CeremonyDependencies,
  identity: TrustedWalletStoreIdentity,
): Promise<void> {
  if (dependencies.artifactClass === "production") {
    await verifyWalletStoreV2ProductionBackup({
      backupDirectory: dependencies.paths.backupBundleDirectory,
      expectedIdentity: identity,
      backupSecurity: dependencies.backupSecurity as WalletStoreV2CeremonyFileSecurity,
    });
    return;
  }
  await verifyWalletStoreV2ProductionFormatFixtureBackup({
    backupDirectory: dependencies.paths.backupBundleDirectory,
    expectedIdentity: identity,
    backupSecurity: dependencies.backupSecurity as WalletStoreV2ProductionFormatFixtureCeremonyFileSecurity,
  });
}

async function verifyCompletedCeremony(
  dependencies: WalletStoreV2CeremonyDependencies,
  marker: WalletStoreV2CeremonyStartMarker,
  state: WalletStoreV2CeremonyState,
): Promise<WalletStoreV2CeremonyReceipt> {
  if (!state.trustedIdentity) throw new Error("Completed Wallet Store v2 ceremony has no trusted identity.");
  const persistedIdentity = await loadTrustedIdentity(dependencies);
  if (persistedIdentity.fingerprint !== state.trustedIdentity.fingerprint) {
    throw new Error("Wallet Store v2 ceremony state and trusted identity disagree.");
  }
  if (
    persistedIdentity.ceremonyId !== marker.ceremonyId ||
    persistedIdentity.artifactClass !== marker.artifactClass
  ) throw new Error("Wallet Store v2 completed ceremony identity does not match its start marker.");
  const active = await readCeremonyBundle(
    dependencies,
    dependencies.paths.activeBundleDirectory,
    dependencies.activeSecurity,
  );
  const backup = await readCeremonyBundle(
    dependencies,
    dependencies.paths.backupBundleDirectory,
    dependencies.backupSecurity,
  );
  assertInspectionIdentity(active, persistedIdentity);
  assertInspectionIdentity(backup, persistedIdentity);
  await loadActiveMetadata(dependencies, persistedIdentity);
  await verifyCeremonyBackup(dependencies, persistedIdentity);
  return receipt(dependencies, persistedIdentity, active.addresses);
}

async function verifyFinalCompletionProof(
  dependencies: WalletStoreV2CeremonyDependencies,
  marker: WalletStoreV2CeremonyStartMarker,
): Promise<{ identity: TrustedWalletStoreIdentity; active: WalletStoreV2PublicInspection }> {
  const identity = await loadTrustedIdentity(dependencies);
  if (identity.ceremonyId !== marker.ceremonyId || identity.artifactClass !== marker.artifactClass) {
    throw new Error("Wallet Store v2 final identity does not match the ceremony start marker.");
  }
  const active = await readCeremonyBundle(
    dependencies,
    dependencies.paths.activeBundleDirectory,
    dependencies.activeSecurity,
  );
  const backup = await readCeremonyBundle(
    dependencies,
    dependencies.paths.backupBundleDirectory,
    dependencies.backupSecurity,
  );
  await loadActiveMetadata(dependencies, identity);
  assertInspectionIdentity(active, identity);
  assertInspectionIdentity(backup, identity);
  await verifyCeremonyBackup(dependencies, identity);
  return { identity, active };
}

export async function runWalletStoreV2CeremonyCore(
  dependenciesInput: WalletStoreV2CeremonyDependencies,
): Promise<WalletStoreV2CeremonyReceipt> {
  const dependencies = { ...dependenciesInput, paths: normalizePaths(dependenciesInput.paths) };
  if (dependencies.artifactClass === "production") {
    assertWalletStoreV2ProductionCeremonyRuntimeCapability(dependencies.runtimeCapability);
  } else if (dependencies.runtimeCapability !== undefined) {
    throw new Error("Production-format fixture ceremony rejects production runtime capability.");
  } else {
    assertProductionFormatFixtureCeremonyTempRoot(dependencies.paths);
  }
  for (const security of [dependencies.activeSecurity, dependencies.backupSecurity, dependencies.identitySecurity]) {
    if (security.artifactClass !== dependencies.artifactClass) {
      throw new Error("Wallet Store v2 ceremony security artifact class mismatch.");
    }
  }
  const stateExists = await exists(dependencies.paths.stateFile);
  if (stateExists) {
    await dependencies.identitySecurity.assertPublicFileBeforeOpen(dependencies.paths.stateFile, "ceremony-state");
  } else {
    await dependencies.identitySecurity.assertPublicFileBeforeCreate(dependencies.paths.stateFile, "ceremony-state");
  }
  return withExclusiveFileLock(dependencies.paths.stateFile, async () => {
    let marker = await loadStartMarker(dependencies);
    const durableStateExists = await exists(dependencies.paths.stateFile);
    if (marker && !durableStateExists) {
      throw new Error(
        "Wallet Store v2 ceremony start marker exists without state; incident recovery is required.",
      );
    }
    if (!marker && durableStateExists) {
      throw new Error(
        "Wallet Store v2 ceremony state exists without its start marker; incident recovery is required.",
      );
    }
    let state: WalletStoreV2CeremonyState | null = null;
    if (marker) state = await loadState(dependencies, marker);
    if (state?.stage === "complete") return verifyCompletedCeremony(dependencies, marker!, state);
    if (state && state.stage !== "prepared" && state.stage !== "paths-verified") {
      throw new Error(
        `Wallet Store v2 ceremony stopped at ${state.stage}; regeneration is forbidden and operator recovery is required.`,
      );
    }
    await assertNoMaterialArtifacts(dependencies.paths);
    if (!marker) {
      const ceremonyId = dependencies.createCeremonyId();
      const createdAt = checkedIso(dependencies.now(), "Wallet Store v2 ceremony clock");
      marker = await persistStartMarker(dependencies, ceremonyId, createdAt);
      await dependencies.fault?.("after-start-marker");
    }
    if (!state) {
      state = await persistState(dependencies, undefined, marker, "prepared", null);
      await dependencies.fault?.("after-prepared");
    }
    await dependencies.activeSecurity.assertBeforeCreate(dependencies.paths.activeBundleDirectory);
    await dependencies.backupSecurity.assertBeforeCreate(dependencies.paths.backupBundleDirectory);
    await dependencies.identitySecurity.assertPublicFileBeforeCreate(
      dependencies.paths.trustedIdentityFile,
      "trusted-identity",
    );
    if (state.stage !== "paths-verified") {
      state = await persistState(dependencies, state, marker, "paths-verified", null);
      await dependencies.fault?.("after-paths-verified");
    }
    state = await persistState(dependencies, state, marker, "keys-generating", null);
    await dependencies.fault?.("after-keys-generating");
    const bundle = await dependencies.buildBundle(state.createdAt, marker.ceremonyId);
    if (
      bundle.artifactClass !== marker.artifactClass ||
      bundle.manifest.ceremonyId !== marker.ceremonyId ||
      bundle.envelope.ceremonyId !== marker.ceremonyId
    ) throw new Error("Wallet Store v2 generated bundle does not match the ceremony start marker.");
    const identity = buildTrustedWalletStoreIdentity(bundle.manifest);
    state = await persistState(dependencies, state, marker, "keys-generated", identity);
    await dependencies.fault?.("after-keys-generated");
    await dependencies.fault?.("before-store-commit");
    const active = await writeActiveBundle(dependencies, bundle, identity);
    assertInspectionIdentity(active, identity);
    state = await persistState(dependencies, state, marker, "store-written", identity);
    await dependencies.fault?.("after-store-written");
    const persistedIdentity = await persistTrustedIdentity(dependencies, identity);
    state = await persistState(dependencies, state, marker, "identity-written", persistedIdentity);
    await dependencies.fault?.("after-identity-written");
    await dependencies.fault?.("before-backup-write");
    await writeUnverifiedBackup(dependencies, persistedIdentity);
    state = await persistState(dependencies, state, marker, "backup-written", persistedIdentity);
    await dependencies.fault?.("after-backup-written");
    await verifyCeremonyBackup(dependencies, persistedIdentity);
    const backup = await readCeremonyBundle(
      dependencies,
      dependencies.paths.backupBundleDirectory,
      dependencies.backupSecurity,
    );
    assertInspectionIdentity(backup, persistedIdentity);
    state = await persistState(dependencies, state, marker, "backup-verified", persistedIdentity);
    await dependencies.fault?.("after-backup-verified");
    await dependencies.fault?.("before-final-verification");
    let proof = await verifyFinalCompletionProof(dependencies, marker);
    state = await persistState(dependencies, state, marker, "final-verified", proof.identity);
    await dependencies.fault?.("after-final-verification");
    proof = await verifyFinalCompletionProof(dependencies, marker);
    state = await persistState(dependencies, state, marker, "complete", proof.identity);
    return receipt(dependencies, proof.identity, proof.active.addresses);
  });
}

export async function runWalletStoreV2ProductionCeremony(input: {
  authorization: string;
  now?: () => string;
}): Promise<WalletStoreV2CeremonyReceipt> {
  return runWalletStoreV2ProductionCeremonyRuntime(input);
}

export async function runWalletStoreV2ProductionFormatFixtureCeremony(input: {
  authorization: string;
  dependencies: WalletStoreV2CeremonyDependencies;
}): Promise<WalletStoreV2CeremonyReceipt> {
  if (input.authorization !== WALLET_STORE_V2_FIXTURE_AUTHORIZATION) {
    throw new Error("Production-format ceremony fixture requires test-only authorization.");
  }
  if (input.dependencies.artifactClass !== "production-format-fixture") {
    throw new Error("Fixture ceremony requires production-format-fixture artifact class.");
  }
  return runWalletStoreV2CeremonyCore(input.dependencies);
}
