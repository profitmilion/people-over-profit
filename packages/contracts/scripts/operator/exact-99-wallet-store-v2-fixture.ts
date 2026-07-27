import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { assertSafeExternalFilePath } from "./durable-file.js";

export const EXACT_99_WALLET_STORE_V2_FIXTURE_SUFFIX =
  ".fixture-wallet-store-v2.enc.json";
export const EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE =
  "fixture-only-never-use-for-real-wallets";

const FORMAT_VERSION = 2;
const WALLET_COUNT = 99;
const CIPHER = "aes-256-gcm";
const KDF = "scrypt-fixture";
const KDF_N = 1_024;
const KDF_R = 8;
const KDF_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const REAL_KEY_SHAPE = /^(?:0x)?[0-9a-fA-F]{64}$/;

export interface Exact99WalletStoreV2FixtureRecordInput {
  index: number;
  address: string;
  fixtureKeyMaterial: string;
}

export interface Exact99WalletStoreV2EncryptedRecord {
  index: number;
  address: string;
  salt: string;
  iv: string;
  authenticationTag: string;
  ciphertext: string;
  recordDigest: string;
}

export interface Exact99WalletStoreV2FixtureEnvelope {
  formatVersion: 2;
  purpose: typeof EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE;
  storeId: string;
  walletCount: 99;
  cipher: typeof CIPHER;
  kdf: typeof KDF;
  kdfParameters: {
    n: number;
    r: number;
    p: number;
  };
  orderDigest: string;
  recordsDigest: string;
  records: Exact99WalletStoreV2EncryptedRecord[];
  integrityDigest: string;
  createdAt: string;
}

export interface Exact99WalletStoreV2FixtureInspection {
  formatVersion: 2;
  fixtureOnly: true;
  storeId: string;
  walletCount: 99;
  addresses: string[];
  orderDigest: string;
  recordsDigest: string;
  integrityDigest: string;
  fileFingerprint: string | null;
}

export interface Exact99WalletStoreV2SelectedFixtureRecord {
  fixtureOnly: true;
  storeId: string;
  index: number;
  address: string;
  fixtureKeyMaterial: string;
}

export interface Exact99WalletStoreV2FixtureBinding {
  storeId: string;
  orderDigest: string;
  integrityDigest: string;
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

function deriveFixtureKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: KDF_N, r: KDF_R, p: KDF_P, maxmem: 16 * 1024 * 1024 },
      (error, key) => error ? rejectPromise(error) : resolvePromise(key as Buffer),
    );
  });
}

function assertFixturePassword(password: string): void {
  if (password.length < 12 || !password.includes("fixture")) {
    throw new Error("The v2 prototype accepts only an explicitly labelled fixture password.");
  }
}

function assertFixtureMaterial(value: string): void {
  if (!value.startsWith("fixture-only:") || value.length < 20 || REAL_KEY_SHAPE.test(value)) {
    throw new Error("Store v2 prototype accepts fixture key material only.");
  }
}

function assertRecordInputs(
  records: readonly Exact99WalletStoreV2FixtureRecordInput[],
): void {
  if (records.length !== WALLET_COUNT) {
    throw new Error("Exact-99 store v2 fixture requires exactly 99 records.");
  }
  const addresses = new Set<string>();
  records.forEach((record, index) => {
    if (record.index !== index) throw new Error("Fixture record indexes must be contiguous and ordered.");
    if (!ADDRESS.test(record.address)) throw new Error(`Fixture record ${index} address is invalid.`);
    const normalized = record.address.toLowerCase();
    if (addresses.has(normalized)) throw new Error("Fixture store contains a duplicate address.");
    addresses.add(normalized);
    assertFixtureMaterial(record.fixtureKeyMaterial);
  });
}

function base64(value: unknown, length: number | null, label: string): Buffer {
  if (typeof value !== "string" || !BASE64.test(value)) throw new Error(`${label} is not base64.`);
  const buffer = Buffer.from(value, "base64");
  if (length !== null && buffer.length !== length) throw new Error(`${label} has an invalid length.`);
  return buffer;
}

function recordDigest(record: Omit<Exact99WalletStoreV2EncryptedRecord, "recordDigest">): string {
  return digest(record);
}

function envelopeIntegrity(input: Omit<Exact99WalletStoreV2FixtureEnvelope, "integrityDigest">): string {
  return digest(input);
}

async function encryptFixtureRecord(input: {
  storeId: string;
  record: Exact99WalletStoreV2FixtureRecordInput;
  password: string;
}): Promise<Exact99WalletStoreV2EncryptedRecord> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveFixtureKey(input.password, salt);
  try {
    const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_LENGTH });
    const plaintext = Buffer.from(JSON.stringify({
      purpose: EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE,
      storeId: input.storeId,
      index: input.record.index,
      address: input.record.address,
      fixtureKeyMaterial: input.record.fixtureKeyMaterial,
    }), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const withoutDigest = {
      index: input.record.index,
      address: input.record.address,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    return { ...withoutDigest, recordDigest: recordDigest(withoutDigest) };
  } finally {
    key.fill(0);
  }
}

export async function buildExact99WalletStoreV2Fixture(input: {
  records: readonly Exact99WalletStoreV2FixtureRecordInput[];
  fixturePassword: string;
  createdAt: string;
  storeId?: string;
}): Promise<Exact99WalletStoreV2FixtureEnvelope> {
  assertFixturePassword(input.fixturePassword);
  assertRecordInputs(input.records);
  if (Number.isNaN(Date.parse(input.createdAt))) throw new Error("Fixture store timestamp is invalid.");
  const storeId = input.storeId ?? randomUUID();
  if (!UUID.test(storeId)) throw new Error("Fixture store ID must be a UUID.");
  const records: Exact99WalletStoreV2EncryptedRecord[] = [];
  for (const record of input.records) {
    records.push(await encryptFixtureRecord({
      storeId,
      record,
      password: input.fixturePassword,
    }));
  }
  const orderDigest = digest(records.map((record) => ({
    index: record.index,
    address: record.address.toLowerCase(),
  })));
  const recordsDigest = digest(records.map((record) => record.recordDigest));
  const withoutIntegrity: Omit<Exact99WalletStoreV2FixtureEnvelope, "integrityDigest"> = {
    formatVersion: FORMAT_VERSION,
    purpose: EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE,
    storeId,
    walletCount: WALLET_COUNT,
    cipher: CIPHER,
    kdf: KDF,
    kdfParameters: { n: KDF_N, r: KDF_R, p: KDF_P },
    orderDigest,
    recordsDigest,
    records,
    createdAt: input.createdAt,
  };
  return { ...withoutIntegrity, integrityDigest: envelopeIntegrity(withoutIntegrity) };
}

export function inspectExact99WalletStoreV2Fixture(
  value: Exact99WalletStoreV2FixtureEnvelope,
  serialized?: string,
): Exact99WalletStoreV2FixtureInspection {
  if (
    value.formatVersion !== 2 ||
    value.purpose !== EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE ||
    value.walletCount !== WALLET_COUNT ||
    value.cipher !== CIPHER ||
    value.kdf !== KDF ||
    value.kdfParameters.n !== KDF_N ||
    value.kdfParameters.r !== KDF_R ||
    value.kdfParameters.p !== KDF_P
  ) throw new Error("Unsupported or non-fixture store v2 envelope.");
  if (!UUID.test(value.storeId)) throw new Error("Fixture store ID is invalid.");
  if (!DIGEST.test(value.orderDigest) || !DIGEST.test(value.recordsDigest) ||
      !DIGEST.test(value.integrityDigest)) throw new Error("Fixture store digest is invalid.");
  if (value.records.length !== WALLET_COUNT) throw new Error("Fixture store has a missing record.");
  const addresses = new Set<string>();
  value.records.forEach((record, index) => {
    if (record.index !== index) throw new Error("Fixture store record order changed.");
    if (!ADDRESS.test(record.address)) throw new Error("Fixture store record address is invalid.");
    const normalized = record.address.toLowerCase();
    if (addresses.has(normalized)) throw new Error("Fixture store contains a duplicate address.");
    addresses.add(normalized);
    base64(record.salt, SALT_LENGTH, `records[${index}].salt`);
    base64(record.iv, IV_LENGTH, `records[${index}].iv`);
    base64(record.authenticationTag, TAG_LENGTH, `records[${index}].authenticationTag`);
    base64(record.ciphertext, null, `records[${index}].ciphertext`);
    const { recordDigest: storedDigest, ...withoutDigest } = record;
    if (recordDigest(withoutDigest) !== storedDigest) {
      throw new Error(`Fixture store record ${index} was changed.`);
    }
  });
  const expectedOrder = digest(value.records.map((record) => ({
    index: record.index,
    address: record.address.toLowerCase(),
  })));
  if (expectedOrder !== value.orderDigest) throw new Error("Fixture store order digest mismatch.");
  if (digest(value.records.map((record) => record.recordDigest)) !== value.recordsDigest) {
    throw new Error("Fixture store records digest mismatch.");
  }
  const { integrityDigest, ...withoutIntegrity } = value;
  if (envelopeIntegrity(withoutIntegrity) !== integrityDigest) {
    throw new Error("Fixture store whole-set integrity mismatch.");
  }
  return {
    formatVersion: 2,
    fixtureOnly: true,
    storeId: value.storeId,
    walletCount: 99,
    addresses: value.records.map((record) => record.address),
    orderDigest: value.orderDigest,
    recordsDigest: value.recordsDigest,
    integrityDigest: value.integrityDigest,
    fileFingerprint: serialized === undefined
      ? null
      : `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`,
  };
}

export function verifyExact99WalletStoreV2FixtureBinding(input: {
  inspection: Exact99WalletStoreV2FixtureInspection;
  expected: Exact99WalletStoreV2FixtureBinding;
}): void {
  if (
    input.inspection.storeId !== input.expected.storeId ||
    input.inspection.orderDigest !== input.expected.orderDigest ||
    input.inspection.integrityDigest !== input.expected.integrityDigest
  ) {
    throw new Error("Fixture store v2 does not match its external manifest binding.");
  }
}

export async function openSelectedExact99WalletStoreV2FixtureRecord(input: {
  envelope: Exact99WalletStoreV2FixtureEnvelope;
  index: number;
  fixturePassword: string;
}): Promise<Exact99WalletStoreV2SelectedFixtureRecord> {
  assertFixturePassword(input.fixturePassword);
  inspectExact99WalletStoreV2Fixture(input.envelope);
  if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= WALLET_COUNT) {
    throw new Error("Selected fixture record index is outside 0..98.");
  }
  const record = input.envelope.records[input.index];
  const salt = base64(record.salt, SALT_LENGTH, "selected record salt");
  const iv = base64(record.iv, IV_LENGTH, "selected record IV");
  const tag = base64(record.authenticationTag, TAG_LENGTH, "selected record authentication tag");
  const ciphertext = base64(record.ciphertext, null, "selected record ciphertext");
  const key = await deriveFixtureKey(input.fixturePassword, salt);
  try {
    const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    if (
      plaintext.purpose !== EXACT_99_WALLET_STORE_V2_FIXTURE_PURPOSE ||
      plaintext.storeId !== input.envelope.storeId ||
      plaintext.index !== input.index ||
      plaintext.address !== record.address ||
      typeof plaintext.fixtureKeyMaterial !== "string"
    ) throw new Error("Selected fixture record identity mismatch.");
    assertFixtureMaterial(plaintext.fixtureKeyMaterial);
    return {
      fixtureOnly: true,
      storeId: input.envelope.storeId,
      index: input.index,
      address: record.address,
      fixtureKeyMaterial: plaintext.fixtureKeyMaterial,
    };
  } catch {
    throw new Error("Unable to decrypt selected fixture record or verify its integrity.");
  } finally {
    key.fill(0);
  }
}

async function assertFixtureFilePath(filePath: string): Promise<string> {
  return assertSafeExternalFilePath(filePath, EXACT_99_WALLET_STORE_V2_FIXTURE_SUFFIX);
}

export async function createExact99WalletStoreV2FixtureFile(input: {
  filePath: string;
  envelope: Exact99WalletStoreV2FixtureEnvelope;
}): Promise<Exact99WalletStoreV2FixtureInspection> {
  inspectExact99WalletStoreV2Fixture(input.envelope);
  const filePath = await assertFixtureFilePath(input.filePath);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(input.envelope, null, 2)}\n`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let linked = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporaryPath, filePath);
    linked = true;
    await chmod(filePath, 0o600).catch((error: NodeJS.ErrnoException) => {
      if (process.platform !== "win32") throw error;
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Fixture store v2 already exists; create-only mode refuses overwrite.");
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  if (!linked) throw new Error("Fixture store v2 create-only write did not complete.");
  return readAndInspectExact99WalletStoreV2FixtureFile(filePath);
}

export async function readAndInspectExact99WalletStoreV2FixtureFile(
  filePathInput: string,
): Promise<Exact99WalletStoreV2FixtureInspection> {
  const filePath = await assertFixtureFilePath(filePathInput);
  let serialized: string;
  let parsed: unknown;
  try {
    serialized = await readFile(filePath, "utf8");
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Fixture store v2 file is missing, incomplete, or invalid JSON.");
  }
  return inspectExact99WalletStoreV2Fixture(
    parsed as Exact99WalletStoreV2FixtureEnvelope,
    serialized,
  );
}

export function describeExact99WalletStoreV2Migration(): {
  implemented: false;
  requiresSeparateAuthorization: true;
  reason: string;
} {
  return {
    implemented: false,
    requiresSeparateAuthorization: true,
    reason: "Migration from store v1 is intentionally deferred and must never run implicitly.",
  };
}
