import React from "react";

export default function LandingView() {
  return (
    <div className="min-h-screen bg-black text-[#8AFF70] flex items-center justify-center px-4 py-6 font-mono">
      {/* „Ekran” w stylu starego monitora */}
      <div className="w-full max-w-sm scanlines crt-noise rounded-[18px] border border-[#8AFF70]/60 bg-black/95 shadow-[0_0_32px_rgba(0,255,80,0.35)]">
        <div className="px-4 py-3 border-b border-[#8AFF70]/40 flex items-center justify-between text-[0.65rem]">
          <span>POP33 v0.1</span>
          <span className="uppercase tracking-[0.2em] text-[#8AFF70]/80">
            demo
          </span>
        </div>

        {/* Wnętrze „terminala” */}
        <main className="px-4 py-4 space-y-4 text-xs leading-relaxed">
          {/* „Logo” w stylu ASCII */}
          <section className="space-y-2">
            <p className="text-[0.7rem] text-[#8AFF70]/70">
              // PEOPLE OVER PROFIT SYSTEM
            </p>
            <pre className="text-[0.7rem] whitespace-pre text-[#8AFF70]">
{String.raw`   ____   ___  ____  ____
  |  _ \ / _ \|  _ \|  _ \
  | |_) | | | | |_) | |_) |
  |  __/| |_| |  __/|  __/
  |_|    \___/|_|   |_|  `}
            </pre>
            <p className="text-[0.7rem] text-[#8AFF70]/80">
              POP33 · DAILY CROWDFUNDING DRAW · DEMO MODE
            </p>
          </section>

          {/* Krótki opis w formie „logów” */}
          <section className="border-y border-dashed border-[#8AFF70]/40 py-3 space-y-1">
            <TerminalLine label="INFO" value="Eksperymentalny cykl crowdfundingu & losowania." />
            <TerminalLine label="MODE" value="Wersja demonstracyjna · brak prawdziwych depozytów." />
            <TerminalLine label="LIMIT" value="Max 100 uczestników na cykl demo." />
            <TerminalLine label="STATUS" value="CYKL OTWARTY · OCZEKIWANIE NA UCZESTNIKÓW..." />
          </section>

          {/* „Menu” jak w starych grach */}
          <section className="space-y-2">
            <p className="text-[0.7rem] text-[#8AFF70]/80">
              // SELECT ACTION:
            </p>

            <button
              className="w-full rounded border border-[#8AFF70] bg-black/80 px-3 py-2 text-left text-[0.75rem]
                         hover:bg-[#8AFF70]/10 active:bg-[#8AFF70]/20 transition-colors"
            >
              &gt; [ENTER] DOŁĄCZ DO DEMO CYKLU
            </button>

            <button
              className="w-full rounded border border-[#8AFF70]/50 bg-black/60 px-3 py-2 text-left text-[0.75rem]
                         hover:bg-[#8AFF70]/10 active:bg-[#8AFF70]/15 transition-colors"
            >
              &gt; [H] JAK TO DZIAŁA (KRÓTKA INSTRUKCJA)
            </button>
          </section>

          {/* Stopka jak komunikat systemowy */}
          <footer className="pt-3 border-t border-dotted border-[#8AFF70]/40 text-[0.65rem] text-[#8AFF70]/70">
            [SYSTEM] TO JEST WERSJA DEMONSTRACYJNA. BRAK PRAWDZIWYCH WYGRANYCH.
            CEL: TESTOWANIE KONCEPCJI I LOGIKI POP33.
          </footer>
        </main>
      </div>
    </div>
  );
}

type TerminalLineProps = {
  label: string;
  value: string;
};

function TerminalLine({ label, value }: TerminalLineProps) {
  return (
    <p>
      <span className="text-[#8AFF70]/60">{label.padEnd(6, " ")}:</span>{" "}
      <span>{value}</span>
    </p>
  );
}
