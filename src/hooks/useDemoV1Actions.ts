import { useCallback, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import {
  parseEventLogs,
  type Abi,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { demoV1Abi, demoV1TokenAbi } from "../demo-v1/abi";
import { demoV1Config } from "../demo-v1/config";
import {
  DEMO_V1_CHAIN_ID,
  DEMO_V1_CONTRACT_ADDRESS,
  DEMO_V1_ENTRY_PRICE,
  DEMO_V1_TOKEN_ADDRESS,
  DemoV1ActionError,
  DemoV1SingleFlightGuard,
  assertDemoV1WriteChain,
  assertExactApprovalObserved,
  assertFaucetPostReceipt,
  assertJoinPostReceipt,
  assertReversibleJoinPool,
  assertSafeExistingAllowance,
  assertWithdrawalPostReceipt,
  classifyDemoV1TransactionError,
  exactDemoV1ApprovalAmount,
  runBoundedDemoV1ReadVerification,
  runDemoV1SingleFlight,
  validateDemoV1RuntimeIdentity,
  type DemoV1TxPhase,
} from "../demo-v1/safety";

const ALLOWANCE_POLL_INTERVAL_MS = 1_000;
const ALLOWANCE_POLL_TIMEOUT_MS = 30_000;
const RECEIPT_TIMEOUT_MS = 180_000;

type DemoPublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

export type DemoV1TxState = {
  action: string;
  phase: DemoV1TxPhase;
  hash?: Hash;
  message?: string;
};

type JoinPreflight = {
  tokenBalance: bigint;
  allowance: bigint;
  activePositions: bigint;
  expectedPoolId: bigint;
};

const initialState: DemoV1TxState = { action: "", phase: "idle" };

async function assertRuntimeIdentity(client: DemoPublicClient): Promise<void> {
  try {
    const [
      contractBytecode,
      tokenBytecode,
      paymentToken,
      tokenName,
      tokenSymbol,
      tokenDecimals,
      entryPrice,
      poolCapacity,
      drawRounds,
      prizePerRound,
      drawInterval,
      dripAmount,
      dripCooldown,
    ] = await Promise.all([
      client.getBytecode({ address: DEMO_V1_CONTRACT_ADDRESS }),
      client.getBytecode({ address: DEMO_V1_TOKEN_ADDRESS }),
      client.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "paymentToken" }),
      client.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "name" }),
      client.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "symbol" }),
      client.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "decimals" }),
      client.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "ENTRY_PRICE" }),
      client.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "MAX_POSITIONS_PER_POOL" }),
      client.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "DRAW_ROUNDS" }),
      client.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "PRIZE_PER_ROUND" }),
      client.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "DRAW_INTERVAL" }),
      client.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "DRIP_AMOUNT" }),
      client.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "DRIP_COOLDOWN" }),
    ]);

    const errors = validateDemoV1RuntimeIdentity({
      contractHasBytecode: Boolean(contractBytecode && contractBytecode !== "0x"),
      tokenHasBytecode: Boolean(tokenBytecode && tokenBytecode !== "0x"),
      paymentToken,
      tokenName,
      tokenSymbol,
      tokenDecimals,
      entryPrice,
      poolCapacity,
      drawRounds,
      prizePerRound,
      drawInterval,
      dripAmount,
      dripCooldown,
    });
    if (errors.length > 0) {
      throw new DemoV1ActionError(
        "identity-mismatch",
        `Demo V1 runtime identity check failed: ${errors.join(", ")}. No transaction was sent.`,
      );
    }
  } catch (error) {
    if (error instanceof DemoV1ActionError) throw error;
    throw new DemoV1ActionError(
      "identity-mismatch",
      "The reviewed Demo V1 contracts could not be verified through Base Sepolia reads. No transaction was sent.",
    );
  }
}

async function waitForExactApprovedAllowance(input: {
  client: DemoPublicClient;
  owner: `0x${string}`;
  requiredAmount: bigint;
}): Promise<bigint> {
  const deadline = Date.now() + ALLOWANCE_POLL_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    try {
      const allowance = await input.client.readContract({
        address: DEMO_V1_TOKEN_ADDRESS,
        abi: demoV1TokenAbi,
        functionName: "allowance",
        args: [input.owner, DEMO_V1_CONTRACT_ADDRESS],
      });
      if (allowance === input.requiredAmount) return allowance;
      if (allowance > input.requiredAmount) {
        assertSafeExistingAllowance(allowance, input.requiredAmount);
      }
    } catch (error) {
      if (error instanceof DemoV1ActionError) throw error;
      // Only the read is retried. The approval transaction is never resent.
    }
    await new Promise((resolve) => window.setTimeout(resolve, ALLOWANCE_POLL_INTERVAL_MS));
  }
  throw new DemoV1ActionError(
    "allowance-not-observed",
    "Approval receipt was confirmed, but the exact 33 dUSDC allowance was not visible within 30 seconds. No approval or join was retried.",
  );
}

function getJoinedEvent(receipt: TransactionReceipt, user: string) {
  const events = parseEventLogs({
    abi: demoV1Abi,
    eventName: "PositionJoined",
    logs: receipt.logs,
    strict: true,
  });
  return events.find(
    (event) => event.args.user.toLowerCase() === user.toLowerCase(),
  );
}

function getWithdrawnEvent(receipt: TransactionReceipt, positionId: bigint) {
  const events = parseEventLogs({
    abi: demoV1Abi,
    eventName: "PositionWithdrawn",
    logs: receipt.logs,
    strict: true,
  });
  return events.find((event) => event.args.positionId === positionId);
}

export function useDemoV1Actions(onConfirmed: () => Promise<unknown> | unknown) {
  const { address, connector, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: DEMO_V1_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [txState, setTxState] = useState<DemoV1TxState>(initialState);
  const [flowActive, setFlowActive] = useState(false);
  const operationGuardRef = useRef(new DemoV1SingleFlightGuard());

  const assertReady = useCallback(async () => {
    if (!isConnected || !address || !connector) {
      throw new DemoV1ActionError("rejected", "Connect a wallet first. No transaction was sent.");
    }
    if (
      !demoV1Config.contractAddress ||
      !demoV1Config.tokenAddress ||
      demoV1Config.errors.length > 0 ||
      !publicClient
    ) {
      throw new DemoV1ActionError("identity-mismatch", "Demo V1 configuration is incomplete or unexpected.");
    }
    const liveChainId = await connector.getChainId();
    assertDemoV1WriteChain(liveChainId);
    await assertRuntimeIdentity(publicClient);
    const gasBalance = await publicClient.getBalance({ address });
    if (gasBalance === 0n) {
      throw new DemoV1ActionError("insufficient-gas", "The wallet has no Base Sepolia ETH for gas.");
    }
    return { address, connector, publicClient };
  }, [address, connector, isConnected, publicClient]);

  const runTransaction = useCallback(async (
    action: string,
    send: () => Promise<Hash>,
    verify?: (receipt: TransactionReceipt) => Promise<string | undefined>,
  ): Promise<Hash> => {
    setTxState({ action, phase: "awaiting-signature", message: "Waiting for the wallet signature." });
    try {
      const hash = await send();
      setTxState({ action, phase: "submitted", hash, message: "Transaction submitted to Base Sepolia." });
      setTxState({ action, phase: "confirming", hash, message: "Waiting for an on-chain receipt. No retry will be sent." });
      if (!publicClient) {
        throw new DemoV1ActionError("manual-review", "Base Sepolia receipt client is unavailable. Inspect the transaction hash.");
      }

      let replacement: { reason: "repriced" | "replaced" | "cancelled"; hash: Hash } | undefined;
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
        onReplaced: (replacementInfo) => {
          replacement = {
            reason: replacementInfo.reason,
            hash: replacementInfo.transaction.hash,
          };
          setTxState({
            action,
            phase: replacementInfo.reason === "cancelled" ? "cancelled" : "replaced",
            hash: replacementInfo.transaction.hash,
            message:
              replacementInfo.reason === "cancelled"
                ? "The wallet cancelled this transaction. No retry was sent."
                : "The transaction was replaced or repriced. Automatic continuation is stopped; inspect the new hash and refresh reads.",
          });
        },
      });

      if (replacement) {
        throw new DemoV1ActionError(
          replacement.reason === "cancelled" ? "cancelled" : "replaced",
          replacement.reason === "cancelled"
            ? "The transaction was cancelled. No retry was sent."
            : "The transaction was replaced or repriced. No next transaction was sent; inspect the hash and refresh reads.",
        );
      }
      if (receipt.status !== "success") {
        throw new DemoV1ActionError("reverted", "Transaction reverted on-chain. No retry was sent.");
      }

      setTxState({ action, phase: "verifying", hash, message: "Receipt confirmed. Verifying the resulting on-chain state." });
      const verificationMessage = await verify?.(receipt);
      let refreshMessage = "";
      try {
        await onConfirmed();
      } catch {
        refreshMessage = " Automatic refresh failed; use Refresh reads before another action.";
      }
      setTxState({
        action,
        phase: "confirmed",
        hash,
        message: `${verificationMessage ?? "Receipt confirmed."}${refreshMessage}`,
      });
      return hash;
    } catch (error) {
      const classified = classifyDemoV1TransactionError(error);
      setTxState((current) => ({ ...current, action, ...classified }));
      throw error;
    }
  }, [onConfirmed, publicClient]);

  const sendWrite = useCallback(async (
    abi: Abi,
    contractAddress: `0x${string}`,
    functionName: string,
    args?: readonly unknown[],
  ): Promise<Hash> => {
    const ready = await assertReady();
    await ready.publicClient.simulateContract({
      account: ready.address,
      address: contractAddress,
      abi,
      functionName,
      args,
    });
    assertDemoV1WriteChain(await ready.connector.getChainId());
    return writeContractAsync({
      address: contractAddress,
      abi,
      functionName,
      args,
      chainId: DEMO_V1_CHAIN_ID,
      connector: ready.connector,
    });
  }, [assertReady, writeContractAsync]);

  const readJoinPreflight = useCallback(async (): Promise<JoinPreflight> => {
    const ready = await assertReady();
    const [tokenBalance, allowance, activePositions, expectedPoolId] = await Promise.all([
      ready.publicClient.readContract({
        address: DEMO_V1_TOKEN_ADDRESS,
        abi: demoV1TokenAbi,
        functionName: "balanceOf",
        args: [ready.address],
      }),
      ready.publicClient.readContract({
        address: DEMO_V1_TOKEN_ADDRESS,
        abi: demoV1TokenAbi,
        functionName: "allowance",
        args: [ready.address, DEMO_V1_CONTRACT_ADDRESS],
      }),
      ready.publicClient.readContract({
        address: DEMO_V1_CONTRACT_ADDRESS,
        abi: demoV1Abi,
        functionName: "activePositionsByUser",
        args: [ready.address],
      }),
      ready.publicClient.readContract({
        address: DEMO_V1_CONTRACT_ADDRESS,
        abi: demoV1Abi,
        functionName: "findOldestQualifyingPool",
        args: [ready.address],
      }),
    ]);

    if (tokenBalance < DEMO_V1_ENTRY_PRICE) {
      throw new DemoV1ActionError("insufficient-token", "The wallet needs at least 33 dUSDC before join.");
    }
    if (activePositions >= 10n) {
      throw new DemoV1ActionError("verification-failed", "The wallet already has the maximum 10 active positions.");
    }
    assertSafeExistingAllowance(allowance, DEMO_V1_ENTRY_PRICE);

    if (expectedPoolId > 0n) {
      const pool = await ready.publicClient.readContract({
        address: DEMO_V1_CONTRACT_ADDRESS,
        abi: demoV1Abi,
        functionName: "getPool",
        args: [expectedPoolId],
      });
      assertReversibleJoinPool({
        poolStatus: pool.status,
        activePositionCount: pool.activePositionCount,
      });
    }

    return { tokenBalance, allowance, activePositions, expectedPoolId };
  }, [assertReady]);

  const runExclusive = useCallback(async (
    action: string,
    operation: () => Promise<Hash>,
  ): Promise<Hash> => {
    if (operationGuardRef.current.isActive()) {
      throw new DemoV1ActionError("busy", "Another Demo V1 transaction flow is already active.");
    }
    setFlowActive(true);
    setTxState({
      action,
      phase: "verifying",
      message: "Running fresh read-only safety checks before requesting a wallet signature.",
    });
    try {
      return await runDemoV1SingleFlight(operationGuardRef.current, operation);
    } catch (error) {
      const classified = classifyDemoV1TransactionError(error);
      if (classified.phase !== "busy") {
        setTxState((current) => ({ ...current, action: current.action || action, ...classified }));
      }
      throw error;
    } finally {
      setFlowActive(false);
    }
  }, []);

  const drip = useCallback(() => runExclusive("Faucet drip", async () => {
    const ready = await assertReady();
    const [balanceBefore, nextDripBefore, dripAmount] = await Promise.all([
      ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "balanceOf", args: [ready.address] }),
      ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "nextDripAt", args: [ready.address] }),
      ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "DRIP_AMOUNT" }),
    ]);
    return runTransaction(
      "Faucet drip",
      () => sendWrite(demoV1TokenAbi, DEMO_V1_TOKEN_ADDRESS, "drip"),
      async () => runBoundedDemoV1ReadVerification(async () => {
          const [balanceAfter, nextDripAfter] = await Promise.all([
            ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "balanceOf", args: [ready.address] }),
            ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "nextDripAt", args: [ready.address] }),
          ]);
          assertFaucetPostReceipt({ balanceBefore, balanceAfter, nextDripBefore, nextDripAfter, dripAmount });
          return "Faucet confirmed: exact 330 dUSDC balance increase and cooldown verified.";
        }, (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs))),
    );
  }), [assertReady, runExclusive, runTransaction, sendWrite]);

  const approveAndJoin = useCallback(() => runExclusive("Approve and join", async () => {
    let preflight = await readJoinPreflight();
    const approvalAmount = exactDemoV1ApprovalAmount(DEMO_V1_ENTRY_PRICE);

    if (preflight.allowance < approvalAmount) {
      await runTransaction(
        "Approve exactly 33 dUSDC",
        () => sendWrite(demoV1TokenAbi, DEMO_V1_TOKEN_ADDRESS, "approve", [
          DEMO_V1_CONTRACT_ADDRESS,
          approvalAmount,
        ]),
        async () => {
          if (!address || !publicClient) {
            throw new DemoV1ActionError("manual-review", "Wallet or receipt client changed after approval. No join was sent.");
          }
          const allowance = await waitForExactApprovedAllowance({
            client: publicClient,
            owner: address,
            requiredAmount: approvalAmount,
          });
          assertExactApprovalObserved(allowance, approvalAmount);
          return "Approval receipt confirmed and exact 33 dUSDC allowance re-read on-chain. A separate join signature follows.";
        },
      );
    }

    preflight = await readJoinPreflight();
    assertExactApprovalObserved(preflight.allowance, approvalAmount);
    const ready = await assertReady();

    return runTransaction(
      "Join pool",
      () => sendWrite(demoV1Abi, DEMO_V1_CONTRACT_ADDRESS, "join"),
      async (receipt) => runBoundedDemoV1ReadVerification(async () => {
        const event = getJoinedEvent(receipt, ready.address);
        if (!event) {
          throw new DemoV1ActionError("verification-failed", "Join receipt has no matching PositionJoined event. Do not retry.");
        }
        const [position, pool, tokenBalanceAfter, allowanceAfter, userActiveAfter] = await Promise.all([
          ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "getPosition", args: [event.args.positionId] }),
          ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "getPool", args: [event.args.poolId] }),
          ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "balanceOf", args: [ready.address] }),
          ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "allowance", args: [ready.address, DEMO_V1_CONTRACT_ADDRESS] }),
          ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "activePositionsByUser", args: [ready.address] }),
        ]);
        assertJoinPostReceipt({
          user: ready.address,
          expectedPoolId: preflight.expectedPoolId,
          eventUser: event.args.user,
          eventPoolId: event.args.poolId,
          eventPositionId: event.args.positionId,
          eventAmount: event.args.amount,
          eventPoolActiveCount: event.args.activePositionCount,
          positionOwner: position.owner,
          positionPoolId: position.poolId,
          positionActive: position.active,
          poolStatus: pool.status,
          poolActiveCount: pool.activePositionCount,
          poolEscrow: pool.escrowedAmount,
          userActiveBefore: preflight.activePositions,
          userActiveAfter,
          tokenBalanceBefore: preflight.tokenBalance,
          tokenBalanceAfter,
          allowanceAfter,
          entryPrice: pool.entryPrice,
        });
        return `Join confirmed: position #${event.args.positionId} in pool #${event.args.poolId}; exact payment, active position, and escrow verified.`;
      }, (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs))),
    );
  }), [address, assertReady, publicClient, readJoinPreflight, runExclusive, runTransaction, sendWrite]);

  const withdraw = useCallback((positionId: bigint) => runExclusive(`Withdraw position #${positionId}`, async () => {
    const ready = await assertReady();
    const positionBefore = await ready.publicClient.readContract({
      address: DEMO_V1_CONTRACT_ADDRESS,
      abi: demoV1Abi,
      functionName: "getPosition",
      args: [positionId],
    });
    if (positionBefore.owner.toLowerCase() !== ready.address.toLowerCase() || !positionBefore.active) {
      throw new DemoV1ActionError("verification-failed", `Position #${positionId} is not an active position owned by this wallet.`);
    }
    const [poolBefore, tokenBalanceBefore, userActiveBefore] = await Promise.all([
      ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "getPool", args: [positionBefore.poolId] }),
      ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "balanceOf", args: [ready.address] }),
      ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "activePositionsByUser", args: [ready.address] }),
    ]);
    if (poolBefore.status !== 0) {
      throw new DemoV1ActionError("verification-failed", `Pool #${positionBefore.poolId} is no longer Open. Withdrawal was not sent.`);
    }

    return runTransaction(
      `Withdraw position #${positionId}`,
      () => sendWrite(demoV1Abi, DEMO_V1_CONTRACT_ADDRESS, "withdraw", [positionId]),
      async (receipt) => runBoundedDemoV1ReadVerification(async () => {
        const event = getWithdrawnEvent(receipt, positionId);
        if (!event) {
          throw new DemoV1ActionError("verification-failed", "Withdrawal receipt has no matching PositionWithdrawn event. Do not retry.");
        }
        const [positionAfter, poolAfter, tokenBalanceAfter, userActiveAfter] = await Promise.all([
          ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "getPosition", args: [positionId] }),
          ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "getPool", args: [positionBefore.poolId] }),
          ready.publicClient.readContract({ address: DEMO_V1_TOKEN_ADDRESS, abi: demoV1TokenAbi, functionName: "balanceOf", args: [ready.address] }),
          ready.publicClient.readContract({ address: DEMO_V1_CONTRACT_ADDRESS, abi: demoV1Abi, functionName: "activePositionsByUser", args: [ready.address] }),
        ]);
        assertWithdrawalPostReceipt({
          user: ready.address,
          positionId,
          eventUser: event.args.user,
          eventPositionId: event.args.positionId,
          eventPoolId: event.args.poolId,
          eventAmount: event.args.amount,
          eventPoolActiveCount: event.args.activePositionCount,
          positionOwner: positionAfter.owner,
          positionPoolId: positionAfter.poolId,
          positionActive: positionAfter.active,
          poolStatus: poolAfter.status,
          poolActiveCount: poolAfter.activePositionCount,
          poolEscrow: poolAfter.escrowedAmount,
          userActiveBefore,
          userActiveAfter,
          tokenBalanceBefore,
          tokenBalanceAfter,
          entryPrice: poolBefore.entryPrice,
        });
        return `Withdrawal confirmed: position #${positionId} is inactive and the exact 33 dUSDC refund and pool escrow were verified.`;
      }, (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs))),
    );
  }), [assertReady, runExclusive, runTransaction, sendWrite]);

  const executeDraw = useCallback((poolId: bigint, roundNumber: bigint) =>
    runExclusive(`Execute pool #${poolId} round #${roundNumber}`, () =>
      runTransaction(
        `Execute pool #${poolId} round #${roundNumber}`,
        () => sendWrite(demoV1Abi, DEMO_V1_CONTRACT_ADDRESS, "executeDraw", [poolId, roundNumber]),
      ),
    ), [runExclusive, runTransaction, sendWrite]);

  const claim = useCallback((poolId: bigint, roundNumber: bigint) =>
    runExclusive(`Claim pool #${poolId} round #${roundNumber}`, () =>
      runTransaction(
        `Claim pool #${poolId} round #${roundNumber}`,
        () => sendWrite(demoV1Abi, DEMO_V1_CONTRACT_ADDRESS, "claim", [poolId, roundNumber]),
      ),
    ), [runExclusive, runTransaction, sendWrite]);

  const busyPhases: DemoV1TxPhase[] = [
    "awaiting-signature",
    "submitted",
    "confirming",
    "verifying",
  ];

  return {
    txState,
    resetTxState: () => {
      if (!operationGuardRef.current.isActive()) setTxState(initialState);
    },
    drip,
    approveAndJoin,
    withdraw,
    executeDraw,
    claim,
    isBusy: flowActive || busyPhases.includes(txState.phase),
  };
}
