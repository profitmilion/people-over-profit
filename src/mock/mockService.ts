export type CycleState = "OPEN" | "FULL" | "CLOSED" | "DRAWING" | "COMPLETED";
export type Cycle = {
  id: number;
  state: CycleState;
  cap: number;
  participantsCount: number;
  drawsDone: number; // 0..30
  winners: number[]; // indices
};

let cycles: Cycle[] = [
  { id: 1, state: "OPEN", cap: 100, participantsCount: 12, drawsDone: 0, winners: [] },
];

export const mock = {
  listCycles: async (): Promise<Cycle[]> => {
    await delay(150);
    return [...cycles];
  },
  join: async (cycleId: number) => {
    await delay(200);
    const c = find(cycleId);
    if (c.state !== "OPEN") throw new Error("Zapisy są zamknięte");
    if (c.participantsCount >= c.cap) throw new Error("Pełny cykl");
    c.participantsCount += 1;
    if (c.participantsCount === c.cap) c.state = "FULL";
    touch();
  },
  closeIfFull: async (cycleId: number) => {
    await delay(200);
    const c = find(cycleId);
    if (c.state !== "FULL") throw new Error("Cykl nie jest pełny");
    c.state = "CLOSED";
    touch();
  },
  startDraws: async (cycleId: number) => {
    await delay(200);
    const c = find(cycleId);
    if (c.state !== "CLOSED") throw new Error("Cykl nie jest zamknięty");
    c.state = "DRAWING";
    c.drawsDone = 0;
    c.winners = [];
    touch();
  },
  canDrawNow: async () => {
    await delay(50);
    return true; // demo
  },
  drawNext: async (cycleId: number) => {
    await delay(250);
    const c = find(cycleId);
    if (c.state !== "DRAWING") throw new Error("Losowanie nie jest aktywne");
    if (c.drawsDone >= 30) throw new Error("Brak losowań");
    const winnerIndex = Math.floor(Math.random() * c.participantsCount);
    c.winners.push(winnerIndex);
    c.drawsDone += 1;
    if (c.drawsDone === 30) c.state = "COMPLETED";
    touch();
    return winnerIndex;
  },
};

function find(cycleId: number) {
  const c = cycles.find((x) => x.id === cycleId);
  if (!c) throw new Error("Nie znaleziono cyklu");
  return c;
}
function touch() {
  cycles = [...cycles];
}
function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
