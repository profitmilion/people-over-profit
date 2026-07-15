import { useCallback, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { createPublicClient, http, type Abi, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { demoV1Abi, demoV1TokenAbi } from "../demo-v1/abi";
import { DEMO_V1_CHAIN_ID, demoV1Config } from "../demo-v1/config";
import { shouldWaitForConfirmedAllowance } from "../demo-v1/domain";

const ALLOWANCE_POLL_INTERVAL_MS = 1_000;
const ALLOWANCE_POLL_TIMEOUT_MS = 30_000;

const allowancePublicClient = demoV1Config.rpcUrl
  ? createPublicClient({
      chain: baseSepolia,
      transport: http(demoV1Config.rpcUrl),
    })
  : undefined;

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
  | "insufficient-gas"
  | "allowance-not-observed";

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

async function waitForApprovedAllowance(input: {
  owner: `0x${string}`;
  spender: `0x${string}`;
  requiredAmount: bigint;
}): Promise<bigint> {
  if (!allowancePublicClient || !demoV1Config.tokenAddress) {
    throw new LocalActionError(
      "allowance-not-observed",
      "Approval was confirmed, but the Demo V1 RPC client is unavailable. No second approval was sent.",
    );
  }

  const deadline = Date.now() + ALLOWANCE_POLL_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    try {
      const allowance = await allowancePublicClient.readContract({
        address: demoV1Config.tokenAddress,
        abi: demoV1TokenAbi,
        functionName: "allowance",
        args: [input.owner, input.spender],
      });
      if (allowance >= input.requiredAmount) return allowance;
    } catch {
      // A transient read failure is retried against this same RPC transport.
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, ALLOWANCE_POLL_INTERVAL_MS),
    );
  }

  throw new LocalActionError(
    "allowance-not-observed",
    "Approval was confirmed, but the fresh 33 dUSDC allowance was not visible within 30 seconds. No second approval was sent. Wait briefly, refresh, and retry join.",
  );
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
  const confirmedApprovalRef = useRef<{
    owner: `0x${string}`;
    spender: `0x${string}`;
    amount: bigint;
    hash: Hash;
  } | null>(null);

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
    if (!address) {
      throw new LocalActionError("rejected", "Connect a wallet first.");
    }

    let confirmedApproval = confirmedApprovalRef.current;
    let hasConfirmedApproval = Boolean(
      confirmedApproval &&
      confirmedApproval.owner.toLowerCase() === address.toLowerCase() &&
      confirmedApproval.spender.toLowerCase() === demoV1Config.contractAddress.toLowerCase() &&
      confirmedApproval.amount >= input.entryPrice,
    );

    if (input.allowance < input.entryPrice && !hasConfirmedApproval) {
      const approvalHash = await run("Approve exactly one entry", () =>
        sendWrite(demoV1TokenAbi, demoV1Config.tokenAddress!, "approve", [
          demoV1Config.contractAddress!,
          input.entryPrice,
        ]),
      );
      confirmedApproval = {
        owner: address,
        spender: demoV1Config.contractAddress,
        amount: input.entryPrice,
        hash: approvalHash,
      };
      confirmedApprovalRef.current = confirmedApproval;
      hasConfirmedApproval = true;
    }

    if (shouldWaitForConfirmedAllowance(
      input.allowance,
      input.entryPrice,
      hasConfirmedApproval,
    )) {
      setTxState({
        action: "Observe approved allowance",
        phase: "confirming",
        hash: confirmedApproval?.hash,
        message: "Approval is confirmed. Waiting for Base Sepolia RPC to expose the fresh allowance before simulating join.",
      });
      try {
        await waitForApprovedAllowance({
          owner: address,
          spender: demoV1Config.contractAddress,
          requiredAmount: input.entryPrice,
        });
      } catch (error) {
        const classified = classifyError(error);
        setTxState({
          action: "Approval confirmed",
          ...classified,
          hash: confirmedApproval?.hash,
        });
        throw error;
      }
    }

    const joinHash = await run("Join pool", () =>
      sendWrite(demoV1Abi, demoV1Config.contractAddress!, "join"),
    );
    confirmedApprovalRef.current = null;
    return joinHash;
  }, [address, run, sendWrite]);

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
