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
  validateLifecycleSupervisorRpcUrl,
  validateLifecycleSupervisorTimeout,
} from "./lifecycle-supervisor-base-sepolia.js";
import {
  type GuardedDrawAuditRecord,
  type GuardedDrawDependencies,
  type GuardedDrawExecutionClient,
} from "./guarded-single-draw.js";

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const AUDIT_SUFFIX = ".guarded-draw-audit.json";

export interface BaseSepoliaGuardedDrawOptions {
  rpcUrl: string;
  poolId: bigint;
  timeoutMs?: number;
  operatorAddress?: string;
  privateKeyEnvironment?: NodeJS.ProcessEnv;
  auditPath?: string;
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
  const timeoutMs = validateLifecycleSupervisorTimeout(
    options.timeoutMs ?? LIFECYCLE_SUPERVISOR_DEFAULT_TIMEOUT_MS,
  );
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl, { retryCount: 0, timeout: timeoutMs }),
  });
  const snapshotClient = new ViemLifecycleSupervisorPublicClient(
    rpcUrl,
    timeoutMs,
  );
  const publicOperator = options.operatorAddress
    ? requirePublicOperatorAddress(options.operatorAddress)
    : undefined;
  const auditFile = options.auditPath
    ? new GuardedDrawAuditFile(options.auditPath)
    : undefined;

  const readSnapshot = async (blockNumber?: bigint) =>
    new BaseSepoliaLifecycleSnapshotAdapter({
      client: snapshotClient,
      rpcHost: redactLifecycleSupervisorRpcUrl(rpcUrl),
      contractAddress: DEMO_V1_CONTRACT_ADDRESS,
      blockNumber,
      poolRange: { fromPoolId: options.poolId, toPoolId: options.poolId },
    }).readSnapshot();

  return {
    readSnapshot,
    getLatestBlockNumber: () => publicClient.getBlockNumber(),
    async readPublicIdentity(blockNumber) {
      const [chainId, bytecode] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getBytecode({
          address: DEMO_V1_CONTRACT_ADDRESS,
          blockNumber,
        }),
      ]);
      return {
        chainId: BigInt(chainId),
        contractAddress: DEMO_V1_CONTRACT_ADDRESS,
        hasBytecode: Boolean(bytecode && bytecode !== "0x"),
      };
    },
    async simulateDraw(input) {
      const simulation = await publicClient.simulateContract({
        account: input.account,
        address: input.address,
        abi: demoV1Abi,
        functionName: "executeDraw",
        args: input.args,
        blockNumber: input.blockNumber,
      });
      let gasEstimate: bigint | null = null;
      try {
        gasEstimate = await publicClient.estimateContractGas({
          account: input.account,
          address: input.address,
          abi: demoV1Abi,
          functionName: "executeDraw",
          args: input.args,
          blockNumber: input.blockNumber,
        });
      } catch {
        // A successful simulation remains useful when an RPC omits gas estimation.
      }
      return {
        result: typeof simulation.result === "bigint"
          ? simulation.result
          : null,
        gasEstimate,
      };
    },
    estimateDraw: (input) => publicClient.estimateContractGas({
      account: input.account,
      address: input.address,
      abi: input.abi,
      functionName: input.functionName,
      args: input.args,
    }),
    async loadExecutionClient(): Promise<GuardedDrawExecutionClient> {
      const expectedAddress = requirePublicOperatorAddress(publicOperator);
      const account = loadPrivateKey(
        options.privateKeyEnvironment ?? process.env,
        expectedAddress,
      );
      const wallet = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(rpcUrl, { retryCount: 0, timeout: timeoutMs }),
      });
      const chainId = BigInt(await wallet.getChainId());
      return {
        chainId,
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
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1,
        timeout: 180_000,
      });
      return {
        transactionHash,
        status: receipt.status,
        blockNumber: receipt.blockNumber,
      };
    },
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
