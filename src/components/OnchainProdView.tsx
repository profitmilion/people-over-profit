import { useCallback, useEffect, useRef, useState } from "react";
import { usePop33Onchain } from "../hooks/usePop33Onchain";
import { OnchainJoinError } from "../hooks/usePop33Onchain";
import { usePop33Stats } from "../hooks/usePop33Stats";

type JoinPhase =
  | "idle"
  | "awaiting-wallet"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "error";

function getBaseSepoliaTxUrl(hash?: string) {
  return hash ? `https://sepolia.basescan.org/tx/${hash}` : "";
}

function shortenHash(hash?: string, len = 6) {
  if (!hash || hash.length <= len * 2) return hash ?? "";
  return `${hash.slice(0, len)}…${hash.slice(-len)}`;
}

function isUserRejectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    name?: unknown;
    cause?: unknown;
  };

  return (
    candidate.code === 4001 ||
    candidate.name === "UserRejectedRequestError" ||
    isUserRejectedError(candidate.cause)
  );
}

function getFriendlyTransactionError(error: unknown): Error {
  if (error instanceof OnchainJoinError) return error;
  if (isUserRejectedError(error)) {
    return new Error("Transaction cancelled. No transaction was sent.");
  }
  return new Error("Transaction failed. Please try again.");
}

export default function OnchainProdView() {
  const intentLocked = useRef(false);
  const [phase, setPhase] = useState<JoinPhase>("idle");
  const [intentError, setIntentError] = useState<Error | null>(null);

  const {
    onchainAvailability,
    canUseOnchain,
    triggerOnchainJoin,
    isPending,
    isConfirming,
    isConfirmed,
    txHash,
    onchainError,
  } = usePop33Onchain();

  const {
    totalJoins,
    totalJoinsLoading,
    currentCycleId,
    currentCycleIdLoading,
    activeCyclesOnchain,
    activeCyclesLoading,
    refetchStats,
  } = usePop33Stats();

  useEffect(() => {
    if (isConfirming) setPhase("confirming");
  }, [isConfirming]);

  useEffect(() => {
    if (!isConfirmed) return;
    setPhase("confirmed");
    intentLocked.current = false;
    refetchStats();
  }, [isConfirmed, refetchStats]);

  useEffect(() => {
    if (!onchainError) return;
    console.error("POP33 on-chain transaction failed:", onchainError);
    setIntentError(getFriendlyTransactionError(onchainError));
    setPhase("error");
    intentLocked.current = false;
  }, [onchainError]);

  const handleJoin = useCallback(async () => {
    if (intentLocked.current || !canUseOnchain) return;

    intentLocked.current = true;
    setIntentError(null);
    setPhase("awaiting-wallet");

    try {
      await triggerOnchainJoin();
      setPhase("submitted");
    } catch (error) {
      console.error("POP33 on-chain join request failed:", error);
      setIntentError(getFriendlyTransactionError(error));
      setPhase("error");
      intentLocked.current = false;
    }
  }, [canUseOnchain, triggerOnchainJoin]);

  const availabilityMessage = {
    disabled: "On-chain mode is disabled.",
    "wallet-disconnected": "Connect your wallet to use POP IT.",
    "missing-address": "Connect your wallet to use POP IT.",
    "wrong-network": "Switch your wallet network to Base Sepolia.",
    "invalid-contract": "The Base Sepolia contract configuration is invalid.",
    ready: null,
  }[onchainAvailability];

  const transactionBusy =
    intentLocked.current || isPending || isConfirming || phase === "awaiting-wallet";
  const displayedError =
    phase === "error" ? intentError ?? (onchainError as Error | null) : null;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-5">
      <header className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">POP33 Base Sepolia</h1>
        <p className="text-sm text-neutral-400">
          Testnet on-chain entry. No local simulation data is used in this view.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/40">
        <div className="flex flex-col items-center gap-4 text-center">
          <button
            type="button"
            onClick={handleJoin}
            disabled={!canUseOnchain || transactionBusy}
            className="flex h-20 w-20 items-center justify-center rounded-full border border-sky-500 bg-sky-500 font-semibold text-sm text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            POP IT
          </button>

          {availabilityMessage && <p className="text-xs text-amber-300">{availabilityMessage}</p>}
          {phase === "awaiting-wallet" && <p className="text-xs text-sky-300">Waiting for wallet approval…</p>}
          {phase === "submitted" && <p className="text-xs text-sky-300">Transaction submitted.</p>}
          {phase === "confirming" && <p className="text-xs text-sky-300">Transaction is confirming on Base Sepolia…</p>}
          {phase === "confirmed" && <p className="text-xs text-emerald-400">Transaction confirmed.</p>}

          {txHash && (
            <a href={getBaseSepoliaTxUrl(txHash)} target="_blank" rel="noreferrer" className="font-mono text-xs text-sky-200 underline" title={txHash}>
              {shortenHash(txHash)}
            </a>
          )}

          {displayedError && (
            <p className="max-w-xl break-all text-xs text-red-400">
              Transaction error: {displayedError.message ?? String(displayedError)}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/40 space-y-2">
        <h2 className="text-lg font-semibold">Available on-chain data</h2>
        <p className="text-sm">Total joins: {totalJoinsLoading ? "Loading…" : totalJoins.toString()}</p>
        <p className="text-sm">Current cycle ID: {currentCycleIdLoading ? "Loading…" : currentCycleId.toString()}</p>
        <p className="text-sm">Your active cycles: {activeCyclesLoading ? "Loading…" : activeCyclesOnchain.toString()}</p>
        <p className="text-xs text-amber-300">
          Testnet limitation: the current frontend reads the active-cycle count, but the available
          contract sources and ABI do not prove complete enforcement of the approved 10-position
          limit and lifecycle rules.
        </p>
      </section>
    </div>
  );
}
