import React from "react";
import { useCycles } from "../../hooks/useCycles";

const CyclesList: React.FC = () => {
  const { cycles, joinFIFO, openNextAndJoin } = useCycles();

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-main)]">Lista cykli (demo)</h2>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => joinFIFO()}
            className="px-2 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
          >
            Dołącz do bieżącego
          </button>
          <button
            type="button"
            onClick={() => openNextAndJoin()}
            className="px-2 py-1 rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
          >
            Otwórz nowy + dołącz
          </button>
        </div>
      </div>

      <div className="border border-[var(--border-soft)] rounded-md divide-y divide-[var(--border-soft)] text-xs">
        {cycles.length === 0 ? (
          <div className="p-2 text-[var(--text-muted)]">Brak cykli w DEMO.</div>
        ) : (
          cycles.map((c) => (
            <div key={c.id} className="p-2 flex justify-between items-center">
              <div>
                <div className="font-mono text-[var(--text-main)]">{c.id}</div>
                <div className="text-[var(--text-dim)]">
                  Status: {c.status} • Uczestników: {c.participants.length}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CyclesList;
