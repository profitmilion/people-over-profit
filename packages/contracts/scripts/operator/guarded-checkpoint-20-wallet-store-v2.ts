import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { inspect } from "node:util";

import { computeAddress, getAddress, isAddress } from "ethers";

import {
  atomicWritePrivateFile,
  assertSafeExternalFilePath,
  pathIsRegularFile,
} from "./durable-file.js";
import {
  GUARDED_CHECKPOINT_20_BASELINE,
  GUARDED_CHECKPOINT_20_CANDIDATE_COUNT,
  GUARDED_CHECKPOINT_20_CHAIN_ID,
  GUARDED_CHECKPOINT_20_CONTRACT,
  GUARDED_CHECKPOINT_20_TARGET,
  GUARDED_CHECKPOINT_20_TOKEN,
  buildGuardedCheckpoint20Manifest,
  type GuardedCheckpoint20Manifest,
  type GuardedCheckpoint20StoreBinding,
} from "./guarded-checkpoint-20.js";

export const WALLET_STORE_V2_FIXTURE_AUTHORIZATION =
  "POP33_WALLET_STORE_V2_TEST_FIXTURE_ONLY";
export const WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION =
  "PREPARE_15_UNFUNDED_BASE_SEPOLIA_WALLETS_FOR_CHECKPOINT_5_TO_20";
export const WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX =
  ".checkpoint-20-wallet-store-v2-bundle";
export const WALLET_STORE_V2_STORE_FILE_NAME =
  "checkpoint-20.wallet-store-v2.enc.json";
export const WALLET_STORE_V2_MANIFEST_FILE_NAME =
  "checkpoint-20.wallet-store-v2.manifest.json";
export const WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME =
  "checkpoint-20.wallet-store-v2.backup.json";
export const WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME =
  "checkpoint-20.wallet-store-v2.trusted-identity.json";
export const WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME =
  "checkpoint-20.wallet-store-v2.ceremony-state.json";
export const WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME =
  "checkpoint-20.wallet-store-v2.ceremony.json";
export const WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE =
  "pop33-wallet-store-v2-production-ceremony-metadata";

const FORMAT_VERSION = 2 as const;
const PURPOSE = "pop33-guarded-checkpoint-20-wallet-store-v2" as const;
const MANIFEST_PURPOSE = "pop33-guarded-checkpoint-20-wallet-store-v2-public-manifest" as const;
const BACKUP_PURPOSE = "pop33-guarded-checkpoint-20-wallet-store-v2-backup" as const;
const TRUSTED_IDENTITY_PURPOSE = "pop33-wallet-store-v2-trusted-identity" as const;
const CHECKPOINT_ID = "checkpoint-5-to-20" as const;
const CIPHER = "aes-256-gcm" as const;
const KDF = "scrypt" as const;
const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
export const WALLET_STORE_V2_PASSWORD_MIN_BYTES = 16;
export const WALLET_STORE_V2_PASSWORD_MAX_BYTES = 256;
const MAX_STORE_FILE_BYTES = 64 * 1024;
const MAX_MANIFEST_FILE_BYTES = 32 * 1024;
const MAX_BACKUP_METADATA_BYTES = 16 * 1024;
const UUID_BODY = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_BODY}$`, "i");
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const consumeUnlockSecret = Symbol("consumeWalletStoreV2UnlockSecret");
const consumeFixtureRecord = Symbol("consumeWalletStoreV2FixtureRecord");

export type WalletStoreV2ArtifactClass = "fixture" | "production";

export interface WalletStoreV2Candidate {
  index: number;
  address: string;
}

export interface WalletStoreV2PublicManifest {
  formatVersion: 2;
  purpose: typeof MANIFEST_PURPOSE;
  artifactClass: WalletStoreV2ArtifactClass;
  createdAt: string;
  chainId: "84532";
  contractAddress: string;
  tokenAddress: string;
  checkpoint: {
    id: typeof CHECKPOINT_ID;
    baselineCount: "5";
    targetCount: "20";
    recordCount: 15;
  };
  store: {
    formatVersion: 2;
    storeId: string;
    bindingFingerprint: string;
    encryptedStoreFingerprint: string;
  };
  candidates: readonly WalletStoreV2Candidate[];
  fingerprint: string;
}

export interface WalletStoreV2EncryptedRecord {
  index: number;
  address: string;
  iv: string;
  authenticationTag: string;
  ciphertext: string;
  recordFingerprint: string;
}

export interface WalletStoreV2Envelope {
  formatVersion: 2;
  purpose: typeof PURPOSE;
  artifactClass: WalletStoreV2ArtifactClass;
  createdAt: string;
  storeId: string;
  chainId: "84532";
  contractAddress: string;
  tokenAddress: string;
  checkpointId: typeof CHECKPOINT_ID;
  baselineCount: "5";
  targetCount: "20";
  recordCount: 15;
  cipher: typeof CIPHER;
  kdf: typeof KDF;
  kdfParameters: {
    n: number;
    r: number;
    p: number;
    salt: string;
  };
  bindingFingerprint: string;
  recordsFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  records: readonly WalletStoreV2EncryptedRecord[];
}

export interface WalletStoreV2FixtureBundle {
  artifactClass: "fixture";
  manifest: WalletStoreV2PublicManifest;
  envelope: WalletStoreV2Envelope;
}

export interface WalletStoreV2ProductionBundle {
  artifactClass: "production";
  manifest: WalletStoreV2PublicManifest;
  envelope: WalletStoreV2Envelope;
}

export type WalletStoreV2Bundle = WalletStoreV2FixtureBundle | WalletStoreV2ProductionBundle;

export interface WalletStoreV2PublicInspection {
  kind: "wallet-store-v2-inspection";
  readOnly: true;
  artifactClass: WalletStoreV2ArtifactClass;
  formatVersion: 2;
  storeId: string;
  chainId: "84532";
  contractAddress: string;
  tokenAddress: string;
  checkpointId: typeof CHECKPOINT_ID;
  baselineCount: "5";
  targetCount: "20";
  recordCount: 15;
  addresses: readonly string[];
  bindingFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  cipher: typeof CIPHER;
  kdf: typeof KDF;
}

export interface WalletStoreV2SessionReceipt {
  kind: "wallet-store-v2-session-receipt";
  artifactClass: WalletStoreV2ArtifactClass;
  storeId: string;
  index: number;
  address: string;
  manifestFingerprint: string;
  addressVerified: true;
  sessionClosed: true;
}

export interface WalletStoreV2BackupReceipt {
  kind: "wallet-store-v2-backup-receipt";
  artifactClass: WalletStoreV2ArtifactClass;
  storeId: string;
  bindingFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  backupVerified: true;
}

export type WalletStoreV2PublicOutput =
  | WalletStoreV2PublicInspection
  | WalletStoreV2SessionReceipt
  | WalletStoreV2BackupReceipt;

export interface WalletStoreV2BackupMetadata {
  formatVersion: 1;
  purpose: typeof BACKUP_PURPOSE;
  artifactClass: WalletStoreV2ArtifactClass;
  storeId: string;
  bindingFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  storeFile: typeof WALLET_STORE_V2_STORE_FILE_NAME;
  manifestFile: typeof WALLET_STORE_V2_MANIFEST_FILE_NAME;
  fingerprint: string;
}

export interface TrustedWalletStoreIdentity {
  formatVersion: 1;
  purpose: typeof TRUSTED_IDENTITY_PURPOSE;
  artifactClass: WalletStoreV2ArtifactClass;
  storeFormatVersion: 2;
  storeId: string;
  chainId: "84532";
  contractAddress: string;
  tokenAddress: string;
  checkpointId: typeof CHECKPOINT_ID;
  baselineCount: "5";
  targetCount: "20";
  recordCount: 15;
  bindingFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  fingerprint: string;
}

export interface WalletStoreV2BundlePaths {
  directory: string;
  storeFile: string;
  manifestFile: string;
  backupMetadataFile: string;
  ceremonyMetadataFile: string;
}

export interface WalletStoreV2WriteHooks {
  afterStoreWrite?(): Promise<void> | void;
  beforeDirectoryCommit?(): Promise<void> | void;
}

export interface WalletStoreV2ProductionFileSecurity {
  readonly artifactClass: "production";
  assertBeforeCreate(directory: string): Promise<void>;
  assertAfterCommit(directory: string): Promise<void>;
  assertBeforeOpen(directory: string): Promise<void>;
}

export type WalletStoreV2CeremonyPublicFileKind = "trusted-identity" | "ceremony-state";

export interface WalletStoreV2CeremonyFileSecurity extends WalletStoreV2ProductionFileSecurity {
  assertPublicFileBeforeCreate(path: string, kind: WalletStoreV2CeremonyPublicFileKind): Promise<void>;
  assertPublicFileAfterCommit(path: string, kind: WalletStoreV2CeremonyPublicFileKind): Promise<void>;
  assertPublicFileBeforeOpen(path: string, kind: WalletStoreV2CeremonyPublicFileKind): Promise<void>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(`${label} contains a non-public or unsupported field.`);
  }
  for (const key of keys) {
    if (!(key in record)) throw new Error(`${label} is incomplete.`);
  }
  return record;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length !== 24) throw new Error(`${label} is invalid.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function base64(value: unknown, length: number | null, label: string): Buffer {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid.`);
  const maximumEncodedLength = length === null ? 4096 : Math.ceil(length / 3) * 4;
  if (value.length !== maximumEncodedLength) throw new Error(`${label} has an invalid encoded length.`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (length !== null && decoded.length !== length)) {
    decoded.fill(0);
    throw new Error(`${label} is invalid.`);
  }
  return decoded;
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length !== 71 || !DIGEST.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID.test(value);
}

function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && value.length === 42 && isAddress(value);
}

function normalizeCandidates(candidates: readonly WalletStoreV2Candidate[]): WalletStoreV2Candidate[] {
  if (candidates.length !== GUARDED_CHECKPOINT_20_CANDIDATE_COUNT) {
    throw new Error("Wallet Store v2 requires exactly 15 public candidates.");
  }
  const seen = new Set<string>();
  return candidates.map((candidate, index) => {
    if (candidate.index !== index || !isEvmAddress(candidate.address)) {
      throw new Error("Wallet Store v2 candidate order or address is invalid.");
    }
    const address = getAddress(candidate.address);
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) throw new Error("Wallet Store v2 contains a duplicate public address.");
    seen.add(normalized);
    return { index, address };
  });
}

function assertFixtureAuthorization(value: string): void {
  if (value !== WALLET_STORE_V2_FIXTURE_AUTHORIZATION) {
    throw new Error("Wallet Store v2 fixture authorization is required; real wallet creation is unavailable.");
  }
}

function validatePrivateKeyBytes(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength !== KEY_LENGTH) {
    throw new Error("Fixture secret record is invalid.");
  }
  const copy = Buffer.from(value);
  try {
    deriveAddress(copy);
    return copy;
  } catch {
    copy.fill(0);
    throw new Error("Fixture secret record is invalid.");
  }
}

function deriveAddress(privateKeyBytes: Buffer): string {
  // ethers v6 computeAddress accepts a string or SigningKey. This short-lived
  // immutable copy cannot be zeroized by JavaScript/V8; never retain or log it.
  let privateKeyHex: string | null = `0x${privateKeyBytes.toString("hex")}`;
  try {
    return getAddress(computeAddress(privateKeyHex));
  } finally {
    privateKeyHex = null;
  }
}

export class WalletStoreV2FixtureUnlockSecret {
  #bytes: Buffer | null;

  private constructor(bytes: Buffer) {
    this.#bytes = bytes;
    Object.freeze(this);
  }

  static fromFixtureText(value: string, authorization: string): WalletStoreV2FixtureUnlockSecret {
    assertFixtureAuthorization(authorization);
    if (typeof value !== "string" || value.length < 16 || !value.includes("fixture")) {
      throw new Error("Wallet Store v2 accepts only an explicitly labelled fixture unlock secret.");
    }
    return new WalletStoreV2FixtureUnlockSecret(Buffer.from(value, "utf8"));
  }

  async [consumeUnlockSecret]<T>(operation: (bytes: Buffer) => Promise<T>): Promise<T> {
    const bytes = this.#bytes;
    if (!bytes) throw new Error("Wallet Store v2 unlock secret is already closed.");
    this.#bytes = null;
    try {
      return await operation(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  destroy(): void {
    this.#bytes?.fill(0);
    this.#bytes = null;
  }

  toJSON(): never {
    throw new Error("Wallet Store v2 secret objects cannot be serialized.");
  }

  [inspect.custom](): string {
    return "[WalletStoreV2FixtureUnlockSecret REDACTED]";
  }

  [Symbol.toPrimitive](): never {
    throw new Error("Wallet Store v2 secret objects cannot be converted to text.");
  }
}

export class WalletStoreV2FixtureSecretRecord {
  #bytes: Buffer | null;
  #index: number;
  #address: string;

  private constructor(index: number, address: string, bytes: Buffer) {
    this.#index = index;
    this.#address = address;
    this.#bytes = bytes;
    Object.freeze(this);
  }

  static fromPrivateKeyBytes(input: {
    index: number;
    privateKeyBytes: Uint8Array;
    authorization: string;
  }): WalletStoreV2FixtureSecretRecord {
    assertFixtureAuthorization(input.authorization);
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= 15) {
      throw new Error("Wallet Store v2 fixture record index is invalid.");
    }
    const bytes = validatePrivateKeyBytes(input.privateKeyBytes);
    return new WalletStoreV2FixtureSecretRecord(input.index, deriveAddress(bytes), bytes);
  }

  get index(): number { return this.#index; }
  get address(): string { return this.#address; }

  async [consumeFixtureRecord]<T>(operation: (bytes: Buffer) => Promise<T>): Promise<T> {
    const bytes = this.#bytes;
    if (!bytes) throw new Error("Wallet Store v2 fixture record is already closed.");
    this.#bytes = null;
    try {
      return await operation(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  destroy(): void {
    this.#bytes?.fill(0);
    this.#bytes = null;
  }

  toJSON(): never {
    throw new Error("Wallet Store v2 secret records cannot be serialized.");
  }

  [inspect.custom](): string {
    return `[WalletStoreV2FixtureSecretRecord index=${this.#index} REDACTED]`;
  }

  [Symbol.toPrimitive](): never {
    throw new Error("Wallet Store v2 secret records cannot be converted to text.");
  }
}

export class WalletStoreV2DecryptedSession {
  #bytes: Buffer | null;
  #index: number;
  #address: string;

  constructor(index: number, address: string, bytes: Buffer) {
    this.#index = index;
    this.#address = address;
    this.#bytes = bytes;
    Object.freeze(this);
  }

  get index(): number { return this.#index; }
  get address(): string { return this.#address; }
  get closed(): boolean { return this.#bytes === null; }

  async withPrivateKeyBytes(operation: (privateKeyBytes: Uint8Array) => Promise<void> | void): Promise<void> {
    const bytes = this.#bytes;
    if (!bytes) throw new Error("Wallet Store v2 decrypted session is closed.");
    try {
      const result = await operation(bytes);
      if (result !== undefined) throw new Error("Secret callback must not return a value.");
    } catch {
      throw new Error("Wallet Store v2 secret callback failed without exposing its payload.");
    }
  }

  destroy(): void {
    this.#bytes?.fill(0);
    this.#bytes = null;
  }

  toJSON(): never {
    throw new Error("Wallet Store v2 decrypted sessions cannot be serialized.");
  }

  [inspect.custom](): string {
    return `[WalletStoreV2DecryptedSession index=${this.#index} ${this.closed ? "CLOSED" : "REDACTED"}]`;
  }

  [Symbol.toPrimitive](): never {
    throw new Error("Wallet Store v2 decrypted sessions cannot be converted to text.");
  }
}

const consumeProductionPassword = Symbol("consumeWalletStoreV2ProductionPassword");
const consumeProductionRecord = Symbol("consumeWalletStoreV2ProductionRecord");
const createProductionRecord = Symbol("createWalletStoreV2ProductionRecord");

export interface ProductionPasswordProvider {
  readonly providerClass: "production-tty" | "injected-test";
  withPassword<T>(operation: (secret: WalletStoreV2ProductionUnlockSecret) => Promise<T>): Promise<T>;
}

export interface WalletStoreV2TtyInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode(mode: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "end" | "close", listener: () => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}

export interface WalletStoreV2TtyOutput {
  readonly isTTY?: boolean;
  write(value: string): unknown;
}

export interface WalletStoreV2SignalSource {
  on(event: "SIGINT", listener: () => void): unknown;
  off(event: "SIGINT", listener: () => void): unknown;
}

export class WalletStoreV2ProductionUnlockSecret {
  #bytes: Buffer | null;

  private constructor(bytes: Buffer) {
    this.#bytes = bytes;
    Object.freeze(this);
  }

  static fromProviderBytes(bytes: Uint8Array): WalletStoreV2ProductionUnlockSecret {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < WALLET_STORE_V2_PASSWORD_MIN_BYTES ||
      bytes.byteLength > WALLET_STORE_V2_PASSWORD_MAX_BYTES
    ) {
      throw new Error("Production Wallet Store v2 unlock input is invalid.");
    }
    return new WalletStoreV2ProductionUnlockSecret(Buffer.from(bytes));
  }

  async [consumeProductionPassword]<T>(operation: (bytes: Buffer) => Promise<T>): Promise<T> {
    const bytes = this.#bytes;
    if (!bytes) throw new Error("Production Wallet Store v2 unlock secret is already closed.");
    this.#bytes = null;
    try {
      return await operation(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  destroy(): void {
    this.#bytes?.fill(0);
    this.#bytes = null;
  }

  toJSON(): never { throw new Error("Production Wallet Store v2 unlock secret cannot be serialized."); }
  [inspect.custom](): string { return "[WalletStoreV2ProductionUnlockSecret REDACTED]"; }
  [Symbol.toPrimitive](): never {
    throw new Error("Production Wallet Store v2 unlock secret cannot be converted to text.");
  }
}

async function readHiddenTtyBytes(input: {
  prompt: string;
  ttyInput: WalletStoreV2TtyInput;
  ttyOutput: WalletStoreV2TtyOutput;
  signalSource: WalletStoreV2SignalSource;
}): Promise<Buffer> {
  const { ttyInput, ttyOutput, signalSource } = input;
  const password = Buffer.alloc(WALLET_STORE_V2_PASSWORD_MAX_BYTES);
  let length = 0;
  let wasRaw = false;
  let rawModeChanged = false;
  if (!ttyInput.isTTY || !ttyOutput.isTTY || typeof ttyInput.setRawMode !== "function") {
    throw new Error("Production password input requires an interactive TTY.");
  }
  ttyOutput.write(input.prompt);
  wasRaw = Boolean(ttyInput.isRaw);
  ttyInput.setRawMode(true);
  rawModeChanged = true;
  ttyInput.resume();
  try {
    return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
      let settled = false;
      const removeListeners = (): void => {
        ttyInput.off("data", onData);
        ttyInput.off("end", onEnd);
        ttyInput.off("close", onClose);
        ttyInput.off("error", onError);
        signalSource.off("SIGINT", onSigint);
      };
      const rejectOnce = (message: string): void => {
        if (settled) return;
        settled = true;
        removeListeners();
        rejectPromise(new Error(message));
      };
      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        removeListeners();
        resolvePromise(Buffer.from(password.subarray(0, length)));
      };
      const onData = (chunk: Buffer | string): void => {
        const data = Buffer.from(chunk);
        try {
          for (const byte of data) {
            if (byte === 3) {
              rejectOnce("Production password input was cancelled.");
              return;
            }
            if (byte === 13 || byte === 10) {
              resolveOnce();
              return;
            }
            if (byte === 8 || byte === 127) {
              if (length > 0) {
                let start = length - 1;
                while (start > 0 && (password[start] & 0xc0) === 0x80) start -= 1;
                password.fill(0, start, length);
                length = start;
              }
            } else if (byte >= 32) {
              if (length >= WALLET_STORE_V2_PASSWORD_MAX_BYTES) {
                rejectOnce("Production password input exceeds the byte limit.");
                return;
              }
              password[length] = byte;
              length += 1;
            }
          }
        } finally {
          data.fill(0);
        }
      };
      const onEnd = (): void => rejectOnce("Production password input ended before completion.");
      const onClose = (): void => rejectOnce("Production password terminal closed before completion.");
      const onError = (): void => rejectOnce("Production password terminal failed.");
      const onSigint = (): void => rejectOnce("Production password input was cancelled.");
      ttyInput.on("data", onData);
      ttyInput.on("end", onEnd);
      ttyInput.on("close", onClose);
      ttyInput.on("error", onError);
      signalSource.on("SIGINT", onSigint);
    });
  } finally {
    password.fill(0);
    try {
      if (rawModeChanged) ttyInput.setRawMode(wasRaw);
    } finally {
      ttyInput.pause();
      ttyOutput.write("\n");
    }
  }
}

export function readHiddenWalletStoreV2PasswordForFixture(input: {
  ttyInput: WalletStoreV2TtyInput;
  ttyOutput: WalletStoreV2TtyOutput;
  signalSource: WalletStoreV2SignalSource;
  authorization: string;
}): Promise<Buffer> {
  assertFixtureAuthorization(input.authorization);
  return readHiddenTtyBytes({ ...input, prompt: "Wallet Store v2 fixture password: " });
}

async function readConfirmedTtyPassword(input: {
  ttyInput: WalletStoreV2TtyInput;
  ttyOutput: WalletStoreV2TtyOutput;
  signalSource: WalletStoreV2SignalSource;
}): Promise<Buffer> {
  let first: Buffer | null = null;
  let second: Buffer | null = null;
  try {
    first = await readHiddenTtyBytes({ ...input, prompt: "Wallet Store v2 password: " });
    second = await readHiddenTtyBytes({ ...input, prompt: "Repeat Wallet Store v2 password: " });
    if (
      first.length < WALLET_STORE_V2_PASSWORD_MIN_BYTES ||
      first.length > WALLET_STORE_V2_PASSWORD_MAX_BYTES ||
      first.length !== second.length ||
      !timingSafeEqual(first, second)
    ) throw new Error("Production Wallet Store v2 password confirmation failed.");
    return Buffer.from(first);
  } finally {
    first?.fill(0);
    second?.fill(0);
  }
}

export function readConfirmedWalletStoreV2PasswordForFixture(input: {
  ttyInput: WalletStoreV2TtyInput;
  ttyOutput: WalletStoreV2TtyOutput;
  signalSource: WalletStoreV2SignalSource;
  authorization: string;
}): Promise<Buffer> {
  assertFixtureAuthorization(input.authorization);
  return readConfirmedTtyPassword(input);
}

export class ProductionTtyPasswordProvider implements ProductionPasswordProvider {
  readonly providerClass = "production-tty" as const;

  private constructor() { Object.freeze(this); }

  static create(authorization: string): ProductionTtyPasswordProvider {
    if (authorization !== WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION) {
      throw new Error("Production Wallet Store v2 ceremony authorization is required.");
    }
    return new ProductionTtyPasswordProvider();
  }

  async withPassword<T>(operation: (secret: WalletStoreV2ProductionUnlockSecret) => Promise<T>): Promise<T> {
    let confirmed: Buffer | null = null;
    let secret: WalletStoreV2ProductionUnlockSecret | null = null;
    try {
      const tty = {
        ttyInput: process.stdin as WalletStoreV2TtyInput,
        ttyOutput: process.stdout as WalletStoreV2TtyOutput,
        signalSource: process as WalletStoreV2SignalSource,
      };
      confirmed = await readConfirmedTtyPassword(tty);
      secret = WalletStoreV2ProductionUnlockSecret.fromProviderBytes(confirmed);
      return await operation(secret);
    } finally {
      secret?.destroy();
      confirmed?.fill(0);
    }
  }
}

export class InjectedTestPasswordProvider implements ProductionPasswordProvider {
  readonly providerClass = "injected-test" as const;
  #bytes: Buffer;

  constructor(bytes: Uint8Array, authorization: string) {
    assertFixtureAuthorization(authorization);
    this.#bytes = Buffer.from(bytes);
  }

  async withPassword<T>(operation: (secret: WalletStoreV2ProductionUnlockSecret) => Promise<T>): Promise<T> {
    const bytes = Buffer.from(this.#bytes);
    const secret = WalletStoreV2ProductionUnlockSecret.fromProviderBytes(bytes);
    try {
      return await operation(secret);
    } finally {
      secret.destroy();
      bytes.fill(0);
    }
  }

  destroy(): void { this.#bytes.fill(0); }
}

export class WalletStoreV2ProductionSecretRecord {
  #bytes: Buffer | null;
  readonly index: number;
  readonly address: string;

  private constructor(index: number, bytes: Buffer) {
    this.index = index;
    this.address = deriveAddress(bytes);
    this.#bytes = bytes;
    Object.freeze(this);
  }

  static [createProductionRecord](index: number, bytes: Buffer): WalletStoreV2ProductionSecretRecord {
    return new WalletStoreV2ProductionSecretRecord(index, bytes);
  }

  async [consumeProductionRecord]<T>(operation: (bytes: Buffer) => Promise<T>): Promise<T> {
    const bytes = this.#bytes;
    if (!bytes) throw new Error("Production Wallet Store v2 record is already closed.");
    this.#bytes = null;
    try {
      return await operation(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  destroy(): void { this.#bytes?.fill(0); this.#bytes = null; }
  toJSON(): never { throw new Error("Production Wallet Store v2 record cannot be serialized."); }
  [inspect.custom](): string { return `[WalletStoreV2ProductionSecretRecord index=${this.index} REDACTED]`; }
  [Symbol.toPrimitive](): never {
    throw new Error("Production Wallet Store v2 record cannot be converted to text.");
  }
}

export class NodeCSPRNGProductionWalletGenerator {
  readonly generatorClass: "node-csprng-production" | "injected-test-entropy";
  readonly #nextBytes: (length: number) => Buffer;
  readonly #deriveCandidateAddress: (bytes: Buffer) => string;

  private constructor(
    generatorClass: "node-csprng-production" | "injected-test-entropy",
    nextBytes: (length: number) => Buffer,
    deriveCandidateAddress: (bytes: Buffer) => string,
  ) {
    this.generatorClass = generatorClass;
    this.#nextBytes = nextBytes;
    this.#deriveCandidateAddress = deriveCandidateAddress;
    Object.freeze(this);
  }

  static create(authorization: string): NodeCSPRNGProductionWalletGenerator {
    if (authorization !== WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION) {
      throw new Error("Production wallet generation requires ceremony authorization.");
    }
    return new NodeCSPRNGProductionWalletGenerator(
      "node-csprng-production",
      () => randomBytes(32),
      deriveAddress,
    );
  }

  static createForInjectedTests(input: {
    nextBytes(length: number): Buffer;
    deriveAddressForTest?(bytes: Buffer): string;
    authorization: string;
  }): NodeCSPRNGProductionWalletGenerator {
    assertFixtureAuthorization(input.authorization);
    return new NodeCSPRNGProductionWalletGenerator(
      "injected-test-entropy",
      input.nextBytes,
      input.deriveAddressForTest ?? deriveAddress,
    );
  }

  generateIndependentSet(): WalletStoreV2ProductionSecretRecord[] {
    const records: WalletStoreV2ProductionSecretRecord[] = [];
    const addresses = new Set<string>();
    try {
      for (let index = 0; index < 15; index += 1) {
        let accepted = false;
        while (!accepted) {
          let candidate: Buffer | null = null;
          try {
            candidate = this.#nextBytes(KEY_LENGTH);
            if (!Buffer.isBuffer(candidate) || candidate.length !== KEY_LENGTH) {
              throw new Error("Production entropy source returned an invalid candidate.");
            }
            let address: string;
            try {
              address = this.#deriveCandidateAddress(candidate);
            } catch {
              continue;
            }
            if (addresses.has(address.toLowerCase())) continue;
            const record = WalletStoreV2ProductionSecretRecord[createProductionRecord](index, candidate);
            candidate = null;
            records.push(record);
            addresses.add(address.toLowerCase());
            accepted = true;
          } finally {
            candidate?.fill(0);
          }
        }
      }
      return records;
    } catch {
      for (const record of records) record.destroy();
      throw new Error("Production wallet generation failed without exposing secret material.");
    }
  }
}

function bindingBase(input: {
  artifactClass: WalletStoreV2ArtifactClass;
  createdAt: string;
  storeId: string;
  candidates: readonly WalletStoreV2Candidate[];
}): Record<string, unknown> {
  return {
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
    artifactClass: input.artifactClass,
    createdAt: input.createdAt,
    storeId: input.storeId,
    chainId: GUARDED_CHECKPOINT_20_CHAIN_ID.toString(),
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    checkpointId: CHECKPOINT_ID,
    baselineCount: GUARDED_CHECKPOINT_20_BASELINE.toString(),
    targetCount: GUARDED_CHECKPOINT_20_TARGET.toString(),
    recordCount: GUARDED_CHECKPOINT_20_CANDIDATE_COUNT,
    candidates: input.candidates,
  };
}

export function calculateWalletStoreV2BindingFingerprint(input: {
  artifactClass: WalletStoreV2ArtifactClass;
  createdAt: string;
  storeId: string;
  candidates: readonly WalletStoreV2Candidate[];
}): string {
  if (input.artifactClass !== "fixture" && input.artifactClass !== "production") {
    throw new Error("Wallet Store v2 artifact class is invalid.");
  }
  const createdAt = iso(input.createdAt, "Wallet Store v2 binding creation time");
  if (!isUuid(input.storeId)) throw new Error("Wallet Store v2 binding store ID is invalid.");
  return digest(bindingBase({
    artifactClass: input.artifactClass,
    createdAt,
    storeId: input.storeId,
    candidates: normalizeCandidates(input.candidates),
  }));
}

function aad(input: {
  bindingFingerprint: string;
  index: number;
  address: string;
}): Buffer {
  return Buffer.from(canonicalJson({
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
    bindingFingerprint: input.bindingFingerprint,
    index: input.index,
    address: input.address.toLowerCase(),
  }), "utf8");
}

function deriveKey(unlockBytes: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    scrypt(
      unlockBytes,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 },
      (error, key) => error ? rejectPromise(error) : resolvePromise(key as Buffer),
    );
  });
}

function recordWithoutFingerprint(record: WalletStoreV2EncryptedRecord): Omit<WalletStoreV2EncryptedRecord, "recordFingerprint"> {
  return {
    index: record.index,
    address: record.address,
    iv: record.iv,
    authenticationTag: record.authenticationTag,
    ciphertext: record.ciphertext,
  };
}

function envelopeFingerprintBase(envelope: Omit<WalletStoreV2Envelope, "encryptedStoreFingerprint" | "manifestFingerprint">): unknown {
  return envelope;
}

function manifestWithoutFingerprint(manifest: WalletStoreV2PublicManifest): Omit<WalletStoreV2PublicManifest, "fingerprint"> {
  return {
    formatVersion: manifest.formatVersion,
    purpose: manifest.purpose,
    artifactClass: manifest.artifactClass,
    createdAt: manifest.createdAt,
    chainId: manifest.chainId,
    contractAddress: manifest.contractAddress,
    tokenAddress: manifest.tokenAddress,
    checkpoint: manifest.checkpoint,
    store: manifest.store,
    candidates: manifest.candidates,
  };
}

function encryptRecord(input: {
  key: Buffer;
  bindingFingerprint: string;
  index: number;
  address: string;
  privateKeyBytes: Buffer;
  iv: Buffer;
}): WalletStoreV2EncryptedRecord {
  const cipher = createCipheriv(CIPHER, input.key, input.iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(aad(input));
  const ciphertext = Buffer.concat([cipher.update(input.privateKeyBytes), cipher.final()]);
  try {
    const withoutFingerprint = {
      index: input.index,
      address: input.address,
      iv: input.iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    return { ...withoutFingerprint, recordFingerprint: digest(withoutFingerprint) };
  } finally {
    ciphertext.fill(0);
  }
}

export async function buildWalletStoreV2FixtureBundle(input: {
  candidates: readonly WalletStoreV2Candidate[];
  unlockSecret: WalletStoreV2FixtureUnlockSecret;
  provideRecord(index: number): Promise<WalletStoreV2FixtureSecretRecord>;
  createdAt: string;
  storeId?: string;
  authorization: string;
}): Promise<WalletStoreV2FixtureBundle> {
  assertFixtureAuthorization(input.authorization);
  const candidates = normalizeCandidates(input.candidates);
  const createdAt = iso(input.createdAt, "Wallet Store v2 creation time");
  const storeId = input.storeId ?? randomUUID();
  if (!isUuid(storeId)) throw new Error("Wallet Store v2 store ID is invalid.");
  const bindingFingerprint = digest(bindingBase({ artifactClass: "fixture", createdAt, storeId, candidates }));
  const salt = randomBytes(SALT_LENGTH);
  const saltBase64 = salt.toString("base64");
  let key: Buffer | null = null;
  const records: WalletStoreV2EncryptedRecord[] = [];
  const usedIvs = new Set<string>();
  try {
    key = await input.unlockSecret[consumeUnlockSecret]((unlockBytes) => deriveKey(unlockBytes, salt));
    for (let index = 0; index < candidates.length; index += 1) {
      const secretRecord = await input.provideRecord(index);
      try {
        if (secretRecord.index !== index || secretRecord.address !== candidates[index].address) {
          throw new Error("Wallet Store v2 fixture secret does not match the public manifest candidate.");
        }
        let iv = randomBytes(IV_LENGTH);
        while (usedIvs.has(iv.toString("base64"))) iv = randomBytes(IV_LENGTH);
        usedIvs.add(iv.toString("base64"));
        const record = await secretRecord[consumeFixtureRecord](async (privateKeyBytes) =>
          encryptRecord({
            key: key!,
            bindingFingerprint,
            index,
            address: candidates[index].address,
            privateKeyBytes,
            iv,
          }));
        records.push(record);
      } finally {
        secretRecord.destroy();
      }
    }
  } catch {
    throw new Error("Wallet Store v2 fixture creation failed without exposing secret material.");
  } finally {
    key?.fill(0);
    salt.fill(0);
    input.unlockSecret.destroy();
  }

  const recordsFingerprint = digest(records.map((record) => record.recordFingerprint));
  const envelopeBase: Omit<WalletStoreV2Envelope, "encryptedStoreFingerprint" | "manifestFingerprint"> = {
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
    artifactClass: "fixture",
    createdAt,
    storeId,
    chainId: "84532",
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    checkpointId: CHECKPOINT_ID,
    baselineCount: "5",
    targetCount: "20",
    recordCount: 15,
    cipher: CIPHER,
    kdf: KDF,
    kdfParameters: { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: saltBase64 },
    bindingFingerprint,
    recordsFingerprint,
    records,
  };
  const encryptedStoreFingerprint = digest(envelopeFingerprintBase(envelopeBase));
  const manifestBase: Omit<WalletStoreV2PublicManifest, "fingerprint"> = {
    formatVersion: FORMAT_VERSION,
    purpose: MANIFEST_PURPOSE,
    artifactClass: "fixture",
    createdAt,
    chainId: "84532",
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    checkpoint: {
      id: CHECKPOINT_ID,
      baselineCount: "5",
      targetCount: "20",
      recordCount: 15,
    },
    store: {
      formatVersion: FORMAT_VERSION,
      storeId,
      bindingFingerprint,
      encryptedStoreFingerprint,
    },
    candidates,
  };
  const manifest: WalletStoreV2PublicManifest = {
    ...manifestBase,
    fingerprint: digest(manifestBase),
  };
  const envelope: WalletStoreV2Envelope = {
    ...envelopeBase,
    encryptedStoreFingerprint,
    manifestFingerprint: manifest.fingerprint,
  };
  return validateWalletStoreV2FixtureBundle({ artifactClass: "fixture", manifest, envelope });
}

async function buildWalletStoreV2ProductionClassBundle(input: {
  passwordProvider: ProductionPasswordProvider;
  walletGenerator: NodeCSPRNGProductionWalletGenerator;
  createdAt: string;
  storeId?: string;
  afterGenerationForTest?: () => void;
}): Promise<WalletStoreV2ProductionBundle> {
  const createdAt = iso(input.createdAt, "Production Wallet Store v2 creation time");
  const storeId = input.storeId ?? randomUUID();
  if (!isUuid(storeId)) throw new Error("Production Wallet Store v2 store ID is invalid.");
  try {
    return await input.passwordProvider.withPassword(async (unlockSecret) =>
      unlockSecret[consumeProductionPassword](async (unlockBytes) => {
        const secretRecords: WalletStoreV2ProductionSecretRecord[] = [];
        let salt: Buffer | null = null;
        let key: Buffer | null = null;
        try {
          secretRecords.push(...input.walletGenerator.generateIndependentSet());
          input.afterGenerationForTest?.();
          const candidates = normalizeCandidates(secretRecords.map((record) => ({
            index: record.index,
            address: record.address,
          })));
          const bindingFingerprint = digest(bindingBase({
            artifactClass: "production",
            createdAt,
            storeId,
            candidates,
          }));
          salt = randomBytes(SALT_LENGTH);
          const saltBase64 = salt.toString("base64");
          key = await deriveKey(unlockBytes, salt);
          const records: WalletStoreV2EncryptedRecord[] = [];
          const usedIvs = new Set<string>();
          for (const secretRecord of secretRecords) {
            let iv = randomBytes(IV_LENGTH);
            while (usedIvs.has(iv.toString("base64"))) iv = randomBytes(IV_LENGTH);
            usedIvs.add(iv.toString("base64"));
            try {
              records.push(await secretRecord[consumeProductionRecord](async (privateKeyBytes) =>
                encryptRecord({
                  key: key!,
                  bindingFingerprint,
                  index: secretRecord.index,
                  address: secretRecord.address,
                  privateKeyBytes,
                  iv,
                })));
            } finally {
              iv.fill(0);
              secretRecord.destroy();
            }
          }
          const recordsFingerprint = digest(records.map((record) => record.recordFingerprint));
          const envelopeBase: Omit<WalletStoreV2Envelope, "encryptedStoreFingerprint" | "manifestFingerprint"> = {
            formatVersion: FORMAT_VERSION,
            purpose: PURPOSE,
            artifactClass: "production",
            createdAt,
            storeId,
            chainId: "84532",
            contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
            tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
            checkpointId: CHECKPOINT_ID,
            baselineCount: "5",
            targetCount: "20",
            recordCount: 15,
            cipher: CIPHER,
            kdf: KDF,
            kdfParameters: { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: saltBase64 },
            bindingFingerprint,
            recordsFingerprint,
            records,
          };
          const encryptedStoreFingerprint = digest(envelopeFingerprintBase(envelopeBase));
          const manifestBase: Omit<WalletStoreV2PublicManifest, "fingerprint"> = {
            formatVersion: FORMAT_VERSION,
            purpose: MANIFEST_PURPOSE,
            artifactClass: "production",
            createdAt,
            chainId: "84532",
            contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
            tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
            checkpoint: { id: CHECKPOINT_ID, baselineCount: "5", targetCount: "20", recordCount: 15 },
            store: { formatVersion: FORMAT_VERSION, storeId, bindingFingerprint, encryptedStoreFingerprint },
            candidates,
          };
          const manifest = { ...manifestBase, fingerprint: digest(manifestBase) };
          const envelope = { ...envelopeBase, encryptedStoreFingerprint, manifestFingerprint: manifest.fingerprint };
          return validateWalletStoreV2ProductionBundle({ artifactClass: "production", manifest, envelope });
        } finally {
          key?.fill(0);
          salt?.fill(0);
          for (const record of secretRecords) record.destroy();
        }
      }));
  } catch {
    throw new Error("Production Wallet Store v2 creation failed without exposing secret material.");
  }
}

export async function buildWalletStoreV2ProductionBundle(input: {
  passwordProvider: ProductionTtyPasswordProvider;
  walletGenerator: NodeCSPRNGProductionWalletGenerator;
  createdAt: string;
  storeId?: string;
  authorization: string;
}): Promise<WalletStoreV2ProductionBundle> {
  if (input.authorization !== WALLET_STORE_V2_PRODUCTION_CEREMONY_AUTHORIZATION) {
    throw new Error("Production Wallet Store v2 ceremony authorization is required.");
  }
  if (!(input.passwordProvider instanceof ProductionTtyPasswordProvider)) {
    throw new Error("Production Wallet Store v2 rejects injected or fixture password providers.");
  }
  if (
    !(input.walletGenerator instanceof NodeCSPRNGProductionWalletGenerator) ||
    input.walletGenerator.generatorClass !== "node-csprng-production"
  ) {
    throw new Error("Production Wallet Store v2 rejects fixture or injected wallet generators.");
  }
  return buildWalletStoreV2ProductionClassBundle(input);
}

export async function buildWalletStoreV2ProductionFormatFixtureBundle(input: {
  passwordProvider: InjectedTestPasswordProvider;
  walletGenerator: NodeCSPRNGProductionWalletGenerator;
  createdAt: string;
  storeId?: string;
  authorization: string;
  afterGenerationForTest?: () => void;
}): Promise<WalletStoreV2ProductionBundle> {
  assertFixtureAuthorization(input.authorization);
  if (
    !(input.passwordProvider instanceof InjectedTestPasswordProvider) ||
    !(input.walletGenerator instanceof NodeCSPRNGProductionWalletGenerator) ||
    input.walletGenerator.generatorClass !== "injected-test-entropy"
  ) {
    throw new Error("Production-format fixture construction requires injected test-only dependencies.");
  }
  return buildWalletStoreV2ProductionClassBundle(input);
}

export function validateWalletStoreV2PublicManifest(value: unknown): WalletStoreV2PublicManifest {
  const manifest = exactObject(value, [
    "formatVersion", "purpose", "artifactClass", "createdAt", "chainId", "contractAddress", "tokenAddress",
    "checkpoint", "store", "candidates", "fingerprint",
  ], "Wallet Store v2 public manifest");
  if (manifest.formatVersion !== FORMAT_VERSION || manifest.purpose !== MANIFEST_PURPOSE) {
    throw new Error("Wallet Store v2 public manifest version or purpose is invalid.");
  }
  if (manifest.artifactClass !== "fixture" && manifest.artifactClass !== "production") {
    throw new Error("Wallet Store v2 public manifest artifact class is invalid.");
  }
  const createdAt = iso(manifest.createdAt, "Wallet Store v2 manifest creation time");
  if (manifest.chainId !== "84532") throw new Error("Wallet Store v2 manifest chain ID mismatch.");
  if (
    !isEvmAddress(manifest.contractAddress) ||
    getAddress(manifest.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT)
  ) throw new Error("Wallet Store v2 manifest contract mismatch.");
  if (
    !isEvmAddress(manifest.tokenAddress) ||
    getAddress(manifest.tokenAddress) !== getAddress(GUARDED_CHECKPOINT_20_TOKEN)
  ) throw new Error("Wallet Store v2 manifest token mismatch.");
  const checkpoint = exactObject(
    manifest.checkpoint,
    ["id", "baselineCount", "targetCount", "recordCount"],
    "Wallet Store v2 manifest checkpoint",
  );
  if (
    checkpoint.id !== CHECKPOINT_ID || checkpoint.baselineCount !== "5" ||
    checkpoint.targetCount !== "20" || checkpoint.recordCount !== 15
  ) throw new Error("Wallet Store v2 manifest checkpoint mismatch.");
  const store = exactObject(
    manifest.store,
    ["formatVersion", "storeId", "bindingFingerprint", "encryptedStoreFingerprint"],
    "Wallet Store v2 manifest store binding",
  );
  if (store.formatVersion !== FORMAT_VERSION || !isUuid(store.storeId)) {
    throw new Error("Wallet Store v2 manifest store identity mismatch.");
  }
  const bindingFingerprint = requireDigest(store.bindingFingerprint, "Wallet Store v2 binding fingerprint");
  const encryptedStoreFingerprint = requireDigest(
    store.encryptedStoreFingerprint,
    "Wallet Store v2 encrypted store fingerprint",
  );
  if (!Array.isArray(manifest.candidates)) throw new Error("Wallet Store v2 manifest candidates are invalid.");
  const candidates = normalizeCandidates(manifest.candidates as WalletStoreV2Candidate[]);
  const expectedBinding = digest(bindingBase({
    artifactClass: manifest.artifactClass,
    createdAt,
    storeId: store.storeId,
    candidates,
  }));
  if (bindingFingerprint !== expectedBinding) throw new Error("Wallet Store v2 manifest binding fingerprint mismatch.");
  const normalized: WalletStoreV2PublicManifest = {
    formatVersion: FORMAT_VERSION,
    purpose: MANIFEST_PURPOSE,
    artifactClass: manifest.artifactClass,
    createdAt,
    chainId: "84532",
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    checkpoint: { id: CHECKPOINT_ID, baselineCount: "5", targetCount: "20", recordCount: 15 },
    store: {
      formatVersion: FORMAT_VERSION,
      storeId: store.storeId,
      bindingFingerprint,
      encryptedStoreFingerprint,
    },
    candidates,
    fingerprint: typeof manifest.fingerprint === "string" ? manifest.fingerprint : "",
  };
  requireDigest(normalized.fingerprint, "Wallet Store v2 manifest fingerprint");
  if (digest(manifestWithoutFingerprint(normalized)) !== normalized.fingerprint) {
    throw new Error("Wallet Store v2 manifest fingerprint mismatch.");
  }
  return normalized;
}

function validateEncryptedRecord(value: unknown, index: number, address: string): WalletStoreV2EncryptedRecord {
  const record = exactObject(
    value,
    ["index", "address", "iv", "authenticationTag", "ciphertext", "recordFingerprint"],
    `Wallet Store v2 encrypted record ${index}`,
  );
  if (record.index !== index || typeof record.address !== "string" || getAddress(record.address) !== address) {
    throw new Error("Wallet Store v2 encrypted record identity mismatch.");
  }
  const iv = base64(record.iv, IV_LENGTH, "Wallet Store v2 record IV");
  const tag = base64(record.authenticationTag, AUTH_TAG_LENGTH, "Wallet Store v2 record authentication tag");
  const ciphertext = base64(record.ciphertext, KEY_LENGTH, "Wallet Store v2 record ciphertext");
  iv.fill(0);
  tag.fill(0);
  ciphertext.fill(0);
  const normalized: WalletStoreV2EncryptedRecord = {
    index,
    address,
    iv: record.iv as string,
    authenticationTag: record.authenticationTag as string,
    ciphertext: record.ciphertext as string,
    recordFingerprint: requireDigest(record.recordFingerprint, "Wallet Store v2 record fingerprint"),
  };
  if (digest(recordWithoutFingerprint(normalized)) !== normalized.recordFingerprint) {
    throw new Error("Wallet Store v2 encrypted record fingerprint mismatch.");
  }
  return normalized;
}

export function validateWalletStoreV2Envelope(input: {
  value: unknown;
  manifest: WalletStoreV2PublicManifest;
}): WalletStoreV2Envelope {
  const manifest = validateWalletStoreV2PublicManifest(input.manifest);
  const envelope = exactObject(input.value, [
    "formatVersion", "purpose", "artifactClass", "createdAt", "storeId", "chainId",
    "contractAddress", "tokenAddress", "checkpointId", "baselineCount", "targetCount",
    "recordCount", "cipher", "kdf", "kdfParameters", "bindingFingerprint",
    "recordsFingerprint", "encryptedStoreFingerprint", "manifestFingerprint", "records",
  ], "Wallet Store v2 envelope");
  if (
    envelope.formatVersion !== FORMAT_VERSION || envelope.purpose !== PURPOSE ||
    envelope.artifactClass !== manifest.artifactClass || envelope.chainId !== "84532" ||
    envelope.checkpointId !== CHECKPOINT_ID || envelope.baselineCount !== "5" ||
    envelope.targetCount !== "20" || envelope.recordCount !== 15 ||
    envelope.cipher !== CIPHER || envelope.kdf !== KDF
  ) throw new Error("Wallet Store v2 envelope identity or cryptographic profile mismatch.");
  const createdAt = iso(envelope.createdAt, "Wallet Store v2 envelope creation time");
  if (createdAt !== manifest.createdAt || envelope.storeId !== manifest.store.storeId) {
    throw new Error("Wallet Store v2 envelope and manifest identity mismatch.");
  }
  if (
    !isUuid(envelope.storeId) ||
    !isEvmAddress(envelope.contractAddress) ||
    getAddress(envelope.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT) ||
    !isEvmAddress(envelope.tokenAddress) ||
    getAddress(envelope.tokenAddress) !== getAddress(GUARDED_CHECKPOINT_20_TOKEN)
  ) throw new Error("Wallet Store v2 envelope deployment identity mismatch.");
  const kdfParameters = exactObject(
    envelope.kdfParameters,
    ["n", "r", "p", "salt"],
    "Wallet Store v2 KDF parameters",
  );
  if (kdfParameters.n !== SCRYPT_N || kdfParameters.r !== SCRYPT_R || kdfParameters.p !== SCRYPT_P) {
    throw new Error("Wallet Store v2 KDF parameters mismatch.");
  }
  const salt = base64(kdfParameters.salt, SALT_LENGTH, "Wallet Store v2 KDF salt");
  salt.fill(0);
  const bindingFingerprint = requireDigest(envelope.bindingFingerprint, "Wallet Store v2 binding fingerprint");
  const recordsFingerprint = requireDigest(envelope.recordsFingerprint, "Wallet Store v2 records fingerprint");
  const encryptedStoreFingerprint = requireDigest(
    envelope.encryptedStoreFingerprint,
    "Wallet Store v2 encrypted store fingerprint",
  );
  const manifestFingerprint = requireDigest(envelope.manifestFingerprint, "Wallet Store v2 manifest fingerprint");
  if (
    bindingFingerprint !== manifest.store.bindingFingerprint ||
    encryptedStoreFingerprint !== manifest.store.encryptedStoreFingerprint ||
    manifestFingerprint !== manifest.fingerprint
  ) throw new Error("Wallet Store v2 envelope-to-manifest binding mismatch.");
  if (!Array.isArray(envelope.records) || envelope.records.length !== 15) {
    throw new Error("Wallet Store v2 envelope must contain exactly 15 encrypted records.");
  }
  const records = envelope.records.map((record, index) =>
    validateEncryptedRecord(record, index, manifest.candidates[index].address));
  if (new Set(records.map((record) => record.iv)).size !== records.length) {
    throw new Error("Wallet Store v2 encrypted record IVs must be unique.");
  }
  if (digest(records.map((record) => record.recordFingerprint)) !== recordsFingerprint) {
    throw new Error("Wallet Store v2 records fingerprint mismatch.");
  }
  const normalizedBase: Omit<WalletStoreV2Envelope, "encryptedStoreFingerprint" | "manifestFingerprint"> = {
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
    artifactClass: manifest.artifactClass,
    createdAt,
    storeId: envelope.storeId,
    chainId: "84532",
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    checkpointId: CHECKPOINT_ID,
    baselineCount: "5",
    targetCount: "20",
    recordCount: 15,
    cipher: CIPHER,
    kdf: KDF,
    kdfParameters: {
      n: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      salt: kdfParameters.salt as string,
    },
    bindingFingerprint,
    recordsFingerprint,
    records,
  };
  if (digest(envelopeFingerprintBase(normalizedBase)) !== encryptedStoreFingerprint) {
    throw new Error("Wallet Store v2 encrypted store fingerprint mismatch.");
  }
  return { ...normalizedBase, encryptedStoreFingerprint, manifestFingerprint };
}

export function validateWalletStoreV2FixtureBundle(value: WalletStoreV2FixtureBundle): WalletStoreV2FixtureBundle {
  if (!value || value.artifactClass !== "fixture") throw new Error("Wallet Store v2 fixture bundle marker is missing.");
  const manifest = validateWalletStoreV2PublicManifest(value.manifest);
  if (manifest.artifactClass !== "fixture") throw new Error("Production store is rejected by the fixture-only API.");
  const envelope = validateWalletStoreV2Envelope({ value: value.envelope, manifest });
  return { artifactClass: "fixture", manifest, envelope };
}

export function validateWalletStoreV2ProductionBundle(
  value: WalletStoreV2ProductionBundle,
): WalletStoreV2ProductionBundle {
  if (!value || value.artifactClass !== "production") {
    throw new Error("Fixture store is rejected by the production API.");
  }
  const manifest = validateWalletStoreV2PublicManifest(value.manifest);
  if (manifest.artifactClass !== "production") {
    throw new Error("Fixture store is rejected by the production API.");
  }
  const envelope = validateWalletStoreV2Envelope({ value: value.envelope, manifest });
  return { artifactClass: "production", manifest, envelope };
}

function inspectWalletStoreV2Bundle(value: WalletStoreV2Bundle): WalletStoreV2PublicInspection {
  const bundle = value.artifactClass === "fixture"
    ? validateWalletStoreV2FixtureBundle(value)
    : validateWalletStoreV2ProductionBundle(value);
  return assertWalletStoreV2PublicOutput({
    kind: "wallet-store-v2-inspection",
    readOnly: true,
    artifactClass: bundle.artifactClass,
    formatVersion: FORMAT_VERSION,
    storeId: bundle.envelope.storeId,
    chainId: "84532",
    contractAddress: bundle.envelope.contractAddress,
    tokenAddress: bundle.envelope.tokenAddress,
    checkpointId: CHECKPOINT_ID,
    baselineCount: "5",
    targetCount: "20",
    recordCount: 15,
    addresses: bundle.manifest.candidates.map((candidate) => candidate.address),
    bindingFingerprint: bundle.envelope.bindingFingerprint,
    encryptedStoreFingerprint: bundle.envelope.encryptedStoreFingerprint,
    manifestFingerprint: bundle.manifest.fingerprint,
    cipher: CIPHER,
    kdf: KDF,
  }) as WalletStoreV2PublicInspection;
}

export function inspectWalletStoreV2FixtureBundle(value: WalletStoreV2FixtureBundle): WalletStoreV2PublicInspection {
  return inspectWalletStoreV2Bundle(validateWalletStoreV2FixtureBundle(value));
}

export function inspectWalletStoreV2ProductionBundle(
  value: WalletStoreV2ProductionBundle,
): WalletStoreV2PublicInspection {
  return inspectWalletStoreV2Bundle(validateWalletStoreV2ProductionBundle(value));
}

export function assertWalletStoreV2PublicOutput(value: unknown): WalletStoreV2PublicOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet Store v2 public output must use an allowlisted shape.");
  }
  const kind = (value as { kind?: unknown }).kind;
  const keysByKind: Record<string, readonly string[]> = {
    "wallet-store-v2-inspection": [
      "kind", "readOnly", "artifactClass", "formatVersion", "storeId", "chainId",
      "contractAddress", "tokenAddress", "checkpointId", "baselineCount", "targetCount",
      "recordCount", "addresses", "bindingFingerprint", "encryptedStoreFingerprint",
      "manifestFingerprint", "cipher", "kdf",
    ],
    "wallet-store-v2-session-receipt": [
      "kind", "artifactClass", "storeId", "index", "address", "manifestFingerprint",
      "addressVerified", "sessionClosed",
    ],
    "wallet-store-v2-backup-receipt": [
      "kind", "artifactClass", "storeId", "bindingFingerprint", "encryptedStoreFingerprint",
      "manifestFingerprint", "backupVerified",
    ],
  };
  if (typeof kind !== "string" || !(kind in keysByKind)) {
    throw new Error("Wallet Store v2 public output kind is not allowlisted.");
  }
  const output = exactObject(value, keysByKind[kind], "Wallet Store v2 public output");
  if (
    (output.artifactClass !== "fixture" && output.artifactClass !== "production") ||
    !isUuid(output.storeId)
  ) {
    throw new Error("Wallet Store v2 public output identity is invalid.");
  }
  requireDigest(output.manifestFingerprint, "Wallet Store v2 public manifest fingerprint");
  if (kind === "wallet-store-v2-inspection") {
    if (
      output.readOnly !== true || output.formatVersion !== 2 || output.chainId !== "84532" ||
      output.checkpointId !== CHECKPOINT_ID || output.baselineCount !== "5" ||
      output.targetCount !== "20" || output.recordCount !== 15 ||
      output.cipher !== CIPHER || output.kdf !== KDF ||
      !isEvmAddress(output.contractAddress) ||
      getAddress(output.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT) ||
      !isEvmAddress(output.tokenAddress) ||
      getAddress(output.tokenAddress) !== getAddress(GUARDED_CHECKPOINT_20_TOKEN) ||
      !Array.isArray(output.addresses)
    ) throw new Error("Wallet Store v2 public inspection output is invalid.");
    normalizeCandidates((output.addresses as unknown[]).map((address, index) => ({
      index,
      address: typeof address === "string" ? address : "",
    })));
    requireDigest(output.bindingFingerprint, "Wallet Store v2 public binding fingerprint");
    requireDigest(output.encryptedStoreFingerprint, "Wallet Store v2 public store fingerprint");
  } else if (kind === "wallet-store-v2-session-receipt") {
    if (
      !Number.isSafeInteger(output.index) || (output.index as number) < 0 || (output.index as number) >= 15 ||
      !isEvmAddress(output.address) ||
      output.addressVerified !== true || output.sessionClosed !== true
    ) throw new Error("Wallet Store v2 public session receipt is invalid.");
  } else if (
    output.backupVerified !== true ||
    !DIGEST.test(String(output.bindingFingerprint)) ||
    !DIGEST.test(String(output.encryptedStoreFingerprint))
  ) {
    throw new Error("Wallet Store v2 public backup receipt is invalid.");
  }
  const serialized = JSON.stringify(value);
  if (/private|secret|mnemonic|seed|password|passphrase|ciphertext|authenticationTag|\bkdfParameters\b/i.test(serialized)) {
    throw new Error("Wallet Store v2 public output contains a forbidden field.");
  }
  return structuredClone(output) as unknown as WalletStoreV2PublicOutput;
}

export function walletStoreV2BundlePaths(directoryInput: string): WalletStoreV2BundlePaths {
  const directory = resolve(directoryInput);
  if (!basename(directory).toLowerCase().endsWith(WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX)) {
    throw new Error(`Wallet Store v2 bundle directory must end with ${WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX}.`);
  }
  return {
    directory,
    storeFile: join(directory, WALLET_STORE_V2_STORE_FILE_NAME),
    manifestFile: join(directory, WALLET_STORE_V2_MANIFEST_FILE_NAME),
    backupMetadataFile: join(directory, WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME),
    ceremonyMetadataFile: join(directory, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME),
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

async function readBoundedUtf8(path: string, maximumBytes: number, label: string): Promise<string> {
  const handle = await open(path, "r");
  const buffer = Buffer.alloc(maximumBytes + 1);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maximumBytes) throw new Error(`${label} exceeds its size limit.`);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) throw new Error(`${label} exceeds its size limit.`);
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    buffer.fill(0);
    await handle.close();
  }
}

async function assertBundlePaths(paths: WalletStoreV2BundlePaths): Promise<void> {
  await assertSafeExternalFilePath(paths.storeFile, ".wallet-store-v2.enc.json");
  await assertSafeExternalFilePath(paths.manifestFile, ".wallet-store-v2.manifest.json");
  await assertSafeExternalFilePath(paths.backupMetadataFile, ".wallet-store-v2.backup.json");
  await assertSafeExternalFilePath(paths.ceremonyMetadataFile, ".wallet-store-v2.ceremony.json");
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeSerializedBundleDirectory(input: {
  directory: string;
  artifactClass: WalletStoreV2ArtifactClass;
  storeSerialized: string;
  manifestSerialized: string;
  backupMetadataSerialized?: string;
  ceremonyMetadataSerialized?: string;
  hooks?: WalletStoreV2WriteHooks;
  productionSecurity?: WalletStoreV2ProductionFileSecurity;
}): Promise<void> {
  const finalPaths = walletStoreV2BundlePaths(input.directory);
  await assertBundlePaths(finalPaths);
  if (input.artifactClass === "production") {
    if (!input.productionSecurity) throw new Error("Production Wallet Store v2 requires file security.");
    await input.productionSecurity.assertBeforeCreate(finalPaths.directory);
  } else if (input.productionSecurity) {
    throw new Error("Fixture Wallet Store v2 cannot use production file security.");
  }
  if (await pathExists(finalPaths.directory)) {
    throw new Error("Wallet Store v2 bundle directory already exists; overwrite is forbidden.");
  }
  await mkdir(dirname(finalPaths.directory), { recursive: true, mode: 0o700 });
  const temporaryDirectory = join(
    dirname(finalPaths.directory),
    `.${basename(finalPaths.directory)}.${randomUUID()}.tmp`,
  );
  let committed = false;
  let renamed = false;
  try {
    await mkdir(temporaryDirectory, { recursive: false, mode: 0o700 });
    const temporaryPaths = {
      directory: temporaryDirectory,
      storeFile: join(temporaryDirectory, WALLET_STORE_V2_STORE_FILE_NAME),
      manifestFile: join(temporaryDirectory, WALLET_STORE_V2_MANIFEST_FILE_NAME),
      backupMetadataFile: join(temporaryDirectory, WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME),
      ceremonyMetadataFile: join(temporaryDirectory, WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME),
    };
    await atomicWritePrivateFile(temporaryPaths.storeFile, input.storeSerialized);
    await input.hooks?.afterStoreWrite?.();
    await atomicWritePrivateFile(temporaryPaths.manifestFile, input.manifestSerialized);
    if (input.backupMetadataSerialized !== undefined) {
      await atomicWritePrivateFile(temporaryPaths.backupMetadataFile, input.backupMetadataSerialized);
    }
    if (input.ceremonyMetadataSerialized !== undefined) {
      if (input.artifactClass !== "production") {
        throw new Error("Wallet Store v2 ceremony metadata is production-only.");
      }
      await atomicWritePrivateFile(temporaryPaths.ceremonyMetadataFile, input.ceremonyMetadataSerialized);
    }
    await input.hooks?.beforeDirectoryCommit?.();
    if (await pathExists(finalPaths.directory)) {
      throw new Error("Wallet Store v2 target appeared during creation; overwrite is forbidden.");
    }
    await rename(temporaryDirectory, finalPaths.directory);
    renamed = true;
    await chmod(finalPaths.directory, 0o700).catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== "win32") throw error;
    });
    if (input.artifactClass === "production") {
      await input.productionSecurity!.assertAfterCommit(finalPaths.directory);
    }
    committed = true;
  } finally {
    if (!committed) {
      await rm(renamed ? finalPaths.directory : temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function orphanDirectoryPattern(targetDirectory: string): RegExp {
  const escaped = basename(targetDirectory).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\.${escaped}\\.${UUID_BODY}\\.tmp$`, "i");
}

export async function listWalletStoreV2OrphanDirectories(targetDirectoryInput: string): Promise<string[]> {
  const targetPaths = walletStoreV2BundlePaths(targetDirectoryInput);
  await assertBundlePaths(targetPaths);
  const parent = dirname(targetPaths.directory);
  const pattern = orphanDirectoryPattern(targetPaths.directory);
  let names: string[];
  try {
    names = await readdir(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const matches: string[] = [];
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const candidate = join(parent, name);
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
    matches.push(candidate);
  }
  return matches.sort();
}

export async function cleanupWalletStoreV2OrphanDirectory(input: {
  targetDirectory: string;
  orphanDirectory: string;
}): Promise<void> {
  const targetPaths = walletStoreV2BundlePaths(input.targetDirectory);
  const orphan = resolve(input.orphanDirectory);
  const recognized = await listWalletStoreV2OrphanDirectories(targetPaths.directory);
  if (!recognized.includes(orphan) || orphan === targetPaths.directory) {
    throw new Error("Wallet Store v2 orphan cleanup target is not recognized.");
  }
  const entries = await readdir(orphan);
  const allowed = new Set([
    WALLET_STORE_V2_STORE_FILE_NAME,
    WALLET_STORE_V2_MANIFEST_FILE_NAME,
    WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME,
    WALLET_STORE_V2_CEREMONY_METADATA_FILE_NAME,
  ]);
  for (const entry of entries) {
    const entryPath = join(orphan, entry);
    const stats = await lstat(entryPath);
    const isAtomicTemporary = /^\.[0-9a-f-]{36}\.operator-state\.tmp$/i.test(entry);
    if (stats.isSymbolicLink() || !stats.isFile() || (!allowed.has(entry) && !isAtomicTemporary)) {
      throw new Error("Wallet Store v2 orphan contains an unrecognized entry; cleanup refused.");
    }
  }
  await rm(orphan, { recursive: true, force: false });
}

export async function createWalletStoreV2FixtureBundleDirectory(input: {
  directory: string;
  bundle: WalletStoreV2FixtureBundle;
  hooks?: WalletStoreV2WriteHooks;
}): Promise<WalletStoreV2PublicInspection> {
  const bundle = validateWalletStoreV2FixtureBundle(input.bundle);
  await writeSerializedBundleDirectory({
    directory: input.directory,
    artifactClass: "fixture",
    storeSerialized: serialize(bundle.envelope),
    manifestSerialized: serialize(bundle.manifest),
    hooks: input.hooks,
  });
  return readAndInspectWalletStoreV2FixtureBundleDirectory(input.directory);
}

function validateWalletStoreV2CeremonyMetadata(
  value: unknown,
  bundle: WalletStoreV2ProductionBundle,
): Record<string, unknown> {
  const metadata = exactObject(value, [
    "formatVersion", "purpose", "storeId", "trustedIdentityFile", "stateFile",
    "trustedIdentityFingerprint", "fingerprint",
  ], "Wallet Store v2 ceremony metadata");
  if (
    metadata.formatVersion !== 1 ||
    metadata.purpose !== WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE ||
    metadata.storeId !== bundle.envelope.storeId ||
    typeof metadata.trustedIdentityFile !== "string" ||
    !isAbsolute(metadata.trustedIdentityFile) ||
    basename(metadata.trustedIdentityFile) !== WALLET_STORE_V2_TRUSTED_IDENTITY_FILE_NAME ||
    typeof metadata.stateFile !== "string" ||
    !isAbsolute(metadata.stateFile) ||
    basename(metadata.stateFile) !== WALLET_STORE_V2_CEREMONY_STATE_FILE_NAME
  ) throw new Error("Wallet Store v2 ceremony metadata identity or path is invalid.");
  const base = {
    formatVersion: 1,
    purpose: WALLET_STORE_V2_CEREMONY_METADATA_PURPOSE,
    storeId: bundle.envelope.storeId,
    trustedIdentityFile: resolve(metadata.trustedIdentityFile),
    stateFile: resolve(metadata.stateFile),
    trustedIdentityFingerprint: requireDigest(
      metadata.trustedIdentityFingerprint,
      "Wallet Store v2 trusted identity fingerprint",
    ),
  };
  const checkedFingerprint = requireDigest(metadata.fingerprint, "Wallet Store v2 ceremony metadata fingerprint");
  if (digest(base) !== checkedFingerprint) {
    throw new Error("Wallet Store v2 ceremony metadata fingerprint mismatch.");
  }
  return { ...base, fingerprint: checkedFingerprint };
}

export async function createWalletStoreV2ProductionBundleDirectory(input: {
  directory: string;
  bundle: WalletStoreV2ProductionBundle;
  productionSecurity: WalletStoreV2ProductionFileSecurity;
  hooks?: WalletStoreV2WriteHooks;
  ceremonyMetadata?: unknown;
}): Promise<WalletStoreV2PublicInspection> {
  const bundle = validateWalletStoreV2ProductionBundle(input.bundle);
  const ceremonyMetadata = input.ceremonyMetadata === undefined
    ? undefined
    : validateWalletStoreV2CeremonyMetadata(input.ceremonyMetadata, bundle);
  await writeSerializedBundleDirectory({
    directory: input.directory,
    artifactClass: "production",
    storeSerialized: serialize(bundle.envelope),
    manifestSerialized: serialize(bundle.manifest),
    productionSecurity: input.productionSecurity,
    hooks: input.hooks,
    ceremonyMetadataSerialized: ceremonyMetadata === undefined
      ? undefined
      : serialize(ceremonyMetadata),
  });
  return readAndInspectWalletStoreV2ProductionBundleDirectory({
    directory: input.directory,
    productionSecurity: input.productionSecurity,
  });
}

async function readBundleFiles(
  directory: string,
  expectedArtifactClass: WalletStoreV2ArtifactClass,
  productionSecurity?: WalletStoreV2ProductionFileSecurity,
): Promise<{
  paths: WalletStoreV2BundlePaths;
  storeSerialized: string;
  manifestSerialized: string;
  bundle: WalletStoreV2Bundle;
}> {
  const paths = walletStoreV2BundlePaths(directory);
  await assertBundlePaths(paths);
  if (expectedArtifactClass === "production") {
    if (!productionSecurity) throw new Error("Production Wallet Store v2 requires file security.");
    await productionSecurity.assertBeforeOpen(paths.directory);
  } else if (productionSecurity) {
    throw new Error("Fixture Wallet Store v2 cannot use production file security.");
  }
  if (!(await pathIsRegularFile(paths.storeFile)) || !(await pathIsRegularFile(paths.manifestFile))) {
    throw new Error("Wallet Store v2 bundle is missing or incomplete.");
  }
  const [storeSerialized, manifestSerialized] = await Promise.all([
    readBoundedUtf8(paths.storeFile, MAX_STORE_FILE_BYTES, "Wallet Store v2 encrypted store"),
    readBoundedUtf8(paths.manifestFile, MAX_MANIFEST_FILE_BYTES, "Wallet Store v2 public manifest"),
  ]);
  let envelope: unknown;
  let manifest: unknown;
  try {
    envelope = JSON.parse(storeSerialized);
    manifest = JSON.parse(manifestSerialized);
  } catch {
    throw new Error("Wallet Store v2 bundle is truncated, corrupt, or invalid JSON.");
  }
  const checkedManifest = validateWalletStoreV2PublicManifest(manifest);
  if (checkedManifest.artifactClass !== expectedArtifactClass) {
    throw new Error("Wallet Store v2 artifact class does not match the selected API.");
  }
  const checkedEnvelope = validateWalletStoreV2Envelope({ value: envelope, manifest: checkedManifest });
  return {
    paths,
    storeSerialized,
    manifestSerialized,
    bundle: expectedArtifactClass === "fixture"
      ? { artifactClass: "fixture", envelope: checkedEnvelope, manifest: checkedManifest }
      : { artifactClass: "production", envelope: checkedEnvelope, manifest: checkedManifest },
  };
}

export async function readAndInspectWalletStoreV2FixtureBundleDirectory(
  directory: string,
): Promise<WalletStoreV2PublicInspection> {
  const { bundle } = await readBundleFiles(directory, "fixture");
  return inspectWalletStoreV2FixtureBundle(bundle as WalletStoreV2FixtureBundle);
}

export async function readAndInspectWalletStoreV2ProductionBundleDirectory(input: {
  directory: string;
  productionSecurity: WalletStoreV2ProductionFileSecurity;
}): Promise<WalletStoreV2PublicInspection> {
  const { bundle } = await readBundleFiles(input.directory, "production", input.productionSecurity);
  return inspectWalletStoreV2ProductionBundle(bundle as WalletStoreV2ProductionBundle);
}

function trustedIdentityWithoutFingerprint(
  identity: TrustedWalletStoreIdentity,
): Omit<TrustedWalletStoreIdentity, "fingerprint"> {
  return Object.fromEntries(
    Object.entries(identity).filter(([key]) => key !== "fingerprint"),
  ) as unknown as Omit<TrustedWalletStoreIdentity, "fingerprint">;
}

export function buildTrustedWalletStoreIdentity(
  manifestInput: WalletStoreV2PublicManifest,
): TrustedWalletStoreIdentity {
  const manifest = validateWalletStoreV2PublicManifest(manifestInput);
  const base: Omit<TrustedWalletStoreIdentity, "fingerprint"> = {
    formatVersion: 1,
    purpose: TRUSTED_IDENTITY_PURPOSE,
    artifactClass: manifest.artifactClass,
    storeFormatVersion: 2,
    storeId: manifest.store.storeId,
    chainId: "84532",
    contractAddress: manifest.contractAddress,
    tokenAddress: manifest.tokenAddress,
    checkpointId: CHECKPOINT_ID,
    baselineCount: "5",
    targetCount: "20",
    recordCount: 15,
    bindingFingerprint: manifest.store.bindingFingerprint,
    encryptedStoreFingerprint: manifest.store.encryptedStoreFingerprint,
    manifestFingerprint: manifest.fingerprint,
  };
  return { ...base, fingerprint: digest(base) };
}

export function validateTrustedWalletStoreIdentity(value: unknown): TrustedWalletStoreIdentity {
  const identity = exactObject(value, [
    "formatVersion", "purpose", "artifactClass", "storeFormatVersion", "storeId", "chainId",
    "contractAddress", "tokenAddress", "checkpointId", "baselineCount", "targetCount",
    "recordCount", "bindingFingerprint", "encryptedStoreFingerprint", "manifestFingerprint",
    "fingerprint",
  ], "Trusted Wallet Store v2 identity");
  if (
    identity.formatVersion !== 1 || identity.purpose !== TRUSTED_IDENTITY_PURPOSE ||
    (identity.artifactClass !== "fixture" && identity.artifactClass !== "production") ||
    identity.storeFormatVersion !== 2 || !isUuid(identity.storeId) || identity.chainId !== "84532" ||
    identity.checkpointId !== CHECKPOINT_ID || identity.baselineCount !== "5" ||
    identity.targetCount !== "20" || identity.recordCount !== 15 ||
    !isEvmAddress(identity.contractAddress) ||
    getAddress(identity.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT) ||
    !isEvmAddress(identity.tokenAddress) ||
    getAddress(identity.tokenAddress) !== getAddress(GUARDED_CHECKPOINT_20_TOKEN)
  ) throw new Error("Trusted Wallet Store v2 identity is invalid.");
  const normalized: TrustedWalletStoreIdentity = {
    formatVersion: 1,
    purpose: TRUSTED_IDENTITY_PURPOSE,
    artifactClass: identity.artifactClass,
    storeFormatVersion: 2,
    storeId: identity.storeId,
    chainId: "84532",
    contractAddress: getAddress(GUARDED_CHECKPOINT_20_CONTRACT),
    tokenAddress: getAddress(GUARDED_CHECKPOINT_20_TOKEN),
    checkpointId: CHECKPOINT_ID,
    baselineCount: "5",
    targetCount: "20",
    recordCount: 15,
    bindingFingerprint: requireDigest(identity.bindingFingerprint, "Trusted binding fingerprint"),
    encryptedStoreFingerprint: requireDigest(identity.encryptedStoreFingerprint, "Trusted store fingerprint"),
    manifestFingerprint: requireDigest(identity.manifestFingerprint, "Trusted manifest fingerprint"),
    fingerprint: requireDigest(identity.fingerprint, "Trusted identity fingerprint"),
  };
  if (digest(trustedIdentityWithoutFingerprint(normalized)) !== normalized.fingerprint) {
    throw new Error("Trusted Wallet Store v2 identity fingerprint mismatch.");
  }
  return normalized;
}

function assertInspectionMatchesTrustedIdentity(
  inspection: WalletStoreV2PublicInspection,
  expectedInput: TrustedWalletStoreIdentity,
): TrustedWalletStoreIdentity {
  const expected = validateTrustedWalletStoreIdentity(expectedInput);
  if (
    inspection.artifactClass !== expected.artifactClass || inspection.storeId !== expected.storeId ||
    inspection.chainId !== expected.chainId || inspection.contractAddress !== expected.contractAddress ||
    inspection.tokenAddress !== expected.tokenAddress || inspection.checkpointId !== expected.checkpointId ||
    inspection.baselineCount !== expected.baselineCount || inspection.targetCount !== expected.targetCount ||
    inspection.recordCount !== expected.recordCount ||
    inspection.bindingFingerprint !== expected.bindingFingerprint ||
    inspection.encryptedStoreFingerprint !== expected.encryptedStoreFingerprint ||
    inspection.manifestFingerprint !== expected.manifestFingerprint
  ) throw new Error("Wallet Store v2 does not match the independently trusted identity.");
  return expected;
}

function buildBackupMetadata(inspection: WalletStoreV2PublicInspection): WalletStoreV2BackupMetadata {
  const base: Omit<WalletStoreV2BackupMetadata, "fingerprint"> = {
    formatVersion: 1,
    purpose: BACKUP_PURPOSE,
    artifactClass: inspection.artifactClass,
    storeId: inspection.storeId,
    bindingFingerprint: inspection.bindingFingerprint,
    encryptedStoreFingerprint: inspection.encryptedStoreFingerprint,
    manifestFingerprint: inspection.manifestFingerprint,
    storeFile: WALLET_STORE_V2_STORE_FILE_NAME,
    manifestFile: WALLET_STORE_V2_MANIFEST_FILE_NAME,
  };
  return { ...base, fingerprint: digest(base) };
}

function validateBackupMetadata(value: unknown, inspection: WalletStoreV2PublicInspection): WalletStoreV2BackupMetadata {
  const metadata = exactObject(value, [
    "formatVersion", "purpose", "artifactClass", "storeId", "bindingFingerprint",
    "encryptedStoreFingerprint", "manifestFingerprint", "storeFile", "manifestFile", "fingerprint",
  ], "Wallet Store v2 backup metadata");
  const expected = buildBackupMetadata(inspection);
  for (const key of Object.keys(expected) as Array<keyof WalletStoreV2BackupMetadata>) {
    if (metadata[key] !== expected[key]) throw new Error("Wallet Store v2 backup metadata mismatch.");
  }
  return expected;
}

function backupReceipt(inspection: WalletStoreV2PublicInspection): WalletStoreV2BackupReceipt {
  return assertWalletStoreV2PublicOutput({
    kind: "wallet-store-v2-backup-receipt",
    artifactClass: inspection.artifactClass,
    storeId: inspection.storeId,
    bindingFingerprint: inspection.bindingFingerprint,
    encryptedStoreFingerprint: inspection.encryptedStoreFingerprint,
    manifestFingerprint: inspection.manifestFingerprint,
    backupVerified: true,
  }) as WalletStoreV2BackupReceipt;
}

export async function createWalletStoreV2FixtureBackup(input: {
  sourceDirectory: string;
  backupDirectory: string;
}): Promise<WalletStoreV2BackupReceipt> {
  const source = await readBundleFiles(input.sourceDirectory, "fixture");
  const inspection = inspectWalletStoreV2FixtureBundle(source.bundle as WalletStoreV2FixtureBundle);
  const metadata = buildBackupMetadata(inspection);
  await writeSerializedBundleDirectory({
    directory: input.backupDirectory,
    artifactClass: "fixture",
    storeSerialized: source.storeSerialized,
    manifestSerialized: source.manifestSerialized,
    backupMetadataSerialized: serialize(metadata),
  });
  const backup = await readBundleFiles(input.backupDirectory, "fixture");
  const backupInspection = inspectWalletStoreV2FixtureBundle(backup.bundle as WalletStoreV2FixtureBundle);
  const metadataText = await readBoundedUtf8(
    backup.paths.backupMetadataFile,
    MAX_BACKUP_METADATA_BYTES,
    "Wallet Store v2 backup metadata",
  );
  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(metadataText);
  } catch {
    throw new Error("Wallet Store v2 backup metadata is corrupt.");
  }
  validateBackupMetadata(parsedMetadata, backupInspection);
  return backupReceipt(backupInspection);
}

export async function restoreWalletStoreV2FixtureBackup(input: {
  backupDirectory: string;
  restoreDirectory: string;
  expectedIdentity: TrustedWalletStoreIdentity;
}): Promise<WalletStoreV2BackupReceipt> {
  const backup = await readBundleFiles(input.backupDirectory, "fixture");
  const inspection = inspectWalletStoreV2FixtureBundle(backup.bundle as WalletStoreV2FixtureBundle);
  assertInspectionMatchesTrustedIdentity(inspection, input.expectedIdentity);
  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(await readBoundedUtf8(
      backup.paths.backupMetadataFile,
      MAX_BACKUP_METADATA_BYTES,
      "Wallet Store v2 backup metadata",
    ));
  } catch {
    throw new Error("Wallet Store v2 backup metadata is missing or corrupt.");
  }
  validateBackupMetadata(parsedMetadata, inspection);
  await writeSerializedBundleDirectory({
    directory: input.restoreDirectory,
    artifactClass: "fixture",
    storeSerialized: backup.storeSerialized,
    manifestSerialized: backup.manifestSerialized,
  });
  const restored = await readAndInspectWalletStoreV2FixtureBundleDirectory(input.restoreDirectory);
  if (
    restored.encryptedStoreFingerprint !== inspection.encryptedStoreFingerprint ||
    restored.manifestFingerprint !== inspection.manifestFingerprint
  ) throw new Error("Wallet Store v2 restored bundle fingerprint mismatch.");
  assertInspectionMatchesTrustedIdentity(restored, input.expectedIdentity);
  return backupReceipt(restored);
}

export async function createUnverifiedWalletStoreV2ProductionBackupForCeremony(input: {
  sourceDirectory: string;
  backupDirectory: string;
  expectedIdentity: TrustedWalletStoreIdentity;
  sourceSecurity: WalletStoreV2ProductionFileSecurity;
  backupSecurity: WalletStoreV2ProductionFileSecurity;
  hooks?: WalletStoreV2WriteHooks;
}): Promise<void> {
  const source = await readBundleFiles(input.sourceDirectory, "production", input.sourceSecurity);
  const inspection = inspectWalletStoreV2ProductionBundle(source.bundle as WalletStoreV2ProductionBundle);
  assertInspectionMatchesTrustedIdentity(inspection, input.expectedIdentity);
  const metadata = buildBackupMetadata(inspection);
  await writeSerializedBundleDirectory({
    directory: input.backupDirectory,
    artifactClass: "production",
    storeSerialized: source.storeSerialized,
    manifestSerialized: source.manifestSerialized,
    backupMetadataSerialized: serialize(metadata),
    productionSecurity: input.backupSecurity,
    hooks: input.hooks,
  });
}

export async function verifyWalletStoreV2ProductionBackup(input: {
  backupDirectory: string;
  expectedIdentity: TrustedWalletStoreIdentity;
  backupSecurity: WalletStoreV2ProductionFileSecurity;
}): Promise<WalletStoreV2BackupReceipt> {
  const backup = await readBundleFiles(input.backupDirectory, "production", input.backupSecurity);
  const backupInspection = inspectWalletStoreV2ProductionBundle(backup.bundle as WalletStoreV2ProductionBundle);
  assertInspectionMatchesTrustedIdentity(backupInspection, input.expectedIdentity);
  const metadataText = await readBoundedUtf8(
    backup.paths.backupMetadataFile,
    MAX_BACKUP_METADATA_BYTES,
    "Wallet Store v2 backup metadata",
  );
  validateBackupMetadata(JSON.parse(metadataText), backupInspection);
  return backupReceipt(backupInspection);
}

export async function createWalletStoreV2ProductionBackup(input: {
  sourceDirectory: string;
  backupDirectory: string;
  expectedIdentity: TrustedWalletStoreIdentity;
  sourceSecurity: WalletStoreV2ProductionFileSecurity;
  backupSecurity: WalletStoreV2ProductionFileSecurity;
  hooks?: WalletStoreV2WriteHooks;
}): Promise<WalletStoreV2BackupReceipt> {
  await createUnverifiedWalletStoreV2ProductionBackupForCeremony(input);
  return verifyWalletStoreV2ProductionBackup(input);
}

export async function restoreWalletStoreV2ProductionBackup(input: {
  backupDirectory: string;
  restoreDirectory: string;
  expectedIdentity: TrustedWalletStoreIdentity;
  backupSecurity: WalletStoreV2ProductionFileSecurity;
  restoreSecurity: WalletStoreV2ProductionFileSecurity;
}): Promise<WalletStoreV2BackupReceipt> {
  const backup = await readBundleFiles(input.backupDirectory, "production", input.backupSecurity);
  const inspection = inspectWalletStoreV2ProductionBundle(backup.bundle as WalletStoreV2ProductionBundle);
  assertInspectionMatchesTrustedIdentity(inspection, input.expectedIdentity);
  const metadataText = await readBoundedUtf8(
    backup.paths.backupMetadataFile,
    MAX_BACKUP_METADATA_BYTES,
    "Wallet Store v2 backup metadata",
  );
  validateBackupMetadata(JSON.parse(metadataText), inspection);
  await writeSerializedBundleDirectory({
    directory: input.restoreDirectory,
    artifactClass: "production",
    storeSerialized: backup.storeSerialized,
    manifestSerialized: backup.manifestSerialized,
    productionSecurity: input.restoreSecurity,
  });
  const restored = await readAndInspectWalletStoreV2ProductionBundleDirectory({
    directory: input.restoreDirectory,
    productionSecurity: input.restoreSecurity,
  });
  assertInspectionMatchesTrustedIdentity(restored, input.expectedIdentity);
  return backupReceipt(restored);
}

export async function withDecryptedWalletStoreV2FixtureRecord(input: {
  directory: string;
  index: number;
  unlockSecret: WalletStoreV2FixtureUnlockSecret;
  callback(session: WalletStoreV2DecryptedSession): Promise<void> | void;
  onRecordDecrypted?(index: number): void;
}): Promise<WalletStoreV2SessionReceipt> {
  let key: Buffer | null = null;
  let plaintext: Buffer | null = null;
  let session: WalletStoreV2DecryptedSession | null = null;
  try {
    const { bundle } = await readBundleFiles(input.directory, "fixture");
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= 15) {
      throw new Error("Wallet Store v2 selected index is invalid.");
    }
    const record = bundle.envelope.records[input.index];
    const salt = base64(bundle.envelope.kdfParameters.salt, SALT_LENGTH, "Wallet Store v2 salt");
    try {
      key = await input.unlockSecret[consumeUnlockSecret]((unlockBytes) => deriveKey(unlockBytes, salt));
    } finally {
      salt.fill(0);
    }
    const iv = base64(record.iv, IV_LENGTH, "Wallet Store v2 selected IV");
    const tag = base64(record.authenticationTag, AUTH_TAG_LENGTH, "Wallet Store v2 selected authentication tag");
    const ciphertext = base64(record.ciphertext, KEY_LENGTH, "Wallet Store v2 selected ciphertext");
    let updatePlaintext: Buffer | null = null;
    let finalPlaintext: Buffer | null = null;
    try {
      const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAAD(aad({
        bindingFingerprint: bundle.envelope.bindingFingerprint,
        index: input.index,
        address: record.address,
      }));
      decipher.setAuthTag(tag);
      updatePlaintext = decipher.update(ciphertext);
      finalPlaintext = decipher.final();
      plaintext = Buffer.concat([updatePlaintext, finalPlaintext]);
      input.onRecordDecrypted?.(input.index);
    } finally {
      updatePlaintext?.fill(0);
      finalPlaintext?.fill(0);
      iv.fill(0);
      tag.fill(0);
      ciphertext.fill(0);
    }
    const derivedAddress = deriveAddress(plaintext);
    const manifestAddress = bundle.manifest.candidates[input.index].address;
    if (derivedAddress !== record.address || derivedAddress !== manifestAddress) {
      throw new Error("Wallet Store v2 selected address verification failed.");
    }
    session = new WalletStoreV2DecryptedSession(input.index, derivedAddress, plaintext);
    plaintext = null;
    const callbackResult = await input.callback(session);
    if (callbackResult !== undefined) throw new Error("Wallet Store v2 callback must not return a value.");
    session.destroy();
    return assertWalletStoreV2PublicOutput({
      kind: "wallet-store-v2-session-receipt",
      artifactClass: "fixture",
      storeId: bundle.envelope.storeId,
      index: input.index,
      address: derivedAddress,
      manifestFingerprint: bundle.manifest.fingerprint,
      addressVerified: true,
      sessionClosed: true,
    }) as WalletStoreV2SessionReceipt;
  } catch {
    throw new Error("Wallet Store v2 selected-record session failed without exposing secret material.");
  } finally {
    session?.destroy();
    plaintext?.fill(0);
    key?.fill(0);
    input.unlockSecret.destroy();
  }
}

async function verifyDecryptedWalletStoreV2ProductionClassRecord(input: {
  directory: string;
  index: number;
  passwordProvider: ProductionPasswordProvider;
  productionSecurity: WalletStoreV2ProductionFileSecurity;
  expectedIdentity: TrustedWalletStoreIdentity;
  onRecordDecrypted?: (index: number) => void;
}): Promise<WalletStoreV2SessionReceipt> {
  let key: Buffer | null = null;
  let plaintext: Buffer | null = null;
  let updatePlaintext: Buffer | null = null;
  let finalPlaintext: Buffer | null = null;
  try {
    const { bundle } = await readBundleFiles(input.directory, "production", input.productionSecurity);
    const productionBundle = bundle as WalletStoreV2ProductionBundle;
    const inspection = inspectWalletStoreV2ProductionBundle(productionBundle);
    assertInspectionMatchesTrustedIdentity(inspection, input.expectedIdentity);
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= 15) {
      throw new Error("Production Wallet Store v2 selected index is invalid.");
    }
    const record = productionBundle.envelope.records[input.index];
    const salt = base64(productionBundle.envelope.kdfParameters.salt, SALT_LENGTH, "Wallet Store v2 salt");
    try {
      key = await input.passwordProvider.withPassword(async (unlockSecret) =>
        unlockSecret[consumeProductionPassword]((unlockBytes) => deriveKey(unlockBytes, salt)));
    } finally {
      salt.fill(0);
    }
    const iv = base64(record.iv, IV_LENGTH, "Wallet Store v2 selected IV");
    const tag = base64(record.authenticationTag, AUTH_TAG_LENGTH, "Wallet Store v2 selected authentication tag");
    const ciphertext = base64(record.ciphertext, KEY_LENGTH, "Wallet Store v2 selected ciphertext");
    try {
      const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAAD(aad({
        bindingFingerprint: productionBundle.envelope.bindingFingerprint,
        index: input.index,
        address: record.address,
      }));
      decipher.setAuthTag(tag);
      updatePlaintext = decipher.update(ciphertext);
      finalPlaintext = decipher.final();
      plaintext = Buffer.concat([updatePlaintext, finalPlaintext]);
      input.onRecordDecrypted?.(input.index);
    } finally {
      updatePlaintext?.fill(0);
      finalPlaintext?.fill(0);
      iv.fill(0);
      tag.fill(0);
      ciphertext.fill(0);
    }
    const derivedAddress = deriveAddress(plaintext);
    if (
      derivedAddress !== record.address ||
      derivedAddress !== productionBundle.manifest.candidates[input.index].address
    ) throw new Error("Production Wallet Store v2 selected address verification failed.");
    return assertWalletStoreV2PublicOutput({
      kind: "wallet-store-v2-session-receipt",
      artifactClass: "production",
      storeId: productionBundle.envelope.storeId,
      index: input.index,
      address: derivedAddress,
      manifestFingerprint: productionBundle.manifest.fingerprint,
      addressVerified: true,
      sessionClosed: true,
    }) as WalletStoreV2SessionReceipt;
  } catch {
    throw new Error("Production Wallet Store v2 verification failed without exposing secret material.");
  } finally {
    updatePlaintext?.fill(0);
    finalPlaintext?.fill(0);
    plaintext?.fill(0);
    key?.fill(0);
  }
}

export async function verifyDecryptedWalletStoreV2ProductionRecord(input: {
  directory: string;
  index: number;
  passwordProvider: ProductionTtyPasswordProvider;
  productionSecurity: WalletStoreV2ProductionFileSecurity;
  expectedIdentity: TrustedWalletStoreIdentity;
}): Promise<WalletStoreV2SessionReceipt> {
  if (!(input.passwordProvider instanceof ProductionTtyPasswordProvider)) {
    throw new Error("Production Wallet Store v2 rejects injected or fixture password providers.");
  }
  return verifyDecryptedWalletStoreV2ProductionClassRecord(input);
}

export async function verifyDecryptedWalletStoreV2ProductionFormatFixtureRecord(input: {
  directory: string;
  index: number;
  passwordProvider: InjectedTestPasswordProvider;
  productionSecurity: WalletStoreV2ProductionFileSecurity;
  expectedIdentity: TrustedWalletStoreIdentity;
  authorization: string;
  onRecordDecrypted?: (index: number) => void;
}): Promise<WalletStoreV2SessionReceipt> {
  assertFixtureAuthorization(input.authorization);
  if (!(input.passwordProvider instanceof InjectedTestPasswordProvider)) {
    throw new Error("Production-format record fixture requires an injected test-only password provider.");
  }
  return verifyDecryptedWalletStoreV2ProductionClassRecord(input);
}

function buildGuardedCheckpoint20ManifestForArtifactClass(
  manifestInput: WalletStoreV2PublicManifest,
  expectedArtifactClass: WalletStoreV2ArtifactClass,
): GuardedCheckpoint20Manifest {
  const manifest = validateWalletStoreV2PublicManifest(manifestInput);
  if (manifest.artifactClass !== expectedArtifactClass) {
    throw new Error(`Wallet Store v2 ${manifest.artifactClass} artifact is rejected by the ${expectedArtifactClass} binding.`);
  }
  const storeBinding: GuardedCheckpoint20StoreBinding = {
    formatVersion: 2,
    artifactClass: manifest.artifactClass,
    storeId: manifest.store.storeId,
    publicFingerprint: manifest.fingerprint,
    selectedRecordDecryption: true,
    externalPathRequired: true,
  };
  return buildGuardedCheckpoint20Manifest({
    addresses: manifest.candidates.map((candidate) => candidate.address),
    storeBinding,
  });
}

export function buildFixtureGuardedCheckpoint20ManifestFromWalletStoreV2(
  manifestInput: WalletStoreV2PublicManifest,
): GuardedCheckpoint20Manifest {
  return buildGuardedCheckpoint20ManifestForArtifactClass(manifestInput, "fixture");
}

export function buildProductionGuardedCheckpoint20ManifestFromWalletStoreV2(
  manifestInput: WalletStoreV2PublicManifest,
): GuardedCheckpoint20Manifest {
  return buildGuardedCheckpoint20ManifestForArtifactClass(manifestInput, "production");
}

export function walletStoreV2FixtureSecuritySummary(): {
  fixtureOnly: true;
  realWalletGenerationAvailable: false;
  walletClientAvailable: false;
  signerAvailable: false;
  transactionTransportAvailable: false;
  selectedRecordOnly: true;
} {
  return {
    fixtureOnly: true,
    realWalletGenerationAvailable: false,
    walletClientAvailable: false,
    signerAvailable: false,
    transactionTransportAvailable: false,
    selectedRecordOnly: true,
  };
}
