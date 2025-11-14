// src/utils/cycles.ts
import type { Cycle } from "../hooks/useCycles";

// Limity wersji demo (OFFLINE)
const MAX_WINNERS = 3;

/**
 * Funkcja sprawdza, czy można jeszcze przeprowadzić losowanie
 * w danym cyklu.
 * - Cykl musi być zamknięty ("closed")
 * - Nie może mieć już wylosowanych 3 zwycięzców
 * - Musi mieć przynajmniej jednego uczestnika, który jeszcze nie wygrał
 */
export function canDraw(c: Cycle): boolean {
  if (c.status !== "closed") return false;
  if (c.draws >= MAX_WINNERS) return false;
  if (c.participants.length <= c.winners.length) return false;
  return true;
}
