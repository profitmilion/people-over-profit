// src/hooks/usePop33Stats.ts
import { useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { POP33_ADDRESS, POP33_ABI } from "../utils/contract";

const FALLBACK_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Hook do odczytu statystyk z kontraktu Pop33DemoV2:
 * - totalJoins: ile było wszystkich wejść do systemu
 * - currentCycleId: ID aktualnego cyklu na kontrakcie
 * - activeCycles: ile aktywnych cykli ma dany użytkownik on-chain
 *
 * Dodano:
 * - refetchStats(): ręczne odświeżenie wszystkich odczytów (po tx)
 */
export function usePop33Stats() {
  const { address } = useAccount();

  // Bezpieczny adres użytkownika (dla niepodłączonego portfela używamy zero address)
  const userAddress = (address ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;

  const totalJoinsResult = useReadContract({
    address: POP33_ADDRESS ?? FALLBACK_ADDRESS,
    abi: POP33_ABI,
    functionName: "totalJoins",
    query: { enabled: Boolean(POP33_ADDRESS) },
  });

  const currentCycleIdResult = useReadContract({
    address: POP33_ADDRESS ?? FALLBACK_ADDRESS,
    abi: POP33_ABI,
    functionName: "getCurrentCycleId",
    query: { enabled: Boolean(POP33_ADDRESS) },
  });

  const activeCyclesResult = useReadContract({
    address: POP33_ADDRESS ?? FALLBACK_ADDRESS,
    abi: POP33_ABI,
    functionName: "getActiveCyclesCount",
    args: [userAddress],
    query: { enabled: Boolean(POP33_ADDRESS) },
  });

  const refetchTotalJoins = totalJoinsResult.refetch;
  const refetchCurrentCycleId = currentCycleIdResult.refetch;
  const refetchActiveCycles = activeCyclesResult.refetch;

  const refetchStats = useCallback(() => {
    refetchTotalJoins?.();
    refetchCurrentCycleId?.();
    refetchActiveCycles?.();
  }, [
    refetchActiveCycles,
    refetchCurrentCycleId,
    refetchTotalJoins,
  ]);

  return {
    totalJoins: (totalJoinsResult.data ?? 0n) as bigint,
    totalJoinsLoading: totalJoinsResult.isLoading,

    currentCycleId: (currentCycleIdResult.data ?? 0n) as bigint,
    currentCycleIdLoading: currentCycleIdResult.isLoading,

    activeCyclesOnchain: (activeCyclesResult.data ?? 0n) as bigint,
    activeCyclesLoading: activeCyclesResult.isLoading,

    refetchStats,
  };

}
