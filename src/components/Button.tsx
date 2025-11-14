import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost";
  className?: string;
  children: ReactNode;
}

export function Button({
  children,
  variant = "default",
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus:outline-none active:scale-[0.99]";
  const styles =
    variant === "ghost"
      ? "bg-transparent border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-black disabled:opacity-50"
      : "bg-[var(--gold)] text-black hover:bg-yellow-400 disabled:opacity-50";

  return (
    <button {...props} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}
