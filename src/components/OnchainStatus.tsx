import { useChainId, useBlockNumber } from "wagmi";

export function OnchainStatus() {
  const chainId = useChainId();
  const { data, isLoading, error } = useBlockNumber({ watch: true });

  if (error) return <div className="text-xs text-red-400">Chain error</div>;

  return (
    <div className="text-xs text-[var(--text-dim)]">
      Net: {chainId} • Block: {isLoading ? "…" : data?.toString()}
    </div>
  );
}
