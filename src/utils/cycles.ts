// src/utils/cycles.ts
import type { Cycle, UserId } from "../types/core";

// Limity wersji demo (OFFLINE)
const MAX_DRAWS_PER_CYCLE = 3;

/**
 * Czy można wykonać kolejne losowanie w cyklu:
 * - cykl musi być w fazie losowań ("drawing")
 * - nie może przekroczyć limitu losowań w cyklu
 * - musi istnieć przynajmniej jeden uczestnik, który jeszcze nie wygrał
 */
export function canDraw(c: Cycle): boolean {
  if (!c) return false;

  // Losowania wykonujemy tylko w fazie "drawing"
  if (c.status !== "drawing") return false;

  const participants = Array.isArray(c.participants) ? c.participants : [];
  if (participants.length === 0) return false;

  // Liczba wykonanych losowań – źródło prawdy to drawHistory
  const history = Array.isArray(c.drawHistory) ? c.drawHistory : [];
  const drawsCount = history.length;

  if (drawsCount >= MAX_DRAWS_PER_CYCLE) return false;

  // Zbieramy wszystkich, którzy już wygrali w tym cyklu (po całej historii)
  const alreadyWon = new Set<UserId>();
  for (const d of history) {
    if (Array.isArray(d?.winners)) {
      for (const w of d.winners) alreadyWon.add(w);
    }
  }

  // Czy jest jeszcze ktoś, kto może wygrać?
  const hasCandidate = participants.some((p) => !alreadyWon.has(p.userId));
  if (!hasCandidate) return false;

  return true;
}
