// src/utils/cycles.ts
import type { Cycle } from "../types/core";


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
  // W nowym modelu nie mamy już statusu "closed" – używamy "finished"
  if (c.status !== "finished") return false;

  // Rzutujemy na any, żeby obsłużyć zarówno stare, jak i nowe struktury draw/winners
  const anyCycle: any = c;

  // Liczba losowań – próbujemy najpierw z draw.count, potem z ewentualnego starego pola draws
  const drawsCount: number =
    typeof anyCycle.draw?.count === "number"
      ? anyCycle.draw.count
      : typeof anyCycle.draws === "number"
        ? anyCycle.draws
        : 0;

  // Lista zwycięzców – najpierw z draw.winners, potem z ewentualnego starego pola winners
  const winners: any[] = Array.isArray(anyCycle.draw?.winners)
    ? anyCycle.draw.winners
    : Array.isArray(anyCycle.winners)
      ? anyCycle.winners
      : [];

  if (drawsCount >= MAX_WINNERS) return false;
  if (c.participants.length <= winners.length) return false;

  return true;
}
