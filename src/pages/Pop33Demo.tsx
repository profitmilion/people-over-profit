// src/pages/Pop33Demo.tsx

import React, { useMemo } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import ProdView from "../components/ProdView";
import DevPanel from "../components/DevPanel";

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

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Wspólny nagłówek miniapp */}
      <Header />

      {/* Główna zawartość strony DEMO */}
      <main className="max-w-5xl mx-auto w-full px-4 py-4 md:py-6 flex-1">
        {view === "dev" ? (
          // TRYB DEV – widok techniczny (tylko /demo?view=dev)
          <DevPanel />
        ) : (
          // TRYB PROD – zwykły widok demo dla użytkownika (/demo)
          <section className="space-y-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">
                Panel użytkownika – wersja DEMO
              </h2>
              <p className="text-xs text-neutral-400">
                To jest widok z perspektywy zwykłego uczestnika. Dane i losowania
                są symulowane na testnecie – bez prawdziwych środków.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/80 p-3 md:p-4">
              <ProdView />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
