// src/types/core.ts

export type UserId = string;
export type CycleId = string;

// Uczestnik cyklu
export interface Participant {
  userId: UserId;
  joinedAt: number; // timestamp (ms od 1970)
}

// Informacja o jednym losowaniu
export interface DrawInfo {
  cycleId: CycleId;
  winners: UserId[];
  drawnAt: number;
  seed?: number;
  // który z kolei draw w tym cyklu (1 = pierwsze losowanie itd.)
  drawIndex?: number;
}

// Stary typ harmonogramu (zostawiamy dla kompatybilności)
export interface DrawSchedule {
  pooledSeconds: number;
  thresholdSeconds: number;
  countdownSeconds: number;
  locked: boolean;
  scheduledAt?: number;
  countdownStartAt?: number;
  drawAt?: number;
}

// Cykl losowania POP33
export interface Cycle {
  id: CycleId;
  status: "open" | "drawing" | "finished";

  participants: Participant[];
  maxParticipants: number;
  maxWinners: number;

  openedAt: number;
  closedAt?: number;

  // ostatnie losowanie (do szybkiego podglądu)
  draw?: DrawInfo;

  // historia wszystkich losowań w tym cyklu
  drawHistory?: DrawInfo[];

  // legacy, nieużywane w nowej logice, ale zostawiamy, zeby nie psuć innych plików
  schedule?: DrawSchedule;

  // ile razy już losowaliśmy w tym cyklu
  drawCount?: number;

  // kiedy automatycznie zrobić kolejne losowanie (timestamp)
  nextDrawAt?: number;
}

// Cały stan aplikacji
export interface AppState {
  cycles: Cycle[];
  lastUserId?: UserId;
}
