import { Contract, getAddress, Interface, JsonRpcProvider } from "ethers";

import { DEMO_V1_PARAMETERS } from "../lib/demo-v1-config.js";
import {
  PUBLIC_OPERATOR_CONTRACT_ADDRESS,
  PUBLIC_OPERATOR_TOKEN_ADDRESS,
  type PlannedAction,
  type PublicContractIdentity,
  type PublicPoolSnapshot,
  type PublicReadOnlyRuntime,
  type PublicRoundSnapshot,
  type PublicWalletSnapshot,
} from "./base-sepolia-read-only-operator.js";
import {
  withReadOnlyRpcRetry,
  type ReadOnlyRpcRetryOptions,
} from "./read-only-rpc-retry.js";

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
] as const;

const POP33_ABI = [
  "function paymentToken() view returns (address)",
  "function ENTRY_PRICE() view returns (uint256)",
  "function MAX_POSITIONS_PER_POOL() view returns (uint256)",
  "function MAX_ACTIVE_POSITIONS_PER_USER() view returns (uint256)",
  "function DRAW_ROUNDS() view returns (uint256)",
  "function DRAW_INTERVAL() view returns (uint64)",
  "function poolCount() view returns (uint256)",
  "function activePositionsByUser(address) view returns (uint256)",
  "function claimablePrizesByUser(address) view returns (uint256)",
  "function getOpenPoolIds() view returns (uint256[])",
  "function getPool(uint256) view returns ((uint256 id,uint8 status,uint256 activePositionCount,uint256 escrowedAmount,uint64 openedAt,uint64 lockedAt,uint64 drawInterval,uint256 entryPrice,uint256 prizePerRound,uint256 totalPrizeAmount,uint256 positionsPerPool,uint256 drawRoundCount,uint256 completedDrawRoundCount,uint256 claimedPrizeCount,uint256 assignedPrizeAmount,uint256 claimedPrizeAmount))",
  "function getDrawRound(uint256,uint256) view returns ((uint256 number,uint256 scheduledAt,uint256 executedAt,uint8 status,uint256 winningPositionId,address winner,uint256 prizeAmount,uint256 temporaryRequestId,bool claimed))",
  "function getActivePositionId(uint256,address) view returns (uint256)",
  "function join() returns (uint256,uint256)",
  "function withdraw(uint256)",
  "function executeDraw(uint256,uint256) returns (uint256)",
  "function claim(uint256,uint256)",
] as const;

const tokenInterface = new Interface(TOKEN_ABI);
const pop33Interface = new Interface(POP33_ABI);

export class EthersBaseSepoliaReadOnlyRuntime implements PublicReadOnlyRuntime {
  private readonly provider: JsonRpcProvider;
  private readonly token: Contract;
  private readonly pop33: Contract;
  private readonly retryOptions: ReadOnlyRpcRetryOptions;

  constructor(rpcUrl: string, retryOptions: ReadOnlyRpcRetryOptions = {}) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.token = new Contract(PUBLIC_OPERATOR_TOKEN_ADDRESS, TOKEN_ABI, this.provider);
    this.pop33 = new Contract(PUBLIC_OPERATOR_CONTRACT_ADDRESS, POP33_ABI, this.provider);
    this.retryOptions = retryOptions;
  }

  private read<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return withReadOnlyRpcRetry(label, operation, this.retryOptions);
  }

  async getChainId(): Promise<bigint> {
    return (await this.read("eth_chainId", () => this.provider.getNetwork())).chainId;
  }

  getLatestBlockNumber(): Promise<number> {
    return this.read("eth_blockNumber", () => this.provider.getBlockNumber());
  }

  async getLatestBlockTimestamp(): Promise<bigint> {
    const block = await this.read("eth_getBlockByNumber(latest)", () => this.provider.getBlock("latest"));
    if (!block) throw new Error("Provider did not return the latest Base Sepolia block.");
    return BigInt(block.timestamp);
  }

  getCode(address: string): Promise<string> {
    return this.read("eth_getCode", () => this.provider.getCode(address));
  }

  async getFeePerGas(): Promise<bigint> {
    const fees = await this.read("fee data", () => this.provider.getFeeData());
    const value = fees.maxFeePerGas ?? fees.gasPrice;
    if (value === null) throw new Error("Provider returned no usable fee data.");
    return value;
  }

  async getContractIdentity(): Promise<PublicContractIdentity> {
    const paymentToken = await this.read("POP33.paymentToken", () => this.pop33.paymentToken());
    const tokenName = await this.read("dUSDC.name", () => this.token.name());
    const tokenSymbol = await this.read("dUSDC.symbol", () => this.token.symbol());
    const tokenDecimals = await this.read("dUSDC.decimals", () => this.token.decimals());
    const dripAmount = await this.read("dUSDC.DRIP_AMOUNT", () => this.token.DRIP_AMOUNT());
    const dripCooldown = await this.read("dUSDC.DRIP_COOLDOWN", () => this.token.DRIP_COOLDOWN());
    const entryAmount = await this.read("POP33.ENTRY_PRICE", () => this.pop33.ENTRY_PRICE());
    const maxParticipants = await this.read(
      "POP33.MAX_POSITIONS_PER_POOL",
      () => this.pop33.MAX_POSITIONS_PER_POOL(),
    );
    const maxActivePositions = await this.read(
      "POP33.MAX_ACTIVE_POSITIONS_PER_USER",
      () => this.pop33.MAX_ACTIVE_POSITIONS_PER_USER(),
    );
    const roundCount = await this.read("POP33.DRAW_ROUNDS", () => this.pop33.DRAW_ROUNDS());
    const drawInterval = await this.read("POP33.DRAW_INTERVAL", () => this.pop33.DRAW_INTERVAL());
    const poolCount = await this.read("POP33.poolCount", () => this.pop33.poolCount());
    return {
      paymentToken, tokenName, tokenSymbol, tokenDecimals, dripAmount, dripCooldown,
      entryAmount, maxParticipants, maxActivePositions, roundCount, drawInterval, poolCount,
    };
  }

  getOpenPoolIds(): Promise<bigint[]> {
    return this.read("POP33.getOpenPoolIds", () => this.pop33.getOpenPoolIds());
  }

  async getPool(poolId: bigint): Promise<PublicPoolSnapshot> {
    const pool = await this.read("POP33.getPool", () => this.pop33.getPool(poolId));
    return {
      id: pool.id,
      status: pool.status,
      activePositionCount: pool.activePositionCount,
      escrowedAmount: pool.escrowedAmount,
      lockedAt: pool.lockedAt,
      completedDrawRoundCount: pool.completedDrawRoundCount,
      claimedPrizeCount: pool.claimedPrizeCount,
    };
  }

  async getRounds(poolId: bigint, count: bigint): Promise<PublicRoundSnapshot[]> {
    const rounds = [];
    for (let index = 0; index < Number(count); index += 1) {
      rounds.push(await this.read(
        `POP33.getDrawRound(${index + 1})`,
        () => this.pop33.getDrawRound(poolId, index + 1),
      ));
    }
    return rounds.map((round) => ({
      number: round.number,
      scheduledAt: round.scheduledAt,
      executedAt: round.executedAt,
      status: round.status,
      winningPositionId: round.winningPositionId,
      winner: getAddress(round.winner),
      claimed: round.claimed,
    }));
  }

  async getWallet(addressValue: string, poolId: bigint): Promise<PublicWalletSnapshot> {
    const address = getAddress(addressValue);
    const nativeBalance = await this.read("wallet eth_getBalance", () => this.provider.getBalance(address));
    const tokenBalance = await this.read("wallet dUSDC.balanceOf", () => this.token.balanceOf(address));
    const allowance = await this.read(
      "wallet dUSDC.allowance",
      () => this.token.allowance(address, PUBLIC_OPERATOR_CONTRACT_ADDRESS),
    );
    const nextDripAt = await this.read("wallet dUSDC.nextDripAt", () => this.token.nextDripAt(address));
    const activePositions = await this.read(
      "wallet POP33.activePositionsByUser",
      () => this.pop33.activePositionsByUser(address),
    );
    const activePositionId = await this.read(
      "wallet POP33.getActivePositionId",
      () => this.pop33.getActivePositionId(poolId, address),
    );
    const claimablePrizes = await this.read(
      "wallet POP33.claimablePrizesByUser",
      () => this.pop33.claimablePrizesByUser(address),
    );
    const nonceLatest = await this.read(
      "wallet eth_getTransactionCount(latest)",
      () => this.provider.getTransactionCount(address, "latest"),
    );
    const noncePending = await this.read(
      "wallet eth_getTransactionCount(pending)",
      () => this.provider.getTransactionCount(address, "pending"),
    );
    return {
      address, nativeBalance, tokenBalance, allowance, nextDripAt,
      activePositions, activePositionId, claimablePrizes, nonceLatest, noncePending,
    };
  }

  estimateAction(input: {
    action: Exclude<PlannedAction, "fund">;
    from: string;
    poolId: bigint;
    positionId?: bigint;
    round?: bigint;
  }): Promise<bigint> {
    const request = this.encodeAction(input);
    return this.read(`eth_estimateGas(${input.action})`, () => this.provider.estimateGas({
      from: getAddress(input.from),
      to: request.to,
      data: request.data,
      value: 0n,
    }));
  }

  private encodeAction(input: {
    action: Exclude<PlannedAction, "fund">;
    poolId: bigint;
    positionId?: bigint;
    round?: bigint;
  }): { to: string; data: string } {
    switch (input.action) {
      case "faucet":
        return { to: PUBLIC_OPERATOR_TOKEN_ADDRESS, data: tokenInterface.encodeFunctionData("drip") };
      case "approve":
        return {
          to: PUBLIC_OPERATOR_TOKEN_ADDRESS,
          data: tokenInterface.encodeFunctionData("approve", [
            PUBLIC_OPERATOR_CONTRACT_ADDRESS,
            DEMO_V1_PARAMETERS.entryPrice,
          ]),
        };
      case "join":
        return { to: PUBLIC_OPERATOR_CONTRACT_ADDRESS, data: pop33Interface.encodeFunctionData("join") };
      case "withdraw":
        if (!input.positionId || input.positionId <= 0n) throw new Error("Withdrawal estimate requires a position ID.");
        return {
          to: PUBLIC_OPERATOR_CONTRACT_ADDRESS,
          data: pop33Interface.encodeFunctionData("withdraw", [input.positionId]),
        };
      case "draw":
        if (!input.round || input.round <= 0n) throw new Error("Draw estimate requires a round number.");
        return {
          to: PUBLIC_OPERATOR_CONTRACT_ADDRESS,
          data: pop33Interface.encodeFunctionData("executeDraw", [input.poolId, input.round]),
        };
      case "claim":
        if (!input.round || input.round <= 0n) throw new Error("Claim estimate requires a round number.");
        return {
          to: PUBLIC_OPERATOR_CONTRACT_ADDRESS,
          data: pop33Interface.encodeFunctionData("claim", [input.poolId, input.round]),
        };
    }
  }
}
