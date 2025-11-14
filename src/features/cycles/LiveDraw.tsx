import { useEffect, useMemo, useState } from "react";
import { useCycles } from "../../store/cyclesStore";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

export default function LiveDraw() {
  const { cycles, drawWinner } = useCycles();

  // 1) Bierzemy wyłącznie cykle zamknięte i sortujemy malejąco po id (najnowsze pierwsze)
  const closedCycles = useMemo(
    () =>
      cycles
        .filter((c) => c.status === "closed")
        .sort((a, b) => b.id - a.id),
    [cycles]
  );

  // 2) Aktywny cykl - startowo pierwszy zamknięty (jeśli jest)
  const [activeId, setActiveId] = useState<number | undefined>(
    closedCycles[0]?.id
  );

  // 3) Synchronizacja, gdy zmienia się lista zamkniętych cykli
  useEffect(() => {
    if (!closedCycles.length) {
      setActiveId(undefined);
      return;
    }
    // jeśli obecny activeId nie istnieje w nowej liście, ustaw pierwszy
    const stillExists = closedCycles.some((c) => c.id === activeId);
    if (!stillExists) {
      setActiveId(closedCycles[0].id);
    }
  }, [closedCycles, activeId]);

  // 4) Bieżący cykl po ID
  const activeCycle = useMemo(
    () => cycles.find((c) => c.id === activeId),
    [cycles, activeId]
  );

  const winners = activeCycle?.winners ?? [];
  const canDraw =
    !!activeCycle && activeCycle.status === "closed" && activeCycle.draws < 30;

  // 5) Krótki stan ładowania na czas losowania
  const [isDrawing, setIsDrawing] = useState(false);

  const handleDraw = async () => {
    if (!activeCycle || !canDraw || isDrawing) return;
    try {
      setIsDrawing(true);
      // Jeśli drawWinner kiedyś będzie async, ten kod już jest gotowy
      const res = await Promise.resolve(drawWinner(activeCycle.id));
      if (res == null) {
        console.warn("Brak możliwości losowania (limit 30/30 lub brak cyklu).");
      }
    } finally {
      setIsDrawing(false);
    }
  };

  const hasClosed = closedCycles.length > 0;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Live Draw</h3>

          <div className="flex items-center gap-2">
            <label htmlFor="closed-cycles" className="text-sm text-[var(--text-dim)]">
              Wybierz cykl
            </label>
            <select
              id="closed-cycles"
              className="rounded-md border border-neutral-700 bg-[var(--bg)] px-2 py-1 text-sm"
              value={activeId ?? ""}
              onChange={(e) => setActiveId(Number(e.target.value))}
              disabled={!hasClosed}
            >
              {!hasClosed ? (
                <option value="">Brak zamkniętych cykli</option>
              ) : (
                closedCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.name ?? `Cykl #${c.id}`)} • losowań {c.draws}/30
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <Button onClick={handleDraw} disabled={!canDraw || isDrawing}>
          {isDrawing
            ? "Losowanie…"
            : canDraw
            ? "Losuj zwycięzcę"
            : "Losowanie niedostępne (30/30 lub brak cyklu)"}
        </Button>

        <div className="text-sm text-[var(--text-dim)]">
          Zwycięzcy: {activeCycle ? activeCycle.draws : 0} / 30
        </div>

        {/* aria-live, żeby czytniki odczytywały zmiany listy */}
        <div
          className="max-h-64 overflow-auto rounded-lg border border-neutral-800 p-2 text-sm"
          aria-live="polite"
        >
          {winners.length === 0 ? (
            <div className="text-[var(--text-dim)]">Brak zwycięzców.</div>
          ) : (
            <ol className="list-decimal pl-5 space-y-1">
              {winners.map((idx, i) => (
                <li key={`${activeCycle?.id ?? "x"}-${i}`}>
                  Dzień {i + 1}: uczestnik #{idx}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}
