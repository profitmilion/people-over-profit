import { getAddress, isAddress, Wallet, ZeroAddress } from "ethers";

import { DEMO_V1_PARAMETERS } from "../lib/demo-v1-config.js";
import type {
  JournalOperation,
  OperationMeaning,
  TransactionJournal,
} from "../operator/transaction-journal.js";
import {
  executeJournaledOperation,
  recoverTransactionJournal,
  type BroadcastResponse,
  type CoordinatorFailurePoint,
  type TransactionRecoveryProvider,
} from "../operator/transaction-recovery.js";

export const BASE_SEPOLIA_SMOKE_CHAIN_ID = 84_532n;
export const BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS = getAddress(
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786",
);
export const BASE_SEPOLIA_SMOKE_POP33_ADDRESS = getAddress(
  "0x140DA1b29F0B00b003Cabe86AE1a473d6745f56F",
);
export const RECORDED_BASE_SEPOLIA_DEPLOYER = getAddress(
  "0xCaeb6D19d6d85349a08172e0efb9bb8541E4BeFB",
);
export const BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION =
  "I UNDERSTAND THIS SMOKE TEST WRITES TO BASE SEPOLIA";
export const BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION =
  "I AUTHORIZE DUSDC FAUCET APPROVE JOIN AND WITHDRAW";
export const BASE_SEPOLIA_SMOKE_RECEIPT_TIMEOUT_MS = 180_000;
export const BASE_SEPOLIA_SMOKE_MAX_SAFE_ACTIVE_POSITIONS = 89n;

const CONSERVATIVE_JOIN_GAS = 400_000n;
const CONSERVATIVE_WITHDRAW_GAS = 250_000n;
const CONSERVATIVE_FAUCET_GAS = 150_000n;
const GAS_PRICE_BUFFER = 2n;
const MAX_READ_ATTEMPTS = 3;

export type SmokeWriteAction = "faucet" | "approve" | "join" | "withdraw";
export type SmokeRequestedAction = SmokeWriteAction | "draw" | "claim" | "deploy" | "admin";

export interface SmokeReadConfiguration {
  rpcUrl: string;
  walletAddress: string;
}

export interface SmokePoolState {
  id: bigint;
  status: bigint;
  activePositionCount: bigint;
  escrowedAmount: bigint;
  entryPrice: bigint;
  positionsPerPool: bigint;
  drawRoundCount: bigint;
  prizePerRound: bigint;
  totalPrizeAmount: bigint;
  drawInterval: bigint;
}

export interface SmokePositionState {
  id: bigint;
  poolId: bigint;
  owner: string;
  active: boolean;
}

export interface SmokeContractParameters {
  paymentToken: string;
  entryPrice: bigint;
  positionsPerPool: bigint;
  maxActivePositionsPerUser: bigint;
  maxOpenPools: bigint;
  drawRoundCount: bigint;
  prizePerRound: bigint;
  totalPrizeAmount: bigint;
  drawInterval: bigint;
}

export interface SmokeTokenState {
  name: string;
  symbol: string;
  decimals: bigint;
  dripAmount: bigint;
  dripCooldown: bigint;
  nextDripAt: bigint;
  balance: bigint;
  allowance: bigint;
}

export interface SmokeOperationEvidence {
  action: SmokeWriteAction;
  amount?: bigint;
  poolId?: bigint;
  positionId?: bigint;
}

export interface SmokeRuntime {
  readonly walletAddress: string;
  readonly recoveryProvider: TransactionRecoveryProvider;
  getChainId(): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getNativeBalance(): Promise<bigint>;
  getFeePerGas(): Promise<bigint>;
  getTokenState(): Promise<SmokeTokenState>;
  getContractParameters(): Promise<SmokeContractParameters>;
  getOpenPoolIds(): Promise<bigint[]>;
  getPool(poolId: bigint): Promise<SmokePoolState>;
  getActivePositionId(poolId: bigint): Promise<bigint>;
  getPosition(positionId: bigint): Promise<SmokePositionState>;
  estimateAction(action: SmokeWriteAction, positionId?: bigint): Promise<bigint>;
  getPendingNonce(): Promise<number>;
  broadcast(action: SmokeWriteAction, nonce: number, positionId?: bigint): Promise<BroadcastResponse>;
  verifySubmittedOperation(operation: JournalOperation): Promise<void>;
  verifyConfirmedOperation(operation: JournalOperation): Promise<SmokeOperationEvidence>;
}

export interface SmokeGasPlan {
  faucet: bigint;
  approve: bigint;
  join: bigint;
  withdraw: bigint;
  feePerGas: bigint;
  requiredNativeBalance: bigint;
}

export interface SmokePreflightReport {
  mode: "read-only";
  chainId: bigint;
  walletAddress: string;
  tokenAddress: string;
  contractAddress: string;
  nativeBalance: bigint;
  tokenState: SmokeTokenState;
  pool: SmokePoolState;
  activePositionId: bigint;
  gasPlan: SmokeGasPlan;
  blockers: string[];
}

export interface SmokeWriteResult {
  walletAddress: string;
  poolId: bigint;
  positionId: bigint;
  finalTokenBalance: bigint;
  finalAllowance: bigint;
  operationIds: string[];
  transactionHashes: string[];
}

export interface ReadRetryOptions {
  attempts?: number;
  delayMs?: number;
  delay?(milliseconds: number): Promise<void>;
}

function requireEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required and cannot be empty.`);
  return value;
}

export function validateSmokeRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BASE_SEPOLIA_SMOKE_RPC_URL must be a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("BASE_SEPOLIA_SMOKE_RPC_URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("BASE_SEPOLIA_SMOKE_RPC_URL must not contain URL credentials.");
  }
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) {
    throw new Error("BASE_SEPOLIA_SMOKE_RPC_URL must not point to a local endpoint.");
  }
  return value;
}

export function assertSingleSmokeWallet(addresses: readonly string[]): string {
  if (addresses.length !== 1) {
    throw new Error("Base Sepolia smoke harness requires exactly one dedicated wallet.");
  }
  if (!isAddress(addresses[0])) throw new Error("Smoke wallet address is invalid.");
  const address = getAddress(addresses[0]);
  if (address === ZeroAddress) throw new Error("Smoke wallet cannot be the zero address.");
  if (address === RECORDED_BASE_SEPOLIA_DEPLOYER) {
    throw new Error("Refusing to use the recorded deployment wallet as the smoke wallet.");
  }
  return address;
}

export function assertSmokeAction(action: SmokeRequestedAction): asserts action is SmokeWriteAction {
  if (!["faucet", "approve", "join", "withdraw"].includes(action)) {
    throw new Error(`Smoke harness action ${action} is prohibited.`);
  }
}

export function readSmokeReadConfiguration(env: NodeJS.ProcessEnv): SmokeReadConfiguration {
  return {
    rpcUrl: validateSmokeRpcUrl(requireEnvironmentValue(env, "BASE_SEPOLIA_SMOKE_RPC_URL")),
    walletAddress: assertSingleSmokeWallet([
      requireEnvironmentValue(env, "BASE_SEPOLIA_SMOKE_WALLET_ADDRESS"),
    ]),
  };
}

export function assertSmokeWriteAuthorization(
  cliWriteRequested: boolean,
  env: NodeJS.ProcessEnv,
): void {
  if (!cliWriteRequested) {
    throw new Error("Write smoke is disabled: the explicit --write-smoke CLI flag is missing.");
  }
  if (env.BASE_SEPOLIA_SMOKE_NETWORK_CONFIRM?.trim() !== BASE_SEPOLIA_SMOKE_NETWORK_CONFIRMATION) {
    throw new Error("Write smoke is disabled: the exact Base Sepolia confirmation is missing.");
  }
  if (env.BASE_SEPOLIA_SMOKE_FLOW_CONFIRM?.trim() !== BASE_SEPOLIA_SMOKE_FLOW_CONFIRMATION) {
    throw new Error("Write smoke is disabled: the exact reversible-flow confirmation is missing.");
  }
}

export function readDedicatedSmokePrivateKey(
  env: NodeJS.ProcessEnv,
  expectedAddress: string,
): string {
  const value = requireEnvironmentValue(env, "BASE_SEPOLIA_SMOKE_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error("BASE_SEPOLIA_SMOKE_PRIVATE_KEY must be a valid non-zero 32-byte key.");
  }
  let wallet: Wallet;
  try {
    wallet = new Wallet(value);
  } catch {
    throw new Error("BASE_SEPOLIA_SMOKE_PRIVATE_KEY is outside the valid key range.");
  }
  if (wallet.address !== getAddress(expectedAddress)) {
    throw new Error("Dedicated smoke private key does not match the configured public smoke address.");
  }
  return value;
}

export async function readWithRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: ReadRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_READ_ATTEMPTS;
  const delayMs = options.delayMs ?? 500;
  const delay = options.delay ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(delayMs * attempt);
    }
  }
  throw new Error(`Read-only RPC operation failed after ${attempts} attempts: ${label}.`, {
    cause: lastError,
  });
}

function requireEqual(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
}

function requireCode(code: string, label: string): void {
  if (!/^0x[0-9a-fA-F]+$/.test(code) || code === "0x") {
    throw new Error(`${label} address has no deployed bytecode.`);
  }
}

function makeGasPlan(
  faucet: bigint,
  approve: bigint,
  feePerGas: bigint,
): SmokeGasPlan {
  if (feePerGas <= 0n) throw new Error("Provider returned no usable positive gas price.");
  const totalGas = faucet + approve + CONSERVATIVE_JOIN_GAS + CONSERVATIVE_WITHDRAW_GAS;
  return {
    faucet,
    approve,
    join: CONSERVATIVE_JOIN_GAS,
    withdraw: CONSERVATIVE_WITHDRAW_GAS,
    feePerGas,
    requiredNativeBalance: totalGas * feePerGas * GAS_PRICE_BUFFER,
  };
}

export async function runSmokeReadOnlyPreflight(
  runtime: SmokeRuntime,
  nowSeconds = BigInt(Math.floor(Date.now() / 1_000)),
  retryOptions: ReadRetryOptions = {},
): Promise<SmokePreflightReport> {
  const walletAddress = assertSingleSmokeWallet([runtime.walletAddress]);
  const chainId = await readWithRetry("chain ID", () => runtime.getChainId(), retryOptions);
  if (chainId !== BASE_SEPOLIA_SMOKE_CHAIN_ID) {
    throw new Error(`Refusing smoke harness: expected Base Sepolia chain ID 84532, received ${chainId}.`);
  }
  const [tokenCode, contractCode] = await Promise.all([
    readWithRetry("dUSDC bytecode", () => runtime.getCode(BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS), retryOptions),
    readWithRetry("POP33 bytecode", () => runtime.getCode(BASE_SEPOLIA_SMOKE_POP33_ADDRESS), retryOptions),
  ]);
  requireCode(tokenCode, "dUSDC");
  requireCode(contractCode, "POP33");

  const [tokenState, parameters, nativeBalance, openPoolIds, feePerGas] = await Promise.all([
    readWithRetry("dUSDC state", () => runtime.getTokenState(), retryOptions),
    readWithRetry("POP33 parameters", () => runtime.getContractParameters(), retryOptions),
    readWithRetry("smoke wallet native balance", () => runtime.getNativeBalance(), retryOptions),
    readWithRetry("open pool IDs", () => runtime.getOpenPoolIds(), retryOptions),
    readWithRetry("gas price", () => runtime.getFeePerGas(), retryOptions),
  ]);
  if (getAddress(parameters.paymentToken) !== BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS) {
    throw new Error("POP33 paymentToken() does not match the recorded dUSDC address.");
  }
  if (tokenState.name !== "POP33 Demo USD" || tokenState.symbol !== "dUSDC") {
    throw new Error("Token identity does not match POP33 Demo USD (dUSDC).");
  }
  requireEqual(tokenState.decimals, 6n, "dUSDC decimals");
  requireEqual(tokenState.dripAmount, DEMO_V1_PARAMETERS.dripAmount, "dUSDC drip amount");
  requireEqual(tokenState.dripCooldown, DEMO_V1_PARAMETERS.dripCooldownSeconds, "dUSDC cooldown");
  requireEqual(parameters.entryPrice, DEMO_V1_PARAMETERS.entryPrice, "POP33 entry price");
  requireEqual(parameters.positionsPerPool, DEMO_V1_PARAMETERS.positionsPerPool, "POP33 pool capacity");
  requireEqual(parameters.maxActivePositionsPerUser, 10n, "POP33 user position limit");
  requireEqual(parameters.maxOpenPools, 10n, "POP33 open-pool limit");
  requireEqual(parameters.drawRoundCount, DEMO_V1_PARAMETERS.drawRoundCount, "POP33 draw rounds");
  requireEqual(parameters.prizePerRound, DEMO_V1_PARAMETERS.prizePerRound, "POP33 prize per round");
  requireEqual(parameters.totalPrizeAmount, DEMO_V1_PARAMETERS.totalPrizeAmount, "POP33 total prizes");
  requireEqual(parameters.drawInterval, DEMO_V1_PARAMETERS.drawIntervalSeconds, "POP33 draw interval");
  if (openPoolIds.length === 0) throw new Error("No existing open pool is available for a reversible smoke test.");

  const poolId = openPoolIds[0];
  const [pool, activePositionId, faucetGas, approveGas] = await Promise.all([
    readWithRetry("current pool", () => runtime.getPool(poolId), retryOptions),
    readWithRetry("smoke wallet pool membership", () => runtime.getActivePositionId(poolId), retryOptions),
    tokenState.nextDripAt <= nowSeconds
      ? readWithRetry("faucet gas estimate", () => runtime.estimateAction("faucet"), retryOptions)
      : Promise.resolve(CONSERVATIVE_FAUCET_GAS),
    readWithRetry("approval gas estimate", () => runtime.estimateAction("approve"), retryOptions),
  ]);
  if (pool.id !== poolId) throw new Error("Current pool getter returned a mismatched pool ID.");
  requireEqual(pool.entryPrice, DEMO_V1_PARAMETERS.entryPrice, "pool entry price snapshot");
  requireEqual(pool.positionsPerPool, DEMO_V1_PARAMETERS.positionsPerPool, "pool capacity snapshot");
  requireEqual(pool.drawRoundCount, DEMO_V1_PARAMETERS.drawRoundCount, "pool round snapshot");
  requireEqual(pool.prizePerRound, DEMO_V1_PARAMETERS.prizePerRound, "pool prize snapshot");
  requireEqual(pool.totalPrizeAmount, DEMO_V1_PARAMETERS.totalPrizeAmount, "pool total prize snapshot");
  requireEqual(pool.drawInterval, DEMO_V1_PARAMETERS.drawIntervalSeconds, "pool interval snapshot");

  const gasPlan = makeGasPlan(faucetGas, approveGas, feePerGas);
  const blockers: string[] = [];
  if (pool.status !== 0n) blockers.push("Current pool is not Open.");
  if (pool.activePositionCount >= 98n) {
    blockers.push("Current pool has 98 or more active positions; smoke execution is forbidden.");
  } else if (pool.activePositionCount > BASE_SEPOLIA_SMOKE_MAX_SAFE_ACTIVE_POSITIONS) {
    blockers.push("Current pool is inside the conservative ten-position lock safety margin.");
  }
  if (activePositionId !== 0n) blockers.push("Smoke wallet already has an active position in the current pool.");
  if (tokenState.nextDripAt > nowSeconds) blockers.push("dUSDC faucet cooldown has not elapsed.");
  if (nativeBalance < gasPlan.requiredNativeBalance) blockers.push("Smoke wallet has insufficient Base Sepolia ETH for the buffered flow gas plan.");

  return {
    mode: "read-only",
    chainId,
    walletAddress,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    nativeBalance,
    tokenState,
    pool,
    activePositionId,
    gasPlan,
    blockers,
  };
}

export function assertFreshSmokeWriteReady(report: SmokePreflightReport): void {
  if (report.blockers.length > 0) {
    throw new Error(`Write smoke preflight refused: ${report.blockers.join(" ")}`);
  }
}

function scopeFor(action: Exclude<SmokeWriteAction, "withdraw">, poolId: bigint): string {
  return `base-sepolia-smoke-v1:${action}:pool-${poolId}`;
}

function withdrawScope(poolId: bigint, positionId: bigint): string {
  return `base-sepolia-smoke-v1:withdraw:pool-${poolId}:position-${positionId}`;
}

function meaningFor(
  action: SmokeWriteAction,
  walletAddress: string,
  poolId: bigint,
  positionId?: bigint,
): OperationMeaning {
  assertSmokeAction(action);
  return {
    action,
    scope: action === "withdraw"
      ? withdrawScope(poolId, positionId ?? 0n)
      : scopeFor(action, poolId),
    walletAddress,
    chainId: BASE_SEPOLIA_SMOKE_CHAIN_ID,
    contractAddress: BASE_SEPOLIA_SMOKE_POP33_ADDRESS,
    tokenAddress: BASE_SEPOLIA_SMOKE_TOKEN_ADDRESS,
    poolId,
    parameters: action === "approve"
      ? { spender: BASE_SEPOLIA_SMOKE_POP33_ADDRESS, amount: DEMO_V1_PARAMETERS.entryPrice }
      : action === "withdraw"
        ? { positionId: positionId?.toString() }
        : action === "join"
          ? { expectedPoolId: poolId.toString(), entryPrice: DEMO_V1_PARAMETERS.entryPrice }
          : { dripAmount: DEMO_V1_PARAMETERS.dripAmount },
  };
}

function withReceiptTimeout(response: BroadcastResponse, timeoutMs: number): BroadcastResponse {
  return {
    hash: response.hash,
    nonce: response.nonce,
    wait: async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          response.wait(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`Receipt timeout after ${timeoutMs} ms.`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

async function requireCurrentPoolSafety(runtime: SmokeRuntime, poolId: bigint): Promise<SmokePoolState> {
  const pool = await readWithRetry("current pool safety recheck", () => runtime.getPool(poolId));
  if (pool.status !== 0n) throw new Error("Current pool is no longer Open; smoke flow stopped.");
  if (pool.activePositionCount >= 98n) {
    throw new Error("Current pool reached 98 active positions; smoke flow stopped before broadcast.");
  }
  if (pool.activePositionCount > BASE_SEPOLIA_SMOKE_MAX_SAFE_ACTIVE_POSITIONS) {
    throw new Error("Current pool entered the conservative lock safety margin; smoke flow stopped.");
  }
  return pool;
}

async function requirePoolOpenForWithdraw(runtime: SmokeRuntime, poolId: bigint): Promise<SmokePoolState> {
  const pool = await readWithRetry("Open-pool withdraw recheck", () => runtime.getPool(poolId));
  if (pool.status !== 0n) {
    throw new Error("Current pool is no longer Open; withdraw cannot be broadcast.");
  }
  return pool;
}

async function requireActionGas(runtime: SmokeRuntime, action: SmokeWriteAction, positionId?: bigint): Promise<void> {
  const [estimate, feePerGas, balance] = await Promise.all([
    readWithRetry(`${action} gas estimate`, () => runtime.estimateAction(action, positionId)),
    readWithRetry("gas price", () => runtime.getFeePerGas()),
    readWithRetry("smoke wallet native balance", () => runtime.getNativeBalance()),
  ]);
  if (balance < estimate * feePerGas * GAS_PRICE_BUFFER) {
    throw new Error(`Insufficient Base Sepolia ETH for buffered ${action} gas estimate.`);
  }
}

async function recoverAndValidateSmokeJournal(
  runtime: SmokeRuntime,
  journal: TransactionJournal,
  expectedPoolId: bigint,
): Promise<Map<SmokeWriteAction, SmokeOperationEvidence>> {
  const recovered = await recoverTransactionJournal(journal, runtime.recoveryProvider);
  const evidence = new Map<SmokeWriteAction, SmokeOperationEvidence>();
  const seen = new Set<SmokeWriteAction>();
  for (const operation of recovered) {
    assertSmokeAction(operation.action as SmokeRequestedAction);
    const action = operation.action as SmokeWriteAction;
    if (seen.has(action)) throw new Error(`Smoke journal contains more than one ${action} operation.`);
    seen.add(action);
    if (operation.walletAddress !== getAddress(runtime.walletAddress)) {
      throw new Error("Smoke journal contains an operation for another wallet.");
    }
    if (operation.poolId !== expectedPoolId.toString()) {
      throw new Error("Smoke journal pool identity does not match the current preflight.");
    }
    if (operation.status === "confirmed") {
      const confirmed = await runtime.verifyConfirmedOperation(operation);
      if (confirmed.action !== action) throw new Error("Confirmed smoke evidence action mismatch.");
      evidence.set(action, confirmed);
      continue;
    }
    if (operation.status === "prepared") continue;
    if (operation.status === "pending" || operation.status === "broadcast") {
      await runtime.verifySubmittedOperation(operation);
    }
    throw new Error(
      `Smoke recovery stopped in ${operation.status}; operation ${operation.operationId} requires manual review and will not be rebroadcast.`,
    );
  }
  if (evidence.has("approve") && !evidence.has("faucet")) throw new Error("Smoke journal confirmed-order mismatch.");
  if (evidence.has("join") && !evidence.has("approve")) throw new Error("Smoke journal confirmed-order mismatch.");
  if (evidence.has("withdraw") && !evidence.has("join")) throw new Error("Smoke journal confirmed-order mismatch.");
  return evidence;
}

async function executeSmokeStep(input: {
  runtime: SmokeRuntime;
  journal: TransactionJournal;
  action: SmokeWriteAction;
  poolId: bigint;
  positionId?: bigint;
  receiptTimeoutMs: number;
  failureHook?(point: CoordinatorFailurePoint): Promise<void> | void;
}): Promise<{ operation: JournalOperation; evidence: SmokeOperationEvidence }> {
  await requireActionGas(input.runtime, input.action, input.positionId);
  const result = await executeJournaledOperation({
    journal: input.journal,
    meaning: meaningFor(
      input.action,
      input.runtime.walletAddress,
      input.poolId,
      input.positionId,
    ),
    getNonce: () => readWithRetry("pending wallet nonce", () => input.runtime.getPendingNonce()),
    broadcast: async (nonce) => withReceiptTimeout(
      await input.runtime.broadcast(input.action, nonce, input.positionId),
      input.receiptTimeoutMs,
    ),
    failureHook: input.failureHook,
  });
  const evidence = await input.runtime.verifyConfirmedOperation(result.operation);
  return { operation: result.operation, evidence };
}

export async function runSmokeWriteFlow(input: {
  runtime: SmokeRuntime;
  journal: TransactionJournal;
  preflight: SmokePreflightReport;
  receiptTimeoutMs?: number;
  failureHook?(action: SmokeWriteAction, point: CoordinatorFailurePoint): Promise<void> | void;
}): Promise<SmokeWriteResult> {
  const { runtime, journal, preflight } = input;
  if (preflight.chainId !== BASE_SEPOLIA_SMOKE_CHAIN_ID || preflight.walletAddress !== getAddress(runtime.walletAddress)) {
    throw new Error("Write runtime does not match the successful preflight identity.");
  }
  const poolId = preflight.pool.id;
  const recovered = await recoverAndValidateSmokeJournal(runtime, journal, poolId);
  const operationIds: string[] = [];
  const transactionHashes: string[] = [];
  const receiptTimeoutMs = input.receiptTimeoutMs ?? BASE_SEPOLIA_SMOKE_RECEIPT_TIMEOUT_MS;
  if (!Number.isSafeInteger(receiptTimeoutMs) || receiptTimeoutMs < 1 || receiptTimeoutMs > 600_000) {
    throw new Error("Smoke receipt timeout must be between 1 and 600000 milliseconds.");
  }

  if (!recovered.has("faucet")) {
    assertFreshSmokeWriteReady(preflight);
    const before = (await readWithRetry("dUSDC balance before faucet", () => runtime.getTokenState())).balance;
    const step = await executeSmokeStep({
      runtime,
      journal,
      action: "faucet",
      poolId,
      receiptTimeoutMs,
      failureHook: (point) => input.failureHook?.("faucet", point),
    });
    if (step.evidence.amount !== DEMO_V1_PARAMETERS.dripAmount) throw new Error("Faucet receipt evidence amount mismatch.");
    const after = (await readWithRetry("dUSDC balance after faucet", () => runtime.getTokenState())).balance;
    if (after - before !== DEMO_V1_PARAMETERS.dripAmount) throw new Error("Faucet balance delta mismatch.");
    recovered.set("faucet", step.evidence);
    operationIds.push(step.operation.operationId);
    if (step.operation.transactionHash) transactionHashes.push(step.operation.transactionHash);
  }

  if (!recovered.has("approve")) {
    const token = await readWithRetry("token state before approval", () => runtime.getTokenState());
    if (token.balance < DEMO_V1_PARAMETERS.entryPrice) throw new Error("Smoke wallet lacks 33 dUSDC after faucet.");
    const step = await executeSmokeStep({
      runtime,
      journal,
      action: "approve",
      poolId,
      receiptTimeoutMs,
      failureHook: (point) => input.failureHook?.("approve", point),
    });
    const allowance = (await readWithRetry("allowance after approval", () => runtime.getTokenState())).allowance;
    if (allowance !== DEMO_V1_PARAMETERS.entryPrice) throw new Error("Approval is not exactly 33 dUSDC.");
    recovered.set("approve", step.evidence);
    operationIds.push(step.operation.operationId);
    if (step.operation.transactionHash) transactionHashes.push(step.operation.transactionHash);
  }

  if (recovered.has("approve") && !recovered.has("join")) {
    const token = await readWithRetry("recovered exact approval", () => runtime.getTokenState());
    if (token.balance < DEMO_V1_PARAMETERS.entryPrice) {
      throw new Error("Recovered smoke wallet no longer has 33 dUSDC for join.");
    }
    if (token.allowance !== DEMO_V1_PARAMETERS.entryPrice) {
      throw new Error("Recovered approval is no longer exactly 33 dUSDC; join will not be broadcast.");
    }
  }

  let positionId = recovered.get("join")?.positionId;
  if (!recovered.has("join")) {
    await requireCurrentPoolSafety(runtime, poolId);
    if (await readWithRetry("membership before join", () => runtime.getActivePositionId(poolId)) !== 0n) {
      throw new Error("Smoke wallet already has an active position; join refused.");
    }
    const before = (await readWithRetry("dUSDC balance before join", () => runtime.getTokenState())).balance;
    const step = await executeSmokeStep({
      runtime,
      journal,
      action: "join",
      poolId,
      receiptTimeoutMs,
      failureHook: (point) => input.failureHook?.("join", point),
    });
    positionId = step.evidence.positionId;
    if (!positionId || step.evidence.poolId !== poolId) throw new Error("Join receipt did not prove the expected pool and position.");
    const token = await readWithRetry("token state after join", () => runtime.getTokenState());
    if (before - token.balance !== DEMO_V1_PARAMETERS.entryPrice) throw new Error("Join did not debit exactly 33 dUSDC.");
    if (token.allowance !== 0n) throw new Error("Exact approval was not fully consumed by join.");
    recovered.set("join", step.evidence);
    operationIds.push(step.operation.operationId);
    if (step.operation.transactionHash) transactionHashes.push(step.operation.transactionHash);
  }
  if (!positionId) throw new Error("Confirmed join evidence is missing its position ID.");

  const withdrawAlreadyConfirmed = recovered.get("withdraw");
  if (!withdrawAlreadyConfirmed) {
    const position = await readWithRetry("joined position", () => runtime.getPosition(positionId!));
    if (
      position.id !== positionId ||
      position.poolId !== poolId ||
      getAddress(position.owner) !== getAddress(runtime.walletAddress) ||
      !position.active
    ) {
      throw new Error("Joined position state does not match the dedicated smoke wallet.");
    }
    if (await readWithRetry("active position membership", () => runtime.getActivePositionId(poolId)) !== positionId) {
      throw new Error("Active pool membership does not match the joined position.");
    }
    await requirePoolOpenForWithdraw(runtime, poolId);
    const before = (await readWithRetry("dUSDC balance before withdraw", () => runtime.getTokenState())).balance;
    const step = await executeSmokeStep({
      runtime,
      journal,
      action: "withdraw",
      poolId,
      positionId,
      receiptTimeoutMs,
      failureHook: (point) => input.failureHook?.("withdraw", point),
    });
    if (
      step.evidence.positionId !== positionId ||
      step.evidence.poolId !== poolId ||
      step.evidence.amount !== DEMO_V1_PARAMETERS.entryPrice
    ) {
      throw new Error("Withdraw receipt did not prove the exact 33 dUSDC refund.");
    }
    const after = (await readWithRetry("dUSDC balance after withdraw", () => runtime.getTokenState())).balance;
    if (after - before !== DEMO_V1_PARAMETERS.entryPrice) throw new Error("Withdraw balance delta is not exactly 33 dUSDC.");
    recovered.set("withdraw", step.evidence);
    operationIds.push(step.operation.operationId);
    if (step.operation.transactionHash) transactionHashes.push(step.operation.transactionHash);
  } else if (
    withdrawAlreadyConfirmed.positionId !== positionId ||
    withdrawAlreadyConfirmed.amount !== DEMO_V1_PARAMETERS.entryPrice
  ) {
    throw new Error("Recovered withdraw evidence does not match the joined position and refund.");
  }

  const [finalPosition, finalActivePositionId, finalToken] = await Promise.all([
    readWithRetry("final position", () => runtime.getPosition(positionId!)),
    readWithRetry("final membership", () => runtime.getActivePositionId(poolId)),
    readWithRetry("final token state", () => runtime.getTokenState()),
  ]);
  if (finalPosition.active || finalActivePositionId !== 0n) {
    throw new Error("Withdraw did not remove the active smoke position.");
  }
  if (finalToken.allowance !== 0n) {
    throw new Error("Unexpected allowance remains after exact approve/join/withdraw flow.");
  }
  const snapshot = journal.snapshot();
  return {
    walletAddress: getAddress(runtime.walletAddress),
    poolId,
    positionId,
    finalTokenBalance: finalToken.balance,
    finalAllowance: finalToken.allowance,
    operationIds: snapshot.operations.map((operation) => operation.operationId),
    transactionHashes: snapshot.operations
      .map((operation) => operation.transactionHash)
      .filter((hash): hash is string => hash !== null),
  };
}
