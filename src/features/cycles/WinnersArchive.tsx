import React from "react";
import { useCycles } from "../../hooks/useCycles";

const WinnersArchive: React.FC = () => {
  const { cycles } = useCycles();

  const archived = cycles.filter((c) => c.status !== "open");

  return (
    <div className="mt-6 space-y-2">
      <h2 className="text-sm font-semibold text-[var(--text-main)]">Archiwum cykli (demo)</h2>

      <div className="border border-[var(--border-soft)] rounded-md text-xs max-h-60 overflow-auto divide-y divide-[var(--border-soft)]">
        {archived.length === 0 ? (
          <div className="p-2 text-[var(--text-muted)]">Brak zakończonych cykli w archiwum.</div>
        ) : (
          archived.map((c) => {
            const anyCycle: any = c;
            const winners = anyCycle.draw?.winners ?? anyCycle.winners ?? [];
            const drawsCount = anyCycle.draw?.count ?? anyCycle.draws ?? 0;

            return (
              <div key={c.id} className="p-2 space-y-1">
                <div className="flex justify-between">
                  <div className="font-mono text-[var(--text-main)]">{c.id}</div>
                  <div className="text-[var(--text-dim)]">Status: {c.status}</div>
                </div>
                <div className="text-[var(--text-dim)]">
                  Uczestników: {c.participants.length} • Wygrani: {winners.length} • Losowań: {drawsCount}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default WinnersArchive;
