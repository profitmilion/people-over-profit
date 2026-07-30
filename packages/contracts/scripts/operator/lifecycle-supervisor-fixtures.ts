import {
  type DrawRoundSnapshot,
  type LifecycleSnapshotAdapter,
  type PoolSnapshot,
  type PoolStatus,
  type SystemSnapshot,
  ZERO_ADDRESS,
} from "./lifecycle-supervisor.js";

export const FIXTURE_OBSERVED_AT = 1_800_000_000n;
export const FIXTURE_CHAIN_ID = 31_337n;
export const FIXTURE_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000033";
export const FIXTURE_ENTRY_PRICE = 33_000_000n;
export const FIXTURE_PRIZE_PER_ROUND = 330_000_000n;
export const FIXTURE_POSITION_CAPACITY = 100n;
export const FIXTURE_ROUND_COUNT = 10n;
export const FIXTURE_TOTAL_PRIZE = 3_300_000_000n;
export const FIXTURE_DRAW_INTERVAL = 3_600n;

export const LIFECYCLE_FIXTURE_NAMES = [
  "empty-open",
  "open-50",
  "open-99",
  "locked-before-first-draw",
  "multi-pool",
] as const;
export type LifecycleFixtureName = (typeof LIFECYCLE_FIXTURE_NAMES)[number];

function fixtureAddress(index: bigint): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

export function makeRoundFixture(input: {
  number: bigint;
  lockedAt: bigint;
  observedAt?: bigint;
  finalized?: boolean;
  claimed?: boolean;
  winnerIndex?: bigint;
  overrides?: Partial<DrawRoundSnapshot>;
}): DrawRoundSnapshot {
  const observedAt = input.observedAt ?? FIXTURE_OBSERVED_AT;
  const scheduledAt = input.lockedAt + input.number * FIXTURE_DRAW_INTERVAL;
  const finalized = input.finalized ?? false;
  const winnerIndex = input.winnerIndex ?? input.number;
  return {
    number: input.number,
    scheduledAt,
    executedAt: finalized ? (observedAt > scheduledAt ? observedAt : scheduledAt) : 0n,
    status: finalized ? "Finalized" : "Pending",
    winningPositionId: finalized ? winnerIndex : 0n,
    winner: finalized ? fixtureAddress(winnerIndex) : ZERO_ADDRESS,
    prizeAmount: FIXTURE_PRIZE_PER_ROUND,
    temporaryRequestId: finalized ? input.number : 0n,
    claimed: finalized && (input.claimed ?? false),
    ...input.overrides,
  };
}

export function makePoolFixture(input: {
  poolId?: bigint;
  status?: PoolStatus | string;
  activePositionCount?: bigint;
  lockedAt?: bigint;
  completedDrawRoundCount?: bigint;
  claimedPrizeCount?: bigint;
  observedAt?: bigint;
  overrides?: Partial<Omit<PoolSnapshot, "poolId" | "status" | "rounds">>;
  rounds?: readonly DrawRoundSnapshot[];
} = {}): PoolSnapshot {
  const poolId = input.poolId ?? 1n;
  const status = input.status ?? "Open";
  const observedAt = input.observedAt ?? FIXTURE_OBSERVED_AT;
  const lockedAt = input.lockedAt ??
    (status === "Open" ? 0n : observedAt - 2n * FIXTURE_DRAW_INTERVAL);
  const defaultCompleted = status === "Drawing"
    ? 1n
    : status === "Claimable" || status === "Finished"
      ? FIXTURE_ROUND_COUNT
      : 0n;
  const completed = input.completedDrawRoundCount ?? defaultCompleted;
  const defaultClaimed = status === "Claimable"
    ? 9n
    : status === "Finished"
      ? FIXTURE_ROUND_COUNT
      : 0n;
  const claimed = input.claimedPrizeCount ?? defaultClaimed;
  const activePositionCount = input.activePositionCount ??
    (status === "Open" ? 0n : status === "Finished" ? 0n : FIXTURE_POSITION_CAPACITY);
  const rounds = input.rounds ?? (
    status === "Open"
      ? []
      : Array.from({ length: Number(FIXTURE_ROUND_COUNT) }, (_, index) => {
          const number = BigInt(index + 1);
          return makeRoundFixture({
            number,
            lockedAt,
            observedAt,
            finalized: number <= completed,
            claimed: number <= claimed,
          });
        })
  );
  const claimedAmount = claimed * FIXTURE_PRIZE_PER_ROUND;
  const escrowedAmount = status === "Open"
    ? activePositionCount * FIXTURE_ENTRY_PRICE
    : status === "Finished"
      ? 0n
      : FIXTURE_TOTAL_PRIZE - claimedAmount;

  return {
    poolId,
    status,
    activePositionCount,
    escrowedAmount,
    openedAt: observedAt - 86_400n,
    lockedAt,
    drawInterval: FIXTURE_DRAW_INTERVAL,
    entryPrice: FIXTURE_ENTRY_PRICE,
    prizePerRound: FIXTURE_PRIZE_PER_ROUND,
    totalPrizeAmount: FIXTURE_TOTAL_PRIZE,
    maxPositionCount: FIXTURE_POSITION_CAPACITY,
    drawRoundCount: FIXTURE_ROUND_COUNT,
    completedDrawRoundCount: completed,
    claimedPrizeCount: claimed,
    assignedPrizeAmount: completed * FIXTURE_PRIZE_PER_ROUND,
    claimedPrizeAmount: claimedAmount,
    rounds,
    ...input.overrides,
  };
}

export function makeSystemFixture(
  pools: readonly PoolSnapshot[],
  overrides: Partial<Omit<SystemSnapshot, "pools">> = {},
): SystemSnapshot {
  return {
    chainId: FIXTURE_CHAIN_ID,
    contractAddress: FIXTURE_CONTRACT_ADDRESS,
    blockNumber: 12_345n,
    observedAt: FIXTURE_OBSERVED_AT,
    poolCount: BigInt(pools.length),
    source: "fixture",
    pools,
    ...overrides,
  };
}

export function loadLifecycleFixture(name: LifecycleFixtureName): SystemSnapshot {
  switch (name) {
    case "empty-open":
      return makeSystemFixture([makePoolFixture()]);
    case "open-50":
      return makeSystemFixture([makePoolFixture({ activePositionCount: 50n })]);
    case "open-99":
      return makeSystemFixture([makePoolFixture({ activePositionCount: 99n })]);
    case "locked-before-first-draw": {
      const lockedAt = FIXTURE_OBSERVED_AT - FIXTURE_DRAW_INTERVAL + 1n;
      return makeSystemFixture([
        makePoolFixture({ status: "Locked", lockedAt }),
      ]);
    }
    case "multi-pool": {
      const lockedAt = FIXTURE_OBSERVED_AT - 2n * FIXTURE_DRAW_INTERVAL;
      return makeSystemFixture([
        makePoolFixture({ poolId: 1n, activePositionCount: 99n }),
        makePoolFixture({ poolId: 2n, status: "Locked", lockedAt }),
        makePoolFixture({
          poolId: 3n,
          status: "Drawing",
          lockedAt: FIXTURE_OBSERVED_AT - 4n * FIXTURE_DRAW_INTERVAL,
          completedDrawRoundCount: 1n,
        }),
        makePoolFixture({
          poolId: 4n,
          status: "Claimable",
          lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
          claimedPrizeCount: 9n,
        }),
        makePoolFixture({
          poolId: 5n,
          status: "Finished",
          lockedAt: FIXTURE_OBSERVED_AT - 12n * FIXTURE_DRAW_INTERVAL,
        }),
      ]);
    }
  }
}

export class FixtureLifecycleSnapshotAdapter implements LifecycleSnapshotAdapter {
  readonly source = "fixture" as const;
  readonly #snapshot: SystemSnapshot;

  constructor(snapshot: SystemSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }

  async readSnapshot(): Promise<SystemSnapshot> {
    return structuredClone(this.#snapshot);
  }
}

export function assertLifecycleFixtureName(value: string): LifecycleFixtureName {
  if (!LIFECYCLE_FIXTURE_NAMES.includes(value as LifecycleFixtureName)) {
    throw new Error(
      `Unknown fixture "${value}". Available fixtures: ${LIFECYCLE_FIXTURE_NAMES.join(", ")}.`,
    );
  }
  return value as LifecycleFixtureName;
}
