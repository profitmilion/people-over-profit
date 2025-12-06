// src/pages/ArchivePage.tsx

import React from "react";
import { useCycles } from "../hooks/useCycles"; // ścieżka dobra przy strukturze src/pages + src/hooks

type AnyCycle = any;

export const ArchivePage: React.FC = () => {
  // z hooka bierzemy tylko to, co faktycznie istnieje
  const { cycles } = useCycles();

  const archived = cycles.filter((c) => c.status !== "open");

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--text-main)]">
          Pełne archiwum cykli POP33 DEMO
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Łączna liczba zakończonych cykli: {archived.length}
        </p>
      </header>

      <section className="border border-[var(--border-soft)] rounded-md text-sm overflow-auto divide-y divide-[var(--border-soft)]">
        {archived.length === 0 ? (
          <div className="p-3 text-[var(--text-muted)]">
            Brak zakończonych cykli w archiwum.
          </div>
        ) : (
          archived
            .slice()
            .reverse() // najnowsze na górze
            .map((c: AnyCycle) => {
              const winners = c.draw?.winners ?? c.winners ?? [];
              const drawsCount = c.draw?.count ?? c.draws ?? 0;

              return (
                <article key={c.id} className="p-3 space-y-1">
                  <div className="flex justify-between gap-4">
                    <div className="font-mono text-[var(--text-main)] break-all">
                      {c.id}
                    </div>
                    <div className="text-[var(--text-dim)]">
                      Status: {c.status}
                    </div>
                  </div>
                  <div className="text-[var(--text-dim)]">
                    Uczestników: {c.participants?.length ?? 0} • Wygrani:{" "}
                    {winners.length} • Losowań: {drawsCount}
                  </div>
                </article>
              );
            })
        )}
      </section>
    </main>
  );
};
