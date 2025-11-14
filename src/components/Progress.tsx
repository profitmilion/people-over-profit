export function Progress({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="w-full h-3 rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden">
      <div
        className="h-full bg-[var(--gold)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
