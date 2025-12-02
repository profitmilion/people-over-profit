// src/components/Header.tsx
import React from "react";
import { useNavigate } from "react-router-dom";
import PopLogoOrbit from "./PopLogoOrbit";

export default function Header() {
  const navigate = useNavigate();

  const goToDemoProd = () => navigate("/demo");
  const goToDemoDev = () => navigate("/demo?view=dev");

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
        {/* LEWA STRONA – LOGO POP33 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <PopLogoOrbit />
          </div>
        </div>

        {/* PRAWA STRONA – PRZYCISKI */}
        <div className="flex items-center gap-2">
          <button
            className="hidden sm:inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-900 transition"
            onClick={goToDemoDev}
          >
            Zobacz jak to działa
          </button>
          <button
            className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition"
            onClick={goToDemoProd}
          >
            Wejdź do wersji DEMO
          </button>
        </div>
      </nav>
    </header>
  );
}
