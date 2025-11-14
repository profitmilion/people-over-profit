export type CycleStatus = "open" | "closed";

export interface Cycle {
  id: string;                 // id cyklu z kontraktu
  index: number;              // porządkowa pozycja do UI
  participants: `0x${string}`[];
  winners: `0x${string}`[];
  draws: number;              // ile losowań wykonano (0..30)
  createdAt: number;          // ms epoch
  closedAt?: number;          // ms epoch
  status: CycleStatus;        // "open" lub "closed"
}
