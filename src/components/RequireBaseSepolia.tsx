import type { ReactNode } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

const BASE_SEPOLIA_ID = 84532;

export default function RequireBaseSepolia({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, status: switchStatus } = useSwitchChain(); // wagmi v2
  const pending = switchStatus === "pending";

  const onWrongNetwork = isConnected && chainId !== BASE_SEPOLIA_ID;

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-neutral-800 p-6">
          <h2 className="text-xl font-semibold mb-2">Połącz portfel</h2>
          <p className="text-[var(--text-dim)]">
            Aby korzystać z demo, połącz portfel i wybierz sieć Base Sepolia.
          </p>
        </div>
      </div>
    );
  }

  if (onWrongNetwork) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-neutral-800 p-6">
          <h2 className="text-xl font-semibold mb-3">Zmień sieć na Base Sepolia</h2>
          <p className="text-[var(--text-dim)] mb-4">
            Ta aplikacja działa w trybie demo na Base Sepolia.
          </p>
          <button
            onClick={() => switchChain({ chainId: BASE_SEPOLIA_ID })}
            disabled={pending}
            className="rounded-xl border border-neutral-700 px-4 py-2 hover:bg-neutral-900 focus:outline-none focus:ring"
            aria-busy={pending}
          >
            {pending ? "Przełączanie..." : "Przełącz na Base Sepolia"}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
