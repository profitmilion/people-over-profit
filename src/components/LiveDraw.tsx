import React from "react";
import { useCycles } from "../hooks/useCycles";

const LiveDraw: React.FC = () => {
  const { cycles, runDraw } = useCycles();

  const finished = cycles.filter((c) => c.status === "finished");

  return (
    <div className="mt-4 p-3 rounded-md border border-[var(--border-subtle)] text-sm space-y-2">
      <div className="font-semibold text-[var(--text-dim)]">Podgląd losowań (demo)</div>

      <button
        type="button"
        onClick={() => runDraw()}
        className="px-3 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)] text-xs"
      >
        Wykonaj losowanie (runDraw)
      </button>

      {finished.length === 0 ? (
        <div className="text-[var(--text-muted)] text-xs">Brak zakończonych cykli do wyświetlenia.</div>
      ) : (
        <div className="space-y-1 max-h-40 overflow-auto">
          {finished.map((c) => {
            const anyCycle: any = c;
            const winners = anyCycle.draw?.winners ?? anyCycle.winners ?? [];
            return (
              <div
                key={c.id}
                className="border-b border-[var(--border-soft)] pb-1 mb-1 text-[var(--text-muted)] text-xs"
              >
                <div className="font-mono text-[var(--text-main)]">ID: {c.id}</div>
                <div>Uczestników: {c.participants.length}</div>
                <div>Wygrani: {winners.length}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LiveDraw;
