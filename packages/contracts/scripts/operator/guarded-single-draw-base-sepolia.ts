import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
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

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const AUDIT_SUFFIX = ".guarded-draw-audit.json";

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
): GuardedDrawDependencies {
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
    async loadExecutionClient(): Promise<GuardedDrawExecutionClient> {
      const expectedAddress = requirePublicOperatorAddress(publicOperator);
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
