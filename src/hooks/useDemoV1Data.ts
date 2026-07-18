import { useMemo } from "react";
import {
  useAccount,
  useBalance,
  useReadContracts,
} from "wagmi";
import { zeroAddress } from "viem";
import {
  demoV1Abi,
  demoV1TokenAbi,
  type DemoDrawRound,
  type DemoPool,
  type DemoPosition,
} from "../demo-v1/abi";
import {
  DEMO_V1_CHAIN_ID,
  demoV1Config,
  isDemoV1Configured,
} from "../demo-v1/config";
import { validateDemoV1RuntimeIdentity } from "../demo-v1/safety";

const MAX_FRONTEND_POOLS = 50;
const ROUND_NUMBERS = Array.from({ length: 10 }, (_, index) => BigInt(index + 1));

type StaticData = {
  paymentToken?: `0x${string}`;
  entryPrice: bigint;
  maxPositionsPerPool: bigint;
  maxActivePositions: bigint;
  maxOpenPools: bigint;
  drawRounds: bigint;
  prizePerRound: bigint;
  totalPrizeAmount: bigint;
  drawInterval: bigint;
  poolCount: bigint;
  positionCount: bigint;
  openPoolCount: bigint;
  totalEscrowed: bigint;
  totalPrizesAssigned: bigint;
  totalPrizesClaimed: bigint;
  openPoolIds: readonly bigint[];
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  dripAmount: bigint;
  dripCooldown: bigint;
};

const emptyStaticData: StaticData = {
  entryPrice: 0n,
  maxPositionsPerPool: 0n,
  maxActivePositions: 0n,
  maxOpenPools: 0n,
  drawRounds: 0n,
  prizePerRound: 0n,
  totalPrizeAmount: 0n,
  drawInterval: 0n,
  poolCount: 0n,
  positionCount: 0n,
  openPoolCount: 0n,
  totalEscrowed: 0n,
  totalPrizesAssigned: 0n,
  totalPrizesClaimed: 0n,
  openPoolIds: [],
  tokenName: "Demo USDC",
  tokenSymbol: "dUSDC",
  tokenDecimals: 6,
  dripAmount: 0n,
  dripCooldown: 0n,
};

export function useDemoV1Data() {
  const { address, chainId, isConnected } = useAccount();
  const contractAddress = demoV1Config.contractAddress ?? zeroAddress;
  const tokenAddress = demoV1Config.tokenAddress ?? zeroAddress;
  const enabled = isDemoV1Configured;
  const user = address ?? zeroAddress;

  const staticQuery = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: contractAddress, abi: demoV1Abi, functionName: "paymentToken", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "ENTRY_PRICE", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "MAX_POSITIONS_PER_POOL", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "MAX_ACTIVE_POSITIONS_PER_USER", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "MAX_OPEN_POOLS", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "DRAW_ROUNDS", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "PRIZE_PER_ROUND", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "TOTAL_PRIZE_AMOUNT", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "DRAW_INTERVAL", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "poolCount", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "positionCount", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "openPoolCount", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "totalEscrowed", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "totalPrizesAssigned", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "totalPrizesClaimed", chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "getOpenPoolIds", chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "name", chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "symbol", chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "decimals", chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "DRIP_AMOUNT", chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "DRIP_COOLDOWN", chainId: DEMO_V1_CHAIN_ID },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  const staticData = useMemo<StaticData>(() => {
    const d = staticQuery.data;
    if (!d) return emptyStaticData;
    return {
      paymentToken: d[0],
      entryPrice: d[1],
      maxPositionsPerPool: d[2],
      maxActivePositions: d[3],
      maxOpenPools: d[4],
      drawRounds: d[5],
      prizePerRound: d[6],
      totalPrizeAmount: d[7],
      drawInterval: d[8],
      poolCount: d[9],
      positionCount: d[10],
      openPoolCount: d[11],
      totalEscrowed: d[12],
      totalPrizesAssigned: d[13],
      totalPrizesClaimed: d[14],
      openPoolIds: d[15],
      tokenName: d[16],
      tokenSymbol: d[17],
      tokenDecimals: d[18],
      dripAmount: d[19],
      dripCooldown: d[20],
    };
  }, [staticQuery.data]);

  const runtimeIdentityErrors = useMemo(
    () =>
      staticQuery.data
        ? validateDemoV1RuntimeIdentity({
            contractHasBytecode: true,
            tokenHasBytecode: true,
            paymentToken: staticData.paymentToken,
            tokenName: staticData.tokenName,
            tokenSymbol: staticData.tokenSymbol,
            tokenDecimals: staticData.tokenDecimals,
            entryPrice: staticData.entryPrice,
            poolCapacity: staticData.maxPositionsPerPool,
            drawRounds: staticData.drawRounds,
            prizePerRound: staticData.prizePerRound,
            drawInterval: staticData.drawInterval,
            dripAmount: staticData.dripAmount,
            dripCooldown: staticData.dripCooldown,
          })
        : [],
    [staticData, staticQuery.data],
  );
  const runtimeIdentityVerified =
    enabled && Boolean(staticQuery.data) && runtimeIdentityErrors.length === 0;

  const userQuery = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "balanceOf", args: [user], chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "allowance", args: [user, contractAddress], chainId: DEMO_V1_CHAIN_ID },
      { address: tokenAddress, abi: demoV1TokenAbi, functionName: "nextDripAt", args: [user], chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "activePositionsByUser", args: [user], chainId: DEMO_V1_CHAIN_ID },
      { address: contractAddress, abi: demoV1Abi, functionName: "claimablePrizesByUser", args: [user], chainId: DEMO_V1_CHAIN_ID },
    ],
    query: { enabled: enabled && Boolean(address), refetchInterval: 12_000 },
  });

  const poolIds = useMemo(() => {
    const count = Math.min(Number(staticData.poolCount), MAX_FRONTEND_POOLS);
    return Array.from({ length: count }, (_, index) => BigInt(index + 1));
  }, [staticData.poolCount]);

  const poolsQuery = useReadContracts({
    allowFailure: false,
    contracts: poolIds.map((poolId) => ({
      address: contractAddress,
      abi: demoV1Abi,
      functionName: "getPool" as const,
      args: [poolId] as const,
      chainId: DEMO_V1_CHAIN_ID,
    })),
    query: { enabled: enabled && poolIds.length > 0, refetchInterval: 15_000 },
  });
  const pools = (poolsQuery.data ?? []) as readonly DemoPool[];

  const activePositionIdsQuery = useReadContracts({
    allowFailure: false,
    contracts: poolIds.map((poolId) => ({
      address: contractAddress,
      abi: demoV1Abi,
      functionName: "getActivePositionId" as const,
      args: [poolId, user] as const,
      chainId: DEMO_V1_CHAIN_ID,
    })),
    query: { enabled: enabled && Boolean(address) && poolIds.length > 0, refetchInterval: 12_000 },
  });
  const activePositionIds = ((activePositionIdsQuery.data ?? []) as readonly bigint[]).filter(
    (id) => id > 0n,
  );

  const positionsQuery = useReadContracts({
    allowFailure: false,
    contracts: activePositionIds.map((positionId) => ({
      address: contractAddress,
      abi: demoV1Abi,
      functionName: "getPosition" as const,
      args: [positionId] as const,
      chainId: DEMO_V1_CHAIN_ID,
    })),
    query: { enabled: enabled && activePositionIds.length > 0, refetchInterval: 12_000 },
  });
  const positions = (positionsQuery.data ?? []) as readonly DemoPosition[];

  const roundKeys = useMemo(
    () => poolIds.flatMap((poolId) => ROUND_NUMBERS.map((round) => ({ poolId, round }))),
    [poolIds],
  );
  const roundsQuery = useReadContracts({
    allowFailure: false,
    contracts: roundKeys.map(({ poolId, round }) => ({
      address: contractAddress,
      abi: demoV1Abi,
      functionName: "getDrawRound" as const,
      args: [poolId, round] as const,
      chainId: DEMO_V1_CHAIN_ID,
    })),
    query: { enabled: enabled && roundKeys.length > 0, refetchInterval: 12_000 },
  });
  const roundValues = (roundsQuery.data ?? []) as readonly DemoDrawRound[];
  const rounds = roundKeys.map((key, index) => ({ ...key, data: roundValues[index] }));

  const nativeBalance = useBalance({
    address,
    chainId: DEMO_V1_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  const refetch = async () => {
    await Promise.all([
      staticQuery.refetch(),
      userQuery.refetch(),
      poolsQuery.refetch(),
      activePositionIdsQuery.refetch(),
      positionsQuery.refetch(),
      roundsQuery.refetch(),
      nativeBalance.refetch(),
    ]);
  };

  return {
    address,
    chainId,
    isConnected,
    isCorrectChain: chainId === DEMO_V1_CHAIN_ID,
    configured: enabled,
    runtimeIdentityVerified,
    runtimeIdentityErrors,
    staticData,
    tokenBalance: userQuery.data?.[0] ?? 0n,
    allowance: userQuery.data?.[1] ?? 0n,
    nextDripAt: userQuery.data?.[2] ?? 0n,
    activePositionsByUser: userQuery.data?.[3] ?? 0n,
    claimablePrizesByUser: userQuery.data?.[4] ?? 0n,
    nativeBalance: nativeBalance.data?.value ?? 0n,
    pools,
    positions,
    rounds,
    poolLimitReached: staticData.poolCount > BigInt(MAX_FRONTEND_POOLS),
    isLoading:
      staticQuery.isPending ||
      userQuery.isPending ||
      poolsQuery.isPending ||
      roundsQuery.isPending,
    error:
      staticQuery.error ??
      userQuery.error ??
      poolsQuery.error ??
      activePositionIdsQuery.error ??
      positionsQuery.error ??
      roundsQuery.error ??
      nativeBalance.error ??
      null,
    refetch,
  };
}
