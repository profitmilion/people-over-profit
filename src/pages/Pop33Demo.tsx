// src/pages/Pop33Demo.tsx

import React from "react";
import { useNavigate } from "react-router-dom";
import ProdView from "../components/ProdView";
import DevPanel from "../components/DevPanel";

function getViewFromUrl(): "prod" | "dev" {
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get("view");
  return viewParam === "dev" ? "dev" : "prod";
}

export default function Pop33Demo() {
  const view = getViewFromUrl();
  const navigate = useNavigate();

  const setView = (target: "prod" | "dev") => {
    const params = new URLSearchParams(window.location.search);

    if (target === "dev") {
      params.set("view", "dev");
    } else {
      // PROD – domyślny widok, bez parametru `view`
      params.delete("view");
    }

    const search = params.toString();
    const url = search ? `/demo?${search}` : `/demo`;

    navigate(url, { replace: true });
  };

  const baseButton =
    "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-semibold transition";
  const prodButtonClass =
    baseButton +
    (view === "prod"
      ? " bg-emerald-500 text-black border-emerald-500"
      : " bg-transparent text-neutral-200 border-neutral-700 hover:bg-neutral-900");
  const devButtonClass =
    baseButton +
    (view === "dev"
      ? " bg-violet-500 text-black border-violet-500"
      : " bg-transparent text-neutral-200 border-neutral-700 hover:bg-neutral-900");

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Górny pasek DEMO */}
      <header className="border-b border-neutral-800 bg-black/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">pop33 miniapp · DEMO</h1>
            <p className="text-xs text-neutral-400">
              Testnet · tylko punkty · brak prawdziwych środków
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-[11px] text-neutral-200 bg-neutral-900/60">
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Tryb:{" "}
              {view === "dev"
                ? "DEV (panel testowy)"
                : "PROD (widok użytkownika)"}
            </span>
            <button
              type="button"
              className={prodButtonClass}
              onClick={() => setView("prod")}
            >
              PROD
            </button>
            <button
              type="button"
              className={devButtonClass}
              onClick={() => setView("dev")}
            >
              DEV
            </button>
          </div>
        </div>
      </header>

      {/* Główna zawartość */}
      <main className="max-w-5xl mx-auto w-full px-4 py-4 md:py-6">
        {view === "dev" ? (
          // DEV – zostawiamy „surowo”, bo to panel techniczny
          <DevPanel />
        ) : (
          // PROD – opakowujemy w kartę z nagłówkiem
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
