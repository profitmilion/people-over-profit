import {
  Contract,
  getAddress,
  Interface,
  type Provider,
  type Signer,
  type TransactionReceipt,
} from "ethers";

import { DEMO_V1_PARAMETERS } from "../lib/demo-v1-config.js";
import type { JournalOperation } from "../operator/transaction-journal.js";
import type {
  BroadcastResponse,
  RecoveryReceipt,
  RecoveryTransaction,
  TransactionRecoveryProvider,
} from "../operator/transaction-recovery.js";
import {
  BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
  BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
  type SmokeContractParameters,
  type SmokeOperationEvidence,
  type SmokePoolState,
  type SmokePositionState,
  type SmokeRuntime,
  type SmokeTokenState,
  type SmokeWriteAction,
} from "./base-sepolia-smoke.js";

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function DRIP_AMOUNT() view returns (uint256)",
  "function DRIP_COOLDOWN() view returns (uint256)",
  "function nextDripAt(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function drip() returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "event DemoTokensDripped(address indexed account,uint256 amount,uint256 nextAvailableAt)",
] as const;

const POP33_ABI = [
  "function paymentToken() view returns (address)",
  "function ENTRY_PRICE() view returns (uint256)",
  "function MAX_POSITIONS_PER_POOL() view returns (uint256)",
  "function MAX_ACTIVE_POSITIONS_PER_USER() view returns (uint256)",
  "function MAX_OPEN_POOLS() view returns (uint256)",
  "function DRAW_ROUNDS() view returns (uint256)",
  "function PRIZE_PER_ROUND() view returns (uint256)",
  "function TOTAL_PRIZE_AMOUNT() view returns (uint256)",
  "function DRAW_INTERVAL() view returns (uint64)",
  "function getOpenPoolIds() view returns (uint256[])",
  "function getPool(uint256) view returns ((uint256 id,uint8 status,uint256 activePositionCount,uint256 escrowedAmount,uint64 openedAt,uint64 lockedAt,uint64 drawInterval,uint256 entryPrice,uint256 prizePerRound,uint256 totalPrizeAmount,uint256 positionsPerPool,uint256 drawRoundCount,uint256 completedDrawRoundCount,uint256 claimedPrizeCount,uint256 assignedPrizeAmount,uint256 claimedPrizeAmount))",
  "function getActivePositionId(uint256,address) view returns (uint256)",
  "function getPosition(uint256) view returns ((uint256 id,uint256 poolId,address owner,uint64 joinedAt,bool active))",
  "function join() returns (uint256,uint256)",
  "function withdraw(uint256)",
  "event PositionJoined(uint256 indexed positionId,uint256 indexed poolId,address indexed user,uint256 amount,uint256 activePositionCount)",
  "event PositionWithdrawn(uint256 indexed positionId,uint256 indexed poolId,address indexed user,uint256 amount,uint256 activePositionCount)",
] as const;

const tokenInterface = new Interface(TOKEN_ABI);
const pop33Interface = new Interface(POP33_ABI);

function asRecoveryTransaction(transaction: Awaited<ReturnType<Provider["getTransaction"]>>): RecoveryTransaction | null {
  if (!transaction) return null;
  return {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    nonce: transaction.nonce,
    data: transaction.data,
    value: transaction.value,
  };
}

function asRecoveryReceipt(receipt: Awaited<ReturnType<Provider["getTransactionReceipt"]>>): RecoveryReceipt | null {
  if (!receipt) return null;
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
  };
}

function parseScope(operation: JournalOperation): { poolId: bigint; positionId?: bigint } {
  const match = /^base-sepolia-smoke-v1:(?:faucet|approve|join):pool-(\d+)$/.exec(operation.scope);
  if (match) return { poolId: BigInt(match[1]) };
  const withdraw = /^base-sepolia-smoke-v1:withdraw:pool-(\d+):position-(\d+)$/.exec(operation.scope);
  if (withdraw) return { poolId: BigInt(withdraw[1]), positionId: BigInt(withdraw[2]) };
  throw new Error("Smoke journal operation scope is not recognized.");
}

function parseKnownLog(
  receipt: TransactionReceipt,
  iface: Interface,
  eventName: string,
  expectedEmitter: string,
) {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(expectedEmitter)) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === eventName) return parsed;
    } catch {
      // Ignore unrelated contract logs in the same transaction receipt.
    }
  }
  throw new Error(`Confirmed smoke transaction is missing ${eventName} evidence.`);
}

export class EthersBaseSepoliaSmokeRuntime implements SmokeRuntime {
  readonly walletAddress: string;
  readonly recoveryProvider: TransactionRecoveryProvider;
  private readonly token: Contract;
  private readonly pop33: Contract;

  constructor(
    private readonly provider: Provider,
    walletAddress: string,
    private readonly signer?: Signer,
  ) {
    this.walletAddress = getAddress(walletAddress);
    this.token = new Contract(BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS, TOKEN_ABI, provider);
    this.pop33 = new Contract(BASE_SEPOLIA_SMOKE_POP33_ADDRESS, POP33_ABI, provider);
    this.recoveryProvider = {
      getTransaction: async (hash) => asRecoveryTransaction(await provider.getTransaction(hash)),
      getTransactionReceipt: async (hash) => asRecoveryReceipt(await provider.getTransactionReceipt(hash)),
      getTransactionCount: (address, blockTag) => provider.getTransactionCount(address, blockTag),
      findTransactionBySenderAndNonce: (address, nonce) =>
        this.findMinedTransactionBySenderAndNonce(address, nonce),
    };
  }

  async getChainId(): Promise<bigint> {
    return (await this.provider.getNetwork()).chainId;
  }

  getCode(address: string): Promise<string> {
    return this.provider.getCode(address);
  }

  getNativeBalance(): Promise<bigint> {
    return this.provider.getBalance(this.walletAddress);
  }

  async getFeePerGas(): Promise<bigint> {
    const fees = await this.provider.getFeeData();
    const fee = fees.maxFeePerGas ?? fees.gasPrice;
    if (fee === null) throw new Error("Provider returned no usable fee data.");
    return fee;
  }

  async getTokenState(): Promise<SmokeTokenState> {
    const [name, symbol, decimals, dripAmount, dripCooldown, nextDripAt, balance, allowance] =
      await Promise.all([
        this.token.name(),
        this.token.symbol(),
        this.token.decimals(),
        this.token.DRIP_AMOUNT(),
        this.token.DRIP_COOLDOWN(),
        this.token.nextDripAt(this.walletAddress),
        this.token.balanceOf(this.walletAddress),
        this.token.allowance(this.walletAddress, BASE_SEPOLIA_SMOKE_POP33_ADDRESS),
      ]);
    return { name, symbol, decimals, dripAmount, dripCooldown, nextDripAt, balance, allowance };
  }

  async getContractParameters(): Promise<SmokeContractParameters> {
    const [
      paymentToken,
      entryPrice,
      positionsPerPool,
      maxActivePositionsPerUser,
      maxOpenPools,
      drawRoundCount,
      prizePerRound,
      totalPrizeAmount,
      drawInterval,
    ] = await Promise.all([
      this.pop33.paymentToken(),
      this.pop33.ENTRY_PRICE(),
      this.pop33.MAX_POSITIONS_PER_POOL(),
      this.pop33.MAX_ACTIVE_POSITIONS_PER_USER(),
      this.pop33.MAX_OPEN_POOLS(),
      this.pop33.DRAW_ROUNDS(),
      this.pop33.PRIZE_PER_ROUND(),
      this.pop33.TOTAL_PRIZE_AMOUNT(),
      this.pop33.DRAW_INTERVAL(),
    ]);
    return {
      paymentToken,
      entryPrice,
      positionsPerPool,
      maxActivePositionsPerUser,
      maxOpenPools,
      drawRoundCount,
      prizePerRound,
      totalPrizeAmount,
      drawInterval,
    };
  }

  getOpenPoolIds(): Promise<bigint[]> {
    return this.pop33.getOpenPoolIds();
  }

  async getPool(poolId: bigint): Promise<SmokePoolState> {
    const pool = await this.pop33.getPool(poolId);
    return {
      id: pool.id,
      status: pool.status,
      activePositionCount: pool.activePositionCount,
      escrowedAmount: pool.escrowedAmount,
      entryPrice: pool.entryPrice,
      positionsPerPool: pool.positionsPerPool,
      drawRoundCount: pool.drawRoundCount,
      prizePerRound: pool.prizePerRound,
      totalPrizeAmount: pool.totalPrizeAmount,
      drawInterval: pool.drawInterval,
    };
  }

  getActivePositionId(poolId: bigint): Promise<bigint> {
    return this.pop33.getActivePositionId(poolId, this.walletAddress);
  }

  async getPosition(positionId: bigint): Promise<SmokePositionState> {
    const position = await this.pop33.getPosition(positionId);
    return {
      id: position.id,
      poolId: position.poolId,
      owner: position.owner,
      active: position.active,
    };
  }

  async estimateAction(action: SmokeWriteAction, positionId?: bigint): Promise<bigint> {
    const { to, data } = this.transactionData(action, positionId);
    return this.provider.estimateGas({ from: this.walletAddress, to, data, value: 0n });
  }

  getPendingNonce(): Promise<number> {
    return this.provider.getTransactionCount(this.walletAddress, "pending");
  }

  async broadcast(action: SmokeWriteAction, nonce: number, positionId?: bigint): Promise<BroadcastResponse> {
    if (!this.signer) throw new Error("Write smoke signer is unavailable.");
    if (getAddress(await this.signer.getAddress()) !== this.walletAddress) {
      throw new Error("Write smoke signer does not match the dedicated smoke address.");
    }
    const { to, data } = this.transactionData(action, positionId);
    const estimate = await this.provider.estimateGas({
      from: this.walletAddress,
      to,
      data,
      value: 0n,
    });
    const response = await this.signer.sendTransaction({
      to,
      data,
      value: 0n,
      nonce,
      gasLimit: (estimate * 12n + 9n) / 10n,
    });
    return {
      hash: response.hash,
      nonce: response.nonce,
      wait: async () => asRecoveryReceipt(await response.wait()),
    };
  }

  async verifySubmittedOperation(operation: JournalOperation): Promise<void> {
    if (!operation.transactionHash || operation.nonce === null) {
      throw new Error("Submitted smoke operation lacks transaction evidence.");
    }
    const transaction = await this.provider.getTransaction(operation.transactionHash);
    if (!transaction) throw new Error("Submitted smoke transaction is unavailable.");
    const expected = this.transactionData(
      operation.action as SmokeWriteAction,
      parseScope(operation).positionId,
    );
    if (
      getAddress(transaction.from) !== this.walletAddress ||
      transaction.to === null ||
      getAddress(transaction.to) !== expected.to ||
      transaction.nonce !== operation.nonce ||
      transaction.data.toLowerCase() !== expected.data.toLowerCase() ||
      transaction.value !== 0n
    ) {
      throw new Error("Smoke transaction calldata or identity does not match the journal operation.");
    }
  }

  async verifyConfirmedOperation(operation: JournalOperation): Promise<SmokeOperationEvidence> {
    await this.verifySubmittedOperation(operation);
    if (!operation.transactionHash) throw new Error("Confirmed operation lacks a transaction hash.");
    const receipt = await this.provider.getTransactionReceipt(operation.transactionHash);
    if (!receipt || receipt.status !== 1) throw new Error("Confirmed smoke receipt is unavailable or failed.");
    const scope = parseScope(operation);
    switch (operation.action) {
      case "faucet": {
        const event = parseKnownLog(
          receipt,
          tokenInterface,
          "DemoTokensDripped",
          BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
        );
        if (getAddress(event.args.account) !== this.walletAddress || event.args.amount !== DEMO_V1_PARAMETERS.dripAmount) {
          throw new Error("Faucet receipt evidence mismatch.");
        }
        return { action: "faucet", amount: event.args.amount, poolId: scope.poolId };
      }
      case "approve":
        return { action: "approve", amount: DEMO_V1_PARAMETERS.entryPrice, poolId: scope.poolId };
      case "join": {
        const event = parseKnownLog(
          receipt,
          pop33Interface,
          "PositionJoined",
          BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
        );
        if (
          getAddress(event.args.user) !== this.walletAddress ||
          event.args.poolId !== scope.poolId ||
          event.args.amount !== DEMO_V1_PARAMETERS.entryPrice
        ) {
          throw new Error("Join receipt evidence mismatch.");
        }
        return {
          action: "join",
          amount: event.args.amount,
          poolId: event.args.poolId,
          positionId: event.args.positionId,
        };
      }
      case "withdraw": {
        const event = parseKnownLog(
          receipt,
          pop33Interface,
          "PositionWithdrawn",
          BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
        );
        if (
          getAddress(event.args.user) !== this.walletAddress ||
          event.args.poolId !== scope.poolId ||
          event.args.positionId !== scope.positionId ||
          event.args.amount !== DEMO_V1_PARAMETERS.entryPrice
        ) {
          throw new Error("Withdraw receipt evidence mismatch.");
        }
        return {
          action: "withdraw",
          amount: event.args.amount,
          poolId: event.args.poolId,
          positionId: event.args.positionId,
        };
      }
      default:
        throw new Error("Prohibited action found in smoke journal.");
    }
  }

  private transactionData(action: SmokeWriteAction, positionId?: bigint): { to: string; data: string } {
    switch (action) {
      case "faucet":
        return { to: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS, data: tokenInterface.encodeFunctionData("drip") };
      case "approve":
        return {
          to: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
          data: tokenInterface.encodeFunctionData("approve", [
            BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
            DEMO_V1_PARAMETERS.entryPrice,
          ]),
        };
      case "join":
        return { to: BASE_SEPOLIA_SMOKE_POP33_ADDRESS, data: pop33Interface.encodeFunctionData("join") };
      case "withdraw":
        if (!positionId || positionId <= 0n) throw new Error("Withdraw requires a positive smoke position ID.");
        return {
          to: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
          data: pop33Interface.encodeFunctionData("withdraw", [positionId]),
        };
    }
  }

  private async findMinedTransactionBySenderAndNonce(
    address: string,
    nonce: number,
  ): Promise<RecoveryTransaction | null> {
    const latest = await this.provider.getBlockNumber();
    const first = Math.max(0, latest - 128);
    for (let blockNumber = latest; blockNumber >= first; blockNumber -= 1) {
      const block = await this.provider.getBlock(blockNumber, true);
      if (!block) continue;
      for (const transaction of block.prefetchedTransactions) {
        if (
          transaction.nonce === nonce &&
          transaction.from.toLowerCase() === address.toLowerCase()
        ) {
          return asRecoveryTransaction(transaction);
        }
      }
    }
    return null;
  }
}
