// src/components/ProdView.tsx
import { useMemo } from "react";
import { useCycles } from "../hooks/useCycles";

const MAX_PARTICIPANTS = 100;
const MAX_WINNERS = 1;

export default function ProdView() {
  const { state, joinFIFO, openNextAndJoin, cycles, getOrCreateUserId, openCycle } = useCycles();

  const userId = useMemo(() => getOrCreateUserId(), [getOrCreateUserId]);

  // znajdź wszystkie cykle, do których użytkownik dołączył
  const userCycles = useMemo(() => {
    return cycles.filter((c) => c.participants.some((p) => p.userId === userId));
  }, [cycles, userId]);

  // ilość cykli użytkownika
  const totalUserCycles = userCycles.length;

  const alreadyInOpenCycle = !!openCycle?.participants.some((p) => p.userId === userId);
  const isOpenCycleFull =
    (openCycle?.participants.length ?? 0) >= (openCycle?.maxParticipants ?? MAX_PARTICIPANTS);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      <div className="text-sm opacity-70">
        Twój ID: <span className="font-mono">{userId}</span>
      </div>

      {/* Sekcja AKTUALNEGO CZYLI OTWARTEGO CYKLU */}
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

        {/* Przyciski nawigacyjne */}
        <div className="flex gap-3">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-900 disabled:opacity-50"
            onClick={joinFIFO}
            disabled={!openCycle || alreadyInOpenCycle || isOpenCycleFull}
            title={
              !openCycle
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
            disabled={!alreadyInOpenCycle && !!openCycle && !isOpenCycleFull}
            title="Dołącz do nowego cyklu (po dołączeniu do bieżącego lub gdy bieżący pełny)"
          >
            Dołącz do nowego cyklu
          </button>
        </div>
      </section>

      {/* Sekcja WSZYSTKICH CYKLI UŻYTKOWNIKA */}
      <section className="rounded-2xl border border-neutral-800 p-4 space-y-4">
        <div className="text-lg font-semibold">Twoje cykle</div>

        {totalUserCycles > 0 ? (
          <div className="space-y-3">
            {userCycles.map((c) => (
              <div key={c.id} className="rounded-xl border border-neutral-700 p-3">
                <div className="font-mono text-sm mb-2">{c.id}</div>
                <div className="text-xs opacity-80">
                  Uczestników: {c.participants.length}/{c.maxParticipants}
                </div>
                <div className="text-xs opacity-80">Status: {c.status}</div>

                {c.status === "finished" && (
                  <div className="text-xs opacity-70 mt-1">Zakończony</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm opacity-70">Jeszcze nie dołączyłeś do żadnego cyklu.</div>
        )}
      </section>
    </div>
  );
}
