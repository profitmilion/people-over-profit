import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Abi, Hash } from "viem";
import { demoV1Abi, demoV1TokenAbi } from "../demo-v1/abi";
import { DEMO_V1_CHAIN_ID, demoV1Config } from "../demo-v1/config";

export type DemoV1TxPhase =
  | "idle"
  | "awaiting-signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "wrong-network"
  | "insufficient-token"
  | "insufficient-gas";

export type DemoV1TxState = {
  action: string;
  phase: DemoV1TxPhase;
  hash?: Hash;
  message?: string;
};

const initialState: DemoV1TxState = { action: "", phase: "idle" };

class LocalActionError extends Error {
  constructor(public readonly phase: DemoV1TxPhase, message: string) {
    super(message);
  }
}

function classifyError(error: unknown): Pick<DemoV1TxState, "phase" | "message"> {
  if (error instanceof LocalActionError) {
    return { phase: error.phase, message: error.message };
  }
  const candidate = error as { code?: number; shortMessage?: string; message?: string };
  const message = candidate.shortMessage ?? candidate.message ?? "Transaction failed.";
  if (candidate.code === 4001 || /rejected|denied/i.test(message)) {
    return { phase: "rejected", message: "Request rejected in the wallet." };
  }
  if (/insufficient funds|gas required exceeds allowance/i.test(message)) {
    return { phase: "insufficient-gas", message: "Insufficient Base Sepolia ETH for gas." };
  }
  return { phase: "reverted", message };
}

export function useDemoV1Actions(onConfirmed: () => Promise<unknown> | unknown) {
  const { address, connector, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: DEMO_V1_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [txState, setTxState] = useState<DemoV1TxState>(initialState);

  const assertReady = useCallback(async () => {
    if (!isConnected || !address || !connector) {
      throw new LocalActionError("rejected", "Connect a wallet first.");
    }
    if (!demoV1Config.contractAddress || !demoV1Config.tokenAddress || !publicClient) {
      throw new LocalActionError("reverted", "Demo V1 configuration is incomplete.");
    }
    const liveChainId = await connector.getChainId();
    if (liveChainId !== DEMO_V1_CHAIN_ID) {
      throw new LocalActionError("wrong-network", "Switch the wallet to Base Sepolia (84532)." );
    }
    const gasBalance = await publicClient.getBalance({ address });
    if (gasBalance === 0n) {
      throw new LocalActionError("insufficient-gas", "The wallet has no Base Sepolia ETH for gas.");
    }
    return { address, connector, publicClient };
  }, [address, connector, isConnected, publicClient]);

  const run = useCallback(async (action: string, send: () => Promise<Hash>) => {
    setTxState({ action, phase: "awaiting-signature" });
    try {
      const hash = await send();
      setTxState({ action, phase: "submitted", hash });
      setTxState({ action, phase: "confirming", hash });
      if (!publicClient) throw new Error("Base Sepolia RPC client is unavailable.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new LocalActionError("reverted", "Transaction reverted on-chain.");
      }
      setTxState({ action, phase: "confirmed", hash });
      try {
        await onConfirmed();
      } catch {
        // The write is already confirmed; a transient refresh failure must not
        // misrepresent the successful receipt as a reverted transaction.
      }
      return hash;
    } catch (error) {
      const classified = classifyError(error);
      setTxState((current) => ({ ...current, ...classified }));
      throw error;
    }
  }, [onConfirmed, publicClient]);

  const sendWrite = useCallback(async (
    abi: Abi,
    address: `0x${string}`,
    functionName: string,
    args?: readonly unknown[],
  ): Promise<Hash> => {
    const ready = await assertReady();
    await ready.publicClient.simulateContract({
      account: ready.address,
      address,
      abi,
      functionName,
      args,
    });
    return writeContractAsync({
      address,
      abi,
      functionName,
      args,
      chainId: DEMO_V1_CHAIN_ID,
      connector: ready.connector,
    });
  }, [assertReady, writeContractAsync]);

  const drip = useCallback(() => {
    if (!demoV1Config.tokenAddress) return Promise.reject(new Error("Token address missing."));
    return run("Faucet drip", () =>
      sendWrite(demoV1TokenAbi, demoV1Config.tokenAddress!, "drip"),
    );
  }, [run, sendWrite]);

  const approveAndJoin = useCallback(async (input: {
    entryPrice: bigint;
    tokenBalance: bigint;
    allowance: bigint;
  }) => {
    if (input.tokenBalance < input.entryPrice) {
      const error = new LocalActionError("insufficient-token", "Insufficient dUSDC for one 33 dUSDC entry.");
      setTxState({ action: "Join", phase: error.phase, message: error.message });
      throw error;
    }
    if (!demoV1Config.tokenAddress || !demoV1Config.contractAddress) {
      throw new Error("Demo V1 addresses are missing.");
    }
    if (input.allowance < input.entryPrice) {
      await run("Approve exactly one entry", () =>
        sendWrite(demoV1TokenAbi, demoV1Config.tokenAddress!, "approve", [
          demoV1Config.contractAddress!,
          input.entryPrice,
        ]),
      );
    }
    return run("Join pool", () =>
      sendWrite(demoV1Abi, demoV1Config.contractAddress!, "join"),
    );
  }, [run, sendWrite]);

  const withdraw = useCallback((positionId: bigint) => {
    if (!demoV1Config.contractAddress) return Promise.reject(new Error("Contract address missing."));
    return run(`Withdraw position #${positionId}`, () =>
      sendWrite(demoV1Abi, demoV1Config.contractAddress!, "withdraw", [positionId]),
    );
  }, [run, sendWrite]);

  const executeDraw = useCallback((poolId: bigint, roundNumber: bigint) => {
    if (!demoV1Config.contractAddress) return Promise.reject(new Error("Contract address missing."));
    return run(`Execute pool #${poolId} round #${roundNumber}`, () =>
      sendWrite(demoV1Abi, demoV1Config.contractAddress!, "executeDraw", [poolId, roundNumber]),
    );
  }, [run, sendWrite]);

  const claim = useCallback((poolId: bigint, roundNumber: bigint) => {
    if (!demoV1Config.contractAddress) return Promise.reject(new Error("Contract address missing."));
    return run(`Claim pool #${poolId} round #${roundNumber}`, () =>
      sendWrite(demoV1Abi, demoV1Config.contractAddress!, "claim", [poolId, roundNumber]),
    );
  }, [run, sendWrite]);

  return {
    txState,
    resetTxState: () => setTxState(initialState),
    drip,
    approveAndJoin,
    withdraw,
    executeDraw,
    claim,
    isBusy: ["awaiting-signature", "submitted", "confirming"].includes(txState.phase),
  };
}
