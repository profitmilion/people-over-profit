// src/pages/Pop33Demo.tsx
import { usePop33Stats } from "../hooks/usePop33Stats";
import { useAccount } from "wagmi";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import ProdView from "../components/ProdView";
import DevPanel from "../components/DevPanel";
import WinnersArchive from "../components/WinnersArchive";
import { SectionFrame } from "../components/SectionFrame";
import { ConnectButton } from "../components/ConnectButton";


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

  const { isConnected } = useAccount();

  const { activeCyclesOnchain, activeCyclesLoading } = usePop33Stats();


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

            <SectionFrame className="flex flex-col items-center text-center gap-2">
              <h2 className="text-lg font-semibold">
                This is where future millionaires are born
              </h2>
              <h3 className="text-lg font-semibold">
                Testnet · No real funds · For testing purposes only
              </h3>
              <div className="flex items-center justify-center">
                <ConnectButton />
              </div>

              <p className="text-[11px] text-neutral-500 max-w-xl">
                This is the POP33 Base Sepolia testnet. On-chain data and actions.
              </p>
            </SectionFrame>

            {/* NOWA SEKCJA – ON-CHAIN STATS */}
            <SectionFrame className="mt-4 p-4">
              <h2 className="text-lg font-semibold mb-2">On-chain status</h2>

              <div className="text-sm space-y-1">
                <p>
                  Wallet:{" "}
                  {isConnected ? (
                    <span className="text-emerald-300">Connected</span>
                  ) : (
                    <span className="text-neutral-400">Not connected</span>
                  )}
                </p>

                <p>
                  Your on-chain entry:{" "}
                  {isConnected ? (
                    activeCyclesLoading ? (
                      "Loading..."
                    ) : activeCyclesOnchain > 0n ? (
                      <span className="text-emerald-300">Active</span>
                    ) : (
                      <span className="text-neutral-400">None</span>
                    )
                  ) : (
                    <span className="text-neutral-400">Connect wallet to check</span>
                  )}
                </p>


              </div>
            </SectionFrame>


            {/* Główna karta DEMO */}
            <SectionFrame className="p-3 md:p-4">
              <ProdView />
            </SectionFrame>

            {/* Sekcja – ARCHIWUM CYKLI (DEMO) */}
            <SectionFrame className="mt-4">
              <WinnersArchive />
            </SectionFrame>



          </section>
        )}
      </main>
    </div>
  );
}
