// src/pages/Pop33Demo.tsx
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import Header from "../components/Header";
import ProdView from "../components/ProdView";
import DevPanel from "../components/DevPanel";
import WinnersArchive from "../components/WinnersArchive";
import { SectionFrame } from "../components/SectionFrame";


type ViewMode = "legacy" | "dev";

/**
 * Odczyt trybu widoku z adresu URL:
 * - /demo          -> "legacy"
 * - /demo?view=dev -> "dev"
 *
 * Publiczny produkt jest dostępny wyłącznie pod /demo-v1. Ten routing
 * zachowuje historyczny punkt wejścia i lokalne narzędzia developerskie.
 */
function useViewMode(): ViewMode {
  const location = useLocation();

  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    const viewParam = params.get("view");
    return viewParam === "dev" ? "dev" : "legacy";
  }, [location.search]);
}

export default function Pop33Demo() {
  const view = useViewMode();

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
          <section className="space-y-3">
            <SectionFrame className="space-y-2 text-center">
              <p className="text-sm font-semibold text-amber-300">
                Local simulation — developer tool only
              </p>
              <p className="text-xs leading-relaxed text-neutral-400">
                This view does not use the current POP33 Demo V1 contract. Its
                browser-local data may come from localStorage and can disappear
                when browser storage is cleared. The simulator does not represent
                the current 33 dUSDC economics or the complete on-chain lifecycle.
              </p>
            </SectionFrame>
            <SectionFrame>
              <ProdView />
            </SectionFrame>
            <SectionFrame>
              <DevPanel />
            </SectionFrame>
            <SectionFrame>
              <WinnersArchive />
            </SectionFrame>
          </section>
        ) : (
          // ZWYKŁE /demo – bez akcji starego kontraktu
          <section>
            <SectionFrame className="mx-auto flex max-w-2xl flex-col items-center gap-4 p-6 text-center sm:p-8">
              <div className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">
                Legacy route
              </div>
              <h1 className="text-2xl font-semibold text-slate-50">
                This demo route has been retired from the public product flow
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-neutral-400">
                The current POP33 Demo V1 uses Pop33BasicV1 on Base Sepolia.
                The former contract integration is retained in the repository
                for historical and developer reference, but no legacy wallet
                action is available on this public route.
              </p>
              <Link
                to="/demo-v1"
                className="inline-flex rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 no-underline transition-colors hover:bg-emerald-300"
              >
                Open the current Demo V1
              </Link>
            </SectionFrame>
          </section>
        )}
      </main>
    </div>
  );
}
