import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import { getAddress, isAddress } from "ethers";

export type WalletStage =
  | "discovered"
  | "funded"
  | "dripped"
  | "approved"
  | "joined"
  | "withdrawn"
  | "winner"
  | "claimed";

export interface TransactionCheckpoint {
  operation: Exclude<WalletStage, "discovered" | "winner"> | "draw";
  hash: string;
  blockNumber: number;
  receiptStatus: number;
  nonce: number;
}

export interface WalletCheckpoint {
  index: number;
  address: string;
  stage: WalletStage;
  nativeBalance: string;
  tokenBalance: string;
  allowance: string;
  activePositionId: string;
  poolId: string;
  winningRounds: number[];
  claimedRounds: number[];
  transactions: TransactionCheckpoint[];
}

export interface OperatorCheckpoint {
  schemaVersion: 1;
  revision: number;
  chainId: string;
  tokenAddress: string;
  contractAddress: string;
  poolId: string;
  poolStatus: string;
  activePositionCount: string;
  escrowedAmount: string;
  completedDrawRoundCount: string;
  claimedPrizeCount: string;
  updatedAt: string;
  operatorTransactions: TransactionCheckpoint[];
  wallets: WalletCheckpoint[];
}

export interface CheckpointStore {
  load(): Promise<OperatorCheckpoint | undefined>;
  save(checkpoint: OperatorCheckpoint): Promise<void>;
}

const CHECKPOINT_SUFFIX = ".operator-checkpoint.json";
const FORBIDDEN_CHECKPOINT_KEY =
  /private.?key|mnemonic|seed|password|passphrase|keystore|secret/i;
const CREDENTIAL_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i;
const PEM_PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const SECRET_LABEL =
  /\b(?:mnemonic|seed phrase|private key|secret key|keystore|password|passphrase)\b/i;
const KEYSTORE_STRUCTURE =
  /(?:UTC--|"crypto"\s*:|"cipher"\s*:|"ciphertext"\s*:|"kdf"\s*:|\bscrypt\b|\bpbkdf2\b)/i;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_KEY_SHAPE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/;
const WALLET_STAGES = new Set<WalletStage>([
  "discovered",
  "funded",
  "dripped",
  "approved",
  "joined",
  "withdrawn",
  "winner",
  "claimed",
]);
const TRANSACTION_OPERATIONS = new Set<TransactionCheckpoint["operation"]>([
  "funded",
  "dripped",
  "approved",
  "joined",
  "withdrawn",
  "claimed",
  "draw",
]);

const CHECKPOINT_KEYS = [
  "schemaVersion",
  "revision",
  "chainId",
  "tokenAddress",
  "contractAddress",
  "poolId",
  "poolStatus",
  "activePositionCount",
  "escrowedAmount",
  "completedDrawRoundCount",
  "claimedPrizeCount",
  "updatedAt",
  "operatorTransactions",
  "wallets",
] as const;
const WALLET_KEYS = [
  "index",
  "address",
  "stage",
  "nativeBalance",
  "tokenBalance",
  "allowance",
  "activePositionId",
  "poolId",
  "winningRounds",
  "claimedRounds",
  "transactions",
] as const;
const TRANSACTION_KEYS = [
  "operation",
  "hash",
  "blockNumber",
  "receiptStatus",
  "nonce",
] as const;

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const OPERATOR_WORKSPACE_ROOT = resolve(MODULE_DIRECTORY, "../../../..");

function isMnemonicShape(value: string): boolean {
  const words = value.trim().split(/\s+/);
  return (
    [12, 15, 18, 21, 24].includes(words.length) &&
    words.every((word) => /^[a-z]{2,}$/i.test(word))
  );
}

function assertNoSecretLikeString(value: string, path: string): void {
  if (
    CREDENTIAL_URL.test(value) ||
    PEM_PRIVATE_KEY.test(value) ||
    SECRET_LABEL.test(value) ||
    KEYSTORE_STRUCTURE.test(value) ||
    isMnemonicShape(value) ||
    (path.split(".").at(-1) !== "hash" && PRIVATE_KEY_SHAPE.test(value))
  ) {
    throw new Error(`${path} contains a forbidden secret-like value.`);
  }
}

export function assertCheckpointContainsNoSecretFields(
  value: unknown,
  path = "checkpoint",
): void {
  if (typeof value === "string") {
    assertNoSecretLikeString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertCheckpointContainsNoSecretFields(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_CHECKPOINT_KEY.test(key)) {
      throw new Error(`Checkpoint field '${key}' is forbidden.`);
    }
    assertCheckpointContainsNoSecretFields(nestedValue, `${path}.${key}`);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = requireRecord(value, path);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) throw new Error(`${path}.${key} is not allowed.`);
  }
  for (const key of allowedKeys) {
    if (!(key in record)) throw new Error(`${path}.${key} is required.`);
  }
  return record;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  return value;
}

function requireSafeInteger(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requireDecimal(
  value: unknown,
  path: string,
  minimum = 0n,
  maximum = (1n << 256n) - 1n,
): bigint {
  const text = requireString(value, path);
  if (!DECIMAL_INTEGER.test(text)) throw new Error(`${path} must be an unsigned decimal integer.`);
  const parsed = BigInt(text);
  if (parsed < minimum || parsed > maximum) throw new Error(`${path} is outside the allowed range.`);
  return parsed;
}

function requireAddress(value: unknown, path: string): string {
  const address = requireString(value, path);
  if (!isAddress(address)) throw new Error(`${path} must be a valid EVM address.`);
  return getAddress(address);
}

function requireIsoTimestamp(value: unknown, path: string): string {
  const timestamp = requireString(value, path);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`${path} must be an ISO timestamp.`);
  }
  return timestamp;
}

function requireRoundArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  const rounds = value.map((round, index) => requireSafeInteger(round, `${path}[${index}]`, 1, 10));
  if (new Set(rounds).size !== rounds.length) throw new Error(`${path} must contain unique rounds.`);
  return rounds;
}

function assertTransactionSchema(
  value: unknown,
  path: string,
  allowedOperations: ReadonlySet<TransactionCheckpoint["operation"]>,
  seenHashes: Set<string>,
): void {
  const transaction = assertExactKeys(value, TRANSACTION_KEYS, path);
  const operation = requireString(transaction.operation, `${path}.operation`);
  if (!TRANSACTION_OPERATIONS.has(operation as TransactionCheckpoint["operation"]) ||
      !allowedOperations.has(operation as TransactionCheckpoint["operation"])) {
    throw new Error(`${path}.operation is not allowed in this transaction list.`);
  }
  const hash = requireString(transaction.hash, `${path}.hash`);
  if (!TRANSACTION_HASH.test(hash)) throw new Error(`${path}.hash must be a 32-byte hex hash.`);
  const normalizedHash = hash.toLowerCase();
  if (seenHashes.has(normalizedHash)) throw new Error(`${path}.hash is duplicated.`);
  seenHashes.add(normalizedHash);
  requireSafeInteger(transaction.blockNumber, `${path}.blockNumber`);
  if (transaction.receiptStatus !== 1) throw new Error(`${path}.receiptStatus must equal 1.`);
  requireSafeInteger(transaction.nonce, `${path}.nonce`);
}

export function assertClosedCheckpointSchema(value: unknown): asserts value is OperatorCheckpoint {
  assertCheckpointContainsNoSecretFields(value);
  const checkpoint = assertExactKeys(value, CHECKPOINT_KEYS, "checkpoint");
  if (checkpoint.schemaVersion !== 1) throw new Error("checkpoint.schemaVersion must equal 1.");
  requireSafeInteger(checkpoint.revision, "checkpoint.revision");
  requireDecimal(checkpoint.chainId, "checkpoint.chainId", 1n);
  const tokenAddress = requireAddress(checkpoint.tokenAddress, "checkpoint.tokenAddress");
  const contractAddress = requireAddress(checkpoint.contractAddress, "checkpoint.contractAddress");
  if (tokenAddress === contractAddress) throw new Error("Checkpoint token and contract addresses must differ.");
  const poolId = requireDecimal(checkpoint.poolId, "checkpoint.poolId", 1n);
  const poolStatus = requireDecimal(checkpoint.poolStatus, "checkpoint.poolStatus");
  if (poolStatus > 4n) throw new Error("checkpoint.poolStatus is outside the PoolStatus enum.");
  requireDecimal(checkpoint.activePositionCount, "checkpoint.activePositionCount", 0n, 100n);
  requireDecimal(checkpoint.escrowedAmount, "checkpoint.escrowedAmount");
  const completed = requireDecimal(checkpoint.completedDrawRoundCount, "checkpoint.completedDrawRoundCount", 0n, 10n);
  const claimed = requireDecimal(checkpoint.claimedPrizeCount, "checkpoint.claimedPrizeCount", 0n, 10n);
  if (claimed > completed) throw new Error("checkpoint.claimedPrizeCount cannot exceed completed draws.");
  requireIsoTimestamp(checkpoint.updatedAt, "checkpoint.updatedAt");

  if (!Array.isArray(checkpoint.operatorTransactions)) {
    throw new Error("checkpoint.operatorTransactions must be an array.");
  }
  if (!Array.isArray(checkpoint.wallets)) throw new Error("checkpoint.wallets must be an array.");

  const seenHashes = new Set<string>();
  const drawOnly = new Set<TransactionCheckpoint["operation"]>(["draw"]);
  checkpoint.operatorTransactions.forEach((transaction, index) =>
    assertTransactionSchema(
      transaction,
      `checkpoint.operatorTransactions[${index}]`,
      drawOnly,
      seenHashes,
    ),
  );

  const walletOperations = new Set<TransactionCheckpoint["operation"]>([
    "dripped",
    "approved",
    "joined",
    "withdrawn",
    "claimed",
  ]);
  const walletAddresses = new Set<string>();
  checkpoint.wallets.forEach((wallet, index) => {
    const path = `checkpoint.wallets[${index}]`;
    const walletRecord = assertExactKeys(wallet, WALLET_KEYS, path);
    if (requireSafeInteger(walletRecord.index, `${path}.index`) !== index) {
      throw new Error(`${path}.index must match its array position.`);
    }
    const address = requireAddress(walletRecord.address, `${path}.address`).toLowerCase();
    if (walletAddresses.has(address)) throw new Error(`${path}.address is duplicated.`);
    walletAddresses.add(address);
    const stage = requireString(walletRecord.stage, `${path}.stage`);
    if (!WALLET_STAGES.has(stage as WalletStage)) throw new Error(`${path}.stage is not allowed.`);
    requireDecimal(walletRecord.nativeBalance, `${path}.nativeBalance`);
    requireDecimal(walletRecord.tokenBalance, `${path}.tokenBalance`);
    requireDecimal(walletRecord.allowance, `${path}.allowance`);
    requireDecimal(walletRecord.activePositionId, `${path}.activePositionId`);
    if (requireDecimal(walletRecord.poolId, `${path}.poolId`, 1n) !== poolId) {
      throw new Error(`${path}.poolId must match checkpoint.poolId.`);
    }
    requireRoundArray(walletRecord.winningRounds, `${path}.winningRounds`);
    requireRoundArray(walletRecord.claimedRounds, `${path}.claimedRounds`);
    if (!Array.isArray(walletRecord.transactions)) {
      throw new Error(`${path}.transactions must be an array.`);
    }
    walletRecord.transactions.forEach((transaction, transactionIndex) =>
      assertTransactionSchema(
        transaction,
        `${path}.transactions[${transactionIndex}]`,
        walletOperations,
        seenHashes,
      ),
    );
  });
}

function cloneCheckpoint(checkpoint: OperatorCheckpoint): OperatorCheckpoint {
  return structuredClone(checkpoint);
}

function normalizedPath(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizedPath(candidate);
  const normalizedParent = normalizedPath(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${sep}`)
  );
}

async function assertSafeCheckpointPath(filePath: string): Promise<string> {
  if (!isAbsolute(filePath)) throw new Error("Checkpoint path must be absolute.");
  if (!filePath.toLowerCase().endsWith(CHECKPOINT_SUFFIX)) {
    throw new Error(`Checkpoint path must end with ${CHECKPOINT_SUFFIX}.`);
  }
  const target = resolve(filePath);
  const workspace = await realpath(OPERATOR_WORKSPACE_ROOT);
  if (isInside(target, workspace)) throw new Error("Checkpoint path must be outside the workspace.");

  const root = parse(target).root;
  const segments = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`Checkpoint path crosses a symlink: ${current}`);
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw new Error(`Checkpoint parent path is not a directory: ${current}`);
      }
      const canonical = await realpath(current);
      if (normalizedPath(canonical) !== normalizedPath(current)) {
        throw new Error(`Checkpoint path crosses a redirected filesystem entry: ${current}`);
      }
      if (isInside(canonical, workspace)) {
        throw new Error("Checkpoint path resolves inside the workspace.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}

async function requireRegularFileIfPresent(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Checkpoint target must be a regular non-symlink file.");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class MemoryCheckpointStore implements CheckpointStore {
  private checkpoint?: OperatorCheckpoint;

  async load(): Promise<OperatorCheckpoint | undefined> {
    return this.checkpoint ? cloneCheckpoint(this.checkpoint) : undefined;
  }

  async save(checkpoint: OperatorCheckpoint): Promise<void> {
    assertClosedCheckpointSchema(checkpoint);
    this.checkpoint = cloneCheckpoint(checkpoint);
  }
}

export class JsonCheckpointStore implements CheckpointStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<OperatorCheckpoint | undefined> {
    const safePath = await assertSafeCheckpointPath(this.filePath);
    if (!(await requireRegularFileIfPresent(safePath))) return undefined;
    const parsed: unknown = JSON.parse(await readFile(safePath, "utf8"));
    assertClosedCheckpointSchema(parsed);
    return parsed;
  }

  async save(checkpoint: OperatorCheckpoint): Promise<void> {
    assertClosedCheckpointSchema(checkpoint);
    const safePath = await assertSafeCheckpointPath(this.filePath);
    const parent = dirname(safePath);
    await mkdir(parent, { recursive: true });
    await assertSafeCheckpointPath(safePath);

    if (await requireRegularFileIfPresent(safePath)) {
      try {
        const existing: unknown = JSON.parse(await readFile(safePath, "utf8"));
        assertClosedCheckpointSchema(existing);
      } catch {
        throw new Error("Refusing to overwrite an existing file that is not a valid operator checkpoint.");
      }
    }

    const temporaryPath = join(parent, `.${randomUUID()}.operator-checkpoint.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let renamed = false;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, safePath);
      renamed = true;
    } finally {
      await handle?.close().catch(() => undefined);
      if (!renamed) {
        await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  }
}
