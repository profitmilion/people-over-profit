// src/types/core.ts

// Proste "brandowanie" identyfikatorów (pomaga unikać pomyłek typów string)
export type CycleId = string;
export type UserId  = string;

// Uczestnik cyklu
export interface Participant {
    userId: UserId;
    joinedAt: number; // ms since epoch
}

// Wynik losowania
export interface DrawResult {
    cycleId: CycleId;
    winners: UserId[];
    drawnAt: number;   // ms since epoch
    seed?: number | undefined;     // użyte ziarno (opcjonalnie)
}

// Harmonogram losowania – logika puli czasu i countdown
export interface DrawSchedule {
    pooledSeconds: number;       // skumulowany czas dodany przez społeczność
    thresholdSeconds: number;    // próg startu odliczania
    countdownSeconds: number;    // długość odliczania (sekundy)
    locked: boolean;             // true po osiągnięciu progu

    // znaczniki czasu (opcjonalne)
    scheduledAt?: number | undefined;        // ms – moment osiągnięcia progu
    countdownStartAt?: number | undefined;   // ms – start odliczania
    drawAt?: number | undefined;             // ms – docelowy moment losowania
}

// Status cyklu
export type CycleStatus = "open" | "drawing" | "finished" | "closed";

// Cykl
export interface Cycle {
    id: CycleId;
    status: CycleStatus;
    participants: Participant[];
    maxParticipants: number;
    maxWinners: number;
    openedAt: number;
    closedAt?: number | undefined;
    schedule: DrawSchedule;
    draw?: DrawResult | undefined;
}

// Stan aplikacji
export interface AppState {
    cycles: Cycle[];
    lastUserId?: UserId | undefined;
}
