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
    smartJoin,
    smartJoinStatus,
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

  // Sygnalizacja ze strony logiki globalnej (systemowy limit)
  const blockedBySystemLimit =
    smartJoinStatus.kind === "BLOCKED" &&
    smartJoinStatus.reason === "LIMIT_REACHED";

  const canJoinByStatus = smartJoinStatus.kind === "READY";

  // Decyzja, czy przycisk powinien być aktywny
  const joinDisabled = hasReachedUserLimit || !canJoinByStatus;

  // Tekst tooltipa dla przycisku
  let joinTitle = "Weź udział w losowaniu";
  if (hasReachedUserLimit) {
    joinTitle = `Osiągnąłeś limit ${MAX_USER_CYCLES} aktywnych cykli. Poczekaj na zakończenie części z nich.`;
  } else if (blockedBySystemLimit) {
    joinTitle =
      "System osiągnął limit otwartych cykli. Poczekaj na kolejną rundę.";
  } else if (!openCycle && smartJoinStatus.kind === "READY") {
    joinTitle = "Dołączysz do nowego cyklu, gdy tylko zostanie otwarty.";
  }

  // =========================
  // KOLORY wg Twojej mapy:
  // 0/10   -> zielony (start)
  // 1–9/10 -> pomarańczowy (aktywny)
  // 10/10  -> czerwony (limit użytkownika)
  // LIMIT SYSTEMU -> czerwony (priorytet)
  // =========================

  let statusText = "";
  let statusLabel = "";

  // domyślne kolory (gdyby coś było nieokreślone)
  let indicatorColor = "#6b7280"; // gray

  if (blockedBySystemLimit) {
    // priorytet: systemowy limit
    statusLabel = "Limit systemu";
    statusText =
      "System osiągnął limit otwartych cykli. Poczekaj na kolejną rundę.";
    indicatorColor = "#ef4444"; // czerwony
  } else if (hasReachedUserLimit) {
    // użytkownik 10/10
    statusLabel = "Limit użytkownika";
    statusText = `Masz już ${activeUserCycles}/${MAX_USER_CYCLES} aktywnych cykli. To maksymalny limit w tym demie.`;
    indicatorColor = "#ef4444"; // czerwony
  } else if (activeUserCycles > 0) {
    // 1–9/10
    statusLabel = "Aktywny";
    statusText = `Masz ${activeUserCycles}/${MAX_USER_CYCLES} aktywnych cykli. Możesz dołączyć do kolejnych.`;
    indicatorColor = "#f97316"; // pomarańczowy
  } else {
    // 0/10
    statusLabel = "Gotowe";
    statusText =
      "Jeszcze nie bierzesz udziału w żadnym cyklu. Możesz dołączyć do pierwszego.";
    indicatorColor = "#22c55e"; // zielony
  }

  // Przycisk ma ten sam kolor co status
  let buttonBg = indicatorColor;
  let buttonBorder = indicatorColor;
  let buttonText = "#000000";
  let buttonCursor: "pointer" | "not-allowed" = "pointer";
  let buttonOpacity = 1;

  if (joinDisabled) {
    buttonCursor = "not-allowed";
    buttonOpacity = 0.6;
    buttonText = "#000000";
  }

  const joinButtonStyle = {
    backgroundColor: buttonBg,
    borderColor: buttonBorder,
    color: buttonText,
    cursor: buttonCursor,
    opacity: buttonOpacity
  } as const;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <div className="text-sm opacity-70">
        Twój ID: <span className="font-mono">{userId}</span>
      </div>

      {/* AKTUALNY CYKL */}
      <section className="rounded-2xl border border-neutral-800 p-4 space-y-4 bg-neutral-950/40">
        <div className="flex items-center justify-between gap-2">
          <div className="text-lg font-semibold">Aktualny cykl</div>
          {openCycle && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-300">
              ID: <span className="font-mono">{openCycle.id}</span>
            </span>
          )}
        </div>

        {openCycle ? (
          <div className="text-sm opacity-80">
            Uczestników: {openCycle.participants.length}/
            {openCycle.maxParticipants}
          </div>
        ) : (
          <div className="text-sm opacity-80">Brak otwartego cyklu</div>
        )}

        {/* Inteligentny przycisk + status */}
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            className="px-5 py-2.5 rounded-xl font-semibold text-sm border transition"
            style={joinButtonStyle}
            onClick={smartJoin}
            disabled={joinDisabled}
            title={joinTitle}
          >
            {canJoinByStatus && !hasReachedUserLimit
              ? "Weź udział"
              : "Niedostępne"}
          </button>

          <div className="flex flex-col gap-1 text-xs">
            <span
              className="font-semibold uppercase tracking-wide text-[11px]"
              style={{ color: indicatorColor }}
            >
              {statusLabel}
            </span>
            <span className="opacity-80">{statusText}</span>

            {/* Debug – na czas developmentu */}
            <span className="opacity-50 text-[10px] font-mono">
              debug: kind={smartJoinStatus.kind}
              {smartJoinStatus.kind === "READY"
                ? ` mode=${smartJoinStatus.mode}`
                : smartJoinStatus.kind === "BLOCKED"
                  ? ` reason=${smartJoinStatus.reason}`
                  : ""}{" "}
              | active={activeUserCycles}/{MAX_USER_CYCLES}
            </span>

            {/* Legenda kolorów */}
            <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 text-[11px] text-neutral-300 space-y-2">
              <p className="font-semibold text-neutral-200">
                Legenda kolorów przycisku wejścia do cyklu
              </p>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span>zielony: start, 0/10 cykli, jeszcze nie dołączyłeś</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                  <span>pomarańczowy: aktywny udział, 1–9/10 cykli</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span>czerwony: limit systemu osiągnięty (10/10 lub brak miejsc)</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-neutral-500" />
                  <span>szary: Twój limit 10/10 osiągnięty – przycisk jest wyłączony</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Informacja pomocnicza o bieżącym cyklu dla użytkownika */}
        {alreadyInOpenCycle && (
          <div className="mt-2 text-xs text-emerald-400">
            Masz już udział w aktualnym otwartym cyklu.
          </div>
        )}
        {isOpenCycleFull && openCycle && (
          <div className="mt-1 text-xs text-amber-400">
            Bieżący cykl jest pełny. System otworzy nowy cykl, gdy będzie to
            możliwe.
          </div>
        )}
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
                  className="rounded-xl border border-neutral-700 p-3 space-y-2 bg-neutral-950/30"
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
                        ? "Zamknięty - oczekiwanie na kolejne losowanie"
                        : isFinished && hasDrawHistory
                          ? "Zakończony - losowania odbyły się"
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
                      Zakończony - brak zapisanych danych o losowaniu (starszy
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
