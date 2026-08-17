import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  concatHex,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
  size,
  toHex,
  toRlp,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { demoV1Abi } from "../../../../src/demo-v1/abi.js";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
} from "../../../../src/demo-v1/safety.js";
import {
  LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  BaseSepoliaLifecycleSnapshotAdapter,
  ViemLifecycleSupervisorPublicClient,
  redactLifecycleSupervisorRpcUrl,
  type LifecycleSupervisorPublicClient,
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./lifecycle-supervisor-base-sepolia.js";
import {
  type GuardedDrawAuditRecord,
  type GuardedDrawDependencies,
  type GuardedDrawExecutionClient,
  type GuardedDrawPreparedIntentContext,
} from "./guarded-single-draw.js";
import type { DrawPreSignerConsumerResult } from "./draw-pre-signer-consumer.js";
import {
  GuardedDrawReadOnlyRpcFailover,
} from "./guarded-draw-rpc-failover.js";
import type {
  GuardedDrawExecutionReadinessReadDependencies,
} from "./automatic-draw-runner-v1-readiness.js";

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const AUDIT_SUFFIX = ".guarded-draw-audit.json";
const GAS_PRICE_ORACLE_ADDRESS =
  "0x420000000000000000000000000000000000000F";
const L1_BLOCK_ADDRESS = "0x4200000000000000000000000000000000000015";
const MAX_PRE_SIGNER_NONCE = (1n << 64n) - 1n;
const JOVIAN_OPERATOR_FEE_MULTIPLIER = 100n;
const gasPriceOracleFeeAbi = parseAbi([
  "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
]);
const l1BlockFeeAbi = parseAbi([
  "function operatorFeeScalar() view returns (uint32)",
  "function operatorFeeConstant() view returns (uint64)",
  "function daFootprintGasScalar() view returns (uint16)",
]);

export interface BaseSepoliaGuardedDrawOptions {
  rpcUrl: string;
  fallbackRpcUrl?: string;
  poolId: bigint;
  timeoutMs?: number;
  operatorAddress?: string;
  privateKeyEnvironment?: NodeJS.ProcessEnv;
  auditPath?: string;
  consumePreparedDrawIntent?(
    context: GuardedDrawPreparedIntentContext,
  ): Promise<DrawPreSignerConsumerResult>;
}

export class GuardedDrawAuditFile {
  readonly #path: string;

  constructor(path: string) {
    if (!isAbsolute(path) || !path.endsWith(AUDIT_SUFFIX)) {
      throw new Error(
        `Guarded Draw audit path must be absolute and end with ${AUDIT_SUFFIX}.`,
      );
    }
    this.#path = resolve(path);
  }

  async write(record: GuardedDrawAuditRecord): Promise<void> {
    const json = `${JSON.stringify(record, null, 2)}\n`;
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(json, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.#path);
    } finally {
      await handle?.close();
      await rm(temporary, { force: true });
    }
  }
}

function requirePublicOperatorAddress(value: string | undefined): Address {
  if (!value || !isAddress(value)) {
    throw new Error(
      "BASE_SEPOLIA_DRAW_OPERATOR_ADDRESS must contain a valid public address.",
    );
  }
  return getAddress(value);
}

function loadPrivateKey(
  environment: NodeJS.ProcessEnv,
  expectedAddress: Address,
): ReturnType<typeof privateKeyToAccount> {
  const value = environment.BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY?.trim();
  if (!value || !PRIVATE_KEY.test(value)) {
    throw new Error(
      "BASE_SEPOLIA_DRAW_OPERATOR_PRIVATE_KEY is missing or invalid.",
    );
  }
  const account = privateKeyToAccount(value as Hex);
  if (account.address !== expectedAddress) {
    throw new Error(
      "Private-key account does not match BASE_SEPOLIA_DRAW_OPERATOR_ADDRESS.",
    );
  }
  return account;
}

export function createBaseSepoliaGuardedDrawDependencies(
  options: BaseSepoliaGuardedDrawOptions,
): GuardedDrawDependencies & GuardedDrawExecutionReadinessReadDependencies {
  const rpcUrl = validateLifecycleSupervisorRpcUrl(options.rpcUrl);
  const rpcUrls = [...new Set([
    rpcUrl,
    ...(options.fallbackRpcUrl
      ? [validateLifecycleSupervisorRpcUrl(options.fallbackRpcUrl)]
      : []),
  ])];
  const timeoutMs = validateLifecycleSupervisorTimeout(
    options.timeoutMs ?? LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  );
  const rpcClients = rpcUrls.map((url, index) => ({
    name: index === 0 ? "primary" : `fallback-${index}`,
    maskedEndpoint: redactLifecycleSupervisorRpcUrl(url),
    client: {
      rpcUrl: url,
      publicClient: createPublicClient({
        chain: baseSepolia,
        transport: http(url, { retryCount: 0, timeout: timeoutMs }),
      }),
      snapshotClient: new ViemLifecycleSupervisorPublicClient(url, timeoutMs),
    },
  }));
  const rpcFailover = new GuardedDrawReadOnlyRpcFailover({
    endpoints: rpcClients,
    expectedChainId: BigInt(DEMO_V1_CHAIN_ID),
    async healthCheck(client) {
      const chainId = BigInt(await client.publicClient.getChainId());
      const blockNumber = await client.publicClient.getBlockNumber();
      const bytecode = await client.publicClient.getBytecode({
        address: DEMO_V1_CONTRACT_ADDRESS,
        blockNumber,
      });
      return {
        chainId,
        contractBytecodePresent: Boolean(bytecode && bytecode !== "0x"),
      };
    },
  });
  const snapshotClient: LifecycleSupervisorPublicClient = {
    getChainId: () => rpcFailover.read("eth_chainId", (client) =>
      client.snapshotClient.getChainId()),
    getBlockNumber: () => rpcFailover.read("eth_blockNumber", (client) =>
      client.snapshotClient.getBlockNumber()),
    getBlock: (input) => rpcFailover.read("eth_getBlockByNumber", (client) =>
      client.snapshotClient.getBlock(input)),
    getBytecode: (input) => rpcFailover.read("eth_getCode", (client) =>
      client.snapshotClient.getBytecode(input)),
    readContract: (input) => rpcFailover.read(
      `eth_call:${input.functionName}`,
      (client) => client.snapshotClient.readContract(input),
    ),
  };
  const publicOperator = options.operatorAddress
    ? requirePublicOperatorAddress(options.operatorAddress)
    : undefined;
  const auditFile = options.auditPath
    ? new GuardedDrawAuditFile(options.auditPath)
    : undefined;

  const readSnapshot = async (blockNumber?: bigint) =>
    new BaseSepoliaLifecycleSnapshotAdapter({
      client: snapshotClient,
      rpcHost: rpcUrls.length > 1
        ? "base-sepolia-rpc-failover"
        : redactLifecycleSupervisorRpcUrl(rpcUrl),
      contractAddress: DEMO_V1_CONTRACT_ADDRESS,
      blockNumber,
      poolRange: { fromPoolId: options.poolId, toPoolId: options.poolId },
    }).readSnapshot();

  return {
    readSnapshot,
    consumePreparedDrawIntent: options.consumePreparedDrawIntent,
    getLatestBlockNumber: () => rpcFailover.read("eth_blockNumber", (client) =>
      client.publicClient.getBlockNumber()),
    getTransactionCount: (address, blockTag) => rpcFailover.read(
      `eth_getTransactionCount:${blockTag}`,
      (client) => client.publicClient.getTransactionCount({
        address,
        blockTag,
      }),
    ),
    async readPublicIdentity(blockNumber) {
      const { chainId, bytecode } = await rpcFailover.read(
        "public identity",
        async (client) => ({
          chainId: await client.publicClient.getChainId(),
          bytecode: await client.publicClient.getBytecode({
            address: DEMO_V1_CONTRACT_ADDRESS,
            blockNumber,
          }),
        }),
      );
      return {
        chainId: BigInt(chainId),
        contractAddress: DEMO_V1_CONTRACT_ADDRESS,
        hasBytecode: Boolean(bytecode && bytecode !== "0x"),
      };
    },
    async simulateDraw(input) {
      const { simulation, gasEstimate } = await rpcFailover.read(
        "Draw simulation and gas estimate",
        async (client) => {
          const simulation = await client.publicClient.simulateContract({
            account: input.account,
            address: input.address,
            abi: demoV1Abi,
            functionName: "executeDraw",
            args: input.args,
            blockNumber: input.blockNumber,
          });
          const gasEstimate = await client.publicClient.estimateContractGas({
            account: input.account,
            address: input.address,
            abi: demoV1Abi,
            functionName: "executeDraw",
            args: input.args,
            blockNumber: input.blockNumber,
          });
          return { simulation, gasEstimate };
        },
      );
      return {
        result: typeof simulation.result === "bigint"
          ? simulation.result
          : null,
        gasEstimate,
      };
    },
    estimateDraw: (input) => rpcFailover.read("runtime gas estimate", (client) =>
      client.publicClient.estimateContractGas({
        account: input.account,
        address: input.address,
        abi: input.abi,
        functionName: input.functionName,
        args: input.args,
      })),
    readNativeBalance: (input) => rpcFailover.read(
      "public operator native balance",
      async (client) => ({
        blockNumber: input.blockNumber,
        nativeBalanceWei: await client.publicClient.getBalance({
          address: input.address,
          blockNumber: input.blockNumber,
        }),
      }),
    ),
    readDrawNativeFeeUpperBounds: (input) => rpcFailover.read(
      "complete bounded Base Draw fee data",
      async (client) => {
        const blockNumber = await client.publicClient.getBlockNumber();
        const fees = await client.publicClient.estimateFeesPerGas({
          type: "eip1559",
        });
        const calldata = encodeFunctionData({
          abi: demoV1Abi,
          functionName: "executeDraw",
          args: [input.poolId, input.roundNumber],
        });
        // EIP-2681 bounds nonce to uint64. Using that maximum yields the
        // largest unsigned EIP-1559 envelope for the exact Draw calldata.
        const unsignedTransaction = concatHex([
          "0x02",
          toRlp([
            toHex(baseSepolia.id),
            toHex(MAX_PRE_SIGNER_NONCE),
            fees.maxPriorityFeePerGas > 0n
              ? toHex(fees.maxPriorityFeePerGas)
              : "0x",
            toHex(fees.maxFeePerGas),
            toHex(input.bufferedGasLimit),
            input.contractAddress,
            "0x",
            calldata,
            [],
          ]),
        ]);
        const l1UnsignedTransactionSizeBytes = BigInt(
          size(unsignedTransaction),
        );
        const [
          l1DataFeeUpperBoundWei,
          operatorFeeScalar,
          operatorFeeConstantWei,
        ] = await Promise.all([
          client.publicClient.readContract({
            address: GAS_PRICE_ORACLE_ADDRESS,
            abi: gasPriceOracleFeeAbi,
            functionName: "getL1FeeUpperBound",
            args: [l1UnsignedTransactionSizeBytes],
            blockNumber,
          }),
          client.publicClient.readContract({
            address: L1_BLOCK_ADDRESS,
            abi: l1BlockFeeAbi,
            functionName: "operatorFeeScalar",
            blockNumber,
          }),
          client.publicClient.readContract({
            address: L1_BLOCK_ADDRESS,
            abi: l1BlockFeeAbi,
            functionName: "operatorFeeConstant",
            blockNumber,
          }),
          // Proves the pinned Base block exposes the current Jovian fee semantics.
          client.publicClient.readContract({
            address: L1_BLOCK_ADDRESS,
            abi: l1BlockFeeAbi,
            functionName: "daFootprintGasScalar",
            blockNumber,
          }),
        ]);
        if (fees.maxFeePerGas <= 0n) {
          throw new Error("Public provider returned no positive bounded fee.");
        }
        const operatorFeeUpperBoundWei =
          input.bufferedGasLimit *
            BigInt(operatorFeeScalar) *
            JOVIAN_OPERATOR_FEE_MULTIPLIER +
          operatorFeeConstantWei;
        return {
          blockNumber,
          boundedFeePerGasWei: fees.maxFeePerGas,
          l1UnsignedTransactionSizeBytes,
          l1DataFeeUpperBoundWei,
          operatorFeeScalar: BigInt(operatorFeeScalar),
          operatorFeeConstantWei,
          operatorFeeUpperBoundWei,
        };
      },
    ),
    async loadExecutionClient(
      expectedOperatorAddress,
    ): Promise<GuardedDrawExecutionClient> {
      const expectedAddress = requirePublicOperatorAddress(publicOperator);
      if (
        !isAddress(expectedOperatorAddress) ||
        getAddress(expectedOperatorAddress) !== expectedAddress
      ) {
        throw new Error(
          "Configured Base Sepolia operator does not match the approved execution operator.",
        );
      }
      const account = loadPrivateKey(
        options.privateKeyEnvironment ?? process.env,
        expectedAddress,
      );
      const activeProvider = await rpcFailover.activeProvider();
      const wallet = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(activeProvider.client.rpcUrl, {
          retryCount: 0,
          timeout: timeoutMs,
        }),
      });
      return {
        chainId: BigInt(DEMO_V1_CHAIN_ID),
        account: account.address,
        contractAddress: DEMO_V1_CONTRACT_ADDRESS,
        async prepareDraw(input) {
          const gasLimit = input.gasLimit;
          return {
            gasLimit,
            broadcast: () => wallet.writeContract({
              account,
              chain: baseSepolia,
              address: input.address,
              abi: input.abi,
              functionName: input.functionName,
              args: input.args,
              gas: gasLimit,
              ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
            }),
          };
        },
      };
    },
    async waitForReceipt(transactionHash) {
      const receipt = await rpcFailover.read(
        "transaction receipt lookup",
        (client) => client.publicClient.waitForTransactionReceipt({
          hash: transactionHash,
          confirmations: 1,
          timeout: 180_000,
        }),
      );
      return {
        transactionHash,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
      };
    },
    getRpcTelemetry: () => rpcFailover.telemetry(),
    writeAudit: auditFile
      ? (record) => auditFile.write(record)
      : undefined,
  };
}

export function assertGuardedDrawCanonicalNetwork(chainId: bigint): void {
  if (chainId !== BigInt(DEMO_V1_CHAIN_ID)) {
    throw new Error("Guarded Draw supports only Base Sepolia (84532).");
  }
}
