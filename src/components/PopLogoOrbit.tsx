// src/components/PopLogoOrbit.tsx
import React from "react";

export default function PopLogoOrbit() {
  return (
    <div className="flex flex-col items-center text-center gap-3 px-4 py-4 select-none">
      {/* Minimalistyczny znak POP33 */}
      <div className="relative flex items-center justify-center h-28 w-28 md:h-32 md:w-32 rounded-3xl bg-neutral-950 border border-neutral-700">
        <div className="flex flex-col items-center leading-none">
          <span className="text-[11px] font-semibold tracking-[0.32em] text-emerald-400 uppercase">
            pop
          </span>
          <span className="mt-1 text-3xl md:text-4xl font-extrabold tracking-[0.28em] text-emerald-50">
            33
          </span>
        </div>
      </div>

      {/* Podpis produktowy */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-medium tracking-[0.26em] uppercase text-neutral-400">
          pop33 miniapp
        </span>
        <span className="text-sm md:text-base font-semibold text-white">
          One click - one chance
        </span>
      </div>
    </div>
  );
}
