import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import { readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { getAddress, Wallet, type Provider } from "ethers";

import {
  assertSafeExternalFilePath,
  atomicWritePrivateFile,
  pathIsRegularFile,
  withExclusiveFileLock,
  type AtomicWriteHooks,
} from "./durable-file.js";
import type {
  InteractivePasswordReader,
  OperatorWallet,
  OperatorWalletProvider,
} from "./wallet-provider.js";

const WALLET_STORE_SUFFIX = ".operator-wallets.enc.json";
const FORMAT_VERSION = 1;
const CIPHER = "aes-256-gcm";
const KDF = "scrypt";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

interface WalletStoreEnvelope {
  formatVersion: 1;
  storeId: string;
  cipher: typeof CIPHER;
  kdf: typeof KDF;
  kdfParameters: {
    n: number;
    r: number;
    p: number;
    salt: string;
  };
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface WalletStorePlaintext {
  formatVersion: 1;
  storeId: string;
  walletCount: number;
  wallets: Array<{
    index: number;
    address: string;
    privateKey: string;
  }>;
}

export interface DecryptedWalletRecord {
  index: number;
  address: string;
  privateKey: string;
}

export interface EncryptedWalletStoreInspection {
  formatVersion: 1;
  storeId: string;
  walletCount: number;
  addresses: string[];
  fingerprint: string;
}

export interface CreateEncryptedWalletStoreOptions {
  filePath: string;
  password: string;
  walletCount: number;
  hooks?: AtomicWriteHooks;
}

export interface EncryptedWalletStoreOptions {
  filePath: string;
  password: string;
  walletCount: number;
  provider: Provider;
  hooks?: AtomicWriteHooks;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(`${label}.${key} is not allowed.`);
  }
  for (const key of keys) {
    if (!(key in record)) throw new Error(`${label}.${key} is required.`);
  }
  return record;
}

function base64Buffer(value: unknown, expectedLength: number | undefined, label: string): Buffer {
  if (typeof value !== "string" || !BASE64.test(value)) {
    throw new Error(`${label} must be canonical base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`${label} has an invalid length.`);
  }
  return decoded;
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Wallet store password must contain at least 12 characters.");
  }
}

function assertWalletCount(walletCount: number): void {
  if (!Number.isSafeInteger(walletCount) || walletCount <= 0 || walletCount > 100) {
    throw new Error("Wallet store count must be an integer between 1 and 100.");
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      },
    );
  });
}

async function encrypt(
  plaintext: WalletStorePlaintext,
  password: string,
): Promise<WalletStoreEnvelope> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);
  try {
    const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encoded = Buffer.from(JSON.stringify(plaintext), "utf8");
    const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      formatVersion: FORMAT_VERSION,
      storeId: plaintext.storeId,
      cipher: CIPHER,
      kdf: KDF,
      kdfParameters: {
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        salt: salt.toString("base64"),
      },
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

function parseEnvelope(value: unknown): WalletStoreEnvelope {
  const envelope = exactObject(
    value,
    ["formatVersion", "storeId", "cipher", "kdf", "kdfParameters", "iv", "authTag", "ciphertext"],
    "walletStore",
  );
  if (envelope.formatVersion !== FORMAT_VERSION) {
    throw new Error("Unsupported wallet store format version.");
  }
  if (typeof envelope.storeId !== "string" || envelope.storeId.length < 16) {
    throw new Error("Wallet store ID is invalid.");
  }
  if (envelope.cipher !== CIPHER || envelope.kdf !== KDF) {
    throw new Error("Wallet store cryptographic configuration is unsupported.");
  }
  const parameters = exactObject(
    envelope.kdfParameters,
    ["n", "r", "p", "salt"],
    "walletStore.kdfParameters",
  );
  if (parameters.n !== SCRYPT_N || parameters.r !== SCRYPT_R || parameters.p !== SCRYPT_P) {
    throw new Error("Wallet store KDF parameters are unsupported.");
  }
  base64Buffer(parameters.salt, SALT_LENGTH, "walletStore.kdfParameters.salt");
  base64Buffer(envelope.iv, IV_LENGTH, "walletStore.iv");
  base64Buffer(envelope.authTag, AUTH_TAG_LENGTH, "walletStore.authTag");
  base64Buffer(envelope.ciphertext, undefined, "walletStore.ciphertext");
  return envelope as unknown as WalletStoreEnvelope;
}

function parsePlaintext(
  value: unknown,
  storeId: string,
  expectedWalletCount?: number,
): WalletStorePlaintext {
  const plaintext = exactObject(
    value,
    ["formatVersion", "storeId", "walletCount", "wallets"],
    "walletData",
  );
  if (plaintext.formatVersion !== FORMAT_VERSION || plaintext.storeId !== storeId) {
    throw new Error("Wallet store decrypted metadata is inconsistent.");
  }
  if (typeof plaintext.walletCount !== "number") {
    throw new Error("Wallet store contains an invalid wallet count.");
  }
  assertWalletCount(plaintext.walletCount);
  const walletCount = plaintext.walletCount;
  if ((expectedWalletCount !== undefined && walletCount !== expectedWalletCount) || !Array.isArray(plaintext.wallets)) {
    throw new Error("Wallet store contains an unexpected wallet count.");
  }
  if (plaintext.wallets.length !== walletCount) {
    throw new Error("Wallet store wallet list length is inconsistent.");
  }

  const wallets = validateWalletRecords(plaintext.wallets, walletCount);

  return {
    formatVersion: FORMAT_VERSION,
    storeId,
    walletCount,
    wallets,
  };
}

export function validateWalletRecords(
  records: unknown[],
  expectedWalletCount: number,
): DecryptedWalletRecord[] {
  if (records.length !== expectedWalletCount) {
    throw new Error("Wallet store wallet list length is inconsistent.");
  }
  const seenAddresses = new Set<string>();
  return records.map((entry, index) => {
    const wallet = exactObject(entry, ["index", "address", "privateKey"], `walletData.wallets[${index}]`);
    if (wallet.index !== index) throw new Error("Wallet store index sequence is invalid.");
    if (typeof wallet.privateKey !== "string" || !PRIVATE_KEY.test(wallet.privateKey)) {
      throw new Error("Wallet store contains invalid encrypted wallet material.");
    }
    let derived: Wallet;
    try {
      derived = new Wallet(wallet.privateKey);
    } catch {
      throw new Error("Wallet store contains invalid encrypted wallet material.");
    }
    if (typeof wallet.address !== "string" || getAddress(wallet.address) !== derived.address) {
      throw new Error("Wallet store address integrity check failed.");
    }
    const normalized = derived.address.toLowerCase();
    if (seenAddresses.has(normalized)) throw new Error("Wallet store contains duplicate addresses.");
    seenAddresses.add(normalized);
    return { index, address: derived.address, privateKey: wallet.privateKey };
  });
}

async function decrypt(
  envelope: WalletStoreEnvelope,
  password: string,
  expectedWalletCount?: number,
): Promise<WalletStorePlaintext> {
  const salt = base64Buffer(envelope.kdfParameters.salt, SALT_LENGTH, "walletStore salt");
  const iv = base64Buffer(envelope.iv, IV_LENGTH, "walletStore IV");
  const tag = base64Buffer(envelope.authTag, AUTH_TAG_LENGTH, "walletStore authentication tag");
  const ciphertext = base64Buffer(envelope.ciphertext, undefined, "walletStore ciphertext");
  const key = await deriveKey(password, salt);
  try {
    const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const value: unknown = JSON.parse(decrypted.toString("utf8"));
    return parsePlaintext(value, envelope.storeId, expectedWalletCount);
  } catch {
    throw new Error("Unable to decrypt wallet store: wrong password or file integrity failure.");
  } finally {
    key.fill(0);
  }
}

function newPlaintext(walletCount: number): WalletStorePlaintext {
  const storeId = randomUUID();
  const wallets = Array.from({ length: walletCount }, (_, index) => {
    const wallet = Wallet.createRandom();
    return { index, address: wallet.address, privateKey: wallet.privateKey };
  });
  return { formatVersion: FORMAT_VERSION, storeId, walletCount, wallets };
}

async function writeEncrypted(
  filePath: string,
  plaintext: WalletStorePlaintext,
  password: string,
  hooks?: AtomicWriteHooks,
): Promise<void> {
  await assertSafeExternalFilePath(filePath, WALLET_STORE_SUFFIX);
  const envelope = await encrypt(plaintext, password);
  await atomicWritePrivateFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, hooks);
}

export function readWalletStorePathFromEnvironment(env: NodeJS.ProcessEnv): string {
  const value = env.OPERATOR_WALLET_STORE_PATH?.trim();
  if (!value) throw new Error("OPERATOR_WALLET_STORE_PATH is required.");
  return value;
}

export async function openEncryptedWalletProviderFromEnvironment(input: {
  env: NodeJS.ProcessEnv;
  passwordReader: InteractivePasswordReader;
  walletCount: number;
  provider: Provider;
}): Promise<EncryptedWalletProvider> {
  const filePath = readWalletStorePathFromEnvironment(input.env);
  const password = await input.passwordReader.readPassword("Operator wallet store password: ");
  return EncryptedWalletProvider.openOrCreate({
    filePath,
    password,
    walletCount: input.walletCount,
    provider: input.provider,
  });
}

export async function inspectExistingEncryptedWalletStore(input: {
  filePath: string;
  password: string;
  expectedWalletCount?: number;
}): Promise<EncryptedWalletStoreInspection> {
  assertPassword(input.password);
  if (input.expectedWalletCount !== undefined) assertWalletCount(input.expectedWalletCount);
  const filePath = await assertSafeExternalFilePath(input.filePath, WALLET_STORE_SUFFIX);
  if (!(await pathIsRegularFile(filePath))) {
    throw new Error("Encrypted wallet store does not exist; read-only inspection will not create it.");
  }

  let parsed: unknown;
  let serialized: string;
  try {
    serialized = await readFile(filePath, "utf8");
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Wallet store file is incomplete or invalid JSON.");
  }
  const plaintext = await decrypt(
    parseEnvelope(parsed),
    input.password,
    input.expectedWalletCount,
  );
  return {
    formatVersion: FORMAT_VERSION,
    storeId: plaintext.storeId,
    walletCount: plaintext.walletCount,
    addresses: plaintext.wallets.map((wallet) => wallet.address),
    fingerprint: `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`,
  };
}

export async function createEncryptedWalletStoreFile(
  input: CreateEncryptedWalletStoreOptions,
): Promise<EncryptedWalletStoreInspection> {
  assertPassword(input.password);
  assertWalletCount(input.walletCount);
  const filePath = await assertSafeExternalFilePath(input.filePath, WALLET_STORE_SUFFIX);

  return withExclusiveFileLock(filePath, async () => {
    if (await pathIsRegularFile(filePath)) {
      throw new Error("Encrypted wallet store already exists; creation will not overwrite it.");
    }

    const temporaryPath = join(
      dirname(filePath),
      `.${basename(filePath)}.${randomUUID()}.validation${WALLET_STORE_SUFFIX}`,
    );
    let renamed = false;
    try {
      const plaintext = newPlaintext(input.walletCount);
      await writeEncrypted(temporaryPath, plaintext, input.password, input.hooks);
      const validated = await inspectExistingEncryptedWalletStore({
        filePath: temporaryPath,
        password: input.password,
        expectedWalletCount: input.walletCount,
      });
      if (
        validated.storeId !== plaintext.storeId ||
        validated.walletCount !== plaintext.walletCount ||
        validated.addresses.some(
          (address, index) => address.toLowerCase() !== plaintext.wallets[index].address.toLowerCase(),
        )
      ) {
        throw new Error("Encrypted wallet store validation failed before final rename.");
      }
      if (await pathIsRegularFile(filePath)) {
        throw new Error("Encrypted wallet store target appeared during creation; refusing to overwrite it.");
      }
      await rename(temporaryPath, filePath);
      renamed = true;
      return inspectExistingEncryptedWalletStore({
        filePath,
        password: input.password,
        expectedWalletCount: input.walletCount,
      });
    } finally {
      if (!renamed) {
        await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  });
}

export class EncryptedWalletProvider implements OperatorWalletProvider {
  readonly kind = "external-encrypted" as const;
  readonly supportsProcessRestart = true;
  private readonly walletsByAddress: Map<string, OperatorWallet>;

  private constructor(
    private readonly filePath: string,
    private readonly plaintext: WalletStorePlaintext | undefined,
    private readonly wallets: readonly OperatorWallet[],
  ) {
    this.walletsByAddress = new Map(
      wallets.map((wallet) => [wallet.address.toLowerCase(), wallet]),
    );
  }

  static async openOrCreate(options: EncryptedWalletStoreOptions): Promise<EncryptedWalletProvider> {
    assertPassword(options.password);
    assertWalletCount(options.walletCount);
    const filePath = await assertSafeExternalFilePath(options.filePath, WALLET_STORE_SUFFIX);

    let plaintext: WalletStorePlaintext;
    if (await pathIsRegularFile(filePath)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        throw new Error("Wallet store file is incomplete or invalid JSON.");
      }
      plaintext = await decrypt(parseEnvelope(parsed), options.password, options.walletCount);
    } else {
      plaintext = await withExclusiveFileLock(filePath, async () => {
        if (await pathIsRegularFile(filePath)) {
          const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
          return decrypt(parseEnvelope(parsed), options.password, options.walletCount);
        } else {
          const created = newPlaintext(options.walletCount);
          await writeEncrypted(filePath, created, options.password, options.hooks);
          return created;
        }
      });
    }

    const wallets = plaintext.wallets.map(
      (wallet) => new Wallet(wallet.privateKey, options.provider),
    );
    return new EncryptedWalletProvider(filePath, plaintext, wallets);
  }

  static async openExistingSelected(
    options: EncryptedWalletStoreOptions & { walletIndices: readonly number[] },
  ): Promise<EncryptedWalletProvider> {
    assertPassword(options.password);
    assertWalletCount(options.walletCount);
    const filePath = await assertSafeExternalFilePath(options.filePath, WALLET_STORE_SUFFIX);
    if (!(await pathIsRegularFile(filePath))) {
      throw new Error("Wallet store does not exist; write pilot will not create it.");
    }
    const uniqueIndices = [...new Set(options.walletIndices)];
    if (
      uniqueIndices.length !== options.walletIndices.length ||
      uniqueIndices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= options.walletCount)
    ) {
      throw new Error("Selected wallet indices must be unique and within the existing store.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      throw new Error("Wallet store file is incomplete or invalid JSON.");
    }
    const plaintext = await decrypt(parseEnvelope(parsed), options.password, options.walletCount);
    const wallets = uniqueIndices.map((index) =>
      new Wallet(plaintext.wallets[index].privateKey, options.provider),
    );
    return new EncryptedWalletProvider(filePath, undefined, wallets);
  }

  listWallets(): readonly OperatorWallet[] {
    return this.wallets;
  }

  findWallet(address: string): OperatorWallet | undefined {
    return this.walletsByAddress.get(address.toLowerCase());
  }

  async reencrypt(password: string, hooks?: AtomicWriteHooks): Promise<void> {
    assertPassword(password);
    const plaintext = this.plaintext;
    if (!plaintext) {
      throw new Error("A selected signer view cannot reencrypt the complete wallet store.");
    }
    await withExclusiveFileLock(this.filePath, () =>
      writeEncrypted(this.filePath, plaintext, password, hooks),
    );
  }
}
