import { useCycles } from "../../store/cyclesStore";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

export function CyclesList() {
  const {
    cycles,
    autoOpenNext,
    setAutoOpenNext,
    openNext,
    openParallel,
    joinAnyOpen,
    drawWinner,
  } = useCycles();

  const last = cycles[cycles.length - 1];
  const hasOpen = cycles.some((c) => c.status === "open");

  return (
    <div className="flex flex-col gap-4">
      {/* Pasek akcji globalnych */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button onClick={() => openNext()}>Open next</Button>
            <Button variant="ghost" onClick={() => openParallel()}>Open parallel</Button>
            <Button variant="ghost" onClick={() => joinAnyOpen()}>Join 33 (demo)</Button>
          </div>

          {/* Przełącznik Auto open next */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoOpenNext}
              onChange={(e) => setAutoOpenNext(e.target.checked)}
            />
            <span className="text-[var(--text-dim)]">Auto open next</span>
          </label>
        </div>
      </Card>

      {/* Lista cykli */}
      {cycles.map((c) => (
        <Card key={c.id}>
          <div className="flex items-center justify-between">
            <div className="font-semibold">{c.name ?? `Cykl #${c.id}`}</div>
            <div className="text-sm text-[var(--text-dim)]">
              Status: {c.status} • {c.participants}/{c.capacity} • Losowań: {c.draws}/30
            </div>
          </div>

          {/* Akcje specyficzne dla cyklu */}
          {c.status === "closed" && c.draws < 30 && (
            <div className="mt-3">
              <Button onClick={() => drawWinner(c.id)}>Losuj zwycięzcę</Button>
            </div>
          )}
        </Card>
      ))}

      {/* Podpowiedź gdy nic nie jest otwarte */}
      {!hasOpen && last?.status === "closed" && (
        <div className="text-sm text-[var(--text-dim)]">
          Brak otwartych cykli — kliknij „Open next”, aby rozpocząć nowy,
          lub włącz „Auto open next”.
        </div>
      )}
    </div>
  );
}
