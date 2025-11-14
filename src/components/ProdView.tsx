import { useMemo } from "react";
import { useCycles } from "../hooks/useCycles";

const MAX_PARTICIPANTS = 100;
const MAX_WINNERS = 3;

export default function ProdView() {
  const { openCycle, joinFIFO, openNextAndJoin, getOrCreateUserId } = useCycles();

  const userId = useMemo(() => getOrCreateUserId(), [getOrCreateUserId]);
  const alreadyIn = !!openCycle?.participants.some(p => p.userId === userId);
  const isFull    = (openCycle?.participants.length ?? 0) >= (openCycle?.maxParticipants ?? MAX_PARTICIPANTS);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="text-sm opacity-70">Twój ID: <span className="font-mono">{userId}</span></div>

      <div className="rounded-2xl border border-neutral-800 p-4">
        <div className="text-lg font-semibold">Aktualny cykl</div>
        <div className="text-sm opacity-80">
          {openCycle
            ? <>ID: <span className="font-mono">{openCycle.id}</span> · Uczestników: {openCycle.participants.length}/{openCycle.maxParticipants}</>
            : <>Brak otwartego cyklu</>}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            className="px-4 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-900 disabled:opacity-50"
            onClick={joinFIFO}
            disabled={!openCycle || alreadyIn || isFull}
            title={!openCycle ? "Brak otwartego cyklu" : alreadyIn ? "Już dołączyłeś" : isFull ? "Cykl pełny" : "Dołącz"}
          >
            Dołącz do bieżącego
          </button>

          <button
            className="px-4 py-2 rounded-xl border border-amber-600 text-amber-500 hover:bg-amber-950/40"
            onClick={openNextAndJoin}
            disabled={!alreadyIn && !!openCycle && !isFull}
            title="Otwórz nowy cykl i dołącz (dostępne po dołączeniu do bieżącego lub gdy bieżący pełny)"
          >
            Otwórz nowy cykl i dołącz
          </button>
        </div>
      </div>
    </div>
  );
}
