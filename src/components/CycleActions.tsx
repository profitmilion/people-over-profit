import React, { useState } from "react";
import { useCycles } from "../hooks/useCycles";

const CycleActions: React.FC = () => {
  const { joinFIFO, openNextAndJoin, addFakeParticipants } = useCycles();
  const [err, setErr] = useState<string | null>(null);

  const handleJoin = () => {
    try {
      joinFIFO();
      setErr(null);
    } catch (e) {
      console.error(e);
      setErr("Wystąpił błąd podczas dołączania do cyklu.");
    }
  };

  const handleOpenNextAndJoin = () => {
    try {
      openNextAndJoin();
      setErr(null);
    } catch (e) {
      console.error(e);
      setErr("Wystąpił błąd podczas otwierania nowego cyklu i dołączania.");
    }
  };

  const handleAddMany = (n: number) => {
    try {
      // Logika demo – zamiast fakeAddress(i) korzystamy z wbudowanej logiki demo
      addFakeParticipants(n);
      setErr(null);
    } catch (e) {
      console.error(e);
      setErr("Wystąpił błąd podczas dodawania wielu uczestników.");
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleJoin}
          className="px-3 py-1 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          Dołącz do bieżącego cyklu
        </button>

        <button
          type="button"
          onClick={handleOpenNextAndJoin}
          className="px-3 py-1 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          Otwórz nowy cykl i dołącz
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleAddMany(10)}
          className="px-3 py-1 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          Dodaj 10 uczestników (demo)
        </button>
        <button
          type="button"
          onClick={() => handleAddMany(100)}
          className="px-3 py-1 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-soft)]"
        >
          Dodaj 100 uczestników (demo)
        </button>
      </div>

      {err && <div className="text-xs text-red-500 mt-1">{err}</div>}
    </div>
  );
};

export default CycleActions;
