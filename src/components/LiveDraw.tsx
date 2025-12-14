import React from "react";
import { useCycles } from "../hooks/useCycles";
import type { Cycle } from "../types/core";

function getStats(c: Cycle) {
  const drawHistory = Array.isArray(c.drawHistory) ? c.drawHistory : [];
  const drawsCount = drawHistory.length;

  // unikalni zwycięzcy po całej historii
  const unique = new Set<string>();
  for (const d of drawHistory) {
    if (Array.isArray(d?.winners)) {
      d.winners.forEach((w) => unique.add(String(w)));
    }
  }

  return {
    drawsCount,
    winnersCount: unique.size,
  };
}

const LiveDraw: React.FC = () => {
  const { cycles, runDraw } = useCycles();

  // W DEMO interesują nas cykle, które są w trakcie losowań ("drawing")
  // oraz zakończone ("finished") – oba mają historię wyników.
  const drawableOrFinished = cycles.filter(
    (c) => c.status === "drawing" || c.status === "finished"
  );

  return (
    <div className="mt-4 p-3 rounded-md border border-[var(--border-subtle)] text-sm space-y-2">
      <div className="font-semibold text-[var(--text-dim)]">
        Podgląd losowań (demo)
      </div>

      <button
        type="button"
        onClick={() => runDraw()}
        className="px-3 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)] text-xs"
      >
        Wykonaj losowanie (runDraw)
      </button>

      {drawableOrFinished.length === 0 ? (
        <div className="text-[var(--text-muted)] text-xs">
          Brak cykli w fazie losowań lub zakończonych.
        </div>
      ) : (
        <div className="space-y-1 max-h-40 overflow-auto">
          {drawableOrFinished.map((c) => {
            const { drawsCount, winnersCount } = getStats(c);
            return (
              <div
                key={c.id}
                className="border-b border-[var(--border-soft)] pb-1 mb-1 text-[var(--text-muted)] text-xs"
              >
                <div className="font-mono text-[var(--text-main)]">
                  ID: {c.id}
                </div>
                <div>Status: {c.status}</div>
                <div>Uczestników: {c.participants.length}</div>
                <div>Losowań: {drawsCount}</div>
                <div>Unikalni wygrani: {winnersCount}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LiveDraw;
