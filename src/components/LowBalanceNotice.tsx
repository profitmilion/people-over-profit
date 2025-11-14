import { useAccount, useBalance } from "wagmi";

export function LowBalanceNotice({ minEth = 0.00005 }: { minEth?: number }) {
  const { address, isConnected } = useAccount();
  const { data } = useBalance({ address, query: { enabled: !!address } });

  if (!isConnected || !address) return null;

  const bal = data ? Number(data.formatted) : 0;
  if (Number.isNaN(bal) || bal >= minEth) return null;

  return (
    <div className="mt-3 rounded-lg border border-yellow-600/40 bg-yellow-950/20 p-3 text-sm">
      Brak środków na gas. Masz {data?.formatted ?? "0"} {data?.symbol ?? "ETH"}.
      <div className="mt-2 flex gap-2">
        <a
          className="underline"
          href="https://faucet.quicknode.com/base/sepolia"
          target="_blank" rel="noreferrer"
        >
          Faucet QuickNode
        </a>
        <a
          className="underline"
          href="https://blastapi.io/faucets/base-sepolia-eth"
          target="_blank" rel="noreferrer"
        >
          Faucet Blast
        </a>
      </div>
    </div>
  );
}
