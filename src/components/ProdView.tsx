// src/components/ProdView.tsx
import { useMemo, useState, useEffect } from "react";
import { useCycles } from "../hooks/useCycles";

const MAX_PARTICIPANTS = 100;
const MAX_USER_CYCLES = 10;

// Prosty formatter daty (jak w DevPanelu)
function fmt(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

// Skracanie ID użytkownika dla czytelności
function shortenUserId(id: string, len = 4) {
  if (!id) return "";
  if (id.length <= len * 2) return id;
  return id.slice(0, len) + "…" + id.slice(-len);
}

export default function ProdView() {
  const {
    joinFIFO,
    openNextAndJoin,
    cycles,
    getOrCreateUserId,
    openCycle
  } = useCycles();

  const userId = useMemo(() => getOrCreateUserId(), [getOrCreateUserId]);

  // lokalny zegar – odliczanie (jak w DevPanelu)
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // cykle, w których użytkownik ma los (wszystkie, także historyczne)
  const userCycles = useMemo(() => {
    return cycles.filter((c) =>
      c.participants.some((p) => p.userId === userId)
    );
  }, [cycles, userId]);

  const totalUserCycles = userCycles.length;

  // LICZYMY TYLKO AKTYWNE CYKLE do limitu (czyli takie, które NIE są finished)
  const activeUserCycles = useMemo(
    () => userCycles.filter((c) => c.status !== "finished").length,
    [userCycles]
  );

  const hasReachedUserLimit = activeUserCycles >= MAX_USER_CYCLES;

  const alreadyInOpenCycle = !!openCycle?.participants.some(
    (p) => p.userId === userId
  );
  const isOpenCycleFull =
    (openCycle?.participants.length ?? 0) >=
    (openCycle?.maxParticipants ?? MAX_PARTICIPANTS);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <div className="text-sm opacity-70">
        Twój ID: <span className="font-mono">{userId}</span>
      </div>

      {/* AKTUALNY CYKL */}
      <section className="rounded-2xl border border-neutral-800 p-4 space-y-4">
        <div className="text-lg font-semibold">Aktualny cykl</div>

        {openCycle ? (
          <div className="text-sm opacity-80">
            ID: <span className="font-mono">{openCycle.id}</span> · Uczestników:{" "}
            {openCycle.participants.length}/{openCycle.maxParticipants}
          </div>
        ) : (
          <div className="text-sm opacity-80">Brak otwartego cyklu</div>
        )}

        {/* Przyciski akcji */}
        <div className="flex gap-3">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-900 disabled:opacity-50"
            onClick={joinFIFO}
            disabled={
              !openCycle ||
              alreadyInOpenCycle ||
              isOpenCycleFull ||
              hasReachedUserLimit
            }
            title={
              hasReachedUserLimit
                ? `Osiągnąłeś limit ${MAX_USER_CYCLES} aktywnych cykli`
                : !openCycle
                ? "Brak otwartego cyklu"
                : alreadyInOpenCycle
                ? "Już dołączyłeś"
                : isOpenCycleFull
                ? "Cykl pełny"
                : "Dołącz"
            }
          >
            Dołącz
          </button>

          <button
            className="px-4 py-2 rounded-xl border border-amber-600 text-amber-500 hover:bg-amber-950/40 disabled:opacity-50"
            onClick={openNextAndJoin}
            disabled={
              hasReachedUserLimit ||
              (!alreadyInOpenCycle && !!openCycle && !isOpenCycleFull)
            }
            title={
              hasReachedUserLimit
                ? `Osiągnąłeś limit ${MAX_USER_CYCLES} aktywnych cykli`
                : "Dołącz do nowego cyklu (po dołączeniu do bieżącego lub gdy bieżący pełny)"
            }
          >
            Dołącz do nowego cyklu
          </button>
        </div>
      </section>

      {/* TWOJE CYKLE – odliczanie + pełna historia zwycięzców */}
      <section className="rounded-2xl border border-neutral-800 p-4 space-y-4">
        <div className="text-lg font-semibold">Twoje cykle</div>

        {activeUserCycles > 0 && (
          <div className="text-xs opacity-80">
            Aktywne cykle: {activeUserCycles}/{MAX_USER_CYCLES}
          </div>
        )}

        {hasReachedUserLimit && (
          <div className="text-xs text-amber-400">
            Osiągnąłeś maksymalną liczbę aktywnych cykli w tym demie (
            {MAX_USER_CYCLES}). Gdy część cykli zostanie zakończona, będziesz
            mógł dołączać do kolejnych.
          </div>
        )}

        {totalUserCycles > 0 ? (
          <div className="space-y-3">
            {userCycles.map((c) => {
              const now = nowTick;

              const drawHistory = c.drawHistory || [];
              const hasDrawHistory = drawHistory.length > 0;

              const hasNextDraw =
                c.nextDrawAt && c.nextDrawAt > now; // jak w DevPanelu
              const nextLeft = hasNextDraw
                ? Math.ceil(((c.nextDrawAt as number) - now) / 1000)
                : 0;

              const isOpen = c.status === "open";
              const isFinished = c.status === "finished";

              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-neutral-700 p-3 space-y-2"
                >
                  {/* podstawowe info o cyklu */}
                  <div className="font-mono text-sm">{c.id}</div>
                  <div className="text-xs opacity-80">
                    Uczestników: {c.participants.length}/{c.maxParticipants}
                  </div>

                  {/* Status z rozróżnieniem „oczekiwanie na losowanie” */}
                  <div className="text-xs opacity-80">
                    Status:{" "}
                    {isOpen
                      ? "Otwarty"
                      : hasNextDraw
                      ? "Zamknięty – oczekiwanie na kolejne losowanie"
                      : isFinished && hasDrawHistory
                      ? "Zakończony – losowania odbyły się"
                      : isFinished
                      ? "Zakończony"
                      : c.status}
                  </div>

                  {/* Odliczanie do najbliższego losowania */}
                  {hasNextDraw && (
                    <div className="mt-1 text-xs opacity-80">
                      Najbliższe losowanie: {fmt(c.nextDrawAt as number)}
                      {nextLeft > 0 && (
                        <div className="opacity-70">
                          pozostało ~{nextLeft}s
                        </div>
                      )}
                    </div>
                  )}

                  {/* Pełna historia zwycięzców – jak w DevPanelu */}
                  {hasDrawHistory && (
                    <div className="mt-2 text-xs space-y-2">
                      <div className="opacity-80">
                        Historia zwycięzców (wszystkie losowania w tym cyklu):
                      </div>
                      <div className="flex flex-col gap-2">
                        {drawHistory.map((d) => {
                          const youWonHere =
                            Array.isArray(d.winners) &&
                            d.winners.includes(userId);

                          return (
                            <div
                              key={`${d.cycleId}-${d.drawIndex}-${d.drawnAt}`}
                              className="border border-neutral-800 rounded-xl p-2"
                            >
                              <div className="opacity-80">
                                Losowanie #{d.drawIndex ?? "?"} (
                                {fmt(d.drawnAt)})
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {d.winners.map((w: string) => (
                                  <span
                                    key={w}
                                    className={
                                      "font-mono text-[11px] border rounded px-1 py-0.5 " +
                                      (w === userId
                                        ? "border-emerald-500 text-emerald-400"
                                        : "border-neutral-700")
                                    }
                                  >
                                    {shortenUserId(w)}
                                    {w === userId ? " (Ty)" : ""}
                                  </span>
                                ))}
                              </div>
                              {youWonHere && (
                                <div className="mt-1 text-[11px] text-emerald-400">
                                  W tym losowaniu jesteś zwycięzcą (DEMO)
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Cykl zakończony, ale brak historii losowań */}
                  {isFinished && !hasDrawHistory && !hasNextDraw && (
                    <div className="mt-2 text-xs opacity-60">
                      Zakończony – brak zapisanych danych o losowaniu (starszy
                      cykl lub dane DEMO).
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm opacity-70">
            Jeszcze nie dołączyłeś do żadnego cyklu.
          </div>
        )}
      </section>
    </div>
  );
}
