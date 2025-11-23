// src/hooks/useCycles.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadState, saveState } from "../utils/storage";
import { shuffle } from "../utils/rand";
import type { AppState, Cycle, CycleId, UserId, DrawInfo } from "../types/core";

// ========== LIMIT OTWARTYCH CYKLI PO OSTATNIM ZAMKNIĘTYM ==========
const MAX_OPEN_AFTER_LAST_CLOSED = 10;

function countOpenAfterLastClosed(cycles: AppState["cycles"]): number {
  if (!cycles || cycles.length === 0) return 0;

  const sorted = [...cycles].sort((a, b) => {
    const aMatch = /^C-(\d+)$/.exec(a.id as string);
    const bMatch = /^C-(\d+)$/.exec(b.id as string);

    const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
    const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;

    return aNum - bNum;
  });

  let lastClosedIndex = -1;

  // szukamy OSTATNIEGO cyklu, który NIE jest "open"
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].status !== "open") {
      lastClosedIndex = i;
      break;
    }
  }

  const sliceStart = lastClosedIndex === -1 ? 0 : lastClosedIndex + 1;

  return sorted.slice(sliceStart).filter((c) => c.status === "open").length;
}

function canOpenAnotherCycle(cycles: AppState["cycles"]): boolean {
  return countOpenAfterLastClosed(cycles) < MAX_OPEN_AFTER_LAST_CLOSED;
}

// ========== STATUS „INTELIGENTNEGO JOIN” (DO UI / SYGNALIZACJI) ==========

export type SmartJoinStatus =
  | {
      kind: "READY";
      mode: "JOIN_OPEN" | "OPEN_NEW";
      targetCycleId?: CycleId;
    }
  | {
      kind: "BLOCKED";
      reason: "LIMIT_REACHED";
    };

function computeSmartJoinStatus(state: AppState): SmartJoinStatus {
  const cycles = state.cycles ?? [];
  const uid = state.lastUserId; // może być undefined

  // 1. Czy istnieje otwarty cykl, do którego użytkownik może dołączyć?
  const joinable = cycles.find((c) => {
    if (c.status !== "open") return false;
    if (c.participants.length >= c.maxParticipants) return false;

    // jeżeli użytkownik jeszcze nie ma ID, to i tak może dołączyć
    if (!uid) return true;

    // jeżeli ma ID - nie może być już uczestnikiem tego cyklu
    return !c.participants.some((p) => p.userId === uid);
  });

  if (joinable) {
    return {
      kind: "READY",
      mode: "JOIN_OPEN",
      targetCycleId: joinable.id,
    };
  }

  // 2. Jeżeli nie ma cyklu, do którego można dołączyć, sprawdzamy limit
  if (!canOpenAnotherCycle(cycles)) {
    return {
      kind: "BLOCKED",
      reason: "LIMIT_REACHED",
    };
  }

  // 3. Możemy otworzyć nowy cykl i do niego dołączyć
  return {
    kind: "READY",
    mode: "OPEN_NEW",
  };
}

// ========== DOMYŚLNE PARAMETRY CYKLU ==========

const DEFAULTS = {
  MAX_PARTICIPANTS: 100,
  MAX_WINNERS: 1,
};

// DEMO: odstęp między kolejnymi losowaniami w jednym cyklu (ms)
// Docelowo: 24 * 60 * 60 * 1000 (24h)
const DEMO_DRAW_INTERVAL_MS = 10_000;

// DEMO: maksymalna liczba auto-losowań w jednym cyklu
const MAX_AUTO_DRAWS_PER_CYCLE = 3;

// ========== POMOCNICZE TWORZENIE CYKLU ==========

function newCycleTemplate(idNum: number): Cycle {
  const id = `C-${String(idNum).padStart(4, "0")}` as CycleId;
  return {
    id,
    status: "open",
    participants: [],
    maxParticipants: DEFAULTS.MAX_PARTICIPANTS,
    maxWinners: DEFAULTS.MAX_WINNERS,
    openedAt: Date.now(),
    closedAt: undefined,
    draw: undefined,
    drawHistory: [],
    drawCount: 0,
    nextDrawAt: undefined,
  };
}

// ========== INICJALIZACJA STANU Z STORAGE ==========

function ensureInitialState(): AppState {
  const raw = loadState<AppState>({ cycles: [] as Cycle[] } as AppState);

  const cycles: Cycle[] = Array.isArray(raw?.cycles)
    ? raw.cycles.map((c: any, idx: number) => {
        const cycle: Cycle = {
          id: c.id ?? (`C-${String(idx + 1).padStart(4, "0")}` as CycleId),
          status: c.status ?? "open",
          participants: Array.isArray(c.participants) ? c.participants : [],
          maxParticipants:
            typeof c.maxParticipants === "number"
              ? c.maxParticipants
              : DEFAULTS.MAX_PARTICIPANTS,
          maxWinners:
            typeof c.maxWinners === "number"
              ? c.maxWinners
              : DEFAULTS.MAX_WINNERS,
          openedAt:
            typeof c.openedAt === "number" ? c.openedAt : Date.now(),
          closedAt: c.closedAt,
          draw: c.draw,
          drawHistory: Array.isArray(c.drawHistory) ? c.drawHistory : [],
          drawCount: typeof c.drawCount === "number" ? c.drawCount : 0,
          nextDrawAt: c.nextDrawAt,
        };

        // jeżeli nie było drawHistory, a było draw, dodajemy do historii
        if (
          (!cycle.drawHistory || cycle.drawHistory.length === 0) &&
          cycle.draw
        ) {
          cycle.drawHistory = [cycle.draw];
        }

        // drawCount wyrównujemy z historią, jeśli jest
        if (cycle.drawHistory && cycle.drawHistory.length > 0) {
          cycle.drawCount = cycle.drawHistory.length;
        } else {
          cycle.drawCount = cycle.drawCount ?? 0;
        }

        return cycle;
      })
    : [];

  const state: AppState = {
    cycles: cycles.length > 0 ? cycles : [],
    lastUserId: raw?.lastUserId as UserId | undefined,
  };

  if (state.cycles.length === 0) {
    state.cycles.push(newCycleTemplate(1));
    saveState(state);
    return state;
  }

  return state;
}

// ========== LOSOWANIE Z ZACHOWANIEM HISTORII ==========

function performDraw(cycle: Cycle, seed?: number) {
  if (!cycle.participants || cycle.participants.length === 0) {
    cycle.nextDrawAt = undefined;
    return;
  }

  // użytkownicy, którzy już wygrali w tym cyklu
  const alreadyWon = new Set<UserId>();
  if (Array.isArray(cycle.drawHistory)) {
    for (const d of cycle.drawHistory) {
      for (const w of d.winners) {
        alreadyWon.add(w);
      }
    }
  }

  // kandydaci, którzy jeszcze nie wygrali
  const candidateParticipants = cycle.participants.filter(
    (p) => !alreadyWon.has(p.userId)
  );

  if (candidateParticipants.length === 0) {
    cycle.nextDrawAt = undefined;
    return;
  }

  const orderedIds = candidateParticipants
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => p.userId);

  const now = Date.now();
  const drawSeed = typeof seed === "number" ? seed : now;

  const shuffled = shuffle(orderedIds, drawSeed);
  const maxWinners = cycle.maxWinners ?? DEFAULTS.MAX_WINNERS;
  const winnersCount = Math.min(maxWinners, shuffled.length);

  if (winnersCount <= 0) {
    cycle.nextDrawAt = undefined;
    return;
  }

  const winners = shuffled.slice(0, winnersCount);

  const prevHistory = Array.isArray(cycle.drawHistory)
    ? cycle.drawHistory
    : [];

  const drawIndex = prevHistory.length + 1;

  const draw: DrawInfo = {
    cycleId: cycle.id,
    winners,
    drawnAt: now,
    seed: drawSeed,
    drawIndex,
  };

  cycle.draw = draw;
  cycle.drawHistory = [...prevHistory, draw];
  cycle.drawCount = cycle.drawHistory.length;

  // cykl uznajemy za zakończony z punktu widzenia losowania
  cycle.status = "finished";

  const remainingCandidates = candidateParticipants.length - winners.length;

  if (drawIndex < MAX_AUTO_DRAWS_PER_CYCLE && remainingCandidates > 0) {
    cycle.nextDrawAt = now + DEMO_DRAW_INTERVAL_MS;
  } else {
    cycle.nextDrawAt = undefined;
  }
}

// ========== GŁÓWNY HOOK ==========

export function useCycles() {
  const [state, setState] = useState<AppState>(() => ensureInitialState());

  const persist = useCallback(
    (updater: (s: AppState) => AppState | void) => {
      setState((prev: AppState) => {
        const draft: AppState = {
          ...prev,
          cycles: prev.cycles.map((c) => ({
            ...c,
            participants: c.participants.slice(),
          })),
        };

        const maybeNext = updater(draft);
        const next = (maybeNext ?? draft) as AppState;

        if (next !== prev) {
          saveState(next);
        }

        return next;
      });
    },
    []
  );

  const cycles = state.cycles;

  const openCycle = useMemo(
    () => cycles.find((c) => c.status === "open"),
    [cycles]
  );

  const lastCycleNumber = useMemo(() => {
    const last = cycles.length ? cycles[cycles.length - 1] : undefined;
    const parsed = last ? parseInt(String(last.id).split("-")[1], 10) : NaN;
    return Number.isFinite(parsed) ? parsed : 1;
  }, [cycles]);

  // Nowy: status inteligentnego join, dla UI (przycisk, ikonka, sygnalizacja)
  const smartJoinStatus = useMemo(
    () => computeSmartJoinStatus(state),
    [state]
  );

  const makeId = () =>
    typeof crypto !== "undefined" &&
    typeof (crypto as any).randomUUID === "function"
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2);

  const getOrCreateUserId = useCallback((): UserId => {
    if (state.lastUserId) return state.lastUserId;
    const uid = `U-${makeId()}` as UserId;
    persist((s) => ({ ...s, lastUserId: uid }));
    return uid;
  }, [state.lastUserId, persist]);

  // PROD: dołączenie do najstarszego otwartego cyklu (pozostawiamy dla kompatybilności)
  const joinFIFO = useCallback(() => {
    const uid = getOrCreateUserId();
    persist((s) => {
      const copy: AppState = {
        ...s,
        cycles: s.cycles.map((c) => ({
          ...c,
          participants: c.participants.slice(),
        })),
      };

      const cur = copy.cycles.find((c) => c.status === "open");
      if (!cur) return copy;

      const already = cur.participants.some((p) => p.userId === uid);
      if (already) return copy;

      if (cur.participants.length >= cur.maxParticipants) return copy;

      cur.participants.push({ userId: uid, joinedAt: Date.now() });

      if (cur.participants.length >= cur.maxParticipants) {
        const now = Date.now();
        cur.status = "finished";
        if (!cur.closedAt) cur.closedAt = now;

        if (!cur.nextDrawAt && (cur.drawCount ?? 0) === 0) {
          cur.nextDrawAt = now + DEMO_DRAW_INTERVAL_MS;
        }
      }

      return copy;
    });
  }, [getOrCreateUserId, persist]);

  // PROD: otwórz kolejny cykl i dołącz (to będzie nasz „inteligentny join”)
  const openNextAndJoin = useCallback(() => {
    const uid = getOrCreateUserId();

    persist((s) => {
      if (!canOpenAnotherCycle(s.cycles)) {
        console.warn(
          "Nie można otworzyć/dołączyć do kolejnego cyklu - osiągnięto limit 10 otwartych cykli po ostatnim zamkniętym."
        );
        return s;
      }

      const copy: AppState = {
        ...s,
        cycles: s.cycles.map((c) => ({
          ...c,
          participants: c.participants.slice(),
        })),
      };

      const now = Date.now();

      // najpierw spróbuj dołączyć do istniejącego otwartego cyklu
      let cur = copy.cycles.find(
        (c) =>
          c.status === "open" &&
          !c.participants.some((p) => p.userId === uid) &&
          c.participants.length < c.maxParticipants
      );

      if (cur) {
        cur.participants.push({ userId: uid, joinedAt: now });

        if (cur.participants.length >= cur.maxParticipants) {
          cur.status = "finished";
          if (!cur.closedAt) cur.closedAt = now;

          if (!cur.nextDrawAt && (cur.drawCount ?? 0) === 0) {
            cur.nextDrawAt = now + DEMO_DRAW_INTERVAL_MS;
          }
        }

        return copy;
      }

      // jeśli nie ma odpowiedniego otwartego, tworzymy nowy cykl
      const lastNum =
        copy.cycles.length > 0
          ? Math.max(
              ...copy.cycles.map((c) => {
                const m = /^C-(\d+)$/.exec(c.id as string);
                return m ? parseInt(m[1], 10) : 0;
              })
            )
          : 0;

      const nextIdNum = lastNum + 1;
      const nextCycle = newCycleTemplate(nextIdNum);

      nextCycle.participants.push({ userId: uid, joinedAt: now });

      copy.cycles.push(nextCycle);

      return copy;
    });
  }, [getOrCreateUserId, persist]);

  // DEV: dodanie fałszywych uczestników do otwartego cyklu
  const addFakeParticipants = useCallback(
    (count: number) => {
      persist((s) => {
        const copy: AppState = {
          ...s,
          cycles: s.cycles.map((c) => ({
            ...c,
            participants: c.participants.slice(),
          })),
        };

        let cur = copy.cycles.find((c) => c.status === "open");
        if (!cur) {
          const next = newCycleTemplate(lastCycleNumber + 1);
          copy.cycles.push(next);
          cur = next;
        }

        const freeSlots = cur.maxParticipants - cur.participants.length;
        const toAdd = Math.max(0, Math.min(count, freeSlots));

        const baseNow = Date.now();

        for (let i = 0; i < toAdd; i++) {
          const uid = `F-${makeId()}` as UserId;
          cur.participants.push({
            userId: uid,
            joinedAt: baseNow + i,
          });
        }

        if (cur.participants.length >= cur.maxParticipants) {
          const now = Date.now();
          cur.status = "finished";
          if (!cur.closedAt) cur.closedAt = now;

          if (!cur.nextDrawAt && (cur.drawCount ?? 0) === 0) {
            cur.nextDrawAt = now + DEMO_DRAW_INTERVAL_MS;
          }
        }

        return copy;
      });
    },
    [lastCycleNumber, persist]
  );

  const resetDemo = useCallback(() => {
    const fresh: AppState = {
      cycles: [newCycleTemplate(1)],
      lastUserId: undefined,
    };
    saveState(fresh);
    setState(fresh);
  }, []);

  // MONITOR: auto-losowania na podstawie nextDrawAt
  useEffect(() => {
    const id = setInterval(() => {
      setState((prev: AppState) => {
        let changed = false;

        const copy: AppState = {
          ...prev,
          cycles: prev.cycles.map((c) => ({
            ...c,
            participants: c.participants.slice(),
          })),
        };

        const now = Date.now();

        for (const c of copy.cycles) {
          if (!c.nextDrawAt) continue;

          if (c.participants.length === 0) {
            c.nextDrawAt = undefined;
            changed = true;
            continue;
          }

          if (now >= c.nextDrawAt) {
            performDraw(c);
            changed = true;
          }
        }

        if (changed) {
          saveState(copy);
          return copy;
        }

        return prev;
      });
    }, 500);

    return () => clearInterval(id);
  }, []);

  // RĘCZNE LOSOWANIE Z DEV PANELU
  const runDraw = useCallback(
    (seed?: number) => {
      persist((s) => {
        const copy: AppState = {
          ...s,
          cycles: s.cycles.map((c) => ({
            ...c,
            participants: c.participants.slice(),
          })),
        };

        // 1. najpierw losujemy w bieżącym OTWARTYM cyklu z uczestnikami
        let target =
          copy.cycles.find(
            (c) => c.status === "open" && c.participants.length > 0
          ) ?? null;

        // 2. jeśli brak otwartego z uczestnikami, bierzemy ostatni cykl z uczestnikami
        if (!target) {
          target =
            [...copy.cycles]
              .reverse()
              .find((c) => c.participants.length > 0) ?? null;
        }

        if (!target) {
          console.warn(
            "runDraw: brak cyklu z uczestnikami, nie ma czego losować"
          );
          return s;
        }

        performDraw(target, seed);

        return copy;
      });
    },
    [persist]
  );

  return {
    state,
    cycles: state.cycles,
    openCycle,
    // stare API (zachowane)
    joinFIFO,
    openNextAndJoin,
    // nowe API pod „inteligentny join”
    smartJoin: openNextAndJoin,
    smartJoinStatus,
    // reszta
    runDraw,
    addFakeParticipants,
    resetDemo,
    getOrCreateUserId,
  };
}
