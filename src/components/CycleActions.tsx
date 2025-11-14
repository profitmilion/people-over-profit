// src/components/CycleActions.tsx — OFFLINE + licznik postępu i seed
import { useState } from "react";
import { useCycles } from "../hooks/useCycles";

const MAX_PARTICIPANTS = 100;

export default function CycleActions() {
  const { cycles, joinFIFO, openNextAndJoin } = useCycles();
  const [err, setErr] = useState<string | null>(null);

  // najstarszy otwarty cykl
  const open = cycles.find(c => c.status === "open");
  const count = open?.participants.length ?? 0;
  const remaining = Math.max(0, MAX_PARTICIPANTS - count);
  const pct = Math.min(100, Math.round((count / MAX_PARTICIPANTS) * 100));

  function onJoinFIFO() {
    try { joinFIFO(fakeAddress()); setErr(null); }
    catch (e: any) { setErr(e?.message ?? "Błąd (offline)"); }
  }

  function onNextAndJoin() {
    try { openNextAndJoin(fakeAddress()); setErr(null); }
    catch (e: any) { setErr(e?.message ?? "Błąd (offline)"); }
  }

  // opcjonalny seed do testów (w dev)
  function seed(n: number) {
    for (let i = 0; i < n; i++) joinFIFO(fakeAddress(i));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Postęp cyklu */}
      <div className="mb-1">
        <div className="flex items-center justify-between text-xs text-[var(--text-dim)] mb-1">
          <span>Postęp cyklu</span>
          <span>{count}/{MAX_PARTICIPANTS}</span>
        </div>
        <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
          <div className="h-full bg-[var(--gold)]/80" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-xs text-[var(--text-dim)]">
          Do zamknięcia: {remaining}
        </div>
      </div>

      {/* Akcje */}
      <button
        onClick={onJoinFIFO}
        className="w-full rounded-2xl px-4 py-3 font-semibold bg-[var(--gold)]/90 text-black"
      >
        Dołącz
      </button>

      <button
        onClick={onNextAndJoin}
        className="w-full rounded-2xl px-4 py-3 font-semibold bg-neutral-800 text-[var(--text)] border border-neutral-700"
      >
        Kolejny udział
      </button>

      {/* Dev helper (widoczny tylko w trybie dev) */}
      {import.meta.env.DEV && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => seed(10)}
            className="flex-1 rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
            title="Dodaj 10 testowych uczestników"
          >
            +10 testowych
          </button>
          <button
            onClick={() => seed(100)}
            className="flex-1 rounded-xl px-3 py-2 text-xs bg-neutral-900 border border-neutral-700"
            title="Dodaj 100 testowych uczestników"
          >
            +100 testowych
          </button>
        </div>
      )}

      {err && <p className="text-sm text-red-400">{err}</p>}
      <p className="text-sm text-[var(--text-dim)]">Tryb OFFLINE — nic nie łączy się z portfelem</p>
    </div>
  );
}

// pseudo-adres do demo
function fakeAddress(suffix: number = 0) {
  const base = Date.now().toString(16).slice(-8);
  const rnd = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const suf = suffix ? suffix.toString(16).padStart(4, "0") : "";
  return ("0xDEMO" + base + rnd + suf).padEnd(42, "0").slice(0, 42);
}
