// src/components/Header.tsx
import React from "react";
import { Link } from "react-router-dom";


export default function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
        {/* LEWA STRONA – prosty brand POP33 */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-slate-50 no-underline shadow-sm transition-colors hover:border-slate-500 hover:bg-slate-800"
          aria-label="POP33 home"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-base sm:text-lg font-semibold tracking-[0.08em] text-slate-50">
            POP33
          </span>
        </Link>


        {/* PRAWA STRONA – PRZYCISKI */}
        <div />
      </nav>
    </header>
  );
}
