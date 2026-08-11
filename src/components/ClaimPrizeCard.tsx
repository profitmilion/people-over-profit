import { Button } from "./Button";
import { canClaim, formatDUsdc } from "../demo-v1/domain";
import type { DemoV1TxState } from "../hooks/useDemoV1Actions";

const explorer = "https://sepolia.basescan.org";

type ClaimPrizeCardProps = {
  poolId: bigint;
  roundNumber: bigint;
  winner: string;
  winningPositionId: bigint;
  prizeAmount: bigint;
  claimed: boolean;
  roundStatus: number;
  connectedAddress?: string;
  connected: boolean;
  correctChain: boolean;
  runtimeReady: boolean;
  hasGas: boolean;
  busy: boolean;
  txState: DemoV1TxState;
  onClaim: () => Promise<unknown>;
};

function claimAction(poolId: bigint, roundNumber: bigint): string {
  return `Claim pool #${poolId} round #${roundNumber}`;
}

export function ClaimPrizeCard({
  poolId,
  roundNumber,
  winner,
  winningPositionId,
  prizeAmount,
  claimed,
  roundStatus,
  connectedAddress,
  connected,
  correctChain,
  runtimeReady,
  hasGas,
  busy,
  txState,
  onClaim,
}: ClaimPrizeCardProps) {
  const action = claimAction(poolId, roundNumber);
  const isCurrentTransaction = txState.action === action;
  const claimConfirmed = isCurrentTransaction && txState.phase === "confirmed";
  const displayClaimed = claimed || claimConfirmed;
  const eligible = canClaim({
    configured: runtimeReady,
    connected,
    correctChain,
    roundStatus,
    claimed,
    prizeAmount,
    winner,
    user: connectedAddress,
  });
  const transactionPending =
    isCurrentTransaction &&
    ["awaiting-signature", "submitted", "confirming", "verifying"].includes(
      txState.phase,
    );

  const statusMessage = (() => {
    if (!isCurrentTransaction) return null;
    if (txState.phase === "awaiting-signature") {
      return "Confirm the Claim transaction in your wallet.";
    }
    if (txState.phase === "submitted" || txState.phase === "confirming") {
      return "Claim transaction pending...";
    }
    if (txState.phase === "verifying") {
      return "Receipt confirmed. Verifying the prize transfer...";
    }
    if (txState.phase === "confirmed") return "Prize claimed";
    if (txState.phase === "rejected") {
      return "Claim cancelled in the wallet. No transaction was sent.";
    }
    if (
      txState.phase === "reverted" ||
      txState.phase === "verification-failed" ||
      txState.phase === "manual-review"
    ) {
      return txState.message ?? "Claim failed. No automatic retry was sent.";
    }
    return txState.message ?? null;
  })();

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-600/70 bg-gradient-to-br from-emerald-950/95 via-slate-900 to-slate-950 p-4 shadow-lg shadow-emerald-950/30 sm:p-6">
      <div className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">
        {displayClaimed ? "Prize claimed" : "You won"}
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">
        {formatDUsdc(prizeAmount)} dUSDC
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-950/70 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Pool</div>
          <div className="mt-1 font-semibold">#{poolId.toString()}</div>
        </div>
        <div className="rounded-xl bg-slate-950/70 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Round</div>
          <div className="mt-1 font-semibold">#{roundNumber.toString()}</div>
        </div>
        <div className="rounded-xl bg-slate-950/70 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Position</div>
          <div className="mt-1 font-semibold">#{winningPositionId.toString()}</div>
        </div>
      </div>

      {displayClaimed ? (
        <div className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950/60 p-3 text-center text-sm font-semibold text-emerald-200">
          Claimed
        </div>
      ) : (
        <Button
          variant="pop"
          className="mt-5 min-h-12 w-full rounded-xl px-5 py-3 text-base"
          disabled={!eligible || !hasGas || busy || transactionPending}
          onClick={() => void onClaim().catch(() => undefined)}
        >
          {transactionPending
            ? "Claim pending..."
            : `Claim ${formatDUsdc(prizeAmount)} dUSDC`}
        </Button>
      )}

      {!displayClaimed && !correctChain ? (
        <p className="mt-3 text-center text-xs text-amber-300">
          Switch your wallet to Base Sepolia to claim.
        </p>
      ) : null}
      {!displayClaimed && correctChain && !hasGas ? (
        <p className="mt-3 text-center text-xs text-amber-300">
          Add a small amount of test Base Sepolia ETH for gas.
        </p>
      ) : null}
      {statusMessage ? (
        <div
          className={`mt-3 rounded-xl border p-3 text-center text-sm ${
            txState.phase === "confirmed"
              ? "border-emerald-700 bg-emerald-950/50 text-emerald-200"
              : txState.phase === "rejected" || txState.phase === "reverted"
                ? "border-red-800 bg-red-950/40 text-red-200"
                : "border-sky-800 bg-sky-950/40 text-sky-200"
          }`}
          role={txState.phase === "rejected" || txState.phase === "reverted" ? "alert" : "status"}
        >
          <div>{statusMessage}</div>
          {txState.hash ? (
            <a
              className="mt-2 inline-block font-semibold text-sky-300 underline"
              href={`${explorer}/tx/${txState.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on BaseScan
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
