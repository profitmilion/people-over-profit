import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatEther } from "viem";
import { useSwitchChain } from "wagmi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConnectButton } from "../components/ConnectButton";
import {
  canClaim,
  canExecuteDraw,
  canJoin,
  canWithdraw,
  formatCountdown,
  formatDUsdc,
  formatTimestamp,
  isFaucetAvailable,
  needsApproval,
  poolStatusLabels,
  shortenAddress,
} from "../demo-v1/domain";
import {
  DEMO_V1_CHAIN_ID,
  demoV1Config,
  getDemoV1ConfigErrorMessage,
} from "../demo-v1/config";
import { useDemoV1Actions } from "../hooks/useDemoV1Actions";
import { useDemoV1Data } from "../hooks/useDemoV1Data";

const explorer = "https://sepolia.basescan.org";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-950/70 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

export default function DemoV1Page() {
  const data = useDemoV1Data();
  const actions = useDemoV1Actions(data.refetch);
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const currentPool = useMemo(
    () =>
      data.pools.find((pool) => pool.status === 1 || pool.status === 2 || pool.status === 3) ??
      data.pools.find((pool) => pool.status === 0) ??
      data.pools.at(-1),
    [data.pools],
  );
  const currentRoundNumber = currentPool
    ? currentPool.completedDrawRoundCount + 1n
    : 1n;
  const currentRound = currentPool
    ? data.rounds.find(
        (item) => item.poolId === currentPool.id && item.round === currentRoundNumber,
      )?.data
    : undefined;

  const faucetReady = isFaucetAvailable(data.nextDripAt, now);
  const hasGas = data.nativeBalance > 0n;
  const joinReady = canJoin({
    configured: data.configured,
    connected: data.isConnected,
    correctChain: data.isCorrectChain,
    tokenBalance: data.tokenBalance,
    entryPrice: data.staticData.entryPrice,
    activePositions: data.activePositionsByUser,
    maxActivePositions: data.staticData.maxActivePositions,
  });
  const drawReady = currentPool && currentRound
    ? canExecuteDraw({
        poolStatus: currentPool.status,
        completedRounds: currentPool.completedDrawRoundCount,
        totalRounds: currentPool.drawRoundCount,
        scheduledAt: currentRound.scheduledAt,
        nowMs: now,
      })
    : false;

  const handle = (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <main className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-emerald-900/60 bg-slate-900/90 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
              Base Sepolia · Demo V1
            </div>
            <h1 className="mt-1 text-2xl font-semibold">POP33 Basic V1</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Separate integration for the deployed 33 dUSDC pool lifecycle. The legacy demo remains available unchanged.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link className="text-sm text-emerald-400 hover:text-emerald-300" to="/archive-v1">Demo V1 archive</Link>
            <Link className="text-sm text-slate-400 hover:text-slate-200" to="/demo">Legacy demo</Link>
            <ConnectButton />
          </div>
        </header>

        <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-100">
          <strong>Testnet warning:</strong> dUSDC has no monetary value. This prototype has no KYC and uses temporary, permissionless test draw randomness. Every wallet write still spends Base Sepolia ETH for gas. Do not use mainnet funds.
        </div>

        {!data.configured ? (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
            {getDemoV1ConfigErrorMessage()}
          </div>
        ) : null}
        {data.error ? (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
            RPC read failed: {data.error.message}
          </div>
        ) : null}
        {data.isConnected && !data.isCorrectChain ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-orange-700 bg-orange-950/40 p-4 text-sm text-orange-100">
            <span>Wrong network. Demo V1 requires Base Sepolia, chain ID 84532.</span>
            <Button disabled={isSwitching} onClick={() => switchChain({ chainId: DEMO_V1_CHAIN_ID })}>
              {isSwitching ? "Switching…" : "Switch network"}
            </Button>
          </div>
        ) : null}
        {data.isConnected && data.isCorrectChain && !hasGas ? (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
            This wallet has no Base Sepolia ETH. dUSDC cannot pay gas, so all write actions are disabled.
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Metric label="Wallet" value={shortenAddress(data.address)} />
          <Metric label="Base Sepolia ETH" value={`${Number(formatEther(data.nativeBalance)).toFixed(5)} ETH`} />
          <Metric label="dUSDC balance" value={`${formatDUsdc(data.tokenBalance)} ${data.staticData.tokenSymbol}`} />
          <Metric label="Allowance" value={`${formatDUsdc(data.allowance)} ${data.staticData.tokenSymbol}`} />
          <Metric label="Entry" value={`${formatDUsdc(data.staticData.entryPrice)} dUSDC`} />
          <Metric label="Active positions" value={`${data.activePositionsByUser} / ${data.staticData.maxActivePositions}`} />
          <Metric label="Claimable" value={`${formatDUsdc(data.claimablePrizesByUser)} dUSDC`} />
          <Metric label="Pools" value={`${data.staticData.poolCount} total · ${data.staticData.openPoolCount} open`} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="text-lg font-semibold">1. Test token faucet</h2>
            <p className="mt-2 text-sm text-slate-400">
              Drip amount: {formatDUsdc(data.staticData.dripAmount)} dUSDC. Cooldown: {data.staticData.dripCooldown.toString()} seconds.
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Next drip: {formatCountdown(data.nextDripAt, now)}
            </p>
            <Button
              className="mt-4"
              disabled={!data.isConnected || !data.isCorrectChain || !hasGas || !faucetReady || actions.isBusy}
              onClick={() => handle(actions.drip())}
            >
              Get test dUSDC
            </Button>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">2. Approve and join</h2>
            <p className="mt-2 text-sm text-slate-400">
              The button approves exactly one entry only when required, waits for its receipt, then requests a separate join signature.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Approval required: {needsApproval(data.allowance, data.staticData.entryPrice) ? "yes" : "no"}
            </p>
            <Button
              variant="pop"
              className="mt-4 px-6 py-2 text-sm"
              disabled={!joinReady || !hasGas || actions.isBusy}
              onClick={() => handle(actions.approveAndJoin({
                entryPrice: data.staticData.entryPrice,
                tokenBalance: data.tokenBalance,
                allowance: data.allowance,
              }))}
            >
              Approve if needed, then join
            </Button>
          </Card>
        </section>

        {actions.txState.phase !== "idle" ? (
          <div className="rounded-xl border border-sky-800 bg-sky-950/40 p-4 text-sm">
            <div className="font-semibold">{actions.txState.action}: {actions.txState.phase}</div>
            {actions.txState.message ? <div className="mt-1 text-sky-200">{actions.txState.message}</div> : null}
            {actions.txState.hash ? (
              <a className="mt-2 inline-block text-sky-400 underline" href={`${explorer}/tx/${actions.txState.hash}`} target="_blank" rel="noreferrer">
                View transaction on BaseScan
              </a>
            ) : null}
          </div>
        ) : null}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Current pool lifecycle</h2>
            <Button variant="ghost" disabled={data.isLoading} onClick={() => void data.refetch()}>
              Refresh reads
            </Button>
          </div>
          {!currentPool ? (
            <p className="mt-4 text-sm text-slate-400">No pool exists yet. The first successful join creates one.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Pool" value={`#${currentPool.id}`} />
                <Metric label="Status" value={poolStatusLabels[currentPool.status] ?? `Unknown (${currentPool.status})`} />
                <Metric label="Positions" value={`${currentPool.activePositionCount} / ${currentPool.positionsPerPool}`} />
                <Metric label="Escrow" value={`${formatDUsdc(currentPool.escrowedAmount)} dUSDC`} />
                <Metric label="Opened" value={formatTimestamp(currentPool.openedAt)} />
                <Metric label="Locked" value={formatTimestamp(currentPool.lockedAt)} />
                <Metric label="Draw progress" value={`${currentPool.completedDrawRoundCount} / ${currentPool.drawRoundCount}`} />
                <Metric label="Claim progress" value={`${currentPool.claimedPrizeCount} / ${currentPool.drawRoundCount}`} />
              </div>
              {currentRound && currentPool.completedDrawRoundCount < currentPool.drawRoundCount ? (
                <div className="rounded-xl border border-slate-800 p-4">
                  <div className="text-sm font-semibold">Next round #{currentRoundNumber.toString()}</div>
                  <div className="mt-1 text-sm text-slate-400">
                    Scheduled: {formatTimestamp(currentRound.scheduledAt)} · {formatCountdown(currentRound.scheduledAt, now)}
                  </div>
                  <Button
                    className="mt-3"
                    disabled={!drawReady || !data.isConnected || !data.isCorrectChain || !hasGas || actions.isBusy}
                    onClick={() => handle(actions.executeDraw(currentPool.id, currentRoundNumber))}
                  >
                    Execute permissionless test draw
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">My active positions</h2>
          {data.positions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No active positions for the connected wallet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.positions.map((position) => {
                const pool = data.pools.find((item) => item.id === position.poolId);
                const winningRound = data.rounds.find(
                  (round) => round.poolId === position.poolId && round.data?.winningPositionId === position.id,
                )?.data;
                return (
                  <div key={position.id.toString()} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 p-4 md:flex-row md:items-center">
                    <div className="text-sm">
                      <div className="font-semibold">Position #{position.id.toString()} · pool #{position.poolId.toString()}</div>
                      <div className="mt-1 text-slate-400">
                        Joined {formatTimestamp(position.joinedAt)} · {winningRound ? `winner, ${winningRound.claimed ? "claimed" : "unclaimed"}` : "no assigned win"}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      disabled={!pool || !canWithdraw(pool.status, position.active) || !hasGas || actions.isBusy}
                      onClick={() => handle(actions.withdraw(position.id))}
                    >
                      Withdraw from open pool
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Draw rounds and claims</h2>
          {!currentPool ? null : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr><th className="p-2">Round</th><th className="p-2">Status</th><th className="p-2">Scheduled</th><th className="p-2">Winner</th><th className="p-2">Prize</th><th className="p-2">Claim</th></tr>
                </thead>
                <tbody>
                  {data.rounds.filter((item) => item.poolId === currentPool.id).map(({ round, data: draw }) => (
                    <tr key={round.toString()} className="border-t border-slate-800">
                      <td className="p-2">#{round.toString()}</td>
                      <td className="p-2">{draw?.status === 1 ? "Finalized" : "Pending"}</td>
                      <td className="p-2">{formatTimestamp(draw?.scheduledAt ?? 0n)}</td>
                      <td className="p-2">{shortenAddress(draw?.winner)}</td>
                      <td className="p-2">{formatDUsdc(draw?.prizeAmount ?? 0n)} dUSDC</td>
                      <td className="p-2">
                        {draw?.claimed ? "Claimed" : (
                          <Button
                            variant="ghost"
                            disabled={!draw || !canClaim({ roundStatus: draw.status, claimed: draw.claimed, winner: draw.winner, user: data.address }) || !hasGas || actions.isBusy}
                            onClick={() => handle(actions.claim(currentPool.id, round))}
                          >
                            Claim
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <footer className="space-y-2 pb-6 text-xs text-slate-500">
          <div>Contract: <a className="text-slate-300 underline" href={`${explorer}/address/${demoV1Config.contractAddress}`} target="_blank" rel="noreferrer">{demoV1Config.contractAddress}</a></div>
          <div>Token: <a className="text-slate-300 underline" href={`${explorer}/address/${demoV1Config.tokenAddress}`} target="_blank" rel="noreferrer">{demoV1Config.tokenAddress}</a></div>
          <div>Getter-only frontend coverage is capped at 50 pools. A backend indexer is not included in this checkpoint.</div>
        </footer>
      </main>
    </div>
  );
}
