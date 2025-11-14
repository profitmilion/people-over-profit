// src/components/LiveDraw.tsx — OFFLINE (100 uczestników / 3 zwycięzców)
import { useState } from "react";
import { useCycles } from "../hooks/useCycles";
import { canDraw } from "../utils/cycles";

export default function LiveDraw() {
  const { cycles, drawWinner } = useCycles();
  const closed = cycles.filter(c => c.status === "closed");
  const [err, setErr] = useState<string | null>(null);

  function onDraw(id: number) {
    try {
      drawWinner(id);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "Błąd losowania (offline)");
    }
  }

  return (
    <div className="space-y-4">
      {/* poprawiony opis: < 3 */}
      <p className="text-sm text-[var(--text-dim)] -mt-2">
        Losowanie działa tylko dla cykli zamkniętych i dopóki wygranych &lt; 3.
      </p>

      {closed.map(c => (
        <div key={c.id} className="rounded-2xl border border-neutral-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-[var(--text-dim)]">Cykl #{c.index}</div>
              <div className="text-base">
                Uczestnicy {c.participants.length}/100 · Wygrani {c.winners.length}/3
              </div>
              <div className="text-xs text-[var(--text-dim)]">
                Zamknięty: {c.closedAt ? new Date(c.closedAt).toLocaleString() : "-"}
              </div>
            </div>
            <button
              onClick={() => onDraw(c.id)}
              disabled={!canDraw(c)}
              className="rounded-xl px-3 py-2 bg-[var(--gold)]/90 text-black font-semibold disabled:opacity-50"
            >
              Losuj zwycięzcę
            </button>
          </div>

          {c.winners.length > 0 && (
            <div className="mt-3 text-xs break-all text-[var(--text-dim)]">
              {c.winners.map((w, i) => (
                <div key={w + i}>{i + 1}. {w}</div>
              ))}
            </div>
          )}
        </div>
      ))}

      {err && <p className="text-sm text-red-400">{err}</p>}
      {closed.length === 0 && (
        <p className="text-sm text-[var(--text-dim)]">Brak zamkniętych cykli</p>
      )}
    </div>
  );
}
