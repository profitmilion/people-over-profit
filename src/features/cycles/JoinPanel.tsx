import { useState } from "react";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { useCycles } from "../../store/cyclesStore";

export default function JoinPanel() {
  const { getOpenCycle, openCycle, joinCycle, closeCycle } = useCycles();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");

  const openCycleObj = getOpenCycle();

  const handleJoin = async () => {
    setIsBusy(true);
    setMessage("");

    try {
      let currentCycle = getOpenCycle();

      // jeśli nie ma otwartego cyklu – utwórz nowy
      if (!currentCycle) {
        const newCycleId = openCycle();
        setMessage(`Utworzono nowy cykl #${newCycleId}.`);
        currentCycle = getOpenCycle();
      }

      // dołącz do otwartego cyklu
      if (!currentCycle) return;

      const participantId = joinCycle(currentCycle.id);
      if (participantId == null) {
        setMessage("Nie udało się dołączyć. Cykl może być pełny.");
      } else {
        setMessage(`Dołączono do cyklu #${currentCycle.id} jako uczestnik #${participantId}.`);
      }
    } catch (err) {
      setMessage("Wystąpił błąd podczas dołączania do cyklu.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCloseCycle = () => {
    const currentCycle = getOpenCycle();
    if (!currentCycle) {
      setMessage("Brak otwartego cyklu do zamknięcia.");
      return;
    }
    closeCycle(currentCycle.id);
    setMessage(`Cykl #${currentCycle.id} został zamknięty.`);
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Dołącz do cyklu</h3>

        <div className="text-sm text-[var(--text-dim)]">
          {openCycleObj
            ? `Otwarty cykl: #${openCycleObj.id} (uczestnicy: ${openCycleObj.participants?.length ?? 0}/30)`
            : "Brak otwartego cyklu. Kliknij, aby utworzyć nowy."}
        </div>

        <div className="flex gap-2">
          <Button onClick={handleJoin} disabled={isBusy}>
            {isBusy ? "Przetwarzanie..." : openCycleObj ? "Dołącz" : "Utwórz i dołącz"}
          </Button>

          {/* Nowy przycisk do zamykania cyklu */}
          <Button
            onClick={handleCloseCycle}
            disabled={!openCycleObj || isBusy}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Zamknij cykl
          </Button>
        </div>

        {message && (
          <div className="text-sm text-[var(--text-dim)] border-t border-neutral-800 pt-2">
            {message}
          </div>
        )}

        <p className="text-xs text-[var(--text-dim)]">
          Demo UI – bez płatności. Wersja produkcyjna: opłata on-chain i potwierdzenie transakcji w portfelu.
        </p>
      </div>
    </Card>
  );
}
