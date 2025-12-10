// src/hooks/usePop33Onchain.ts
import { useMemo } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { POP33_ADDRESS, POP33_ABI } from "../utils/contract";
import { DEMO_SETTINGS } from "../config/pop33Config";

const ENTRY_VALUE_WEI_ENV = import.meta.env.VITE_POP33_ENTRY_VALUE_WEI as
  | string
  | undefined;

function parseEntryValueWei(): bigint {
  if (!ENTRY_VALUE_WEI_ENV) return 0n;
  try {
    return BigInt(ENTRY_VALUE_WEI_ENV);
  } catch {
    console.warn(
      "Invalid VITE_POP33_ENTRY_VALUE_WEI, falling back to 0. Provided:",
      ENTRY_VALUE_WEI_ENV
    );
    return 0n;
  }
}

const ENTRY_VALUE_WEI = parseEntryValueWei();

export function usePop33Onchain() {
  const { isConnected } = useAccount();

  const {
    data: txHash,
    writeContract,
    isPending,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const isEnabled = DEMO_SETTINGS.isOnchainEnabled;

  const onchainError = writeError ?? confirmError ?? null;

  const canUseOnchain = useMemo(
    () => isEnabled && isConnected && !!POP33_ADDRESS,
    [isEnabled, isConnected]
  );

  const triggerOnchainJoin = () => {
    if (!canUseOnchain) return;

    writeContract({
      address: POP33_ADDRESS as `0x${string}`,
      abi: POP33_ABI,
      functionName: "openNextAndJoin",
      value: ENTRY_VALUE_WEI,
    });
  };

  return {
    isEnabled,
    isConnected,
    canUseOnchain,
    triggerOnchainJoin,
    isPending,
    isConfirming,
    isConfirmed,
    txHash,
    onchainError,
  };
}
