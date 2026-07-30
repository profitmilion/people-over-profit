import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

import { demoV1Abi } from "../../../../src/demo-v1/abi.js";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
} from "../../../../src/demo-v1/safety.js";
import { sanitizeOperatorError } from "./transaction-journal.js";
import {
  type DrawRoundSnapshot,
  type LifecycleSnapshotAdapter,
  type PoolSnapshot,
  type SystemSnapshot,
} from "./lifecycle-supervisor.js";
import { PUBLIC_OPERATOR_DEFAULT_RPC_URL } from "./base-sepolia-read-only-operator.js";
import {
  withReadOnlyRpcRetry,
  type ReadOnlyRpcRetryOptions,
} from "./read-only-rpc-retry.js";

export const LIFECYCLE_SUPERVISOR_BASE_SEPOLIA_CHAIN_ID = BigInt(DEMO_V1_CHAIN_ID);
export const LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS =
  DEMO_V1_CONTRACT_ADDRESS;
export const LIFECYCLE_SUPERVISOR_DEFAULT_RPC_URL =
  PUBLIC_OPERATOR_DEFAULT_RPC_URL;
export const LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS = 10_000;
export const LIFECYCLE_SUPERVISOR_DEPLOYMENT_BLOCK = 44_144_873n;

export type LifecycleSupervisorReadMethod =
  | "poolCount"
  | "getPool"
  | "getDrawRound";

export type LifecycleSupervisorAdapterErrorCode =
  | "RPC_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "WRONG_CHAIN"
  | "NO_CONTRACT_BYTECODE"
  | "ABI_METHOD_MISSING"
  | "DECODE_ERROR"
  | "MISSING_CONTRACT_ADDRESS"
  | "MISSING_DEPLOYMENT_BLOCK"
  | "PARTIAL_POOL_READ"
  | "INVALID_POOL_RANGE"
  | "INCONSISTENT_BLOCK";

export class LifecycleSupervisorAdapterError extends Error {
  override readonly name = "LifecycleSupervisorAdapterError";

  constructor(
    readonly code: LifecycleSupervisorAdapterErrorCode,
    message: string,
    readonly context: {
      method: string | null;
      poolId: bigint | null;
      blockNumber: bigint | null;
      canContinue: false;
      snapshotComplete: false;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface LifecycleSupervisorPublicClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: {
    blockNumber: bigint;
  }): Promise<{ number: bigint; timestamp: bigint } | null>;
  getBytecode(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined>;
  readContract(input: {
    address: Address;
    abi: typeof demoV1Abi;
    functionName: LifecycleSupervisorReadMethod;
    args?: readonly bigint[];
    blockNumber: bigint;
  }): Promise<unknown>;
}

export interface LifecycleSupervisorPoolRange {
  fromPoolId: bigint;
  toPoolId: bigint;
}

export interface BaseSepoliaLifecycleSnapshotAdapterOptions {
  client: LifecycleSupervisorPublicClient;
  rpcHost: string;
  contractAddress?: string;
  blockNumber?: bigint;
  poolRange?: LifecycleSupervisorPoolRange;
  retryOptions?: ReadOnlyRpcRetryOptions;
  maxPoolReads?: number;
}

function adapterError(
  code: LifecycleSupervisorAdapterErrorCode,
  message: string,
  input: {
    method?: string;
    poolId?: bigint;
    blockNumber?: bigint;
    cause?: unknown;
  } = {},
): LifecycleSupervisorAdapterError {
  return new LifecycleSupervisorAdapterError(
    code,
    message,
    {
      method: input.method ?? null,
      poolId: input.poolId ?? null,
      blockNumber: input.blockNumber ?? null,
      canContinue: false,
      snapshotComplete: false,
    },
    input.cause === undefined ? undefined : { cause: input.cause },
  );
}

export function validateLifecycleSupervisorRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw adapterError(
      "RPC_UNAVAILABLE",
      "Base Sepolia supervisor RPC URL must be a valid URL.",
    );
  }
  if (url.protocol !== "https:") {
    throw adapterError(
      "RPC_UNAVAILABLE",
      "Base Sepolia supervisor RPC URL must use HTTPS.",
    );
  }
  if (url.username || url.password) {
    throw adapterError(
      "RPC_UNAVAILABLE",
      "Base Sepolia supervisor RPC URL must not contain URL credentials.",
    );
  }
  return value;
}

export function redactLifecycleSupervisorRpcUrl(value: string): string {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "invalid-rpc-host";
  }
}

export function validateLifecycleSupervisorContractAddress(value: string): Address {
  if (!value.trim()) {
    throw adapterError(
      "MISSING_CONTRACT_ADDRESS",
      "Base Sepolia supervisor contract address is missing.",
    );
  }
  if (!isAddress(value)) {
    throw adapterError(
      "MISSING_CONTRACT_ADDRESS",
      "Base Sepolia supervisor contract address is invalid.",
    );
  }
  const address = getAddress(value);
  if (address === zeroAddress) {
    throw adapterError(
      "MISSING_CONTRACT_ADDRESS",
      "Base Sepolia supervisor contract address must not be the zero address.",
    );
  }
  return address;
}

export function validateLifecycleSupervisorTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60_000) {
    throw adapterError(
      "RPC_TIMEOUT",
      "Base Sepolia supervisor timeout must be an integer between 1000 and 60000 milliseconds.",
    );
  }
  return value;
}

export function requireLifecycleSupervisorDeploymentBlock(
  value: bigint | undefined,
): bigint {
  if (value === undefined || value <= 0n) {
    throw adapterError(
      "MISSING_DEPLOYMENT_BLOCK",
      "A positive deployment block is required before any bounded event-log scan.",
    );
  }
  return value;
}

function createBaseSepoliaPublicClient(rpcUrl: string, timeoutMs: number) {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl, {
      retryCount: 0,
      timeout: timeoutMs,
    }),
  });
}

export class ViemLifecycleSupervisorPublicClient
implements LifecycleSupervisorPublicClient {
  readonly #client: ReturnType<typeof createBaseSepoliaPublicClient>;

  constructor(rpcUrl: string, timeoutMs = LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS) {
    const validatedUrl = validateLifecycleSupervisorRpcUrl(rpcUrl);
    const validatedTimeout = validateLifecycleSupervisorTimeout(timeoutMs);
    this.#client = createBaseSepoliaPublicClient(
      validatedUrl,
      validatedTimeout,
    );
  }

  getChainId(): Promise<number> {
    return this.#client.getChainId();
  }

  getBlockNumber(): Promise<bigint> {
    return this.#client.getBlockNumber();
  }

  async getBlock(input: {
    blockNumber: bigint;
  }): Promise<{ number: bigint; timestamp: bigint } | null> {
    const block = await this.#client.getBlock({
      blockNumber: input.blockNumber,
      includeTransactions: false,
    });
    return {
      number: block.number,
      timestamp: block.timestamp,
    };
  }

  getBytecode(input: {
    address: Address;
    blockNumber: bigint;
  }): Promise<Hex | undefined> {
    return this.#client.getBytecode(input);
  }

  readContract(input: {
    address: Address;
    abi: typeof demoV1Abi;
    functionName: LifecycleSupervisorReadMethod;
    args?: readonly bigint[];
    blockNumber: bigint;
  }): Promise<unknown> {
    if (input.functionName === "poolCount") {
      return this.#client.readContract({
        address: input.address,
        abi: input.abi,
        functionName: "poolCount",
        blockNumber: input.blockNumber,
      });
    }
    if (input.functionName === "getPool") {
      return this.#client.readContract({
        address: input.address,
        abi: input.abi,
        functionName: "getPool",
        args: [input.args?.[0] ?? 0n],
        blockNumber: input.blockNumber,
      });
    }
    return this.#client.readContract({
      address: input.address,
      abi: input.abi,
      functionName: "getDrawRound",
      args: [input.args?.[0] ?? 0n, input.args?.[1] ?? 0n],
      blockNumber: input.blockNumber,
    });
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function bigintField(
  value: Record<string, unknown> | null,
  name: string,
): bigint | undefined {
  const field = value?.[name];
  return typeof field === "bigint" ? field : undefined;
}

function booleanField(
  value: Record<string, unknown> | null,
  name: string,
): boolean | undefined {
  const field = value?.[name];
  return typeof field === "boolean" ? field : undefined;
}

function addressField(
  value: Record<string, unknown> | null,
  name: string,
): string | undefined {
  const field = value?.[name];
  return typeof field === "string" && isAddress(field)
    ? getAddress(field)
    : undefined;
}

function numericEnumField(
  value: Record<string, unknown> | null,
  name: string,
): bigint | undefined {
  const field = value?.[name];
  if (typeof field === "bigint") return field;
  if (typeof field === "number" && Number.isSafeInteger(field) && field >= 0) {
    return BigInt(field);
  }
  return undefined;
}

function poolStatus(value: bigint | undefined): string {
  if (value === undefined) return "Unknown(missing)";
  return ["Open", "Locked", "Drawing", "Claimable", "Finished"][Number(value)] ??
    `Unknown(${value})`;
}

function roundStatus(value: bigint | undefined): string {
  if (value === undefined) return "Unknown(missing)";
  return ["Pending", "Finalized"][Number(value)] ?? `Unknown(${value})`;
}

function decodePool(
  poolId: bigint,
  blockNumber: bigint,
  value: unknown,
): PoolSnapshot {
  const data = record(value);
  const returnedId = bigintField(data, "id");
  if (returnedId !== undefined && returnedId !== poolId) {
    throw adapterError(
      "DECODE_ERROR",
      `POP33.getPool(${poolId}) returned pool ID ${returnedId}.`,
      { method: "getPool", poolId, blockNumber },
    );
  }
  return {
    poolId,
    status: poolStatus(numericEnumField(data, "status")),
    activePositionCount: bigintField(data, "activePositionCount"),
    escrowedAmount: bigintField(data, "escrowedAmount"),
    openedAt: bigintField(data, "openedAt"),
    lockedAt: bigintField(data, "lockedAt"),
    drawInterval: bigintField(data, "drawInterval"),
    entryPrice: bigintField(data, "entryPrice"),
    prizePerRound: bigintField(data, "prizePerRound"),
    totalPrizeAmount: bigintField(data, "totalPrizeAmount"),
    maxPositionCount: bigintField(data, "positionsPerPool"),
    drawRoundCount: bigintField(data, "drawRoundCount"),
    completedDrawRoundCount: bigintField(data, "completedDrawRoundCount"),
    claimedPrizeCount: bigintField(data, "claimedPrizeCount"),
    assignedPrizeAmount: bigintField(data, "assignedPrizeAmount"),
    claimedPrizeAmount: bigintField(data, "claimedPrizeAmount"),
    rounds: [],
  };
}

function decodeRound(value: unknown): DrawRoundSnapshot {
  const data = record(value);
  return {
    number: bigintField(data, "number"),
    scheduledAt: bigintField(data, "scheduledAt"),
    executedAt: bigintField(data, "executedAt"),
    status: roundStatus(numericEnumField(data, "status")),
    winningPositionId: bigintField(data, "winningPositionId"),
    winner: addressField(data, "winner"),
    prizeAmount: bigintField(data, "prizeAmount"),
    temporaryRequestId: bigintField(data, "temporaryRequestId"),
    claimed: booleanField(data, "claimed"),
  };
}

const REQUIRED_POOL_FIELDS = [
  "activePositionCount",
  "escrowedAmount",
  "openedAt",
  "lockedAt",
  "drawInterval",
  "entryPrice",
  "prizePerRound",
  "totalPrizeAmount",
  "maxPositionCount",
  "drawRoundCount",
  "completedDrawRoundCount",
  "claimedPrizeCount",
  "assignedPrizeAmount",
  "claimedPrizeAmount",
] as const;

const REQUIRED_ROUND_FIELDS = [
  "number",
  "scheduledAt",
  "executedAt",
  "status",
  "winningPositionId",
  "winner",
  "prizeAmount",
  "temporaryRequestId",
  "claimed",
] as const;

function poolIsComplete(pool: PoolSnapshot): boolean {
  if (pool.status === "Unknown(missing)") return false;
  if (!REQUIRED_POOL_FIELDS.every((field) => pool[field] !== undefined)) {
    return false;
  }
  return pool.rounds.every((round) =>
    REQUIRED_ROUND_FIELDS.every((field) => round[field] !== undefined));
}

function classifyReadError(error: unknown): LifecycleSupervisorAdapterErrorCode {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(`${name} ${message}`)) return "RPC_TIMEOUT";
  if (/abi|function.*not found|unknown function/i.test(`${name} ${message}`)) {
    return "ABI_METHOD_MISSING";
  }
  return "RPC_UNAVAILABLE";
}

export class BaseSepoliaLifecycleSnapshotAdapter
implements LifecycleSnapshotAdapter {
  readonly source = "base-sepolia-read-only" as const;
  readonly #client: LifecycleSupervisorPublicClient;
  readonly #rpcHost: string;
  readonly #contractAddress: Address;
  readonly #blockNumber: bigint | undefined;
  readonly #poolRange: LifecycleSupervisorPoolRange | undefined;
  readonly #retryOptions: ReadOnlyRpcRetryOptions;
  readonly #maxPoolReads: number;

  constructor(options: BaseSepoliaLifecycleSnapshotAdapterOptions) {
    this.#client = options.client;
    this.#rpcHost = options.rpcHost;
    this.#contractAddress = validateLifecycleSupervisorContractAddress(
      options.contractAddress ?? LIFECYCLE_SUPERVISOR_CANONICAL_CONTRACT_ADDRESS,
    );
    this.#blockNumber = options.blockNumber;
    this.#poolRange = options.poolRange;
    this.#retryOptions = options.retryOptions ?? {};
    this.#maxPoolReads = options.maxPoolReads ?? 1_000;
    if (
      !Number.isSafeInteger(this.#maxPoolReads) ||
      this.#maxPoolReads < 1 ||
      this.#maxPoolReads > 10_000
    ) {
      throw adapterError(
        "INVALID_POOL_RANGE",
        "Maximum pool reads must be an integer between 1 and 10000.",
      );
    }
  }

  async #read<T>(
    label: string,
    operation: () => Promise<T>,
    context: {
      method?: string;
      poolId?: bigint;
      blockNumber?: bigint;
    } = {},
  ): Promise<T> {
    try {
      return await withReadOnlyRpcRetry(label, operation, this.#retryOptions);
    } catch (error) {
      if (error instanceof LifecycleSupervisorAdapterError) throw error;
      const code = classifyReadError(error);
      throw adapterError(
        code,
        `${label} failed; snapshot is incomplete and analysis cannot continue: ${sanitizeOperatorError(error)}`,
        { ...context, cause: error },
      );
    }
  }

  async #readContract(
    functionName: LifecycleSupervisorReadMethod,
    blockNumber: bigint,
    args?: readonly bigint[],
    poolId?: bigint,
  ): Promise<unknown> {
    return this.#read(
      `POP33.${functionName}${poolId === undefined ? "" : ` for pool ${poolId}`} at block ${blockNumber}`,
      () => this.#client.readContract({
        address: this.#contractAddress,
        abi: demoV1Abi,
        functionName,
        args,
        blockNumber,
      }),
      { method: functionName, poolId, blockNumber },
    );
  }

  #resolvePoolRange(
    poolCount: bigint,
    blockNumber: bigint,
  ): LifecycleSupervisorPoolRange {
    const range = this.#poolRange ?? {
      fromPoolId: 1n,
      toPoolId: poolCount,
    };
    const count = range.toPoolId - range.fromPoolId + 1n;
    if (
      poolCount <= 0n ||
      range.fromPoolId <= 0n ||
      range.toPoolId < range.fromPoolId ||
      range.toPoolId > poolCount ||
      count > BigInt(this.#maxPoolReads)
    ) {
      throw adapterError(
        "INVALID_POOL_RANGE",
        `Pool range ${range.fromPoolId}..${range.toPoolId} is invalid for poolCount ${poolCount} and maximum ${this.#maxPoolReads}.`,
        { method: "poolCount", blockNumber },
      );
    }
    return range;
  }

  async #readPool(poolId: bigint, blockNumber: bigint): Promise<PoolSnapshot> {
    const rawPool = await this.#readContract(
      "getPool",
      blockNumber,
      [poolId],
      poolId,
    );
    const pool = decodePool(poolId, blockNumber, rawPool);
    const roundCount = pool.drawRoundCount;
    if (roundCount === undefined || pool.status === "Open") return pool;
    if (roundCount > 1_000n) {
      throw adapterError(
        "DECODE_ERROR",
        `Pool ${poolId} exposes unsupported drawRoundCount ${roundCount}.`,
        { method: "getPool", poolId, blockNumber },
      );
    }

    const rounds: DrawRoundSnapshot[] = [];
    for (let roundNumber = 1n; roundNumber <= roundCount; roundNumber += 1n) {
      try {
        rounds.push(decodeRound(await this.#readContract(
          "getDrawRound",
          blockNumber,
          [poolId, roundNumber],
          poolId,
        )));
      } catch (error) {
        if (error instanceof LifecycleSupervisorAdapterError) {
          throw adapterError(
            "PARTIAL_POOL_READ",
            `Pool ${poolId} round ${roundNumber} could not be read at block ${blockNumber}; snapshot is incomplete.`,
            {
              method: "getDrawRound",
              poolId,
              blockNumber,
              cause: error,
            },
          );
        }
        throw error;
      }
    }
    return { ...pool, rounds };
  }

  async readSnapshot(): Promise<SystemSnapshot> {
    const chainId = BigInt(await this.#read(
      "eth_chainId",
      () => this.#client.getChainId(),
      { method: "eth_chainId" },
    ));
    if (chainId !== LIFECYCLE_SUPERVISOR_BASE_SEPOLIA_CHAIN_ID) {
      throw adapterError(
        "WRONG_CHAIN",
        `Expected Base Sepolia chain ID ${LIFECYCLE_SUPERVISOR_BASE_SEPOLIA_CHAIN_ID}, received ${chainId}.`,
        { method: "eth_chainId" },
      );
    }

    const blockNumber = this.#blockNumber ?? await this.#read(
      "eth_blockNumber",
      () => this.#client.getBlockNumber(),
      { method: "eth_blockNumber" },
    );
    const block = await this.#read(
      `eth_getBlockByNumber(${blockNumber})`,
      () => this.#client.getBlock({ blockNumber }),
      { method: "eth_getBlockByNumber", blockNumber },
    );
    if (!block || block.number !== blockNumber) {
      throw adapterError(
        "INCONSISTENT_BLOCK",
        `RPC did not return the requested snapshot block ${blockNumber}.`,
        { method: "eth_getBlockByNumber", blockNumber },
      );
    }

    const bytecode = await this.#read(
      `eth_getCode at block ${blockNumber}`,
      () => this.#client.getBytecode({
        address: this.#contractAddress,
        blockNumber,
      }),
      { method: "eth_getCode", blockNumber },
    );
    if (!bytecode || bytecode === "0x") {
      throw adapterError(
        "NO_CONTRACT_BYTECODE",
        `No POP33 bytecode exists at ${this.#contractAddress} at block ${blockNumber}.`,
        { method: "eth_getCode", blockNumber },
      );
    }

    const rawPoolCount = await this.#readContract("poolCount", blockNumber);
    if (typeof rawPoolCount !== "bigint") {
      throw adapterError(
        "DECODE_ERROR",
        `POP33.poolCount at block ${blockNumber} did not decode as bigint.`,
        { method: "poolCount", blockNumber },
      );
    }
    const range = this.#resolvePoolRange(rawPoolCount, blockNumber);
    const pools: PoolSnapshot[] = [];
    for (
      let poolId = range.fromPoolId;
      poolId <= range.toPoolId;
      poolId += 1n
    ) {
      pools.push(await this.#readPool(poolId, blockNumber));
    }

    const incompletePoolIds = pools
      .filter((pool) => !poolIsComplete(pool))
      .map((pool) => pool.poolId);
    const requestedPoolRange = this.#poolRange ? range : null;
    return {
      chainId,
      contractAddress: this.#contractAddress,
      blockNumber,
      observedAt: block.timestamp,
      poolCount: rawPoolCount,
      source: this.source,
      pools,
      metadata: {
        network: "Base Sepolia",
        rpcHost: this.#rpcHost,
        requestedPoolRange,
        snapshotComplete: incompletePoolIds.length === 0,
        warnings: incompletePoolIds.length === 0
          ? []
          : [
              `Incomplete contract data for pool IDs: ${incompletePoolIds.join(", ")}.`,
            ],
      },
    };
  }
}
