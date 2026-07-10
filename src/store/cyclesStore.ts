import { create } from "zustand";

/** Model cyklu */
export interface Cycle {
  id: number;
  name?: string;
  participants: number[];
  winners: number[];
  draws: number;
  status: "open" | "closed";
}

interface State {
  cycles: Cycle[];
}

interface Actions {
  openCycle: () => number;
  getOpenCycle: () => Cycle | undefined;
  joinCycle: (id: number) => number | null;
  drawWinner: (id: number) => number | null;
  closeCycle: (id: number) => void;
}

/** --- Normalizacja danych (np. z LocalStorage) --- */
function normalizeStatus(s: unknown): Cycle["status"] {
  return s === "closed" ? "closed" : "open";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => Number(item)) : [];
}

function normalizeCycle(value: unknown): Cycle {
  const x = isRecord(value) ? value : {};
  return {
    id: Number(x.id) || 0,
    name: typeof x.name === "string" ? x.name : undefined,
    participants: normalizeNumbers(x.participants),
    winners: normalizeNumbers(x.winners),
    draws: Number(x.draws) || 0,
    status: normalizeStatus(x.status),
  };
}

function persistCycles(cycles: Cycle[]): void {
  try {
    localStorage.setItem("pop33_cycles", JSON.stringify(cycles));
  } catch {
    return;
  }
}

/** Wczytaj startowe dane, jeśli trzymasz w LocalStorage (bez błędów typów) */
function loadInitialCycles(): Cycle[] {
  try {
    const raw = localStorage.getItem("pop33_cycles");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCycle);
  } catch {
    return [];
  }
}

export const useCycles = create<State & Actions>((set, get) => ({
  cycles: loadInitialCycles(), // <- TWARDY typ: Cycle[]

  openCycle: () => {
    const { cycles } = get();
    const newId = (cycles.at(-1)?.id ?? 0) + 1;
    const newCycle: Cycle = {
      id: newId,
      name: `Cykl #${newId}`,
      participants: [],
      winners: [],
      draws: 0,
      status: "open", // <- literał typu
    };
    const next = [...cycles, newCycle];
    set({ cycles: next });
    persistCycles(next);
    return newId;
  },

  getOpenCycle: () => {
    const { cycles } = get();
    return cycles.find((c) => c.status === "open");
  },

  joinCycle: (id) => {
    const { cycles } = get();
    const idx = cycles.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const c = cycles[idx];
    if (c.status !== "open" || c.participants.length >= 30) return null;

    const newParticipantId = c.participants.length + 1;
    const updated: Cycle = {
      ...c,
      participants: [...c.participants, newParticipantId],
    };
    const next = [...cycles];
    next[idx] = updated;
    set({ cycles: next });
    persistCycles(next);
    return newParticipantId;
  },

  drawWinner: (id) => {
    const { cycles } = get();
    const idx = cycles.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const c = cycles[idx];

    if (c.status !== "closed") return null;
    if (c.draws >= 30) return null;

    const available = c.participants.filter((p) => !c.winners.includes(p));
    if (available.length === 0) return null;

    const winner = available[Math.floor(Math.random() * available.length)];

    const updated: Cycle = {
      ...c,
      winners: [...c.winners, winner],
      draws: c.draws + 1,
    };
    const next = [...cycles];
    next[idx] = updated;
    set({ cycles: next });
    persistCycles(next);
    return winner;
  },

  closeCycle: (id) => {
    const { cycles } = get();
    const idx = cycles.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const updated: Cycle = { ...cycles[idx], status: "closed" };
    const next = [...cycles];
    next[idx] = updated;
    set({ cycles: next });
    persistCycles(next);
  },
}));
