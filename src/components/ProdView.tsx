// src/components/ProdView.tsx
import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useCycles } from "../hooks/useCycles";
import { Disclosure } from "@headlessui/react";

const MAX_PARTICIPANTS = 100;
const MAX_USER_CYCLES = 10;

// Simple date formatter (same as in DevPanel)
function fmt(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

// Shorten user ID for readability
function shortenUserId(id: string, len = 4) {
  if (!id) return "";
  if (id.length <= len * 2) return id;
  return id.slice(0, len) + "…" + id.slice(-len);
}

export default function ProdView() {
  const { smartJoin, smartJoinStatus, cycles, getOrCreateUserId, openCycle } = useCycles();

  const userId = useMemo(() => getOrCreateUserId(), [getOrCreateUserId]);

  // local clock for countdowns (same idea as DevPanel)
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // cycles where the user has at least one ticket (including historical)
  const userCycles = useMemo(() => {
    return cycles.filter((c) => c.participants.some((p) => p.userId === userId));
  }, [cycles, userId]);

  const totalUserCycles = userCycles.length;

  // How many cycles we show in "Your cycles" panel (latest list)
  const MAX_VISIBLE_USER_CYCLES = 11;

  // How many archived cycles we show in the archive accordion (under "Show older drawings")
  const MAX_VISIBLE_ARCHIVED_CYCLES = 22;

  // Visible cycles in UI – max 11, newest at the top
  const visibleUserCycles =
    totalUserCycles <= MAX_VISIBLE_USER_CYCLES
      ? [...userCycles].reverse()
      : userCycles.slice(-MAX_VISIBLE_USER_CYCLES).reverse();

  // Archived cycles – everything older than the last 11 (rest of user cycles)
  const archivedUserCycles =
    totalUserCycles > MAX_VISIBLE_USER_CYCLES
      ? userCycles.slice(0, totalUserCycles - MAX_VISIBLE_USER_CYCLES).reverse()
      : [];

  // Cycles we actually render inside the Archive accordion (max 22)
  const archiveDisplayCycles =
    archivedUserCycles.length > MAX_VISIBLE_ARCHIVED_CYCLES
      ? archivedUserCycles.slice(0, MAX_VISIBLE_ARCHIVED_CYCLES)
      : archivedUserCycles;

  // Czy mamy więcej archiwalnych cykli niż pokazujemy w accordionie
  const hasMoreArchivedThanDisplayed = archivedUserCycles.length > MAX_VISIBLE_ARCHIVED_CYCLES;

  // ONLY ACTIVE cycles count toward the limit (status not "finished")
  const activeUserCycles = useMemo(
    () => userCycles.filter((c) => c.status !== "finished").length,
    [userCycles]
  );

  const hasReachedUserLimit = activeUserCycles >= MAX_USER_CYCLES;

  const alreadyInOpenCycle = !!openCycle?.participants.some((p) => p.userId === userId);
  const isOpenCycleFull =
    (openCycle?.participants.length ?? 0) >= (openCycle?.maxParticipants ?? MAX_PARTICIPANTS);

  // Global system limit (from smartJoinStatus)
  const blockedBySystemLimit =
    smartJoinStatus.kind === "BLOCKED" && smartJoinStatus.reason === "LIMIT_REACHED";

  const canJoinByStatus = smartJoinStatus.kind === "READY";

  // Decide if the main button should be enabled
  const joinDisabled = hasReachedUserLimit || !canJoinByStatus;

  // Tooltip text for the button
  let joinTitle = "Join the draw";
  if (hasReachedUserLimit) {
    joinTitle = `You reached the limit of ${MAX_USER_CYCLES} active cycles. Please wait until some of them finish.`;
  } else if (blockedBySystemLimit) {
    joinTitle = "The system reached the limit of open cycles. Please wait for the next round.";
  } else if (!openCycle && smartJoinStatus.kind === "READY") {
    joinTitle = "You will join a new cycle as soon as it opens.";
  }

  // =========================
  // COLORS map:
  // 0/10   -> green (start)
  // 1–9/10 -> orange (active)
  // 10/10  -> red (user limit)
  // SYSTEM LIMIT -> red (priority)
  // =========================

  let statusText = "";
  let statusLabel = "";
  let indicatorColor = "#6b7280"; // gray

  if (blockedBySystemLimit) {
    statusLabel = "System limit";
    statusText = "The system reached the limit of open cycles. Please wait for the next round.";
    indicatorColor = "#ef4444"; // red
  } else if (hasReachedUserLimit) {
    statusLabel = "User limit";
    statusText = `You have ${activeUserCycles}/${MAX_USER_CYCLES} active cycles. This is the maximum limit in this demo.`;
    indicatorColor = "#ef4444"; // red
  } else if (activeUserCycles > 0) {
    statusLabel = "Active";
    statusText = `You have ${activeUserCycles}/${MAX_USER_CYCLES} active cycles. You can still join new ones.`;
    indicatorColor = "#f97316"; // orange
  } else {
    statusLabel = "Ready";
    statusText = "You are not in any cycle yet. You can join your first one.";
    indicatorColor = "#22c55e"; // green
  }

  // Button colors follow the status
  let buttonBg = indicatorColor;
  let buttonBorder = indicatorColor;
  let buttonText = "#000000";
  let buttonCursor: "pointer" | "not-allowed" = "pointer";
  let buttonOpacity = 1;

  if (joinDisabled) {
    buttonCursor = "not-allowed";
    buttonOpacity = 0.6;
    buttonText = "#000000";
  }

  const joinButtonStyle = {
    backgroundColor: buttonBg,
    borderColor: buttonBorder,
    color: buttonText,
    cursor: buttonCursor,
    opacity: buttonOpacity,
  } as const;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      {/* Header – simple, product-style, no fake logo */}
      <header className="flex flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">POP33 DEMO</h1>
        <p className="text-xs sm:text-sm text-neutral-400">
          Daily draw simulator - up to {MAX_USER_CYCLES} active tickets per user.
        </p>

        <div className="mt-2 text-xs sm:text-sm text-neutral-400">
          <div>
            Your user ID:{" "}
            <span className="font-mono text-neutral-200">{userId}</span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            This ID is local to this demo and stored only in your browser.
          </div>
        </div>
      </header>

      {/* Subscription status / high-level info (DEMO placeholder) */}
      <section className="rounded-2xl border border-neutral-800 p-4 space-y-2 bg-neutral-950/40">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-300">Subscription status</h2>
        <p className="text-sm text-neutral-100">
          Your monthly subscription gives you priority access to the 1,000,000 prize pool. Each ticket represents a
          verified on-chain opportunity available only to active subscribers. You can hold up to{" "}
          <span className="font-semibold">{MAX_USER_CYCLES}</span> tickets. Each ticket unlocks a full set of{" "}
          <span className="font-semibold">30 upcoming draws</span>, activated once its participant pool is complete.
          The more tickets you hold, the more parallel draw sets you participate in - each with its own independent
          chance to win.
        </p>
      </section>

      {/* CURRENT CYCLE */}
      <section className="rounded-2xl border border-neutral-800 p-4 space-y-4 bg-neutral-950/40">
        <div className="flex flex-col items-center gap-1">
          <div className="text-lg font-semibold text-center">Current open cycle</div>
          {openCycle && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-700 text-neutral-300">
              ID: <span className="font-mono">{openCycle.id}</span>
            </span>
          )}
        </div>

        {openCycle ? (
          <div className="text-sm opacity-80 text-center">
            Participants: {openCycle.participants.length}/{openCycle.maxParticipants}
          </div>
        ) : (
          <div className="text-sm opacity-80 text-center">No open cycle</div>
        )}

        {/* Smart button + status */}
        <div className="mt-2 flex flex-col items-center gap-4">
          <button
            onClick={smartJoin}
            disabled={joinDisabled}
            title={joinTitle}
            style={{
              ...joinButtonStyle,
              width: "80px",
              height: "80px",
              borderRadius: "9999px",
              padding: 0,
            }}
            className="flex items-center justify-center font-semibold text-sm border transition duration-200 text-black select-none"
          >
            POP IT
          </button>

          <div className="flex flex-col items-center gap-2 text-xs text-center">
            <span className="font-semibold uppercase tracking-wide text-[11px]" style={{ color: indicatorColor }}>
              {statusLabel}
            </span>

            <span className="opacity-80 max-w-xl">{statusText}</span>

            {/* Color legend */}
            <div className="mt-3 w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 text-[11px] text-neutral-300 space-y-2">
              <p className="font-semibold text-neutral-200">Button colors</p>

              <div className="flex flex-col gap-1.5 text-left">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span>green – start, 0/10 tickets, you have not joined yet</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                  <span>orange – active participation, 1–9/10 tickets</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span>red – system limit reached (no room for new cycles)</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-neutral-500" />
                  <span>gray – your personal limit 10/10 reached, button is disabled</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Helper info about the current cycle for the user */}
        {alreadyInOpenCycle && (
          <div className="mt-2 text-xs text-emerald-400 text-center">
            You already have an entry in the current open cycle.
          </div>
        )}
        {isOpenCycleFull && openCycle && (
          <div className="mt-1 text-xs text-amber-400 text-center">
            The current cycle is full. The system will open a new cycle when possible.
          </div>
        )}
      </section>

      {/* YOUR CYCLES – accordion + archive */}
      <section className="rounded-2xl border border-neutral-800 p-4 pb-10 space-y-4 bg-neutral-950/40">
        <div className="flex flex-col items-center gap-1">
          <div className="text-lg font-semibold text-center">Your cycles</div>

          {activeUserCycles > 0 && (
            <div className="text-xs opacity-80 text-center">
              Active cycles: {activeUserCycles}/{MAX_USER_CYCLES}
            </div>
          )}
        </div>

        {totalUserCycles > 0 ? (
          <div className="space-y-3">
            <div className="text-[11px] sm:text-xs text-neutral-400 text-center">
              Below you can see all cycles where you had at least one ticket. Newer cycles are shown at the top.
              Older ones are grouped in the archive section for full auditability.
            </div>

            {hasReachedUserLimit && (
              <div className="text-xs text-amber-400 text-center">
                You reached the maximum number of active cycles in this demo ({MAX_USER_CYCLES}). Once some cycles
                finish, you will be able to join new ones.
              </div>
            )}

            {/* Visible (latest) cycles – accordion per cycle, max 11 */}
            <div className="space-y-2">
              {visibleUserCycles.map((c, index) => {
                const now = nowTick;

                const drawHistory = (c as any).drawHistory || [];
                const hasDrawHistory = Array.isArray(drawHistory) && drawHistory.length > 0;

                const finalWinners = (c as any).winners || [];
                const hasFinalWinners = Array.isArray(finalWinners) && finalWinners.length > 0;

                const hasNextDraw = c.nextDrawAt && c.nextDrawAt > now;
                const nextLeft = hasNextDraw ? Math.ceil(((c.nextDrawAt as number) - now) / 1000) : 0;

                const isOpen = c.status === "open";
                const isFinished = c.status === "finished";

                const baseStatusText =
                  isOpen
                    ? "Open"
                    : hasNextDraw
                      ? "Closed – waiting for the next draw"
                      : isFinished && (hasDrawHistory || hasFinalWinners)
                        ? "Finished – draws completed"
                        : isFinished
                          ? "Finished"
                          : c.status;

                return (
                  <Disclosure key={c.id} defaultOpen={index === 0 || isOpen}>
                    {({ open }) => (
                      <div
                        className="rounded-xl border border-neutral-800 overflow-hidden"
                        style={{ backgroundColor: "transparent" }}
                      >
                        {/* MAIN HEADER OF CYCLE – clickable, dark background */}
                        <Disclosure.Button
                          className="w-full px-3 py-2 sm:px-4 sm:py-3 flex items-center justify-between text-left hover:bg-neutral-900 transition-colors"
                          style={{ backgroundColor: "transparent", color: "#e5e7eb" }}
                        >
                          <div className="flex flex-col gap-0.5 text-left">
                            <span className="font-mono text-sm">{c.id}</span>
                            <span className="opacity-80">
                              Participants: {c.participants.length}/{c.maxParticipants}
                            </span>
                            <span className="opacity-80">Status: {baseStatusText}</span>
                            {hasNextDraw && (
                              <span className="opacity-80">
                                Next draw: {fmt(c.nextDrawAt as number)}
                                {nextLeft > 0 && (
                                  <span className="opacity-70"> – ~{nextLeft}s left</span>
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

                        {/* DETAILS PANEL – winners history etc. */}
                        <Disclosure.Panel
                          className="border-t border-neutral-800 px-3 py-3 text-xs space-y-3"
                          style={{ backgroundColor: "transparent" }}
                        >
                          {hasDrawHistory && (
                            <div className="space-y-2">
                              <div className="opacity-80">Winners history (all draws in this cycle):</div>
                              <div className="flex flex-col gap-2">
                                {drawHistory.map((d: any) => {
                                  const youWonHere =
                                    Array.isArray(d.winners) && d.winners.includes(userId);

                                  return (
                                    <div
                                      key={`${d.cycleId}-${d.drawIndex}-${d.drawnAt}`}
                                      className="border border-neutral-800 rounded-xl p-2"
                                      style={{ backgroundColor: "transparent" }}
                                    >
                                      <div className="opacity-80">
                                        Draw #{d.drawIndex ?? "?"} ({fmt(d.drawnAt)})
                                      </div>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {d.winners.map((w: string) => (
                                          <span
                                            key={w}
                                            className={
                                              "font-mono text-[11px] border rounded px-1 py-0.5 " +
                                              (w === userId
                                                ? "border-emerald-500 text-emerald-400"
                                                : "border-neutral-700 text-neutral-200")
                                            }
                                          >
                                            {shortenUserId(w)}
                                            {w === userId ? " (you)" : ""}
                                          </span>
                                        ))}
                                      </div>
                                      {youWonHere && (
                                        <div className="mt-1 text-[11px] text-emerald-400">
                                          In this draw you are a winner (simulation).
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {!hasDrawHistory && hasFinalWinners && (
                            <div className="space-y-2">
                              <div className="opacity-80">Cycle winners (final result):</div>
                              <div className="flex flex-wrap gap-1">
                                {finalWinners.map((w: string) => (
                                  <span
                                    key={w}
                                    className={
                                      "font-mono text-[11px] border rounded px-1 py-0.5 " +
                                      (w === userId
                                        ? "border-emerald-500 text-emerald-400"
                                        : "border-neutral-700 text-neutral-200")
                                    }
                                  >
                                    {shortenUserId(w)}
                                    {w === userId ? " (you)" : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {isFinished && !hasDrawHistory && !hasFinalWinners && !hasNextDraw && (
                            <div className="mt-2 text-xs opacity-60">
                              Finished – no recorded winner data (older cycle or demo data).
                            </div>
                          )}
                        </Disclosure.Panel>
                      </div>
                    )}
                  </Disclosure>
                );
              })}
            </div>

            {/* ARCHIVE SECTION – older cycles with winners (max 22 shown) */}
            {archivedUserCycles.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs text-neutral-400">
                  Archive ({archivedUserCycles.length} older cycles)
                </div>

                <Disclosure>
                  {({ open }) => (
                    <>
                      <Disclosure.Button
                        className="w-full text-left text-xs sm:text-sm px-3 py-2 rounded-lg border border-neutral-800 hover:bg-neutral-900/80 transition-colors flex items-center justify-between"
                        style={{ backgroundColor: "transparent" }}
                      >
                        <span>Show older drawings (archive)</span>
                        <span
                          className={
                            "ml-3 text-[11px] opacity-70 transition-transform duration-150 " +
                            (open ? "rotate-180" : "")
                          }
                        >
                          ▼
                        </span>
                      </Disclosure.Button>

                      <Disclosure.Panel className="mt-2 space-y-2 text-xs">
                        {archiveDisplayCycles.map((c) => {
                          const drawHistory = (c as any).drawHistory || [];
                          const hasDrawHistory = Array.isArray(drawHistory) && drawHistory.length > 0;
                          const finalWinners = (c as any).winners || [];
                          const hasFinalWinners = Array.isArray(finalWinners) && finalWinners.length > 0;

                          return (
                            <div
                              key={c.id}
                              className="rounded-lg border border-neutral-800 px-3 py-2 flex flex-col gap-1"
                              style={{ backgroundColor: "transparent" }}
                            >
                              <span className="font-mono text-[11px] break-all">
                                {c.id}
                              </span>
                              <span className="opacity-80">
                                Participants: {c.participants.length}/{c.maxParticipants}
                              </span>
                              <span className="opacity-70">Status: {c.status}</span>

                              {hasDrawHistory && (
                                <div className="mt-1 space-y-1">
                                  <div className="opacity-80">Winners history:</div>
                                  <div className="flex flex-col gap-1">
                                    {drawHistory.map((d: any) => (
                                      <div
                                        key={`${d.cycleId}-${d.drawIndex}-${d.drawnAt}`}
                                        className="border border-neutral-800 rounded-lg p-1"
                                        style={{ backgroundColor: "transparent" }}
                                      >
                                        <div className="opacity-80">
                                          Draw #{d.drawIndex ?? "?"} ({fmt(d.drawnAt)})
                                        </div>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {d.winners.map((w: string) => (
                                            <span
                                              key={w}
                                              className="font-mono text-[10px] border border-neutral-700 rounded px-1 py-0.5 text-neutral-200"
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

                              {!hasDrawHistory && hasFinalWinners && (
                                <div className="mt-1 space-y-1">
                                  <div className="opacity-80">Cycle winners:</div>
                                  <div className="flex flex-wrap gap-1">
                                    {finalWinners.map((w: string) => (
                                      <span
                                        key={w}
                                        className="font-mono text-[10px] border border-neutral-700 rounded px-1 py-0.5 text-neutral-200"
                                      >
                                        {shortenUserId(w)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* jeśli w archiwum jest więcej niż 22 cykle – link do pełnego archiwum */}
                        {hasMoreArchivedThanDisplayed && (
                          <div className="mt-2 text-[11px] text-neutral-300 text-center">
                            Older cycles are available in the full POP33 archive.{" "}
                            <Link
                              to="/archive"
                              className="inline-flex items-center gap-1 underline text-neutral-100 hover:text-white"
                            >
                              Open full archive
                              <span aria-hidden>→</span>
                            </Link>
                          </div>
                        )}

                      </Disclosure.Panel>
                    </>
                  )}
                </Disclosure>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm opacity-70 text-center">You have not joined any cycle yet.</div>
        )}
      </section>

      {/* FOOTER – simple demo disclaimer */}
      <footer className="mt-6 text-[11px] text-center text-neutral-500">
        POP33 DEMO – simulation only, no real funds or prizes.
        <br className="hidden sm:block" />
        Prototype UI for the future on-chain lottery experience.
      </footer>
    </div>
  );
}
