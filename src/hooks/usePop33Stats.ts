// src/hooks/usePop33Stats.ts
import { useAccount, useReadContract } from "wagmi";
import { POP33_ADDRESS, POP33_ABI } from "../utils/contract";

/**
 * Hook do prostego odczytu statystyk z kontraktu Pop33DemoV2:
 * - totalJoins: ile było wszystkich wejść do systemu (joins.length)
 * - currentCycleId: ID aktualnego cyklu na kontrakcie
 * - activeCycles: ile aktywnych cykli ma dany użytkownik on-chain
 */
export function usePop33Stats() {
  const { address } = useAccount();

  // Bezpieczny adres użytkownika (dla niepodłączonego portfela używamy zero address)
  const userAddress = (address ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;

  // 1) Liczba wszystkich joinów (globalnie)
  const totalJoinsResult = useReadContract({
    address: POP33_ADDRESS as `0x${string}`,
    abi: POP33_ABI,
    functionName: "totalJoins",
  });

  // 2) Aktualne ID cyklu na kontrakcie
  const currentCycleIdResult = useReadContract({
    address: POP33_ADDRESS as `0x${string}`,
    abi: POP33_ABI,
    functionName: "getCurrentCycleId",
  });

  // 3) Ile aktywnych cykli ma dany użytkownik (on-chain)
  const activeCyclesResult = useReadContract({
    address: POP33_ADDRESS as `0x${string}`,
    abi: POP33_ABI,
    functionName: "getActiveCyclesCount",
    args: [userAddress],
  });

  return {
    totalJoins: (totalJoinsResult.data ?? 0n) as bigint,
    totalJoinsLoading: totalJoinsResult.isLoading,

    currentCycleId: (currentCycleIdResult.data ?? 0n) as bigint,
    currentCycleIdLoading: currentCycleIdResult.isLoading,

    activeCyclesOnchain: (activeCyclesResult.data ?? 0n) as bigint,
    activeCyclesLoading: activeCyclesResult.isLoading,
  };
}
