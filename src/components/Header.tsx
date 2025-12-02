// src/components/Header.tsx
import React from "react";
import { useNavigate } from "react-router-dom";


export default function Header() {
  const navigate = useNavigate();

  const goToDemoProd = () => navigate("/demo");
  const goToDemoDev = () => navigate("/demo?view=dev");

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
        {/* LEWA STRONA – prosty brand POP33 */}
        <div className="flex items-center gap-2">
          <span className="text-base sm:text-lg font-semibold tracking-tight text-slate-50">
            POP33
          </span>
          
        </div>


        {/* PRAWA STRONA – PRZYCISKI */}
        <div />
      </nav>
    </header>
  );
}
