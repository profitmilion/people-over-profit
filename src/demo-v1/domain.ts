export const DUSDC_DECIMALS = 6;

export const poolStatusLabels: Record<number, string> = {
  0: "Open",
  1: "Locked",
  2: "Drawing",
  3: "Claimable",
  4: "Finished",
};

export function getPoolFillState(input: {
  poolStatus: number;
  activePositionCount: bigint;
  capacity: bigint;
}): {
  fillLabel: string;
  joinAvailable: boolean;
  nextJoinLocks: boolean;
  withdrawalAvailable: boolean;
} {
  const isOpen = input.poolStatus === 0;
  const hasCapacity =
    input.capacity > 0n && input.activePositionCount < input.capacity;

  return {
    fillLabel: `${input.activePositionCount}/${input.capacity}`,
    joinAvailable: isOpen && hasCapacity,
    nextJoinLocks:
      isOpen &&
      hasCapacity &&
      input.activePositionCount + 1n === input.capacity,
    withdrawalAvailable: isOpen,
  };
}

export function sortPoolsByIdAscending<T extends { id: bigint }>(
  pools: readonly T[],
): T[] {
  return [...pools].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

export function formatDUsdc(value: bigint, decimals = DUSDC_DECIMALS): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatCountdown(targetSeconds: bigint, nowMs = Date.now()): string {
  const remaining = Number(targetSeconds) - Math.floor(nowMs / 1000);
  if (remaining <= 0) return "available now";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function isFaucetAvailable(nextDripAt: bigint, nowMs = Date.now()): boolean {
  return nextDripAt <= BigInt(Math.floor(nowMs / 1000));
}

export function needsApproval(allowance: bigint, entryPrice: bigint): boolean {
  return allowance < entryPrice;
}

export function shouldWaitForConfirmedAllowance(
  displayedAllowance: bigint,
  requiredAmount: bigint,
  hasConfirmedApproval: boolean,
): boolean {
  return hasConfirmedApproval && displayedAllowance < requiredAmount;
}

export function canJoin(input: {
  configured: boolean;
  connected: boolean;
  correctChain: boolean;
  tokenBalance: bigint;
  entryPrice: bigint;
  activePositions: bigint;
  maxActivePositions: bigint;
}): boolean {
  return (
    input.configured &&
    input.connected &&
    input.correctChain &&
    input.tokenBalance >= input.entryPrice &&
    input.activePositions < input.maxActivePositions
  );
}

export function canWithdraw(poolStatus: number, positionActive: boolean): boolean {
  return poolStatus === 0 && positionActive;
}

export function canExecuteDraw(input: {
  poolStatus: number;
  completedRounds: bigint;
  totalRounds: bigint;
  scheduledAt: bigint;
  nowMs?: number;
}): boolean {
  const now = BigInt(Math.floor((input.nowMs ?? Date.now()) / 1000));
  return (
    (input.poolStatus === 1 || input.poolStatus === 2) &&
    input.completedRounds < input.totalRounds &&
    input.scheduledAt > 0n &&
    input.scheduledAt <= now
  );
}

export function canClaim(input: {
  configured: boolean;
  connected: boolean;
  correctChain: boolean;
  roundStatus: number;
  claimed: boolean;
  prizeAmount: bigint;
  winner?: string;
  user?: string;
}): boolean {
  return (
    input.configured &&
    input.connected &&
    input.correctChain &&
    input.roundStatus === 1 &&
    !input.claimed &&
    input.prizeAmount > 0n &&
    Boolean(input.user) &&
    input.winner?.toLowerCase() === input.user?.toLowerCase()
  );
}

export function shortenAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

export function formatTimestamp(seconds: bigint): string {
  if (seconds === 0n) return "—";
  return new Date(Number(seconds) * 1000).toLocaleString();
}
