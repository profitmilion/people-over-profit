import { parseAbi } from "viem";

export const demoV1TokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function DRIP_AMOUNT() view returns (uint256)",
  "function DRIP_COOLDOWN() view returns (uint256)",
  "function nextDripAt(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function drip()",
  "event DemoTokensDripped(address indexed recipient, uint256 amount, uint256 nextAvailableAt)",
]);

export const demoV1Abi = parseAbi([
  "function paymentToken() view returns (address)",
  "function ENTRY_PRICE() view returns (uint256)",
  "function MAX_POSITIONS_PER_POOL() view returns (uint256)",
  "function MAX_ACTIVE_POSITIONS_PER_USER() view returns (uint256)",
  "function MAX_OPEN_POOLS() view returns (uint256)",
  "function DRAW_ROUNDS() view returns (uint256)",
  "function PRIZE_PER_ROUND() view returns (uint256)",
  "function TOTAL_PRIZE_AMOUNT() view returns (uint256)",
  "function DRAW_INTERVAL() view returns (uint256)",
  "function poolCount() view returns (uint256)",
  "function positionCount() view returns (uint256)",
  "function openPoolCount() view returns (uint256)",
  "function totalEscrowed() view returns (uint256)",
  "function totalPrizesAssigned() view returns (uint256)",
  "function totalPrizesClaimed() view returns (uint256)",
  "function activePositionsByUser(address user) view returns (uint256)",
  "function claimablePrizesByUser(address user) view returns (uint256)",
  "function getOpenPoolIds() view returns (uint256[])",
  "function getPool(uint256 poolId) view returns ((uint256 id, uint8 status, uint256 activePositionCount, uint256 escrowedAmount, uint64 openedAt, uint64 lockedAt, uint64 drawInterval, uint256 entryPrice, uint256 prizePerRound, uint256 totalPrizeAmount, uint256 positionsPerPool, uint256 drawRoundCount, uint256 completedDrawRoundCount, uint256 claimedPrizeCount, uint256 assignedPrizeAmount, uint256 claimedPrizeAmount))",
  "function getActivePositionId(uint256 poolId, address user) view returns (uint256)",
  "function getPosition(uint256 positionId) view returns ((uint256 id, uint256 poolId, address owner, uint64 joinedAt, bool active))",
  "function getDrawRound(uint256 poolId, uint256 roundNumber) view returns ((uint256 number, uint256 scheduledAt, uint256 executedAt, uint8 status, uint256 winningPositionId, address winner, uint256 prizeAmount, uint256 temporaryRequestId, bool claimed))",
  "function join() returns (uint256 positionId, uint256 poolId)",
  "function withdraw(uint256 positionId)",
  "function executeDraw(uint256 poolId, uint256 roundNumber) returns (uint256 temporaryRequestId)",
  "function claim(uint256 poolId, uint256 roundNumber)",
  "event PositionJoined(uint256 indexed positionId, uint256 indexed poolId, address indexed user, uint256 amount, uint256 activePositionCount)",
  "event PositionWithdrawn(uint256 indexed positionId, uint256 indexed poolId, address indexed user, uint256 amount, uint256 activePositionCount)",
  "event DrawRoundExecuted(uint256 indexed poolId, uint256 indexed roundNumber, uint256 indexed temporaryRequestId, uint256 scheduledAt, uint256 executedAt)",
  "event WinningPositionAssigned(uint256 indexed poolId, uint256 indexed roundNumber, uint256 indexed positionId, address winner, uint256 prizeAmount)",
  "event PrizeClaimed(uint256 indexed poolId, uint256 indexed roundNumber, uint256 indexed positionId, address winner, uint256 prizeAmount)",
]);

export type DemoPool = {
  id: bigint;
  status: number;
  activePositionCount: bigint;
  escrowedAmount: bigint;
  openedAt: bigint;
  lockedAt: bigint;
  drawInterval: bigint;
  entryPrice: bigint;
  prizePerRound: bigint;
  totalPrizeAmount: bigint;
  positionsPerPool: bigint;
  drawRoundCount: bigint;
  completedDrawRoundCount: bigint;
  claimedPrizeCount: bigint;
  assignedPrizeAmount: bigint;
  claimedPrizeAmount: bigint;
};

export type DemoPosition = {
  id: bigint;
  poolId: bigint;
  owner: `0x${string}`;
  joinedAt: bigint;
  active: boolean;
};

export type DemoDrawRound = {
  number: bigint;
  scheduledAt: bigint;
  executedAt: bigint;
  status: number;
  winningPositionId: bigint;
  winner: `0x${string}`;
  prizeAmount: bigint;
  temporaryRequestId: bigint;
  claimed: boolean;
};
