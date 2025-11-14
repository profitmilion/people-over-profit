// src/components/DevPanel.tsx
import { useMemo, useState } from "react";
import { useCycles } from "../hooks/useCycles";

function fmt(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

export default function DevPanel() {
  const { state, cycles, runDraw, resetDemo, addFakeParticipants, addTimeToPool } = useCycles();
  const [seedInput, setSeedInput] = useState<string>("");
  const [fakeCount, setFakeCount] = useState<string>("25");
  const [poolAdd, setPoolAdd] = useState<string>("5"); // ile sekund dodać do puli

  const open = useMemo(() => cycles.find(c => c.status === "open"), [cycles]);

  const totals = useMemo(() => {
    const participants = cycles.reduce((acc, c) => acc + c.participants.length, 0);
    const finished = cycles.filter(c => c.status === "finished").length;
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

  const onAddTime = () => {
    const n = Number(poolAdd);
    if (Number.isFinite(n) && n > 0) addTimeToPool(n);
  };

  // oblicz postęp puli i countdown
  const poolProgress = (() => {
    if (!open?.schedule) return null;
    const { pooledSeconds, thresholdSeconds } = open.schedule;
    const threshold = Math.max(1, Number(thresholdSeconds || 0)); // ochrona przed 0
    const pooled = Math.max(0, Number(pooledSeconds || 0));
    const pct = Math.min(100, Math.floor((pooled / threshold) * 100));
    return { pooledSeconds: pooled, thresholdSeconds: threshold, pct };
  })();

  const countdownInfo = (() => {
    if (!open?.schedule?.locked) return null;
    const now = Date.now();
    const end = open.schedule.drawAt ?? 0;
    const remainMs = Math.max(0, end - now);
    const remainSec = Math.ceil(remainMs / 1000);
    return { remainSec, drawAt: open.schedule.drawAt, countdownSec: open.schedule.countdownSeconds };
  })();

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xl font-semibold">DEV panel</div>
          <div className="text-sm opacity-70">
            Harmonogram: próg → odliczanie → losowanie. Bez ręcznego zamykania cyklu.
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* PULA CZASU */}
          <div className="flex items-center gap-2">
            <input
              className="w-20 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
              placeholder="+sek"
              value={poolAdd}
              onChange={e => setPoolAdd(e.target.value)}
              title="Ile sekund dodać do puli czasu"
              inputMode="numeric"
            />
            <button
              className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-900"
              onClick={onAddTime}
              title="Dodaj czas do puli"
            >
              Dodaj czas
            </button>
          </div>

          {/* FAKE uczestnicy */}
          <div className="flex items-center gap-2">
            <input
              className="w-20 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none"
              placeholder="liczba"
              value={fakeCount}
              onChange={e => setFakeCount(e.target.value)}
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
              onChange={e => setSeedInput(e.target.value)}
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

      {/* PODGLĄD PULI I COUNTDOWN */}
      <div className="rounded-2xl border border-neutral-800 p-4 space-y-2">
        <div className="text-sm opacity-80">
          Cykle: <b>{totals.cycles}</b> · Uczestnicy razem: <b>{totals.participants}</b> · Zakończone: <b>{totals.finished}</b>
        </div>

        {open?.schedule && (
          <div className="text-sm">
            <div className="mb-1">Pula czasu (otwarty cykl):</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded bg-neutral-800 overflow-hidden">
                <div
                  className="h-2 bg-emerald-500"
                  style={{ width: `${poolProgress?.pct ?? 0}%` }}
                />
              </div>
              <div className="tabular-nums opacity-80">
                {poolProgress?.pooledSeconds ?? 0}s / {poolProgress?.thresholdSeconds ?? 0}s ({poolProgress?.pct ?? 0}%)
              </div>
            </div>

            <div className="mt-2 opacity-80">
              {open.schedule.locked ? (
                <>
                  <div>Próg osiągnięty – odliczanie rozpoczęte.</div>
                  <div>Losowanie o: <b>{fmt(open.schedule.drawAt)}</b></div>
                  <div>Pozostało: <b>{countdownInfo?.remainSec ?? 0}s</b> / {countdownInfo?.countdownSec ?? 0}s</div>
                </>
              ) : (
                <div>Próg nieosiągnięty – społeczność może dodawać czas.</div>
              )}
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
              <th className="px-4 py-3">Pula/Próg/Lock</th>
              <th className="px-4 py-3">Losowanie</th>
              <th className="px-4 py-3">Zwycięzcy</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map(c => (
              <tr key={c.id} className="border-t border-neutral-800 align-top">
                <td className="px-4 py-3 font-mono">{c.id}</td>
                <td className="px-4 py-3">{c.status}</td>
                <td className="px-4 py-3">{c.participants.length}/{c.maxParticipants}</td>
                <td className="px-4 py-3">
                  {c.schedule ? (
                    <>
                      <div>{c.schedule.pooledSeconds ?? 0}s / {c.schedule.thresholdSeconds}s</div>
                      <div>locked: <b>{c.schedule.locked ? "yes" : "no"}</b></div>
                    </>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  {c.draw ? (
                    <>
                      <div>w: {fmt(c.draw.drawnAt)}</div>
                      {typeof c.draw.seed === "number" && <div className="opacity-70">seed: {c.draw.seed}</div>}
                    </>
                  ) : c.schedule?.locked ? (
                    <>
                      <div>o: {fmt(c.schedule.drawAt)}</div>
                      <div className="opacity-70">
                        pozostało ~{Math.max(0, Math.ceil(((c.schedule.drawAt ?? 0) - Date.now()) / 1000))}s
                      </div>
                    </>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  {c.draw && c.draw.winners.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {c.draw.winners.map(w => (
                        <span key={w} className="font-mono">{w}</span>
                      ))}
                    </div>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {cycles.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center opacity-60" colSpan={6}>
                  Brak cykli
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs opacity-60">
        Ostatni userId: <span className="font-mono">{state.lastUserId ?? "—"}</span>
      </div>
    </div>
  );
}
