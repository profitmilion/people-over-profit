// src/components/DevPanel.tsx
import { useMemo, useState, useEffect } from "react";
import { useCycles } from "../hooks/useCycles";

function fmt(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

export default function DevPanel() {
  const { state, cycles, runDraw, resetDemo, addFakeParticipants } = useCycles();
  const [seedInput, setSeedInput] = useState<string>("");
  const [fakeCount, setFakeCount] = useState<string>("25");

  // lokalny zegar do odświeżania countdownu
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const open = useMemo(
    () => cycles.find((c) => c.status === "open"),
    [cycles]
  );

  const totals = useMemo(() => {
    const participants = cycles.reduce(
      (acc, c) => acc + c.participants.length,
      0
    );
    const finished = cycles.filter((c) => c.status === "finished").length;
    return { participants, finished, cycles: cycles.length };
  }, [cycles]);

  const onDraw = () => {
    const s = seedInput.trim();
    if (!s) {
      runDraw();
      return;
    }
    const n = Number(s);
    if (Number.isFinite(n)) runDraw(n);
  };

  const onAddFake = () => {
    const n = Number(fakeCount);
    if (Number.isFinite(n) && n > 0) addFakeParticipants(n);
  };

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xl font-semibold">DEV panel</div>
          <div className="text-sm opacity-70">
            Uproszczony model: cykl zamyka się po zapełnieniu, pierwsze
            losowanie po czasie, kolejne w stałym interwale (DEMO), bez
            powtarzających się zwycięzców w jednym cyklu.
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* FAKE uczestnicy */}
          <div className="flex items-center gap-2">
            <input
              className="w-20 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
              placeholder="liczba"
              value={fakeCount}
              onChange={(e) => setFakeCount(e.target.value)}
              title="Ilu sztucznych uczestników dodać"
              inputMode="numeric"
            />
            <button
              className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-900"
              onClick={onAddFake}
              title="Dodaj sztucznych uczestników do otwartego cyklu"
            >
              Dodaj uczestników
            </button>
          </div>

          {/* Ręczne losowanie (debug) */}
          <div className="flex items-center gap-2">
            <input
              className="w-28 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
              placeholder="seed (opc.)"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              title="Opcjonalny seed do losowania"
              inputMode="numeric"
            />
            <button
              className="px-4 py-2 rounded-xl border border-amber-600 text-amber-500 hover:bg-amber-950/40"
              onClick={onDraw}
              title="Uruchom losowanie (ręczne)"
            >
              Losuj zwycięzców
            </button>
          </div>

          <button
            className="px-4 py-2 rounded-xl border border-red-700 text-red-400 hover:bg-red-950/40"
            onClick={resetDemo}
            title="Wyczyść i utwórz 1 pusty cykl"
          >
            Reset DEMO
          </button>
        </div>
      </div>

      {/* PODSUMOWANIE */}
      <div className="rounded-2xl border border-neutral-800 p-4 space-y-2">
        <div className="text-sm opacity-80">
          Cykle: <b>{totals.cycles}</b> · Uczestnicy razem:{" "}
          <b>{totals.participants}</b> · Zakończone:{" "}
          <b>{totals.finished}</b>
        </div>

        {open && (
          <div className="text-sm opacity-80">
            <div>Bieżący otwarty cykl: {open.id}</div>
            <div>
              Uczestnicy: {open.participants.length}/
              {open.maxParticipants}
            </div>
          </div>
        )}
      </div>

      {/* TABELA CYKLI */}
      <div className="rounded-2xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/60">
            <tr className="text-left">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uczestnicy</th>
              <th className="px-4 py-3">Closed</th>
              <th className="px-4 py-3">Drawy</th>
              <th className="px-4 py-3">Nast. losowanie</th>
              <th className="px-4 py-3">Ostatnie losowanie</th>
              <th className="px-4 py-3">Historia zwycięzców</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => {
              const now = nowTick;
              const nextLeft =
                c.nextDrawAt && c.nextDrawAt > now
                  ? Math.ceil((c.nextDrawAt - now) / 1000)
                  : 0;

              const drawCount =
                (c.drawHistory && c.drawHistory.length) ||
                c.drawCount ||
                0;

              return (
                <tr
                  key={c.id}
                  className="border-t border-neutral-800 align-top"
                >
                  <td className="px-4 py-3 font-mono">{c.id}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3">
                    {c.participants.length}/{c.maxParticipants}
                  </td>
                  <td className="px-4 py-3">{fmt(c.closedAt)}</td>
                  <td className="px-4 py-3">{drawCount}</td>
                  <td className="px-4 py-3">
                    {c.nextDrawAt ? (
                      <>
                        <div>{fmt(c.nextDrawAt)}</div>
                        <div className="opacity-70">
                          pozostało ~{nextLeft}s
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.draw ? (
                      <>
                        <div>w: {fmt(c.draw.drawnAt)}</div>
                        {typeof c.draw.seed === "number" && (
                          <div className="opacity-70">
                            seed: {c.draw.seed}
                          </div>
                        )}
                        {typeof c.draw.drawIndex === "number" && (
                          <div className="opacity-70">
                            draw #{c.draw.drawIndex}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.drawHistory && c.drawHistory.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {c.drawHistory.map((d) => (
                          <div
                            key={`${d.cycleId}-${d.drawIndex}-${d.drawnAt}`}
                            className="border border-neutral-800 rounded-xl p-2"
                          >
                            <div className="opacity-80">
                              losowanie #{d.drawIndex ?? "?"} (
                              {fmt(d.drawnAt)})
                            </div>
                            <div className="flex flex-col gap-1 mt-1">
                              {d.winners.map((w) => (
                                <span
                                  key={w}
                                  className="font-mono text-xs"
                                >
                                  {w}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            {cycles.length === 0 && (
              <tr>
                <td
                  className="px-4 py-6 text-center opacity-60"
                  colSpan={8}
                >
                  Brak cykli
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs opacity-60">
        Ostatni userId:{" "}
        <span className="font-mono">
          {state.lastUserId ?? "—"}
        </span>
      </div>
    </div>
  );
}
