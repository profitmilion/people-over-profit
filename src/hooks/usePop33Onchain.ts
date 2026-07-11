// src/hooks/usePop33Onchain.ts
import { useMemo } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { isAddress } from "viem";
import { POP33_ADDRESS, POP33_ABI } from "../utils/contract";
import { DEMO_SETTINGS } from "../config/pop33Config";

// W DEMO trzymamy jeszcze logikę entry value na przyszłość,
// ale kontrakt Pop33DemoV2 jest nonpayable, więc aktualnie NIE wysyłamy value.
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

// Aktualnie nieużywane w wywołaniu (kontrakt nonpayable),
// zostaje na przyszłość, gdy wprowadzimy prawdziwe wpłaty.
const ENTRY_VALUE_WEI = parseEntryValueWei();
void ENTRY_VALUE_WEI;

export type OnchainJoinErrorCode =
  | "wallet-disconnected"
  | "wrong-network";

export class OnchainJoinError extends Error {
  constructor(
    public readonly code: OnchainJoinErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OnchainJoinError";
  }
}

export type OnchainAvailability =
  | "disabled"
  | "wallet-disconnected"
  | "missing-address"
  | "wrong-network"
  | "invalid-contract"
  | "ready";

export function usePop33Onchain() {
  const {
    address,
    isConnected,
    chainId: walletChainId,
    connector,
  } = useAccount();

  const {
    data: txHash,
    writeContractAsync,
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

  const onchainAvailability = useMemo<OnchainAvailability>(() => {
    if (!isEnabled) return "disabled";
    if (!isConnected) return "wallet-disconnected";
    if (!address) return "missing-address";
    if (!isAddress(POP33_ADDRESS)) return "invalid-contract";
    if (walletChainId !== baseSepolia.id) return "wrong-network";
    return "ready";
  }, [address, isConnected, isEnabled, walletChainId]);

  const canUseOnchain = onchainAvailability === "ready";
  const onchainError = writeError ?? confirmError ?? null;

  const triggerOnchainJoin = async () => {
    if (!isConnected || !address || !connector) {
      throw new OnchainJoinError(
        "wallet-disconnected",
        "Connect your wallet to use POP IT."
      );
    }

    const activeConnectorChainId = await connector.getChainId();
    if (activeConnectorChainId !== baseSepolia.id) {
      throw new OnchainJoinError(
        "wrong-network",
        "Switch your wallet network to Base Sepolia."
      );
    }

    return writeContractAsync({
      address: POP33_ADDRESS as `0x${string}`,
      abi: POP33_ABI,
      functionName: "openNextAndJoin",
      chainId: baseSepolia.id,
      connector,
      // DEMO: kontrakt Pop33DemoV2 jest nonpayable – nie wysyłamy value
      // value: ENTRY_VALUE_WEI,
    });
  };

  return {
    isEnabled,
    isConnected,
    walletChainId,
    canUseOnchain,
    onchainAvailability,
    triggerOnchainJoin,
    isPending,
    isConfirming,
    isConfirmed,
    txHash,
    onchainError,
  };
}
