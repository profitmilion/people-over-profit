// src/components/SectionFrame.tsx
import React from "react";

type SectionFrameProps = {
  children: React.ReactNode;
  className?: string;
};

export const SectionFrame: React.FC<SectionFrameProps> = ({ children, className = "" }) => {
  return (
    <section
      className={
        [
          // bazowy styl ramki
          "border border-slate-700 rounded-2xl",
          "bg-slate-900/60",
          "p-4 sm:p-6 lg:p-8",
          "shadow-md",
          className,
        ].join(" ")
      }
    >
      {children}
    </section>
  );
};
