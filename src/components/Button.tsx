import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "pop";
  className?: string;
  children: ReactNode;
}

export function Button({
  children,
  variant = "default",
  className = "",
  ...props
}: ButtonProps) {
  // Baza wspólna dla wszystkich wariantów
  const base =
    "inline-flex items-center justify-center font-medium transition-all focus:outline-none active:scale-[0.98] disabled:opacity-50";

  // Style wariantów
  const styles =
    variant === "ghost"
      ? "px-3 py-1.5 rounded-lg text-sm bg-transparent border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-black"
      : variant === "pop"
      ? // Główny CTA POP IT
        "px-10 py-3.5 text-base rounded-full bg-gradient-to-r from-orange-500 to-orange-600 text-black shadow-lg shadow-orange-500/40 hover:scale-[1.03] hover:shadow-orange-500/60"
      : // Default
        "px-3 py-1.5 rounded-lg text-sm bg-[var(--gold)] text-black hover:bg-yellow-400";

  return (
    <button {...props} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

// Dzięki temu możesz używać zarówno:
// import Button from "../components/Button";
// jak i:
// import { Button } from "../components/Button";
export default Button;
