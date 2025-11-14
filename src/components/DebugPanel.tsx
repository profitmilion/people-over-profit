// src/components/DebugPanel.tsx - losowanie + podgląd, czy dany użytkownik jest w cyklu
// Dodane: podgląd wyborów czasu (demo) i sumy czasu na cykl.
// src/components/DebugPanel.tsx — losowanie + podgląd, czy dany użytkownik jest w cyklu

import { useEffect, useState } from "react";
import { useCycles } from "../hooks/useCycles";

const MAX_PARTICIPANTS = 100;
const MAX_WINNERS = 3;
const USER_KEY = "pop33_user_addr";

export default function DebugPanel() {
  const { cycles, joinFIFO, openNextAndJoin, closeCycle, drawWinner, reset, canDraw } = useCycles();

  const open = cycles.find((c) => c.status === "open");
  const closed = [...cycles]
    .filter((c) => c.status === "closed")
    .sort((a, b) => a.index - b.index);

  // ten sam identyfikator, co w PROD
  const userAddr =
    typeof window !== "undefined" ? localStorage.getItem(USER_KEY) ?? null : null;

  function seed(n: number) {
    for (let i = 0; i < n; i++) {
      // [ZMIANA] przy seedowaniu ustawiamy ZAWSZE sensowny czas demo
      joinFIFO(fakeAddress(i), randomDemoTime());
    }
  }

  const firstClosed = closed[0];
  const canDrawFirst = firstClosed ? canDraw(firstClosed) : false;
  const drawHint = !firstClosed
    ? "Brak zamkniętych cykli (zapełnij 100)"
    : firstClosed.draws >= MAX_WINNERS
      ? "Limit 3 zwycięzców osiągnięty"
      : firstClosed.participants.length <= firstClosed.winners.length
        ? "Brak osób do wylosowania"
        : firstClosed.status !== "closed"
          ? "Cykl musi być zamknięty"
          : "";



  // Czy dla danego zamkniętego cyklu zostało już wykonane automatyczne losowanie
  const [autoDrawDoneForId, setAutoDrawDoneForId] = useState<string | null>(null);


  // DEMO: odliczanie na podstawie totalTimeSeconds pierwszego zamkniętego cyklu
  const [demoRemaining, setDemoRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // jeśli nie ma zamkniętego cyklu albo czas = 0 -> brak odliczania
    if (!firstClosed || firstClosed.totalTimeSeconds <= 0) {
      setDemoRemaining(null);
      setAutoDrawDoneForId(null);
      return;
    }

    const total = firstClosed.totalTimeSeconds;

    // startujemy od pełnego czasu cyklu
    setDemoRemaining(total);
    setAutoDrawDoneForId(null); // nowy cykl -> jeszcze nie losowaliśmy automatycznie

    const start = Date.now();
    const durationMs = total * 1000;

    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const remainingSec = Math.max(0, durationMs - elapsed) / 1000;

      setDemoRemaining(remainingSec);

      if (remainingSec <= 0) {
        window.clearInterval(id);
      }
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [firstClosed?.id, firstClosed?.totalTimeSeconds]);

  // Automatyczne losowanie po zakończeniu odliczania (demo)
  useEffect(() => {
    if (!firstClosed) return;
    if (demoRemaining === null) return;
    if (demoRemaining > 0) return;

    // już zrobiliśmy auto-losowanie dla tego cyklu -> nic nie rób
    if (autoDrawDoneForId === firstClosed.id) return;

    // Po dojściu do 0: próbujemy wylosować maksymalnie MAX_WINNERS zwycięzców
    for (let i = 0; i < MAX_WINNERS; i++) {
      drawWinner(firstClosed.id);
    }

    setAutoDrawDoneForId(firstClosed.id);
  }, [demoRemaining, firstClosed, autoDrawDoneForId, drawWinner]);


  function drawOnceOnFirstClosed() {
    if (firstClosed && canDrawFirst) drawWinner(firstClosed.id);
  }

  return (
    <div className="rounded-2xl border border-neutral-800 p-4 bg-[var(--bg)]/60">
      <h3 className="text-base font-semibold mb-2">Podgląd (debug)</h3>

      {/* DEMO odliczania dla pierwszego zamkniętego cyklu */}
      <div className="text-xs text-[var(--text-dim)] mb-2">
        {firstClosed ? (
          demoRemaining != null ? (
            <>
              Odliczanie (demo) dla cyklu #{firstClosed.index}:{" "}
              <span className="font-mono">
                {demoRemaining.toFixed(1)} s
              </span>{" "}
              / baza:{" "}
              <span className="font-mono">
                {firstClosed.totalTimeSeconds.toFixed(1)} s
              </span>
            </>
          ) : (
            <>
              Cykl #{firstClosed.index} jest zamknięty, ale odliczanie (demo) nie
              jest aktywne (brak czasu lub 0 s).
            </>
          )
        ) : (
          "Brak zamkniętego cyklu do odliczania (demo)."
        )}
      </div>


      {/* Statystyki ogólne */}
      <div className="text-xs text-[var(--text-dim)] mb-2">
        Cykl otwarty:{" "}
        {open
          ? `#${open.index} · ${open.participants.length}/${MAX_PARTICIPANTS}`
          : "—"}{" "}
        · Zamknięte: {closed.length} · Wszystkie cykle: {cycles.length}
      </div>
      {userAddr && (
        <div className="text-xs text-[var(--text-dim)] mb-3 break-all">
          {/* [ZMIANA] pełny identyfikator użytkownika */}
          Użytkownik z PROD: <span className="font-mono">{userAddr}</span>
        </div>
      )}

      {/* Akcje testowe */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => seed(10)}
          className="rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
        >
          +10 (demo czas)
        </button>
        <button
          onClick={() => seed(100)}
          className="rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
        >
          +100 (demo czas)
        </button>
        <button
          onClick={() => openNextAndJoin(fakeAddress(), randomDemoTime())}
          className="rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
        >
          Otwórz nowy + dołącz
        </button>
        {open && (
          <button
            onClick={() => closeCycle(open.id)}
            className="rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
          >
            Zamknij bieżący
          </button>
        )}
        <button
          onClick={drawOnceOnFirstClosed}
          disabled={!canDrawFirst}
          className="rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700 disabled:opacity-50"
          title={drawHint}
        >
          Losuj 1 (pierwszy zamknięty)
        </button>
        <button
          onClick={reset}
          className="rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
        >
          Reset
        </button>
      </div>

      {/* Lista cykli */}
      <div className="space-y-2 max-h-72 overflow-auto pr-1">
        {cycles.map((c) => {
          const userInCycle = userAddr ? c.participants.includes(userAddr) : false;

          // [ZMIANA] twarde rzutowanie totalTimeSeconds na liczbę, nawet jeśli w localStorage były stare dane
          const total =
            typeof c.totalTimeSeconds === "number"
              ? c.totalTimeSeconds
              : Number(c.totalTimeSeconds || 0);
          const avg =
            c.participants.length > 0
              ? total / c.participants.length
              : 0;

          return (
            <div key={c.id} className="rounded-lg border border-neutral-800 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-[var(--text-dim)]">Cykl</span> #{c.index} ·{" "}
                  {c.status.toUpperCase()}
                </div>
                <div className="text-xs text-[var(--text-dim)]">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.closedAt && ` → ${new Date(c.closedAt).toLocaleString()}`}
                </div>
              </div>

              <div className="text-xs mt-1">
                Uczestnicy: {c.participants.length}/{MAX_PARTICIPANTS} · Wygrani:{" "}
                {c.winners.length}/{MAX_WINNERS} · Losowań: {c.draws}
              </div>

              {/* Podgląd czasu (demo) */}
              <div className="text-xs mt-1 text-[var(--text-dim)]">
                Suma czasu (demo):{" "}
                <strong>{total.toFixed(1)} s</strong> · średnio:{" "}
                <strong>{avg.toFixed(1)} s/osoba</strong>
              </div>

              {userAddr && (
                <div className="text-xs mt-1 text-[var(--text-dim)]">
                  Ty w tym cyklu: <strong>{userInCycle ? "TAK" : "NIE"}</strong>
                </div>
              )}

              {c.winners.length > 0 && (
                <div className="mt-2 text-xs text-[var(--text-dim)] break-all">
                  {c.winners.map((w, i) => (
                    <div key={w + i}>
                      {i + 1}. {shorten(w)}
                      {userAddr && w === userAddr ? "  (TY)" : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shorten(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function fakeAddress(suffix: number = 0) {
  const base = Date.now().toString(16).slice(-8);
  const rnd = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  const suf = suffix ? suffix.toString(16).padStart(4, "0") : "";
  return ("0xDEMO" + base + rnd + suf).padEnd(42, "0").slice(0, 42);
}

function randomDemoTime(): number {
  // losowo z zakresu 0.1–10.0, zaokrąglone do 0.1
  const v = 0.1 + Math.random() * 9.9;
  return parseFloat(v.toFixed(1));
}
