import { useCycles } from "../../store/cyclesStore";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";

function toCSV(rows: Array<{cycleId:number; day:number; index:number}>) {
  const header = "cycleId,day,index";
  const body = rows.map(r => `${r.cycleId},${r.day},${r.index}`).join("\n");
  return [header, body].join("\n");
}

export default function WinnersArchive() {
  const { cycles } = useCycles();

  const exportJSON = () => {
    const payload = cycles.map(c => ({
      id: c.id,
      name: c.name,
      draws: c.draws,
      winners: c.winners,
      status: c.status,
      capacity: c.capacity,
      participants: c.participants,
      createdAt: c.createdAt,
      closedAt: c.closedAt ?? null,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "winners-archive.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const rows: Array<{cycleId:number; day:number; index:number}> = [];
    for (const c of cycles) {
      c.winners.forEach((idx, i) => {
        rows.push({ cycleId: c.id, day: i + 1, index: idx });
      });
    }
    const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "winners-archive.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Archiwum zwycięzców</h3>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportCSV}>Eksport CSV</Button>
          <Button onClick={exportJSON}>Eksport JSON</Button>
        </div>
      </div>

      <div className="mt-3 space-y-4">
        {cycles.map(c => (
          <div key={c.id} className="rounded-lg border border-neutral-800 p-3">
            <div className="mb-2 text-sm text-[var(--text-dim)]">
              {(c.name ?? `Cykl #${c.id}`)} • status {c.status} • losowań {c.draws}/30
            </div>
            {c.winners.length === 0 ? (
              <div className="text-sm text-[var(--text-dim)]">Brak zwycięzców.</div>
            ) : (
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                {c.winners.map((idx, i) => (
                  <li key={`${c.id}-${i}`}>Dzień {i + 1}: uczestnik #{idx}</li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
