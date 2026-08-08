import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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
export const WALLET_STORE_V2_BUNDLE_DIRECTORY_SUFFIX =
  ".checkpoint-20-wallet-store-v2-bundle";
export const WALLET_STORE_V2_STORE_FILE_NAME =
  "checkpoint-20.wallet-store-v2.enc.json";
export const WALLET_STORE_V2_MANIFEST_FILE_NAME =
  "checkpoint-20.wallet-store-v2.manifest.json";
export const WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME =
  "checkpoint-20.wallet-store-v2.backup.json";

const FORMAT_VERSION = 2 as const;
const PURPOSE = "pop33-guarded-checkpoint-20-wallet-store-v2" as const;
const MANIFEST_PURPOSE = "pop33-guarded-checkpoint-20-wallet-store-v2-public-manifest" as const;
const BACKUP_PURPOSE = "pop33-guarded-checkpoint-20-wallet-store-v2-backup" as const;
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const consumeUnlockSecret = Symbol("consumeWalletStoreV2UnlockSecret");
const consumeFixtureRecord = Symbol("consumeWalletStoreV2FixtureRecord");

export interface WalletStoreV2Candidate {
  index: number;
  address: string;
}

export interface WalletStoreV2PublicManifest {
  formatVersion: 2;
  purpose: typeof MANIFEST_PURPOSE;
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

export interface WalletStoreV2FixtureEnvelope {
  formatVersion: 2;
  purpose: typeof PURPOSE;
  fixtureOnly: true;
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
  fixtureOnly: true;
  manifest: WalletStoreV2PublicManifest;
  envelope: WalletStoreV2FixtureEnvelope;
}

export interface WalletStoreV2PublicInspection {
  kind: "wallet-store-v2-inspection";
  readOnly: true;
  fixtureOnly: true;
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
  fixtureOnly: true;
  storeId: string;
  index: number;
  address: string;
  manifestFingerprint: string;
  addressVerified: true;
  sessionClosed: true;
}

export interface WalletStoreV2BackupReceipt {
  kind: "wallet-store-v2-backup-receipt";
  fixtureOnly: true;
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
  fixtureOnly: true;
  storeId: string;
  bindingFingerprint: string;
  encryptedStoreFingerprint: string;
  manifestFingerprint: string;
  storeFile: typeof WALLET_STORE_V2_STORE_FILE_NAME;
  manifestFile: typeof WALLET_STORE_V2_MANIFEST_FILE_NAME;
  fingerprint: string;
}

export interface WalletStoreV2BundlePaths {
  directory: string;
  storeFile: string;
  manifestFile: string;
  backupMetadataFile: string;
}

export interface WalletStoreV2WriteHooks {
  afterStoreWrite?(): Promise<void> | void;
  beforeDirectoryCommit?(): Promise<void> | void;
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
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function base64(value: unknown, length: number | null, label: string): Buffer {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid.`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (length !== null && decoded.length !== length)) {
    decoded.fill(0);
    throw new Error(`${label} is invalid.`);
  }
  return decoded;
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizeCandidates(candidates: readonly WalletStoreV2Candidate[]): WalletStoreV2Candidate[] {
  if (candidates.length !== GUARDED_CHECKPOINT_20_CANDIDATE_COUNT) {
    throw new Error("Wallet Store v2 requires exactly 15 public candidates.");
  }
  const seen = new Set<string>();
  return candidates.map((candidate, index) => {
    if (candidate.index !== index || !isAddress(candidate.address)) {
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
  return getAddress(computeAddress(`0x${privateKeyBytes.toString("hex")}`));
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

function bindingBase(input: {
  createdAt: string;
  storeId: string;
  candidates: readonly WalletStoreV2Candidate[];
}): Record<string, unknown> {
  return {
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
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

function envelopeFingerprintBase(envelope: Omit<WalletStoreV2FixtureEnvelope, "encryptedStoreFingerprint" | "manifestFingerprint">): unknown {
  return envelope;
}

function manifestWithoutFingerprint(manifest: WalletStoreV2PublicManifest): Omit<WalletStoreV2PublicManifest, "fingerprint"> {
  return {
    formatVersion: manifest.formatVersion,
    purpose: manifest.purpose,
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
  if (!UUID.test(storeId)) throw new Error("Wallet Store v2 store ID is invalid.");
  const bindingFingerprint = digest(bindingBase({ createdAt, storeId, candidates }));
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
  const envelopeBase: Omit<WalletStoreV2FixtureEnvelope, "encryptedStoreFingerprint" | "manifestFingerprint"> = {
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
    fixtureOnly: true,
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
  const envelope: WalletStoreV2FixtureEnvelope = {
    ...envelopeBase,
    encryptedStoreFingerprint,
    manifestFingerprint: manifest.fingerprint,
  };
  return validateWalletStoreV2FixtureBundle({ fixtureOnly: true, manifest, envelope });
}

export function validateWalletStoreV2PublicManifest(value: unknown): WalletStoreV2PublicManifest {
  const manifest = exactObject(value, [
    "formatVersion", "purpose", "createdAt", "chainId", "contractAddress", "tokenAddress",
    "checkpoint", "store", "candidates", "fingerprint",
  ], "Wallet Store v2 public manifest");
  if (manifest.formatVersion !== FORMAT_VERSION || manifest.purpose !== MANIFEST_PURPOSE) {
    throw new Error("Wallet Store v2 public manifest version or purpose is invalid.");
  }
  const createdAt = iso(manifest.createdAt, "Wallet Store v2 manifest creation time");
  if (manifest.chainId !== "84532") throw new Error("Wallet Store v2 manifest chain ID mismatch.");
  if (
    typeof manifest.contractAddress !== "string" || !isAddress(manifest.contractAddress) ||
    getAddress(manifest.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT)
  ) throw new Error("Wallet Store v2 manifest contract mismatch.");
  if (
    typeof manifest.tokenAddress !== "string" || !isAddress(manifest.tokenAddress) ||
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
  if (store.formatVersion !== FORMAT_VERSION || typeof store.storeId !== "string" || !UUID.test(store.storeId)) {
    throw new Error("Wallet Store v2 manifest store identity mismatch.");
  }
  const bindingFingerprint = requireDigest(store.bindingFingerprint, "Wallet Store v2 binding fingerprint");
  const encryptedStoreFingerprint = requireDigest(
    store.encryptedStoreFingerprint,
    "Wallet Store v2 encrypted store fingerprint",
  );
  if (!Array.isArray(manifest.candidates)) throw new Error("Wallet Store v2 manifest candidates are invalid.");
  const candidates = normalizeCandidates(manifest.candidates as WalletStoreV2Candidate[]);
  const expectedBinding = digest(bindingBase({ createdAt, storeId: store.storeId, candidates }));
  if (bindingFingerprint !== expectedBinding) throw new Error("Wallet Store v2 manifest binding fingerprint mismatch.");
  const normalized: WalletStoreV2PublicManifest = {
    formatVersion: FORMAT_VERSION,
    purpose: MANIFEST_PURPOSE,
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

export function validateWalletStoreV2FixtureEnvelope(input: {
  value: unknown;
  manifest: WalletStoreV2PublicManifest;
}): WalletStoreV2FixtureEnvelope {
  const manifest = validateWalletStoreV2PublicManifest(input.manifest);
  const envelope = exactObject(input.value, [
    "formatVersion", "purpose", "fixtureOnly", "createdAt", "storeId", "chainId",
    "contractAddress", "tokenAddress", "checkpointId", "baselineCount", "targetCount",
    "recordCount", "cipher", "kdf", "kdfParameters", "bindingFingerprint",
    "recordsFingerprint", "encryptedStoreFingerprint", "manifestFingerprint", "records",
  ], "Wallet Store v2 envelope");
  if (
    envelope.formatVersion !== FORMAT_VERSION || envelope.purpose !== PURPOSE ||
    envelope.fixtureOnly !== true || envelope.chainId !== "84532" ||
    envelope.checkpointId !== CHECKPOINT_ID || envelope.baselineCount !== "5" ||
    envelope.targetCount !== "20" || envelope.recordCount !== 15 ||
    envelope.cipher !== CIPHER || envelope.kdf !== KDF
  ) throw new Error("Wallet Store v2 envelope identity or cryptographic profile mismatch.");
  const createdAt = iso(envelope.createdAt, "Wallet Store v2 envelope creation time");
  if (createdAt !== manifest.createdAt || envelope.storeId !== manifest.store.storeId) {
    throw new Error("Wallet Store v2 envelope and manifest identity mismatch.");
  }
  if (
    typeof envelope.storeId !== "string" || !UUID.test(envelope.storeId) ||
    typeof envelope.contractAddress !== "string" || !isAddress(envelope.contractAddress) ||
    getAddress(envelope.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT) ||
    typeof envelope.tokenAddress !== "string" || !isAddress(envelope.tokenAddress) ||
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
  const normalizedBase: Omit<WalletStoreV2FixtureEnvelope, "encryptedStoreFingerprint" | "manifestFingerprint"> = {
    formatVersion: FORMAT_VERSION,
    purpose: PURPOSE,
    fixtureOnly: true,
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
  if (!value || value.fixtureOnly !== true) throw new Error("Wallet Store v2 fixture bundle marker is missing.");
  const manifest = validateWalletStoreV2PublicManifest(value.manifest);
  const envelope = validateWalletStoreV2FixtureEnvelope({ value: value.envelope, manifest });
  return { fixtureOnly: true, manifest, envelope };
}

export function inspectWalletStoreV2FixtureBundle(value: WalletStoreV2FixtureBundle): WalletStoreV2PublicInspection {
  const bundle = validateWalletStoreV2FixtureBundle(value);
  return assertWalletStoreV2PublicOutput({
    kind: "wallet-store-v2-inspection",
    readOnly: true,
    fixtureOnly: true,
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

export function assertWalletStoreV2PublicOutput(value: unknown): WalletStoreV2PublicOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Wallet Store v2 public output must use an allowlisted shape.");
  }
  const kind = (value as { kind?: unknown }).kind;
  const keysByKind: Record<string, readonly string[]> = {
    "wallet-store-v2-inspection": [
      "kind", "readOnly", "fixtureOnly", "formatVersion", "storeId", "chainId",
      "contractAddress", "tokenAddress", "checkpointId", "baselineCount", "targetCount",
      "recordCount", "addresses", "bindingFingerprint", "encryptedStoreFingerprint",
      "manifestFingerprint", "cipher", "kdf",
    ],
    "wallet-store-v2-session-receipt": [
      "kind", "fixtureOnly", "storeId", "index", "address", "manifestFingerprint",
      "addressVerified", "sessionClosed",
    ],
    "wallet-store-v2-backup-receipt": [
      "kind", "fixtureOnly", "storeId", "bindingFingerprint", "encryptedStoreFingerprint",
      "manifestFingerprint", "backupVerified",
    ],
  };
  if (typeof kind !== "string" || !(kind in keysByKind)) {
    throw new Error("Wallet Store v2 public output kind is not allowlisted.");
  }
  const output = exactObject(value, keysByKind[kind], "Wallet Store v2 public output");
  if (output.fixtureOnly !== true || typeof output.storeId !== "string" || !UUID.test(output.storeId)) {
    throw new Error("Wallet Store v2 public output identity is invalid.");
  }
  requireDigest(output.manifestFingerprint, "Wallet Store v2 public manifest fingerprint");
  if (kind === "wallet-store-v2-inspection") {
    if (
      output.readOnly !== true || output.formatVersion !== 2 || output.chainId !== "84532" ||
      output.checkpointId !== CHECKPOINT_ID || output.baselineCount !== "5" ||
      output.targetCount !== "20" || output.recordCount !== 15 ||
      output.cipher !== CIPHER || output.kdf !== KDF ||
      typeof output.contractAddress !== "string" || !isAddress(output.contractAddress) ||
      getAddress(output.contractAddress) !== getAddress(GUARDED_CHECKPOINT_20_CONTRACT) ||
      typeof output.tokenAddress !== "string" || !isAddress(output.tokenAddress) ||
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
      typeof output.address !== "string" || !isAddress(output.address) ||
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

async function assertBundlePaths(paths: WalletStoreV2BundlePaths): Promise<void> {
  await assertSafeExternalFilePath(paths.storeFile, ".wallet-store-v2.enc.json");
  await assertSafeExternalFilePath(paths.manifestFile, ".wallet-store-v2.manifest.json");
  await assertSafeExternalFilePath(paths.backupMetadataFile, ".wallet-store-v2.backup.json");
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeSerializedBundleDirectory(input: {
  directory: string;
  storeSerialized: string;
  manifestSerialized: string;
  backupMetadataSerialized?: string;
  hooks?: WalletStoreV2WriteHooks;
}): Promise<void> {
  const finalPaths = walletStoreV2BundlePaths(input.directory);
  await assertBundlePaths(finalPaths);
  if (await pathExists(finalPaths.directory)) {
    throw new Error("Wallet Store v2 bundle directory already exists; overwrite is forbidden.");
  }
  await mkdir(dirname(finalPaths.directory), { recursive: true, mode: 0o700 });
  const temporaryDirectory = join(
    dirname(finalPaths.directory),
    `.${basename(finalPaths.directory)}.${randomUUID()}.tmp`,
  );
  let committed = false;
  try {
    await mkdir(temporaryDirectory, { recursive: false, mode: 0o700 });
    const temporaryPaths = {
      directory: temporaryDirectory,
      storeFile: join(temporaryDirectory, WALLET_STORE_V2_STORE_FILE_NAME),
      manifestFile: join(temporaryDirectory, WALLET_STORE_V2_MANIFEST_FILE_NAME),
      backupMetadataFile: join(temporaryDirectory, WALLET_STORE_V2_BACKUP_METADATA_FILE_NAME),
    };
    await atomicWritePrivateFile(temporaryPaths.storeFile, input.storeSerialized);
    await input.hooks?.afterStoreWrite?.();
    await atomicWritePrivateFile(temporaryPaths.manifestFile, input.manifestSerialized);
    if (input.backupMetadataSerialized !== undefined) {
      await atomicWritePrivateFile(temporaryPaths.backupMetadataFile, input.backupMetadataSerialized);
    }
    await input.hooks?.beforeDirectoryCommit?.();
    if (await pathExists(finalPaths.directory)) {
      throw new Error("Wallet Store v2 target appeared during creation; overwrite is forbidden.");
    }
    await rename(temporaryDirectory, finalPaths.directory);
    committed = true;
    await chmod(finalPaths.directory, 0o700).catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== "win32") throw error;
    });
  } finally {
    if (!committed) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function createWalletStoreV2FixtureBundleDirectory(input: {
  directory: string;
  bundle: WalletStoreV2FixtureBundle;
  hooks?: WalletStoreV2WriteHooks;
}): Promise<WalletStoreV2PublicInspection> {
  const bundle = validateWalletStoreV2FixtureBundle(input.bundle);
  await writeSerializedBundleDirectory({
    directory: input.directory,
    storeSerialized: serialize(bundle.envelope),
    manifestSerialized: serialize(bundle.manifest),
    hooks: input.hooks,
  });
  return readAndInspectWalletStoreV2FixtureBundleDirectory(input.directory);
}

async function readBundleFiles(directory: string): Promise<{
  paths: WalletStoreV2BundlePaths;
  storeSerialized: string;
  manifestSerialized: string;
  bundle: WalletStoreV2FixtureBundle;
}> {
  const paths = walletStoreV2BundlePaths(directory);
  await assertBundlePaths(paths);
  if (!(await pathIsRegularFile(paths.storeFile)) || !(await pathIsRegularFile(paths.manifestFile))) {
    throw new Error("Wallet Store v2 bundle is missing or incomplete.");
  }
  let storeSerialized: string;
  let manifestSerialized: string;
  let envelope: unknown;
  let manifest: unknown;
  try {
    [storeSerialized, manifestSerialized] = await Promise.all([
      readFile(paths.storeFile, "utf8"),
      readFile(paths.manifestFile, "utf8"),
    ]);
    envelope = JSON.parse(storeSerialized);
    manifest = JSON.parse(manifestSerialized);
  } catch {
    throw new Error("Wallet Store v2 bundle is truncated, corrupt, or invalid JSON.");
  }
  const checkedManifest = validateWalletStoreV2PublicManifest(manifest);
  const checkedEnvelope = validateWalletStoreV2FixtureEnvelope({ value: envelope, manifest: checkedManifest });
  return {
    paths,
    storeSerialized,
    manifestSerialized,
    bundle: { fixtureOnly: true, envelope: checkedEnvelope, manifest: checkedManifest },
  };
}

export async function readAndInspectWalletStoreV2FixtureBundleDirectory(
  directory: string,
): Promise<WalletStoreV2PublicInspection> {
  return inspectWalletStoreV2FixtureBundle((await readBundleFiles(directory)).bundle);
}

function buildBackupMetadata(inspection: WalletStoreV2PublicInspection): WalletStoreV2BackupMetadata {
  const base: Omit<WalletStoreV2BackupMetadata, "fingerprint"> = {
    formatVersion: 1,
    purpose: BACKUP_PURPOSE,
    fixtureOnly: true,
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
    "formatVersion", "purpose", "fixtureOnly", "storeId", "bindingFingerprint",
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
    fixtureOnly: true,
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
  const source = await readBundleFiles(input.sourceDirectory);
  const inspection = inspectWalletStoreV2FixtureBundle(source.bundle);
  const metadata = buildBackupMetadata(inspection);
  await writeSerializedBundleDirectory({
    directory: input.backupDirectory,
    storeSerialized: source.storeSerialized,
    manifestSerialized: source.manifestSerialized,
    backupMetadataSerialized: serialize(metadata),
  });
  const backup = await readBundleFiles(input.backupDirectory);
  const backupInspection = inspectWalletStoreV2FixtureBundle(backup.bundle);
  const metadataText = await readFile(backup.paths.backupMetadataFile, "utf8");
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
}): Promise<WalletStoreV2BackupReceipt> {
  const backup = await readBundleFiles(input.backupDirectory);
  const inspection = inspectWalletStoreV2FixtureBundle(backup.bundle);
  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(await readFile(backup.paths.backupMetadataFile, "utf8"));
  } catch {
    throw new Error("Wallet Store v2 backup metadata is missing or corrupt.");
  }
  validateBackupMetadata(parsedMetadata, inspection);
  await writeSerializedBundleDirectory({
    directory: input.restoreDirectory,
    storeSerialized: backup.storeSerialized,
    manifestSerialized: backup.manifestSerialized,
  });
  const restored = await readAndInspectWalletStoreV2FixtureBundleDirectory(input.restoreDirectory);
  if (
    restored.encryptedStoreFingerprint !== inspection.encryptedStoreFingerprint ||
    restored.manifestFingerprint !== inspection.manifestFingerprint
  ) throw new Error("Wallet Store v2 restored bundle fingerprint mismatch.");
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
    const { bundle } = await readBundleFiles(input.directory);
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
    try {
      const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAAD(aad({
        bindingFingerprint: bundle.envelope.bindingFingerprint,
        index: input.index,
        address: record.address,
      }));
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      input.onRecordDecrypted?.(input.index);
    } finally {
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
      fixtureOnly: true,
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

export function buildGuardedCheckpoint20ManifestFromWalletStoreV2(
  manifestInput: WalletStoreV2PublicManifest,
): GuardedCheckpoint20Manifest {
  const manifest = validateWalletStoreV2PublicManifest(manifestInput);
  const storeBinding: GuardedCheckpoint20StoreBinding = {
    formatVersion: 2,
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
