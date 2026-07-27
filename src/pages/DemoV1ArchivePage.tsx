import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import {
  formatDUsdc,
  formatTimestamp,
  poolStatusLabels,
  shortenAddress,
  sortPoolsByIdAscending,
} from "../demo-v1/domain";
import { demoV1Config, getDemoV1ConfigErrorMessage } from "../demo-v1/config";
import { useDemoV1Data } from "../hooks/useDemoV1Data";

const explorer = "https://sepolia.basescan.org";

export default function DemoV1ArchivePage() {
  const data = useDemoV1Data();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <main className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-emerald-400">Getter-based public view</div>
            <h1 className="mt-1 text-2xl font-semibold">Demo V1 archive</h1>
          </div>
          <Link className="text-emerald-400 hover:text-emerald-300" to="/demo-v1">Back to Demo V1</Link>
        </header>

        <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-100">
          Base Sepolia test data only. The contract getters do not expose historical transaction hashes, so each pool links to the contract explorer view rather than inventing event-to-transaction associations.
        </div>
        {!data.configured ? <div className="text-red-300">{getDemoV1ConfigErrorMessage()}</div> : null}
        {data.error ? <div className="text-red-300">RPC read failed: {data.error.message}</div> : null}
        {data.poolLimitReached ? <div className="text-orange-300">Only the newest frontend-supported range of 50 pools is loaded. An indexer is TO DECIDE.</div> : null}

        {data.pools.length === 0 && !data.isLoading ? (
          <Card><p className="text-sm text-slate-400">No deployed Demo V1 pools have been created yet.</p></Card>
        ) : null}

        {sortPoolsByIdAscending(data.pools).map((pool) => (
          <Card key={pool.id.toString()}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Pool #{pool.id.toString()}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {poolStatusLabels[pool.status] ?? `Unknown (${pool.status})`} · opened {formatTimestamp(pool.openedAt)} · {pool.activePositionCount.toString()} positions
                </p>
              </div>
              <a className="text-sm text-sky-400 underline" href={`${explorer}/address/${demoV1Config.contractAddress}#readContract`} target="_blank" rel="noreferrer">
                Inspect contract
              </a>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr><th className="p-2">Round</th><th className="p-2">Status</th><th className="p-2">Scheduled</th><th className="p-2">Executed</th><th className="p-2">Winner</th><th className="p-2">Position</th><th className="p-2">Prize</th><th className="p-2">Claimed</th></tr>
                </thead>
                <tbody>
                  {data.rounds.filter((item) => item.poolId === pool.id).map(({ round, data: draw }) => (
                    <tr key={round.toString()} className="border-t border-slate-800">
                      <td className="p-2">#{round.toString()}</td>
                      <td className="p-2">{draw?.status === 1 ? "Finalized" : "Pending"}</td>
                      <td className="p-2">{formatTimestamp(draw?.scheduledAt ?? 0n)}</td>
                      <td className="p-2">{formatTimestamp(draw?.executedAt ?? 0n)}</td>
                      <td className="p-2">{shortenAddress(draw?.winner)}</td>
                      <td className="p-2">{draw?.winningPositionId ? `#${draw.winningPositionId}` : "—"}</td>
                      <td className="p-2">{formatDUsdc(draw?.prizeAmount ?? 0n)} dUSDC</td>
                      <td className="p-2">{draw?.claimed ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </main>
    </div>
  );
}
