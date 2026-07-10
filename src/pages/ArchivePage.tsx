// src/pages/ArchivePage.tsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Disclosure } from "@headlessui/react";
import { useCycles } from "../hooks/useCycles";
import type { Cycle, DrawInfo } from "../types/core";

type CycleWithLegacyWinners = Cycle & { winners?: string[] };

// Prosty formatter daty – taki sam jak w ProdView
function fmt(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

// Skracanie ID użytkownika – taki sam schemat jak w ProdView
function shortenUserId(id: string, len = 4) {
  if (!id) return "";
  if (id.length <= len * 2) return id;
  return id.slice(0, len) + "…" + id.slice(-len);
}

// Pomocniczo: numer cyklu z ID typu "C-0001"
function parseCycleNumber(id: string): number {
  const m = /^C-(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

// Zbiór unikalnych zwycięzców danego cyklu, liczone na podstawie:
// - cycle.drawHistory[].winners
// - opcjonalnie cycle.winners (legacy / finalWinners)
function getCycleWinnersStats(c: Cycle) {
  const cycle = c as CycleWithLegacyWinners;
  const drawHistory: DrawInfo[] = cycle.drawHistory ?? [];
  const finalWinners = cycle.winners ?? [];

  const unique = new Set<string>();

  if (Array.isArray(drawHistory)) {
    for (const d of drawHistory) {
      if (Array.isArray(d?.winners)) {
        d.winners.forEach((w: string) => unique.add(w));
      }
    }
  }

  if (Array.isArray(finalWinners)) {
    finalWinners.forEach((w: string) => unique.add(w));
  }

  const winnersArray = Array.from(unique);

  const drawsCount =
    Array.isArray(drawHistory) && drawHistory.length > 0
      ? drawHistory.length
      : Array.isArray(finalWinners) && finalWinners.length > 0
      ? 1
      : 0;

  const hasDrawHistory =
    Array.isArray(drawHistory) && drawHistory.length > 0;
  const hasFinalWinners =
    Array.isArray(finalWinners) && finalWinners.length > 0;

  return {
    winnersArray,
    winnersCount: winnersArray.length,
    drawsCount,
    drawHistory,
    finalWinners,
    hasDrawHistory,
    hasFinalWinners,
  };
}

// TU ZMIANA: eksport nazwany
export const ArchivePage: React.FC = () => {
  const { cycles } = useCycles();

  // Sortujemy wszystkie cykle po numerze (najnowsze na górze)
  const sortedCycles = useMemo(() => {
    return [...cycles].sort((a, b) => {
      const aNum = parseCycleNumber(String(a.id));
      const bNum = parseCycleNumber(String(b.id));
      return bNum - aNum;
    });
  }, [cycles]);

  return (
    <div className="mx-auto max-w-4xl p-4 space-y-6">
      <header className="flex flex-col items-center text-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">
          POP33 – full archive
        </h1>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-2xl">
          This page shows the full simulation archive of all cycles in this
          POP33 demo. It is meant for transparency, auditing, and testing of the
          draw logic.
        </p>

        <div className="mt-1 text-[11px] text-neutral-500">
          <Link
            to="/demo"
            className="underline text-neutral-200 hover:text-white"
          >
            ← Back to demo view
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-neutral-800 p-4 bg-neutral-950/40 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm text-neutral-100">
            Total cycles in archive:{" "}
            <span className="font-semibold">{sortedCycles.length}</span>
          </div>
          <div className="text-[11px] text-neutral-500">
            Each cycle may contain multiple draws. Winners are calculated as
            unique user IDs across all draws in a cycle.
          </div>
        </div>
      </section>

      {sortedCycles.length === 0 ? (
        <div className="text-sm text-neutral-400 text-center">
          No cycles in archive yet.
        </div>
      ) : (
        <section className="space-y-3">
          {sortedCycles.map((c) => {
            const {
              winnersArray,
              winnersCount,
              drawsCount,
              drawHistory,
              finalWinners,
              hasDrawHistory,
              hasFinalWinners,
            } = getCycleWinnersStats(c as Cycle);

            return (
              <Disclosure key={c.id}>
                {({ open }) => (
                  <div
                    className="rounded-2xl border border-neutral-800 overflow-hidden"
                    style={{ backgroundColor: "transparent" }}
                  >
                    {/* GŁÓWNY NAGŁÓWEK CYKLU */}
                    <Disclosure.Button
                      className="w-full px-3 py-2 sm:px-4 sm:py-3 flex items-center justify-center hover:bg-neutral-900 transition-colors"
                      style={{
                        backgroundColor: "transparent",
                        color: "#e5e7eb",
                      }}
                    >
                      <div className="flex flex-col gap-0.5 text-left">
                        <span className="font-mono text-sm">{c.id}</span>
                        <span className="opacity-80">
                          Participants: {c.participants.length}/
                          {c.maxParticipants}
                        </span>
                        <span className="opacity-80">
                          Status: {c.status}
                        </span>
                        <span className="opacity-80">
                          Draws in this cycle: {drawsCount}
                        </span>
                        <span className="opacity-80">
                          Unique winners in this cycle: {winnersCount}
                        </span>
                        {c.openedAt && (
                          <span className="opacity-70 text-[11px]">
                            Opened at: {fmt(c.openedAt)}{" "}
                            {c.closedAt && (
                              <>
                                {" | "}Closed at: {fmt(c.closedAt)}
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      <span
                        className={
                          "ml-3 text-[11px] opacity-70 transition-transform duration-150 " +
                          (open ? "rotate-180" : "")
                        }
                      >
                        ▼
                      </span>
                    </Disclosure.Button>

                    {/* PANEL SZCZEGÓŁÓW */}
                    <Disclosure.Panel
                      className="border-t border-neutral-800 px-3 py-3 text-xs space-y-3"
                      style={{ backgroundColor: "transparent" }}
                    >
                      {/* HISTORIA LOSOWAŃ – tak jak w ProdView */}
                      {hasDrawHistory && (
                        <div className="space-y-2">
                          <div className="opacity-80">
                            Winners history (all draws in this cycle):
                          </div>
                          <div className="flex flex-col gap-2">
                            {drawHistory.map((d: DrawInfo) => (
                              <div
                                key={`${d.cycleId}-${d.drawIndex}-${d.drawnAt}`}
                                className="border border-neutral-800 rounded-xl p-2"
                                style={{ backgroundColor: "transparent" }}
                              >
                                <div className="opacity-80">
                                  Draw #{d.drawIndex ?? "?"} (
                                  {fmt(d.drawnAt)})
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {Array.isArray(d.winners) &&
                                    d.winners.map((w: string) => (
                                      <span
                                        key={w}
                                        className="font-mono text-[11px] border border-neutral-700 rounded px-1 py-0.5 text-neutral-200"
                                      >
                                        {shortenUserId(w)}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* LEGACY: tylko finalWinners bez drawHistory */}
                      {!hasDrawHistory && hasFinalWinners && (
                        <div className="space-y-2">
                          <div className="opacity-80">
                            Cycle winners (final result):
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {finalWinners.map((w: string) => (
                              <span
                                key={w}
                                className="font-mono text-[11px] border border-neutral-700 rounded px-1 py-0.5 text-neutral-200"
                              >
                                {shortenUserId(w)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* BRAK DANYCH O ZWYCIĘZCACH */}
                      {!hasDrawHistory && !hasFinalWinners && (
                        <div className="mt-2 text-xs opacity-60">
                          No recorded winner data for this cycle (older data or
                          demo test cycle).
                        </div>
                      )}

                      {/* ZBIORCZA LISTA UNIKALNYCH ZWYCIĘZCÓW */}
                      {winnersArray.length > 0 && (
                        <div className="pt-2 border-t border-neutral-800 mt-3 space-y-1">
                          <div className="opacity-80">
                            Unique winners in this cycle (
                            {winnersArray.length}):
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {winnersArray.map((w) => (
                              <span
                                key={w}
                                className="font-mono text-[11px] border border-neutral-700 rounded px-1 py-0.5 text-neutral-200"
                              >
                                {shortenUserId(w)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </Disclosure.Panel>
                  </div>
                )}
              </Disclosure>
            );
          })}
        </section>
      )}
    </div>
  );
};

// eksport domyślny, jeśli gdzieś jest używany
export default ArchivePage;
