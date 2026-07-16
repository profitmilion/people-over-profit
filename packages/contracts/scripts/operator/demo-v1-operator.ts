import { getAddress, parseEther } from "ethers";

import { DEMO_V1_PARAMETERS, LOCAL_HARDHAT_CHAIN_ID } from "../lib/demo-v1-config.js";
import type { DynamicContract } from "../lib/deployment.js";
import {
  type CheckpointStore,
  type OperatorCheckpoint,
  type TransactionCheckpoint,
  type WalletCheckpoint,
} from "./checkpoint.js";
import {
  assertExecutionPolicy,
  type OperatorMode,
  type OperatorNetwork,
} from "./network-policy.js";
import type { OperationAction, TransactionJournal } from "./transaction-journal.js";
import { executeJournaledOperation, recoverTransactionJournal } from "./transaction-recovery.js";
import type { OperatorWallet, OperatorWalletProvider } from "./wallet-provider.js";

export const POOL_STATUS = Object.freeze({
  Open: 0n,
  Locked: 1n,
  Drawing: 2n,
  Claimable: 3n,
  Finished: 4n,
});

const LOCAL_WALLET_ETH_BALANCE = parseEther("1");

interface LocalNetworkHelpers {
  setBalance(address: string, balance: bigint): Promise<void>;
}

interface OperatorRuntime {
  network: OperatorNetwork;
  provider: {
    getNetwork(): Promise<{ chainId: bigint }>;
    getCode(address: string): Promise<string>;
    getBalance(address: string): Promise<bigint>;
    getBlock(blockTag: "latest"): Promise<{ timestamp: number } | null>;
    getTransaction(hash: string): Promise<ChainTransactionLike | null>;
    getTransactionReceipt(hash: string): Promise<ChainReceiptLike | null>;
    getTransactionCount(address: string, blockTag: "latest" | "pending"): Promise<number>;
  };
  networkHelpers?: LocalNetworkHelpers;
  token: DynamicContract;
  pop33: DynamicContract;
  drawExecutor: OperatorWallet | { address: string };
}

interface TransactionResponseLike {
  hash: string;
  nonce: number;
  wait(): Promise<ChainReceiptLike | null>;
}

interface ChainTransactionLike {
  hash: string;
  from: string;
  to: string | null;
  nonce: number;
  data: string;
  value: bigint;
}

interface ChainReceiptLike {
  hash: string;
  blockNumber: number;
  status: number | null;
  logs: readonly unknown[];
  gasUsed?: bigint;
}

interface PoolLike {
  id: bigint;
  status: bigint;
  activePositionCount: bigint;
  escrowedAmount: bigint;
  lockedAt: bigint;
  drawInterval: bigint;
  entryPrice: bigint;
  positionsPerPool: bigint;
  drawRoundCount: bigint;
  completedDrawRoundCount: bigint;
  claimedPrizeCount: bigint;
  claimedPrizeAmount: bigint;
}

export interface OperatorOptions {
  runtime: OperatorRuntime;
  wallets: OperatorWalletProvider;
  checkpointStore: CheckpointStore;
  transactionJournal?: TransactionJournal;
  poolId?: bigint;
  log?: (message: string) => void;
}

export interface JoinTo99Options {
  maxTransactions?: number;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkpointClone(checkpoint: OperatorCheckpoint): OperatorCheckpoint {
  return structuredClone(checkpoint);
}

function toCheckpointTransaction(
  operation: TransactionCheckpoint["operation"],
  response: TransactionResponseLike,
  receipt: ChainReceiptLike,
): TransactionCheckpoint {
  requireCondition(receipt.status === 1, `${operation} transaction receipt was not successful.`);
  return {
    operation,
    hash: response.hash,
    blockNumber: receipt.blockNumber,
    receiptStatus: receipt.status,
    nonce: response.nonce,
  };
}

export class DemoV1Operator {
  private readonly runtime: OperatorRuntime;
  private readonly walletProvider: OperatorWalletProvider;
  private readonly checkpointStore: CheckpointStore;
  private readonly poolId: bigint;
  private readonly transactionJournal?: TransactionJournal;
  private readonly log: (message: string) => void;
  private checkpoint?: OperatorCheckpoint;
  private activeWriteMode?: OperatorMode;
  private journalRecoveryCompleted = false;

  constructor(options: OperatorOptions) {
    this.runtime = options.runtime;
    this.walletProvider = options.wallets;
    this.checkpointStore = options.checkpointStore;
    this.poolId = options.poolId ?? 1n;
    this.transactionJournal = options.transactionJournal;
    this.log = options.log ?? console.log;
  }

  private wallets(): readonly OperatorWallet[] {
    return this.walletProvider.listWallets();
  }

  private async addresses() {
    return {
      tokenAddress: getAddress(await this.runtime.token.getAddress()),
      contractAddress: getAddress(await this.runtime.pop33.getAddress()),
    };
  }

  private async chainId(): Promise<bigint> {
    return (await this.runtime.provider.getNetwork()).chainId;
  }

  private assertMode(mode: OperatorMode): void {
    assertExecutionPolicy({ mode, network: this.runtime.network });
  }

  private async assertLocalWrite(mode: OperatorMode): Promise<void> {
    this.assertMode(mode);
    const chainId = await this.chainId();
    requireCondition(
      this.runtime.network === "hardhatOp" && chainId === LOCAL_HARDHAT_CHAIN_ID,
      `${mode} requires the isolated hardhatOp chain ${LOCAL_HARDHAT_CHAIN_ID}.`,
    );
  }

  private async runExclusiveWrite<T>(
    mode: OperatorMode,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.activeWriteMode) {
      throw new Error(
        `${mode} blocked: write mode ${this.activeWriteMode} is already running.`,
      );
    }
    this.activeWriteMode = mode;
    try {
      await this.assertLocalWrite(mode);
      return await operation();
    } finally {
      this.activeWriteMode = undefined;
    }
  }

  async finalJoinConfirmation(): Promise<string> {
    const chainId = await this.chainId();
    const networkLabel =
      this.runtime.network === "hardhatOp" ? "HARDHAT-OP" : "BASE-SEPOLIA";
    return `CONFIRM FINAL JOIN ${networkLabel} CHAIN ${chainId} POOL ${this.poolId} AT 99/100`;
  }

  private transactionContract(operation: TransactionCheckpoint["operation"]): DynamicContract {
    return operation === "dripped" || operation === "approved"
      ? this.runtime.token
      : this.runtime.pop33;
  }

  private expectedFunction(operation: TransactionCheckpoint["operation"]): string {
    const functionByOperation: Record<TransactionCheckpoint["operation"], string> = {
      funded: "",
      dripped: "drip",
      approved: "approve",
      joined: "join",
      withdrawn: "withdraw",
      claimed: "claim",
      draw: "executeDraw",
    };
    return functionByOperation[operation];
  }

  private async verifyTransactionCheckpoint(
    transaction: TransactionCheckpoint,
    expectedFrom: string,
  ): Promise<void> {
    requireCondition(transaction.operation !== "funded", "Fund operations cannot have transaction receipts.");
    const [chainTransaction, receipt] = await Promise.all([
      this.runtime.provider.getTransaction(transaction.hash),
      this.runtime.provider.getTransactionReceipt(transaction.hash),
    ]);
    requireCondition(
      chainTransaction && receipt,
      `Checkpoint transaction ${transaction.hash} cannot be confirmed by the provider.`,
    );
    requireCondition(
      chainTransaction.hash.toLowerCase() === transaction.hash.toLowerCase() &&
        receipt.hash.toLowerCase() === transaction.hash.toLowerCase(),
      `Checkpoint transaction ${transaction.hash} hash mismatch.`,
    );
    requireCondition(
      getAddress(chainTransaction.from) === getAddress(expectedFrom),
      `Checkpoint transaction ${transaction.hash} sender mismatch.`,
    );
    requireCondition(
      chainTransaction.nonce === transaction.nonce,
      `Checkpoint transaction ${transaction.hash} nonce mismatch.`,
    );
    requireCondition(
      receipt.blockNumber === transaction.blockNumber &&
        receipt.status === transaction.receiptStatus,
      `Checkpoint transaction ${transaction.hash} receipt mismatch.`,
    );

    const contract = this.transactionContract(transaction.operation);
    const target = getAddress(await contract.getAddress());
    requireCondition(
      chainTransaction.to !== null && getAddress(chainTransaction.to) === target,
      `Checkpoint transaction ${transaction.hash} target mismatch.`,
    );
    const parsed = contract.interface.parseTransaction({
      data: chainTransaction.data,
      value: chainTransaction.value,
    });
    requireCondition(
      parsed?.name === this.expectedFunction(transaction.operation),
      `Checkpoint transaction ${transaction.hash} operation mismatch.`,
    );
    if (transaction.operation === "approved") {
      requireCondition(
        getAddress(parsed.args[0]) === getAddress(await this.runtime.pop33.getAddress()) &&
          BigInt(parsed.args[1]) === DEMO_V1_PARAMETERS.entryPrice,
        `Checkpoint transaction ${transaction.hash} approval parameters mismatch.`,
      );
    }
  }

  private async verifyLoadedCheckpointTransactions(
    checkpoint: OperatorCheckpoint,
  ): Promise<void> {
    for (const transaction of checkpoint.operatorTransactions) {
      await this.verifyTransactionCheckpoint(transaction, this.runtime.drawExecutor.address);
    }
    for (const wallet of checkpoint.wallets) {
      for (const transaction of wallet.transactions) {
        await this.verifyTransactionCheckpoint(transaction, wallet.address);
      }
    }
  }

  private blankWalletCheckpoint(index: number, address: string): WalletCheckpoint {
    return {
      index,
      address: getAddress(address),
      stage: "discovered",
      nativeBalance: "0",
      tokenBalance: "0",
      allowance: "0",
      activePositionId: "0",
      poolId: this.poolId.toString(),
      winningRounds: [],
      claimedRounds: [],
      transactions: [],
    };
  }

  private async ensureCheckpoint(): Promise<OperatorCheckpoint> {
    if (this.checkpoint) return this.checkpoint;

    if (this.transactionJournal && !this.journalRecoveryCompleted) {
      const recovered = await recoverTransactionJournal(
        this.transactionJournal,
        this.runtime.provider,
      );
      this.journalRecoveryCompleted = true;
      const unsafe = recovered.find((operation) =>
        !["prepared", "confirmed"].includes(operation.status),
      );
      requireCondition(
        !unsafe,
        `Transaction journal operation ${unsafe?.operationId} requires review in ${unsafe?.status} state.`,
      );
    }

    const chainId = await this.chainId();
    const { tokenAddress, contractAddress } = await this.addresses();
    const loaded = await this.checkpointStore.load();
    if (loaded) {
      requireCondition(loaded.schemaVersion === 1, "Unsupported checkpoint schema.");
      requireCondition(loaded.chainId === chainId.toString(), "Checkpoint chain ID mismatch.");
      requireCondition(
        getAddress(loaded.tokenAddress) === tokenAddress,
        "Checkpoint token address mismatch.",
      );
      requireCondition(
        getAddress(loaded.contractAddress) === contractAddress,
        "Checkpoint POP33 address mismatch.",
      );
      requireCondition(loaded.poolId === this.poolId.toString(), "Checkpoint pool mismatch.");
      requireCondition(
        loaded.wallets.length === this.wallets().length,
        "Checkpoint wallet count mismatch.",
      );
      for (const [index, wallet] of this.wallets().entries()) {
        requireCondition(
          loaded.wallets[index]?.index === index &&
            getAddress(loaded.wallets[index].address) === getAddress(wallet.address),
          `Checkpoint wallet identity mismatch at index ${index}.`,
        );
      }
      await this.verifyLoadedCheckpointTransactions(loaded);
      this.checkpoint = loaded;
    } else {
      this.checkpoint = {
        schemaVersion: 1,
        revision: 0,
        chainId: chainId.toString(),
        tokenAddress,
        contractAddress,
        poolId: this.poolId.toString(),
        poolStatus: "0",
        activePositionCount: "0",
        escrowedAmount: "0",
        completedDrawRoundCount: "0",
        claimedPrizeCount: "0",
        updatedAt: new Date().toISOString(),
        operatorTransactions: [],
        wallets: this.wallets().map((wallet, index) =>
          this.blankWalletCheckpoint(index, wallet.address),
        ),
      };
    }
    await this.reconcileAllWallets();
    return this.checkpoint;
  }

  private inferredStage(
    previous: WalletCheckpoint,
    nativeBalance: bigint,
    tokenBalance: bigint,
    allowance: bigint,
    activePositionId: bigint,
  ): WalletCheckpoint["stage"] {
    if (activePositionId !== 0n) return "joined";
    if (previous.stage === "claimed" || previous.stage === "withdrawn") return previous.stage;
    if (allowance >= DEMO_V1_PARAMETERS.entryPrice) return "approved";
    if (tokenBalance >= DEMO_V1_PARAMETERS.dripAmount) return "dripped";
    if (nativeBalance >= LOCAL_WALLET_ETH_BALANCE) return "funded";
    return "discovered";
  }

  private async readWalletState(index: number) {
    const wallet = this.wallets()[index];
    requireCondition(wallet, `Wallet index ${index} is unavailable.`);
    const contractAddress = await this.runtime.pop33.getAddress();
    const [nativeBalance, tokenBalance, allowance, activePositionId] = await Promise.all([
      this.runtime.provider.getBalance(wallet.address),
      this.runtime.token.balanceOf(wallet.address) as Promise<bigint>,
      this.runtime.token.allowance(wallet.address, contractAddress) as Promise<bigint>,
      this.runtime.pop33.getActivePositionId(this.poolId, wallet.address) as Promise<bigint>,
    ]);
    return { wallet, nativeBalance, tokenBalance, allowance, activePositionId };
  }

  private async updateWallet(
    index: number,
    stage?: WalletCheckpoint["stage"],
    transaction?: TransactionCheckpoint,
  ): Promise<void> {
    const checkpoint = this.checkpoint;
    requireCondition(checkpoint, "Checkpoint was not initialized.");
    const current = checkpoint.wallets[index];
    requireCondition(current, `Checkpoint wallet index ${index} is unavailable.`);
    const state = await this.readWalletState(index);
    const transactions = transaction
      ? [...current.transactions, transaction]
      : current.transactions;
    checkpoint.wallets[index] = {
      ...current,
      stage:
        stage ??
        this.inferredStage(
          current,
          state.nativeBalance,
          state.tokenBalance,
          state.allowance,
          state.activePositionId,
        ),
      nativeBalance: state.nativeBalance.toString(),
      tokenBalance: state.tokenBalance.toString(),
      allowance: state.allowance.toString(),
      activePositionId: state.activePositionId.toString(),
      transactions,
    };
  }

  private async updatePool(): Promise<void> {
    const checkpoint = this.checkpoint;
    requireCondition(checkpoint, "Checkpoint was not initialized.");
    const pool = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    checkpoint.poolStatus = pool.status.toString();
    checkpoint.activePositionCount = pool.activePositionCount.toString();
    checkpoint.escrowedAmount = pool.escrowedAmount.toString();
    checkpoint.completedDrawRoundCount = pool.completedDrawRoundCount.toString();
    checkpoint.claimedPrizeCount = pool.claimedPrizeCount.toString();
  }

  private async saveCheckpoint(): Promise<void> {
    const checkpoint = this.checkpoint;
    requireCondition(checkpoint, "Checkpoint was not initialized.");
    await this.updatePool();
    checkpoint.revision += 1;
    checkpoint.updatedAt = new Date().toISOString();
    await this.checkpointStore.save(checkpoint);
  }

  private async reconcileAllWallets(): Promise<void> {
    const checkpoint = this.checkpoint;
    requireCondition(checkpoint, "Checkpoint was not initialized.");
    for (let index = 0; index < this.wallets().length; index += 1) {
      const previous = checkpoint.wallets[index];
      const state = await this.readWalletState(index);
      const recordedPositionId = BigInt(previous.activePositionId);
      if (recordedPositionId !== 0n && recordedPositionId !== state.activePositionId) {
        const recordedPosition = await this.runtime.pop33.getPosition(recordedPositionId);
        requireCondition(
          recordedPosition.active === false,
          `Checkpoint contradicts live active position for wallet index ${index}.`,
        );
      }
      await this.updateWallet(index);
    }
    await this.saveCheckpoint();
  }

  async reconcileCheckpoint(): Promise<OperatorCheckpoint> {
    await this.ensureCheckpoint();
    await this.reconcileAllWallets();
    return checkpointClone(this.checkpoint as OperatorCheckpoint);
  }

  private async receipt(
    operation: TransactionCheckpoint["operation"],
    response: TransactionResponseLike,
  ): Promise<TransactionCheckpoint> {
    return (await this.receiptWithDetails(operation, response)).transaction;
  }

  private async receiptWithDetails(
    operation: TransactionCheckpoint["operation"],
    response: TransactionResponseLike,
  ): Promise<{ transaction: TransactionCheckpoint; receipt: ChainReceiptLike }> {
    const receipt = await response.wait();
    requireCondition(receipt, `${operation} transaction has no receipt.`);
    return {
      transaction: toCheckpointTransaction(operation, response, receipt),
      receipt,
    };
  }

  private async sendJournaled(input: {
    checkpointOperation: TransactionCheckpoint["operation"];
    action: OperationAction;
    scope: string;
    wallet: { address: string };
    parameters?: unknown;
    poolId?: bigint;
    round?: number;
    send(nonce?: number): Promise<TransactionResponseLike>;
  }): Promise<{ transaction: TransactionCheckpoint; receipt: ChainReceiptLike }> {
    if (!this.transactionJournal) {
      return this.receiptWithDetails(input.checkpointOperation, await input.send());
    }

    const chainId = await this.chainId();
    const { tokenAddress, contractAddress } = await this.addresses();
    const result = await executeJournaledOperation({
      journal: this.transactionJournal,
      meaning: {
        action: input.action,
        scope: input.scope,
        walletAddress: input.wallet.address,
        chainId,
        contractAddress,
        tokenAddress,
        poolId: input.poolId,
        round: input.round,
        parameters: input.parameters,
      },
      getNonce: () => this.runtime.provider.getTransactionCount(input.wallet.address, "pending"),
      broadcast: (nonce) => input.send(nonce),
    });

    const hash = result.operation.transactionHash;
    const nonce = result.operation.nonce;
    requireCondition(hash && nonce !== null, "Confirmed journal operation is missing hash or nonce.");
    const receipt = await this.runtime.provider.getTransactionReceipt(hash);
    requireCondition(receipt, "Confirmed journal operation receipt is unavailable from provider.");
    const response: TransactionResponseLike = {
      hash,
      nonce,
      wait: async () => receipt,
    };
    return {
      transaction: toCheckpointTransaction(input.checkpointOperation, response, receipt),
      receipt,
    };
  }

  private walletOperationSequence(
    index: number,
    operation: TransactionCheckpoint["operation"],
  ): number {
    const checkpoint = this.checkpoint;
    requireCondition(checkpoint, "Checkpoint was not initialized.");
    return checkpoint.wallets[index].transactions.filter(
      (transaction) => transaction.operation === operation,
    ).length + 1;
  }

  async preflight() {
    this.assertMode("preflight");
    const checkpoint = await this.ensureCheckpoint();
    const chainId = await this.chainId();
    const { tokenAddress, contractAddress } = await this.addresses();
    const [tokenCode, contractCode, tokenDecimals, paymentToken, pool] = await Promise.all([
      this.runtime.provider.getCode(tokenAddress),
      this.runtime.provider.getCode(contractAddress),
      this.runtime.token.decimals() as Promise<bigint>,
      this.runtime.pop33.paymentToken() as Promise<string>,
      this.runtime.pop33.getPool(this.poolId) as Promise<PoolLike>,
    ]);
    requireCondition(tokenCode !== "0x", "Payment token has no bytecode.");
    requireCondition(contractCode !== "0x", "POP33 contract has no bytecode.");
    requireCondition(tokenDecimals === 6n, "Payment token decimals are not 6.");
    requireCondition(getAddress(paymentToken) === tokenAddress, "POP33 payment token mismatch.");
    requireCondition(pool.entryPrice === DEMO_V1_PARAMETERS.entryPrice, "Entry price mismatch.");
    requireCondition(
      pool.positionsPerPool === DEMO_V1_PARAMETERS.positionsPerPool,
      "Pool capacity mismatch.",
    );
    requireCondition(
      pool.drawRoundCount === DEMO_V1_PARAMETERS.drawRoundCount,
      "Draw round count mismatch.",
    );
    return {
      chainId,
      tokenAddress,
      contractAddress,
      tokenDecimals,
      poolStatus: pool.status,
      entryPrice: pool.entryPrice,
      positionsPerPool: pool.positionsPerPool,
      maxActivePositionsPerUser:
        (await this.runtime.pop33.MAX_ACTIVE_POSITIONS_PER_USER()) as bigint,
      maxOpenPools: (await this.runtime.pop33.MAX_OPEN_POOLS()) as bigint,
      wallets: checkpointClone(checkpoint).wallets,
    };
  }

  async status() {
    this.assertMode("status");
    const checkpoint = await this.reconcileCheckpoint();
    const pool = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    const rounds = [];
    for (let round = 1; round <= Number(pool.drawRoundCount); round += 1) {
      const drawRound = await this.runtime.pop33.getDrawRound(this.poolId, round);
      rounds.push({
        round,
        scheduledAt: drawRound.scheduledAt as bigint,
        status: drawRound.status as bigint,
        winner: drawRound.winner as string,
        claimed: drawRound.claimed as boolean,
      });
    }
    return { pool, rounds, wallets: checkpoint.wallets };
  }

  async fund(): Promise<void> {
    return this.runExclusiveWrite("fund", () => this.#fundUnlocked());
  }

  async drip(): Promise<void> {
    return this.runExclusiveWrite("drip", () => this.#dripUnlocked());
  }

  async approve(): Promise<void> {
    return this.runExclusiveWrite("approve", () => this.#approveUnlocked());
  }

  async joinTo99(options: JoinTo99Options = {}): Promise<number> {
    return this.runExclusiveWrite("join-to-99", () => this.#joinTo99Unlocked(options));
  }

  async finalJoin(confirmation: string): Promise<void> {
    return this.runExclusiveWrite("final-join", () => this.#finalJoinUnlocked(confirmation));
  }

  async withdrawAllBeforeLock(): Promise<number> {
    return this.runExclusiveWrite("withdraw-all-before-lock", () =>
      this.#withdrawAllBeforeLockUnlocked(),
    );
  }

  async drawNext(): Promise<number> {
    return this.runExclusiveWrite("draw-next", () => this.#drawNextUnlocked());
  }

  async claimFinalized(): Promise<number> {
    return this.runExclusiveWrite("claim-finalized", () => this.#claimFinalizedUnlocked());
  }

  async #fundUnlocked(): Promise<void> {
    await this.ensureCheckpoint();
    requireCondition(this.runtime.networkHelpers, "Local balance helper is unavailable.");
    for (let index = 0; index < this.wallets().length; index += 1) {
      const wallet = this.wallets()[index];
      await this.runtime.networkHelpers.setBalance(wallet.address, LOCAL_WALLET_ETH_BALANCE);
      requireCondition(
        (await this.runtime.provider.getBalance(wallet.address)) === LOCAL_WALLET_ETH_BALANCE,
        `Native funding verification failed for wallet index ${index}.`,
      );
      await this.updateWallet(index, "funded");
    }
    await this.saveCheckpoint();
  }

  async #dripUnlocked(): Promise<void> {
    await this.ensureCheckpoint();
    for (let index = 0; index < this.wallets().length; index += 1) {
      const wallet = this.wallets()[index];
      const before = (await this.runtime.token.balanceOf(wallet.address)) as bigint;
      if (before >= DEMO_V1_PARAMETERS.dripAmount) {
        await this.updateWallet(index);
        continue;
      }
      await this.runtime.token.connect(wallet).drip.staticCall();
      const sequence = this.walletOperationSequence(index, "dripped");
      const { transaction } = await this.sendJournaled({
        checkpointOperation: "dripped",
        action: "faucet",
        scope: `wallet-${index}-drip-${sequence}`,
        wallet,
        parameters: { amount: DEMO_V1_PARAMETERS.dripAmount },
        send: (nonce) => this.runtime.token.connect(wallet).drip(
          ...(nonce === undefined ? [] : [{ nonce }]),
        ) as Promise<TransactionResponseLike>,
      });
      const after = (await this.runtime.token.balanceOf(wallet.address)) as bigint;
      requireCondition(
        after - before === DEMO_V1_PARAMETERS.dripAmount,
        `Drip balance delta mismatch for wallet index ${index}.`,
      );
      await this.updateWallet(index, "dripped", transaction);
      await this.saveCheckpoint();
    }
  }

  async #approveUnlocked(): Promise<void> {
    await this.ensureCheckpoint();
    const contractAddress = await this.runtime.pop33.getAddress();
    for (let index = 0; index < this.wallets().length; index += 1) {
      const wallet = this.wallets()[index];
      const allowance = (await this.runtime.token.allowance(
        wallet.address,
        contractAddress,
      )) as bigint;
      if (allowance === DEMO_V1_PARAMETERS.entryPrice) {
        await this.updateWallet(index);
        continue;
      }
      await this.runtime.token
        .connect(wallet)
        .approve.staticCall(contractAddress, DEMO_V1_PARAMETERS.entryPrice);
      const sequence = this.walletOperationSequence(index, "approved");
      const { transaction } = await this.sendJournaled({
        checkpointOperation: "approved",
        action: "approve",
        scope: `wallet-${index}-approval-${sequence}`,
        wallet,
        parameters: { spender: contractAddress, amount: DEMO_V1_PARAMETERS.entryPrice },
        send: (nonce) => this.runtime.token.connect(wallet).approve(
          contractAddress,
          DEMO_V1_PARAMETERS.entryPrice,
          ...(nonce === undefined ? [] : [{ nonce }]),
        ) as Promise<TransactionResponseLike>,
      });
      requireCondition(
        (await this.runtime.token.allowance(wallet.address, contractAddress)) ===
          DEMO_V1_PARAMETERS.entryPrice,
        `Exact allowance verification failed for wallet index ${index}.`,
      );
      await this.updateWallet(index, "approved", transaction);
      await this.saveCheckpoint();
    }
  }

  async #joinTo99Unlocked(options: JoinTo99Options = {}): Promise<number> {
    await this.ensureCheckpoint();
    let submitted = 0;
    for (let index = 0; index < this.wallets().length; index += 1) {
      const poolBefore = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
      requireCondition(
        poolBefore.status === POOL_STATUS.Open,
        `join-to-99 stopped: pool status is ${poolBefore.status}, expected Open.`,
      );
      requireCondition(
        poolBefore.activePositionCount <= 99n,
        `join-to-99 stopped: position count ${poolBefore.activePositionCount} exceeds 99.`,
      );
      if (poolBefore.activePositionCount === 99n) break;
      if (options.maxTransactions !== undefined && submitted >= options.maxTransactions) break;

      const wallet = this.wallets()[index];
      const activePositionId = (await this.runtime.pop33.getActivePositionId(
        this.poolId,
        wallet.address,
      )) as bigint;
      if (activePositionId !== 0n) continue;
      const state = await this.readWalletState(index);
      requireCondition(
        state.tokenBalance >= poolBefore.entryPrice,
        `join-to-99 stopped: insufficient token balance at wallet index ${index}.`,
      );
      requireCondition(
        state.allowance >= poolBefore.entryPrice,
        `join-to-99 stopped: insufficient allowance at wallet index ${index}.`,
      );

      const simulation = await this.runtime.pop33.connect(wallet).join.staticCall();
      requireCondition(
        BigInt(simulation[1]) === this.poolId,
        `join-to-99 simulation selected unexpected pool ${simulation[1]}.`,
      );
      const sequence = this.walletOperationSequence(index, "joined");
      const { transaction } = await this.sendJournaled({
        checkpointOperation: "joined",
        action: "join",
        scope: `wallet-${index}-position-${sequence}`,
        wallet,
        poolId: this.poolId,
        parameters: { expectedPoolId: this.poolId, expectedCount: poolBefore.activePositionCount },
        send: (nonce) => this.runtime.pop33.connect(wallet).join(
          ...(nonce === undefined ? [] : [{ nonce }]),
        ) as Promise<TransactionResponseLike>,
      });
      const poolAfter = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
      requireCondition(
        poolAfter.status === POOL_STATUS.Open &&
          poolAfter.activePositionCount === poolBefore.activePositionCount + 1n &&
          poolAfter.escrowedAmount === poolBefore.escrowedAmount + poolBefore.entryPrice,
        `join-to-99 post-state mismatch at wallet index ${index}.`,
      );
      await this.updateWallet(index, "joined", transaction);
      await this.saveCheckpoint();
      submitted += 1;
      if (poolAfter.activePositionCount % 10n === 0n) {
        this.log(`join-to-99 progress: ${poolAfter.activePositionCount}/99 confirmed`);
      }
    }

    const pool = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    requireCondition(pool.activePositionCount <= 99n, "join-to-99 crossed its hard 99 limit.");
    return submitted;
  }

  async #finalJoinUnlocked(confirmation: string): Promise<void> {
    await this.ensureCheckpoint();
    const expectedConfirmation = await this.finalJoinConfirmation();
    requireCondition(
      confirmation === expectedConfirmation,
      `final-join requires exact confirmation: ${expectedConfirmation}`,
    );
    requireCondition(this.wallets().length === 100, "final-join requires exactly 100 wallets.");
    const poolBefore = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    requireCondition(poolBefore.status === POOL_STATUS.Open, "final-join requires an Open pool.");
    requireCondition(poolBefore.activePositionCount === 99n, "final-join requires exactly 99 positions.");
    requireCondition(
      poolBefore.escrowedAmount === 99n * poolBefore.entryPrice,
      "final-join escrow precondition mismatch.",
    );

    const activeIds = (await this.runtime.pop33.getPoolActivePositionIds(
      this.poolId,
      0,
      100,
    )) as bigint[];
    requireCondition(activeIds.length === 99, "final-join active-position index mismatch.");
    const operatorAddresses = new Set(this.wallets().map((wallet) => wallet.address.toLowerCase()));
    const activeOwners = new Set<string>();
    for (const positionId of activeIds) {
      const position = await this.runtime.pop33.getPosition(positionId);
      requireCondition(position.active === true, `Position ${positionId} is unexpectedly inactive.`);
      const owner = (position.owner as string).toLowerCase();
      requireCondition(operatorAddresses.has(owner), `Position ${positionId} is not operator-owned.`);
      requireCondition(!activeOwners.has(owner), `Duplicate active owner ${owner} in pool.`);
      activeOwners.add(owner);
    }

    const finalIndex = this.wallets().findIndex(
      (wallet) => !activeOwners.has(wallet.address.toLowerCase()),
    );
    requireCondition(finalIndex >= 0, "final-join could not identify the 100th wallet.");
    for (let index = 0; index < this.wallets().length; index += 1) {
      const walletState = await this.readWalletState(index);
      const shouldBeActive = activeOwners.has(walletState.wallet.address.toLowerCase());
      requireCondition(
        shouldBeActive === (walletState.activePositionId !== 0n),
        `final-join wallet membership mismatch at index ${index}.`,
      );
    }
    const wallet = this.wallets()[finalIndex];
    const state = await this.readWalletState(finalIndex);
    requireCondition(state.activePositionId === 0n, "Final wallet already has an active position.");
    requireCondition(state.tokenBalance >= poolBefore.entryPrice, "Final wallet token balance is insufficient.");
    requireCondition(state.allowance >= poolBefore.entryPrice, "Final wallet allowance is insufficient.");

    const simulation = await this.runtime.pop33.connect(wallet).join.staticCall();
    requireCondition(BigInt(simulation[1]) === this.poolId, "final-join simulation selected another pool.");
    const simulatedPositionId = BigInt(simulation[0]);
    const sequence = this.walletOperationSequence(finalIndex, "joined");
    const { transaction, receipt } = await this.sendJournaled({
      checkpointOperation: "joined",
      action: "join",
      scope: `wallet-${finalIndex}-position-${sequence}-final-lock`,
      wallet,
      poolId: this.poolId,
      parameters: { expectedPoolId: this.poolId, expectedCount: 99n, finalJoin: true },
      send: (nonce) => this.runtime.pop33.connect(wallet).join(
        ...(nonce === undefined ? [] : [{ nonce }]),
      ) as Promise<TransactionResponseLike>,
    });
    const [poolAfter, finalPositionId] = await Promise.all([
      this.runtime.pop33.getPool(this.poolId) as Promise<PoolLike>,
      this.runtime.pop33.getActivePositionId(this.poolId, wallet.address) as Promise<bigint>,
    ]);
    requireCondition(
      finalPositionId !== 0n && finalPositionId === simulatedPositionId,
      "CRITICAL: final join did not create the simulated active position in the expected pool.",
    );
    const finalPosition = await this.runtime.pop33.getPosition(finalPositionId);
    requireCondition(
      BigInt(finalPosition.poolId) === this.poolId &&
        getAddress(finalPosition.owner as string) === getAddress(wallet.address) &&
        finalPosition.active === true,
      "CRITICAL: final join position owner, pool, or active state mismatch.",
    );

    let joinedEventConfirmed = false;
    for (const log of receipt.logs) {
      try {
        const parsedLog = this.runtime.pop33.interface.parseLog(log);
        if (
          parsedLog?.name === "PositionJoined" &&
          BigInt(parsedLog.args.positionId) === finalPositionId &&
          BigInt(parsedLog.args.poolId) === this.poolId &&
          getAddress(parsedLog.args.user) === getAddress(wallet.address) &&
          BigInt(parsedLog.args.amount) === poolBefore.entryPrice &&
          BigInt(parsedLog.args.activePositionCount) === 100n
        ) {
          joinedEventConfirmed = true;
        }
      } catch {
        // The receipt also contains ERC-20 logs that are not part of the POP33 ABI.
      }
    }
    requireCondition(joinedEventConfirmed, "CRITICAL: final join PositionJoined event mismatch.");
    requireCondition(
      poolAfter.status === POOL_STATUS.Locked &&
        poolAfter.activePositionCount === 100n &&
        poolAfter.escrowedAmount === DEMO_V1_PARAMETERS.totalPrizeAmount,
      "final-join did not produce the expected Locked 100/100 state.",
    );
    for (let round = 1; round <= Number(poolAfter.drawRoundCount); round += 1) {
      const drawRound = await this.runtime.pop33.getDrawRound(this.poolId, round);
      requireCondition(
        drawRound.status === 0n &&
          drawRound.scheduledAt === poolAfter.lockedAt + BigInt(round) * poolAfter.drawInterval,
        `Draw schedule mismatch for round ${round}.`,
      );
    }
    await this.updateWallet(finalIndex, "joined", transaction);
    await this.saveCheckpoint();
  }

  async #withdrawAllBeforeLockUnlocked(): Promise<number> {
    await this.ensureCheckpoint();
    const initialPool = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    requireCondition(initialPool.status === POOL_STATUS.Open, "Withdrawal mode requires an Open pool.");
    let withdrawn = 0;
    for (let index = 0; index < this.wallets().length; index += 1) {
      const wallet = this.wallets()[index];
      const positionId = (await this.runtime.pop33.getActivePositionId(
        this.poolId,
        wallet.address,
      )) as bigint;
      if (positionId === 0n) continue;
      const poolBefore = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
      requireCondition(poolBefore.status === POOL_STATUS.Open, "Pool left Open during withdrawal.");
      const balanceBefore = (await this.runtime.token.balanceOf(wallet.address)) as bigint;
      await this.runtime.pop33.connect(wallet).withdraw.staticCall(positionId);
      const { transaction } = await this.sendJournaled({
        checkpointOperation: "withdrawn",
        action: "withdraw",
        scope: `position-${positionId}-withdrawal`,
        wallet,
        poolId: this.poolId,
        parameters: { positionId },
        send: (nonce) => this.runtime.pop33.connect(wallet).withdraw(
          positionId,
          ...(nonce === undefined ? [] : [{ nonce }]),
        ) as Promise<TransactionResponseLike>,
      });
      const [poolAfter, balanceAfter, activeAfter, positionAfter] = await Promise.all([
        this.runtime.pop33.getPool(this.poolId) as Promise<PoolLike>,
        this.runtime.token.balanceOf(wallet.address) as Promise<bigint>,
        this.runtime.pop33.getActivePositionId(this.poolId, wallet.address) as Promise<bigint>,
        this.runtime.pop33.getPosition(positionId),
      ]);
      requireCondition(
        balanceAfter === balanceBefore + poolBefore.entryPrice &&
          activeAfter === 0n &&
          positionAfter.active === false &&
          poolAfter.activePositionCount + 1n === poolBefore.activePositionCount &&
          poolAfter.escrowedAmount + poolBefore.entryPrice === poolBefore.escrowedAmount,
        `Withdrawal post-state mismatch at wallet index ${index}.`,
      );
      await this.updateWallet(index, "withdrawn", transaction);
      await this.saveCheckpoint();
      withdrawn += 1;
    }
    const poolAfter = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    requireCondition(
      poolAfter.activePositionCount === 0n && poolAfter.escrowedAmount === 0n,
      "Withdrawal mode did not return the pool to 0/100 with zero escrow.",
    );
    return withdrawn;
  }

  async #drawNextUnlocked(): Promise<number> {
    const checkpoint = await this.ensureCheckpoint();
    const poolBefore = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    requireCondition(
      poolBefore.status === POOL_STATUS.Locked || poolBefore.status === POOL_STATUS.Drawing,
      `draw-next requires Locked or Drawing status, received ${poolBefore.status}.`,
    );
    const roundNumber = Number(poolBefore.completedDrawRoundCount + 1n);
    requireCondition(
      roundNumber <= Number(poolBefore.drawRoundCount),
      "draw-next found no remaining round.",
    );
    const drawRoundBefore = await this.runtime.pop33.getDrawRound(this.poolId, roundNumber);
    const latestBlock = await this.runtime.provider.getBlock("latest");
    requireCondition(latestBlock, "Latest block is unavailable.");
    requireCondition(
      BigInt(latestBlock.timestamp) >= drawRoundBefore.scheduledAt,
      `draw-next round ${roundNumber} is not yet scheduled.`,
    );
    await this.runtime.pop33
      .connect(this.runtime.drawExecutor)
      .executeDraw.staticCall(this.poolId, roundNumber);
    const { transaction } = await this.sendJournaled({
      checkpointOperation: "draw",
      action: "draw",
      scope: `pool-${this.poolId}-round-${roundNumber}`,
      wallet: this.runtime.drawExecutor,
      poolId: this.poolId,
      round: roundNumber,
      parameters: { poolId: this.poolId, roundNumber },
      send: (nonce) => this.runtime.pop33.connect(this.runtime.drawExecutor).executeDraw(
        this.poolId,
        roundNumber,
        ...(nonce === undefined ? [] : [{ nonce }]),
      ) as Promise<TransactionResponseLike>,
    });
    const [poolAfter, drawRoundAfter] = await Promise.all([
      this.runtime.pop33.getPool(this.poolId) as Promise<PoolLike>,
      this.runtime.pop33.getDrawRound(this.poolId, roundNumber),
    ]);
    requireCondition(
      drawRoundAfter.status === 1n &&
        drawRoundAfter.winningPositionId !== 0n &&
        poolAfter.completedDrawRoundCount === poolBefore.completedDrawRoundCount + 1n,
      `draw-next post-state mismatch for round ${roundNumber}.`,
    );
    for (let priorRound = 1; priorRound < roundNumber; priorRound += 1) {
      const prior = await this.runtime.pop33.getDrawRound(this.poolId, priorRound);
      requireCondition(
        prior.winningPositionId !== drawRoundAfter.winningPositionId,
        `Round ${roundNumber} repeated winning position ${drawRoundAfter.winningPositionId}.`,
      );
    }
    const winningPosition = await this.runtime.pop33.getPosition(
      drawRoundAfter.winningPositionId,
    );
    requireCondition(
      BigInt(winningPosition.poolId) === this.poolId &&
        getAddress(winningPosition.owner as string) ===
          getAddress(drawRoundAfter.winner as string) &&
        winningPosition.active === true,
      `Round ${roundNumber} winner does not own the active winning position in the expected pool.`,
    );
    const winner = this.walletProvider.findWallet(drawRoundAfter.winner as string);
    requireCondition(winner, `No operator wallet maps to round ${roundNumber} winner.`);
    const winnerIndex = this.wallets().findIndex(
      (wallet) => wallet.address.toLowerCase() === winner.address.toLowerCase(),
    );
    const winnerCheckpoint = checkpoint.wallets[winnerIndex];
    winnerCheckpoint.winningRounds = Array.from(
      new Set([...winnerCheckpoint.winningRounds, roundNumber]),
    ).sort((left, right) => left - right);
    winnerCheckpoint.stage = "winner";
    checkpoint.operatorTransactions.push(transaction);
    await this.updateWallet(winnerIndex, "winner");
    await this.saveCheckpoint();
    return roundNumber;
  }

  async #claimFinalizedUnlocked(): Promise<number> {
    const checkpoint = await this.ensureCheckpoint();
    const poolAtStart = (await this.runtime.pop33.getPool(this.poolId)) as PoolLike;
    let claimed = 0;
    for (let roundNumber = 1; roundNumber <= Number(poolAtStart.drawRoundCount); roundNumber += 1) {
      const roundBefore = await this.runtime.pop33.getDrawRound(this.poolId, roundNumber);
      if (roundBefore.status !== 1n || roundBefore.claimed === true) continue;
      const winner = this.walletProvider.findWallet(roundBefore.winner as string);
      requireCondition(winner, `No operator signer maps to finalized round ${roundNumber} winner.`);
      const winnerIndex = this.wallets().findIndex(
        (wallet) => wallet.address.toLowerCase() === winner.address.toLowerCase(),
      );
      const [balanceBefore, poolBefore] = await Promise.all([
        this.runtime.token.balanceOf(winner.address) as Promise<bigint>,
        this.runtime.pop33.getPool(this.poolId) as Promise<PoolLike>,
      ]);
      await this.runtime.pop33.connect(winner).claim.staticCall(this.poolId, roundNumber);
      const { transaction } = await this.sendJournaled({
        checkpointOperation: "claimed",
        action: "claim",
        scope: `pool-${this.poolId}-round-${roundNumber}-claim`,
        wallet: winner,
        poolId: this.poolId,
        round: roundNumber,
        parameters: { poolId: this.poolId, roundNumber },
        send: (nonce) => this.runtime.pop33.connect(winner).claim(
          this.poolId,
          roundNumber,
          ...(nonce === undefined ? [] : [{ nonce }]),
        ) as Promise<TransactionResponseLike>,
      });
      const [roundAfter, poolAfter, balanceAfter] = await Promise.all([
        this.runtime.pop33.getDrawRound(this.poolId, roundNumber),
        this.runtime.pop33.getPool(this.poolId) as Promise<PoolLike>,
        this.runtime.token.balanceOf(winner.address) as Promise<bigint>,
      ]);
      requireCondition(
        roundAfter.claimed === true &&
          balanceAfter === balanceBefore + roundBefore.prizeAmount &&
          poolAfter.claimedPrizeCount === poolBefore.claimedPrizeCount + 1n &&
          poolAfter.escrowedAmount + roundBefore.prizeAmount === poolBefore.escrowedAmount,
        `Claim post-state mismatch for round ${roundNumber}.`,
      );
      const walletCheckpoint = checkpoint.wallets[winnerIndex];
      walletCheckpoint.claimedRounds = Array.from(
        new Set([...walletCheckpoint.claimedRounds, roundNumber]),
      ).sort((left, right) => left - right);
      await this.updateWallet(winnerIndex, "claimed", transaction);
      await this.saveCheckpoint();
      claimed += 1;
    }
    return claimed;
  }
}
