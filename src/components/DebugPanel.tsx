import React from "react";
import { useCycles } from "../hooks/useCycles";

const DebugPanel: React.FC = () => {
  const { cycles, joinFIFO, openNextAndJoin, runDraw, addFakeParticipants, resetDemo } = useCycles();

  const open = cycles.find((c) => c.status === "open");
  const finished = cycles.filter((c) => c.status === "finished");

  return (
    <div className="mt-4 p-3 border border-dashed border-[var(--border-subtle)] rounded-md text-xs space-y-3">
      <div className="font-semibold text-[var(--text-dim)]">
        Panel debug (tylko w DEMO)
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => joinFIFO()}
          className="px-2 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          Dołącz 1 uczestnika
        </button>

        <button
          type="button"
          onClick={() => addFakeParticipants(10)}
          className="px-2 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          +10 uczestników (demo)
        </button>

        <button
          type="button"
          onClick={() => addFakeParticipants(100)}
          className="px-2 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          +100 uczestników (demo)
        </button>

        <button
          type="button"
          onClick={() => openNextAndJoin()}
          className="px-2 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          Otwórz nowy cykl i dołącz
        </button>

        <button
          type="button"
          onClick={() => runDraw()}
          className="px-2 py-1 rounded border border-[var(--border-strong)] text-[var(--accent-strong)] hover:bg-[var(--bg-soft)]"
        >
          Wykonaj losowanie (runDraw)
        </button>

        <button
          type="button"
          onClick={() => resetDemo()}
          className="px-2 py-1 rounded border border-red-500 text-red-500 hover:bg-red-500/5"
        >
          Reset DEMO
        </button>
      </div>

      <div className="space-y-1">
        <div className="font-semibold text-[var(--text-dim)]">Aktualny cykl</div>
        {open ? (
          <div className="text-[var(--text-muted)]">
            ID: <span className="font-mono">{open.id}</span> • status: {open.status} • uczestników:{" "}
            {open.participants.length}
          </div>
        ) : (
          <div className="text-[var(--text-muted)]">Brak otwartego cyklu.</div>
        )}
      </div>

      <div className="space-y-1 max-h-40 overflow-auto">
        <div className="font-semibold text-[var(--text-dim)]">Zamknięte / zakończone cykle</div>
        {finished.length === 0 ? (
          <div className="text-[var(--text-muted)]">Brak zakończonych cykli.</div>
        ) : (
          finished.map((c) => {
            const anyCycle: any = c;
            const winners = anyCycle.draw?.winners ?? anyCycle.winners ?? [];
            return (
              <div
                key={c.id}
                className="flex items-center justify-between text-[var(--text-muted)] border-b border-[var(--border-soft)] py-1"
              >
                <div>
                  <span className="font-mono text-[var(--text-main)]">{c.id}</span>{" "}
                  <span className="text-[var(--text-dim)]">status: {c.status}</span>
                </div>
                <div className="text-[var(--text-dim)]">
                  uczestników: {c.participants.length}
                  {" • "}
                  wygrani: {winners.length}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DebugPanel;
