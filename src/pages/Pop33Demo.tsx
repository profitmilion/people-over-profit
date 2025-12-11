// src/pages/Pop33Demo.tsx
import { usePop33Stats } from "../hooks/usePop33Stats";
import { useAccount } from "wagmi";
import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import ProdView from "../components/ProdView";
import DevPanel from "../components/DevPanel";
import WinnersArchive from "../components/WinnersArchive";
import { SectionFrame } from "../components/SectionFrame";

type ViewMode = "prod" | "dev";

/**
 * Odczyt trybu widoku z adresu URL:
 * - /demo          -> "prod"
 * - /demo?view=dev -> "dev"
 *
 * Używane tylko do tego, żeby zdecydować czy pokazać ProdView (użytkownik)
 * czy DevPanel (widok techniczny dla Ciebie).
 */
function useViewMode(): ViewMode {
  const location = useLocation();

  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    const viewParam = params.get("view");
    return viewParam === "dev" ? "dev" : "prod";
  }, [location.search]);
}

export default function Pop33Demo() {
  const view = useViewMode();

  const { address, isConnected } = useAccount();

  const {
    totalJoins,
    totalJoinsLoading,
    currentCycleId,
    currentCycleIdLoading,
    activeCyclesOnchain,
    activeCyclesLoading,
  } = usePop33Stats();

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Wspólny nagłówek miniapp */}

      <SectionFrame className="mb-3">
        <Header />
      </SectionFrame>

      {/* Główna zawartość strony DEMO */}
      <main className="max-w-5xl mx-auto w-full px-4 py-4 md:py-6 flex-1">
        {view === "dev" ? (
          // TRYB DEV – widok techniczny (tylko /demo?view=dev)
          <SectionFrame>
            <DevPanel />
          </SectionFrame>
        ) : (
          // TRYB PROD – zwykły widok demo dla użytkownika (/demo)
          <section className="space-y-3">
            {/* Sekcja tytułowa */}
            <SectionFrame className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">
                This is where future millionaires are born
              </h2>
              <p className="text-[11px] text-neutral-500">
                This is a POP33 environment. All data and draws are simulated.
              </p>
            </SectionFrame>

            {/* Główna karta DEMO */}
            <SectionFrame className="p-3 md:p-4">
              <ProdView />
            </SectionFrame>

            {/* Sekcja – ARCHIWUM CYKLI (DEMO) */}
            <SectionFrame className="mt-4">
              <WinnersArchive />
            </SectionFrame>
            {/* NOWA SEKCJA – ON-CHAIN STATS */}
            <SectionFrame className="mt-4 p-4">
              <h2 className="text-lg font-semibold mb-2">
                On-chain stats (Base Sepolia demo)
              </h2>

              <div className="text-sm space-y-1">
                <p>
                  Total on-chain joins:{" "}
                  {totalJoinsLoading ? "Loading..." : totalJoins.toString()}
                </p>

                <p>
                  Current cycle ID on-chain:{" "}
                  {currentCycleIdLoading
                    ? "Loading..."
                    : `C-${currentCycleId.toString().padStart(4, "0")}`}
                </p>

                {isConnected && (
                  <p>
                    Your active cycles on-chain:{" "}
                    {activeCyclesLoading
                      ? "Loading..."
                      : activeCyclesOnchain.toString()}
                  </p>
                )}
              </div>
            </SectionFrame>

          </section>
        )}
      </main>
    </div>
  );
}
