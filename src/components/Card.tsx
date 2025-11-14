import React from "react";

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-[var(--card)] p-4 shadow-sm">
      {children}
    </div>
  );
}
