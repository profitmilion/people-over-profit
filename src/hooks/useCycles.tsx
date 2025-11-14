// ...existing code...
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadState, saveState, STATE_KEY } from "../utils/storage";
import { shuffle } from "../utils/rand";
import type { AppState, Cycle, CycleId, UserId, DrawSchedule } from "../types/core";

const DEFAULTS = { MAX_PARTICIPANTS: 100, MAX_WINNERS: 3 };

// DEMO: krótkie wartości do testów
const SCHEDULE_DEFAULTS: Pick<DrawSchedule, "thresholdSeconds" | "countdownSeconds"> = {
  thresholdSeconds: 30,  // próg puli
  countdownSeconds: 15,  // odliczanie po progu
};

const DEFAULT_SCHEDULE: DrawSchedule = {
  pooledSeconds: 0,
  thresholdSeconds: SCHEDULE_DEFAULTS.thresholdSeconds,
  countdownSeconds: SCHEDULE_DEFAULTS.countdownSeconds,
  locked: false,
  scheduledAt: undefined,
  countdownStartAt: undefined,
  drawAt: undefined,
};

function newCycleTemplate(idNum: number): Cycle {
  const id = `C-${String(idNum).padStart(4, "0")}` as CycleId;
  return {
    id,
    status: "open",
    participants: [],
    maxParticipants: DEFAULTS.MAX_PARTICIPANTS,
    maxWinners: DEFAULTS.MAX_WINNERS,
    openedAt: Date.now(),
    schedule: { ...DEFAULT_SCHEDULE },
  };
}

function migrateState(state: AppState): AppState {
  if (!state || !Array.isArray((state as any).cycles)) {
    return { cycles: [] };
  }
  const migrated: AppState = {
    ...state,
    cycles: state.cycles.map((c) => {
      const openedAt =
        typeof (c as any).openedAt === "number" ? (c as any).openedAt : Date.now();

      // Bezpieczny odczyt harmonogramu z domyślnymi wartościami
      const scheduleRaw = (c as any).schedule ?? {};
      const schedule: DrawSchedule = {
        pooledSeconds: Math.max(0, Number(scheduleRaw.pooledSeconds ?? 0)),
        thresholdSeconds: Number(scheduleRaw.thresholdSeconds ?? SCHEDULE_DEFAULTS.thresholdSeconds),
        countdownSeconds: Number(scheduleRaw.countdownSeconds ?? SCHEDULE_DEFAULTS.countdownSeconds),
        locked: Boolean(scheduleRaw.locked ?? false),
        scheduledAt: typeof scheduleRaw.scheduledAt === "number" ? scheduleRaw.scheduledAt : undefined,
        countdownStartAt: typeof scheduleRaw.countdownStartAt === "number" ? scheduleRaw.countdownStartAt : undefined,
        drawAt: typeof scheduleRaw.drawAt === "number" ? scheduleRaw.drawAt : undefined,
      };

      return {
        ...c,
        openedAt,
        schedule,
        participants: Array.isArray(c.participants) ? c.participants : [],
        maxParticipants: c.maxParticipants ?? DEFAULTS.MAX_PARTICIPANTS,
        maxWinners: c.maxWinners ?? DEFAULTS.MAX_WINNERS,
        status: c.status ?? "open",
      };
    }),
  };
  return migrated;
}

function ensureInitialState(): AppState {
  const raw = loadState<AppState>({ cycles: [] });
  const state = migrateState(raw);
  if (state.cycles.length === 0) {
    state.cycles.push(newCycleTemplate(1));
    saveState(state);
  }
  return state;
}

export function useCycles() {
  const [state, setState] = useState<AppState>(() => ensureInitialState());

  // bezpieczny persist (można zwrócić undefined = brak zmian)
  const persist = useCallback((updater: (s: AppState) => AppState | undefined) => {
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        cycles: prev.cycles.map(c => ({
          ...c,
          participants: c.participants.slice(),
          schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) },
        })),
      };
      const maybeNext = updater(draft);
      const next = (maybeNext ?? draft) as AppState;
      // zapis tylko gdy faktycznie coś zmieniono (prosty check referencji)
      if (next !== prev) saveState(next);
      return next;
    });
  }, []);

  const cycles = state.cycles;
  const openCycle = useMemo(() => cycles.find(c => c.status === "open"), [cycles]);

  const lastCycleNumber = useMemo(() => {
    const last = cycles.length ? cycles[cycles.length - 1] : undefined;
    const parsed = last ? parseInt(String(last.id).split("-")[1], 10) : NaN;
    return Number.isFinite(parsed) ? parsed : 1;
  }, [cycles]);

  const makeId = () =>
    (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function")
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

  const getOrCreateUserId = useCallback((): UserId => {
    if (state.lastUserId) return state.lastUserId;
    const uid = `U-${makeId()}` as UserId;
    persist(s => ({ ...s, lastUserId: uid }));
    return uid;
  }, [state.lastUserId, persist]);

  // PROD: dołączenie do najstarszego otwartego cyklu
  const joinFIFO = useCallback(() => {
    const uid = getOrCreateUserId();
    persist(s => {
      const copy: AppState = {
        ...s,
        cycles: s.cycles.map(c => ({
          ...c,
          participants: c.participants.slice(),
          schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) },
        })),
      };

      const cur = copy.cycles.find(c => c.status === "open");
      if (!cur) return copy;

      const already = cur.participants.some(p => p.userId === uid);
      if (already) return copy;
      if (cur.participants.length >= cur.maxParticipants) return copy;

      cur.participants.push({ userId: uid, joinedAt: Date.now() });
      return copy;
    });
  }, [getOrCreateUserId, persist]);

  // PROD: otwórz kolejny cykl i dołącz (jeśli bieżący zajęty)
  const openNextAndJoin = useCallback(() => {
    const uid = getOrCreateUserId();
    persist(s => {
      const copy: AppState = {
        ...s,
        cycles: s.cycles.map(c => ({
          ...c,
          participants: c.participants.slice(),
          schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) },
        })),
      };

      const cur = copy.cycles.find(c => c.status === "open");
      if (cur && !cur.participants.some(p => p.userId === uid) && cur.participants.length < cur.maxParticipants) {
        cur.participants.push({ userId: uid, joinedAt: Date.now() });
        return copy;
      }

      const next = newCycleTemplate(lastCycleNumber + 1);
      copy.cycles.push(next);
      next.participants.push({ userId: uid, joinedAt: Date.now() });
      return copy;
    });
  }, [getOrCreateUserId, persist, lastCycleNumber]);

  // DEV: ręczne losowanie (debug)
  const runDraw = useCallback((seed?: number) => {
    persist(s => {
      const copy: AppState = {
        ...s,
        cycles: s.cycles.map(c => ({
          ...c,
          participants: c.participants.slice(),
          schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) }
        })),
      };
      const target = copy.cycles.find(c => (c.status === "open" || c.status === "closed") && !c.draw);
      if (!target) return copy;
      if (target.participants.length === 0) return copy;

      target.status = "drawing";
      const ordered = target.participants
        .slice()
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(p => p.userId);
      const shuffled = shuffle(ordered, seed ?? Date.now());
      const winners = shuffled.slice(0, Math.min(target.maxWinners, shuffled.length));

      target.draw = { cycleId: target.id, winners, drawnAt: Date.now(), seed };
      target.status = "finished";
      target.closedAt = Date.now();
      return copy;
    });
  }, [persist]);

  // DEV: dodaj sztucznych uczestników
  const addFakeParticipants = useCallback((count: number) => {
    persist(s => {
      const copy: AppState = {
        ...s,
        cycles: s.cycles.map(c => ({
          ...c,
          participants: c.participants.slice(),
          schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) }
        })),
      };

      let cur = copy.cycles.find(c => c.status === "open");
      if (!cur) {
        const next = newCycleTemplate(lastCycleNumber + 1);
        copy.cycles.push(next);
        cur = next;
      }

      const toAdd = Math.max(0, Math.min(count, cur.maxParticipants - cur.participants.length));
      for (let i = 0; i < toAdd; i++) {
        const uid = `F-${makeId()}` as UserId;
        cur.participants.push({ userId: uid, joinedAt: Date.now() + i });
      }
      return copy;
    });
  }, [persist, lastCycleNumber]);

  // PROD/DEV: dokładanie sekund do puli czasu
  // WYMÓG: cykl bez uczestników nie może uruchomić odliczania ani losowania.
  const addTimeToPool = useCallback((seconds: number) => {
    persist(s => {
      const copy: AppState = {
        ...s,
        cycles: s.cycles.map(c => ({
          ...c,
          schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) },
          participants: c.participants.slice()
        })),
      };
      const cur = copy.cycles.find(c => c.status === "open");
      if (!cur) return copy;

      if (!cur.schedule) {
        cur.schedule = { ...DEFAULT_SCHEDULE };
      }
      if (cur.schedule.locked) return copy;

      const add = Math.max(0, Math.floor(seconds));
      cur.schedule.pooledSeconds = Math.max(0, (cur.schedule.pooledSeconds || 0) + add);

      // start odliczania tylko gdy jest przynajmniej 1 uczestnik
      if (!cur.schedule.locked && cur.participants.length > 0 && cur.schedule.pooledSeconds >= cur.schedule.thresholdSeconds) {
        cur.schedule.locked = true;
        cur.schedule.scheduledAt = Date.now();
        cur.schedule.countdownStartAt = cur.schedule.scheduledAt;
        cur.schedule.drawAt = cur.schedule.countdownStartAt + cur.schedule.countdownSeconds * 1000;
      }
      return copy;
    });
  }, [persist]);

  // SYNC między kartami – migracja stanu przy odbiorze zmian z localStorage
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STATE_KEY) {
        const nextRaw = loadState<AppState>({ cycles: [] });
        const next = migrateState(nextRaw);
        setState(next.cycles.length ? next : ensureInitialState());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // MONITOR: jeżeli próg osiągnięty i countdown minął → auto-draw
  useEffect(() => {
    const id = setInterval(() => {
      setState((prev: AppState) => {
        let changed = false;
        const copy: AppState = {
          ...prev,
          cycles: prev.cycles.map(c => ({
            ...c,
            participants: c.participants.slice(),
            schedule: { ...(c.schedule ?? DEFAULT_SCHEDULE) }
          })),
        };

        const cur = copy.cycles.find(c => c.status === "open" && !c.draw);
        if (cur?.schedule?.locked && cur.schedule.drawAt && Date.now() >= cur.schedule.drawAt) {
          if (cur.participants.length > 0) {
            const ordered = cur.participants.slice().sort((a, b) => a.joinedAt - b.joinedAt).map(p => p.userId);
            const shuffled = shuffle(ordered, cur.schedule.drawAt);
            const winners = shuffled.slice(0, Math.min(cur.maxWinners, shuffled.length));

            cur.status = "finished";
            cur.closedAt = Date.now();
            cur.draw = { cycleId: cur.id, winners, drawnAt: Date.now(), seed: cur.schedule.drawAt };
            changed = true;
          } else {
            // brak uczestników – odblokuj i wyczyść harmonogram
            cur.schedule.locked = false;
            cur.schedule.scheduledAt = undefined;
            cur.schedule.countdownStartAt = undefined;
            cur.schedule.drawAt = undefined;
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

  return {
    state,
    cycles,
    openCycle,
    joinFIFO,
    openNextAndJoin,
    runDraw,            // dev debug
    resetDemo: () => persist(_ => ({ cycles: [newCycleTemplate(1)], lastUserId: undefined })),
    getOrCreateUserId,
    addFakeParticipants,
    addTimeToPool,
  };
}
// ...existing code...