import { getAddress, isAddress, type Address } from "viem";

export const DEMO_V1_CHAIN_ID = 84_532;
export const DEMO_V1_CONTRACT_ADDRESS = getAddress(
  "0xc2fAA10d3E5FEeB88604dc3A1Ab33656fFeBCA98",
);
export const DEMO_V1_TOKEN_ADDRESS = getAddress(
  "0xA7FA084b34c888061757d4b5FBb08a7B53fee786",
);
export const DEMO_V1_ENTRY_PRICE = 33_000_000n;
export const DEMO_V1_POOL_CAPACITY = 100n;
export const DEMO_V1_PILOT_POOL_CAPACITY = 10n;
export const DEMO_V1_DRAW_ROUNDS = 10n;
export const DEMO_V1_PRIZE_PER_ROUND = 330_000_000n;
export const DEMO_V1_DRAW_INTERVAL = 3_600n;
export const DEMO_V1_DRIP_AMOUNT = 330_000_000n;
export const DEMO_V1_DRIP_COOLDOWN = 86_400n;

export type DemoV1ConfigError =
  | "missing-contract"
  | "invalid-contract"
  | "unexpected-contract"
  | "missing-token"
  | "invalid-token"
  | "unexpected-token"
  | "missing-chain-id"
  | "invalid-chain-id"
  | "missing-rpc"
  | "invalid-rpc";

export type DemoV1RuntimeIdentityError =
  | "contract-bytecode"
  | "token-bytecode"
  | "payment-token-link"
  | "token-name"
  | "token-symbol"
  | "token-decimals"
  | "entry-price"
  | "pool-capacity"
  | "draw-rounds"
  | "prize-per-round"
  | "draw-interval"
  | "drip-amount"
  | "drip-cooldown";

export type DemoV1TxPhase =
  | "idle"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "verifying"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "wrong-network"
  | "insufficient-token"
  | "insufficient-gas"
  | "allowance-not-observed"
  | "unsafe-allowance"
  | "identity-mismatch"
  | "replaced"
  | "cancelled"
  | "manual-review"
  | "verification-failed"
  | "busy";

export class DemoV1ActionError extends Error {
  constructor(
    public readonly phase: DemoV1TxPhase,
    message: string,
  ) {
    super(message);
    this.name = "DemoV1ActionError";
  }
}

export function parseDemoV1Address(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? getAddress(value) : undefined;
}

function sameAddress(left: string | undefined, right: string): boolean {
  return Boolean(left) && left?.toLowerCase() === right.toLowerCase();
}

export function validateDemoV1PublicConfig(input: {
  contractAddress?: string;
  tokenAddress?: string;
  chainId?: string;
  rpcUrl?: string;
}): DemoV1ConfigError[] {
  const errors: DemoV1ConfigError[] = [];
  const contractAddress = parseDemoV1Address(input.contractAddress);
  const tokenAddress = parseDemoV1Address(input.tokenAddress);

  if (!input.contractAddress) errors.push("missing-contract");
  else if (!contractAddress) errors.push("invalid-contract");
  else if (!sameAddress(contractAddress, DEMO_V1_CONTRACT_ADDRESS)) {
    errors.push("unexpected-contract");
  }

  if (!input.tokenAddress) errors.push("missing-token");
  else if (!tokenAddress) errors.push("invalid-token");
  else if (!sameAddress(tokenAddress, DEMO_V1_TOKEN_ADDRESS)) {
    errors.push("unexpected-token");
  }

  if (!input.chainId) errors.push("missing-chain-id");
  else if (Number(input.chainId) !== DEMO_V1_CHAIN_ID) errors.push("invalid-chain-id");

  if (!input.rpcUrl) errors.push("missing-rpc");
  else {
    try {
      const url = new URL(input.rpcUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)
      ) {
        errors.push("invalid-rpc");
      }
    } catch {
      errors.push("invalid-rpc");
    }
  }

  return errors;
}

export function validateDemoV1RuntimeIdentity(input: {
  contractHasBytecode: boolean;
  tokenHasBytecode: boolean;
  paymentToken?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  entryPrice?: bigint;
  poolCapacity?: bigint;
  drawRounds?: bigint;
  prizePerRound?: bigint;
  drawInterval?: bigint;
  dripAmount?: bigint;
  dripCooldown?: bigint;
}): DemoV1RuntimeIdentityError[] {
  const errors: DemoV1RuntimeIdentityError[] = [];
  const supportedCapacity =
    input.poolCapacity === DEMO_V1_POOL_CAPACITY ||
    input.poolCapacity === DEMO_V1_PILOT_POOL_CAPACITY;
  const expectedPrizePerRound = input.poolCapacity
    ? (DEMO_V1_ENTRY_PRICE * input.poolCapacity) / DEMO_V1_DRAW_ROUNDS
    : 0n;
  if (!input.contractHasBytecode) errors.push("contract-bytecode");
  if (!input.tokenHasBytecode) errors.push("token-bytecode");
  if (!sameAddress(input.paymentToken, DEMO_V1_TOKEN_ADDRESS)) {
    errors.push("payment-token-link");
  }
  if (input.tokenName !== "POP33 Demo USD") errors.push("token-name");
  if (input.tokenSymbol !== "dUSDC") errors.push("token-symbol");
  if (input.tokenDecimals !== 6) errors.push("token-decimals");
  if (input.entryPrice !== DEMO_V1_ENTRY_PRICE) errors.push("entry-price");
  if (!supportedCapacity) errors.push("pool-capacity");
  if (input.drawRounds !== DEMO_V1_DRAW_ROUNDS) errors.push("draw-rounds");
  if (input.prizePerRound !== expectedPrizePerRound) errors.push("prize-per-round");
  if (input.drawInterval !== DEMO_V1_DRAW_INTERVAL) errors.push("draw-interval");
  if (input.dripAmount !== DEMO_V1_DRIP_AMOUNT) errors.push("drip-amount");
  if (input.dripCooldown !== DEMO_V1_DRIP_COOLDOWN) errors.push("drip-cooldown");
  return errors;
}

export class DemoV1SingleFlightGuard {
  private active = false;

  acquire(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

export async function runDemoV1SingleFlight<T>(
  guard: DemoV1SingleFlightGuard,
  operation: () => Promise<T>,
): Promise<T> {
  if (!guard.acquire()) {
    throw new DemoV1ActionError(
      "busy",
      "Another Demo V1 transaction flow is already active.",
    );
  }
  try {
    return await operation();
  } finally {
    guard.release();
  }
}

export async function runBoundedDemoV1ReadVerification<T>(
  operation: () => Promise<T>,
  wait: (delayMs: number) => Promise<void>,
  delaysMs: readonly number[] = [500, 1_000],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < delaysMs.length) await wait(delaysMs[attempt]);
    }
  }
  throw lastError;
}

export async function refreshDemoV1AfterConfirmation(
  refresh: () => Promise<unknown> | unknown,
): Promise<boolean> {
  try {
    await refresh();
    return true;
  } catch {
    return false;
  }
}

function errorCandidates(error: unknown): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const candidate = current as Record<string, unknown>;
    candidates.push(candidate);
    current = candidate.cause;
  }
  return candidates;
}

export function classifyDemoV1TransactionError(error: unknown): {
  phase: DemoV1TxPhase;
  message: string;
} {
  if (error instanceof DemoV1ActionError) {
    return { phase: error.phase, message: error.message };
  }

  const candidates = errorCandidates(error);
  const messages = candidates
    .flatMap((candidate) => [candidate.shortMessage, candidate.message])
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (
    candidates.some((candidate) => candidate.code === 4001 || candidate.name === "UserRejectedRequestError") ||
    /rejected|denied/i.test(messages)
  ) {
    return { phase: "rejected", message: "Request rejected in the wallet. No retry was sent." };
  }
  if (/timeout|timed out|waitfortransactionreceipttimeouterror/i.test(messages)) {
    return {
      phase: "manual-review",
      message: "Receipt was not observed within 180 seconds. Do not retry automatically; inspect the transaction hash and refresh reads.",
    };
  }
  if (/insufficient funds|gas required exceeds allowance/i.test(messages)) {
    return { phase: "insufficient-gas", message: "Insufficient Base Sepolia ETH for gas." };
  }
  return {
    phase: "reverted",
    message: "Simulation or transaction failed. No retry was sent; refresh on-chain reads before deciding what to do next.",
  };
}

export function assertDemoV1WriteChain(chainId: number): void {
  if (chainId !== DEMO_V1_CHAIN_ID) {
    throw new DemoV1ActionError(
      "wrong-network",
      "Switch the wallet to Base Sepolia (84532). No transaction was sent.",
    );
  }
}

export function exactDemoV1ApprovalAmount(entryPrice: bigint): bigint {
  if (entryPrice !== DEMO_V1_ENTRY_PRICE) {
    throw new DemoV1ActionError(
      "identity-mismatch",
      "The runtime entry price does not match the reviewed 33 dUSDC Demo V1 value.",
    );
  }
  return DEMO_V1_ENTRY_PRICE;
}

export function assertExactApprovalObserved(allowance: bigint, entryPrice: bigint): void {
  if (allowance !== exactDemoV1ApprovalAmount(entryPrice)) {
    throw new DemoV1ActionError(
      "allowance-not-observed",
      "Approval was confirmed, but the exact 33 dUSDC allowance was not observed. No join was sent.",
    );
  }
}

export function assertSafeExistingAllowance(allowance: bigint, entryPrice: bigint): void {
  if (allowance > exactDemoV1ApprovalAmount(entryPrice)) {
    throw new DemoV1ActionError(
      "unsafe-allowance",
      "The existing allowance is greater than exactly 33 dUSDC. This test flow will not use it.",
    );
  }
}

export function assertJoinPoolPreflight(input: {
  poolStatus: number;
  activePositionCount: bigint;
  poolCapacity: bigint;
  escrowedAmount: bigint;
  entryPrice: bigint;
  lockedAt: bigint;
  activePositionId: bigint;
}): void {
  if (input.poolStatus !== 0) {
    throw new DemoV1ActionError(
      "verification-failed",
      "The selected pool is no longer Open. No join was sent.",
    );
  }
  if (
    (input.poolCapacity !== DEMO_V1_POOL_CAPACITY &&
      input.poolCapacity !== DEMO_V1_PILOT_POOL_CAPACITY) ||
    input.entryPrice !== DEMO_V1_ENTRY_PRICE
  ) {
    throw new DemoV1ActionError(
      "identity-mismatch",
      "The selected pool does not use the reviewed Demo V1 capacity or entry price. No join was sent.",
    );
  }
  if (input.activePositionCount >= input.poolCapacity) {
    throw new DemoV1ActionError(
      "verification-failed",
      "The selected pool no longer has room for another position. No join was sent.",
    );
  }
  if (
    input.escrowedAmount !== input.activePositionCount * input.entryPrice ||
    input.lockedAt !== 0n
  ) {
    throw new DemoV1ActionError(
      "verification-failed",
      "The selected Open pool has inconsistent escrow or lock state. No join was sent.",
    );
  }
  if (input.activePositionId !== 0n) {
    throw new DemoV1ActionError(
      "verification-failed",
      "This wallet already has an active position in the selected pool. No join was sent.",
    );
  }
}

export function assertJoinPostReceipt(input: {
  user: string;
  expectedPoolId: bigint;
  eventUser: string;
  eventPoolId: bigint;
  eventPositionId: bigint;
  eventAmount: bigint;
  eventPoolActiveCount: bigint;
  positionOwner: string;
  positionPoolId: bigint;
  positionActive: boolean;
  activePositionIdAfter: bigint;
  poolStatus: number;
  poolActiveCount: bigint;
  poolEscrow: bigint;
  poolLockedAt: bigint;
  poolDrawInterval: bigint;
  poolCapacity: bigint;
  poolDrawRoundCount: bigint;
  drawRounds?: readonly {
    number: bigint;
    scheduledAt: bigint;
    status: number;
  }[];
  userActiveBefore: bigint;
  userActiveAfter: bigint;
  tokenBalanceBefore: bigint;
  tokenBalanceAfter: bigint;
  allowanceAfter: bigint;
  entryPrice: bigint;
}): {
  lockingJoin: boolean;
  poolChangedFromPreflight: boolean;
} {
  const amount = exactDemoV1ApprovalAmount(input.entryPrice);
  const lockingJoin = input.eventPoolActiveCount === input.poolCapacity;
  const validDrawSchedule =
    input.drawRounds?.length === Number(DEMO_V1_DRAW_ROUNDS) &&
    input.drawRounds.every(
      (round, index) =>
        round.number === BigInt(index + 1) &&
        round.status === 0 &&
        round.scheduledAt ===
          input.poolLockedAt + BigInt(index + 1) * input.poolDrawInterval,
    );
  const validLifecycle =
    input.eventPoolActiveCount > 0n &&
    input.eventPoolActiveCount <= input.poolCapacity &&
    (input.poolCapacity === DEMO_V1_POOL_CAPACITY ||
      input.poolCapacity === DEMO_V1_PILOT_POOL_CAPACITY) &&
    input.poolDrawRoundCount === DEMO_V1_DRAW_ROUNDS &&
    input.poolDrawInterval === DEMO_V1_DRAW_INTERVAL &&
    input.poolStatus === (lockingJoin ? 1 : 0) &&
    (lockingJoin
      ? input.poolLockedAt > 0n &&
        validDrawSchedule
      : input.poolLockedAt === 0n);
  const valid =
    sameAddress(input.eventUser, input.user) &&
    sameAddress(input.positionOwner, input.user) &&
    input.eventAmount === amount &&
    input.eventPositionId > 0n &&
    input.positionPoolId === input.eventPoolId &&
    input.positionActive &&
    input.activePositionIdAfter === input.eventPositionId &&
    validLifecycle &&
    input.poolActiveCount === input.eventPoolActiveCount &&
    input.poolEscrow === input.poolActiveCount * amount &&
    input.userActiveAfter === input.userActiveBefore + 1n &&
    input.tokenBalanceAfter === input.tokenBalanceBefore - amount &&
    input.allowanceAfter === 0n;

  if (!valid) {
    throw new DemoV1ActionError(
      "verification-failed",
      "The join receipt was mined, but the expected position, pool, allowance, balance, or escrow state did not match. Do not send another transaction; inspect the hash and refresh reads.",
    );
  }

  return {
    lockingJoin,
    poolChangedFromPreflight:
      input.expectedPoolId > 0n && input.eventPoolId !== input.expectedPoolId,
  };
}

export function assertWithdrawalPostReceipt(input: {
  user: string;
  positionId: bigint;
  eventUser: string;
  eventPositionId: bigint;
  eventPoolId: bigint;
  eventAmount: bigint;
  eventPoolActiveCount: bigint;
  positionOwner: string;
  positionPoolId: bigint;
  positionActive: boolean;
  poolStatus: number;
  poolActiveCount: bigint;
  poolEscrow: bigint;
  userActiveBefore: bigint;
  userActiveAfter: bigint;
  tokenBalanceBefore: bigint;
  tokenBalanceAfter: bigint;
  entryPrice: bigint;
}): void {
  const amount = exactDemoV1ApprovalAmount(input.entryPrice);
  const valid =
    sameAddress(input.eventUser, input.user) &&
    sameAddress(input.positionOwner, input.user) &&
    input.eventPositionId === input.positionId &&
    input.positionPoolId === input.eventPoolId &&
    input.eventAmount === amount &&
    !input.positionActive &&
    input.poolStatus === 0 &&
    input.poolActiveCount === input.eventPoolActiveCount &&
    input.poolEscrow === input.poolActiveCount * amount &&
    input.userActiveAfter + 1n === input.userActiveBefore &&
    input.tokenBalanceAfter === input.tokenBalanceBefore + amount;

  if (!valid) {
    throw new DemoV1ActionError(
      "verification-failed",
      "The withdrawal receipt was mined, but the expected inactive position, exact refund, or pool escrow state did not match. Do not retry; inspect the hash and refresh reads.",
    );
  }
}

export function assertFaucetPostReceipt(input: {
  balanceBefore: bigint;
  balanceAfter: bigint;
  nextDripBefore: bigint;
  nextDripAfter: bigint;
  dripAmount: bigint;
}): void {
  if (
    input.dripAmount !== DEMO_V1_DRIP_AMOUNT ||
    input.balanceAfter !== input.balanceBefore + input.dripAmount ||
    input.nextDripAfter <= input.nextDripBefore
  ) {
    throw new DemoV1ActionError(
      "verification-failed",
      "The faucet receipt was mined, but the exact dUSDC balance and cooldown change were not verified. Do not retry; refresh reads.",
    );
  }
}
