"use client";

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-[var(--radius-control)] bg-[#eceef6] p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${value === t.id ? "bg-surface text-ink shadow-[0_1px_2px_rgba(30,42,94,.12)]" : "text-ink-soft hover:text-ink"}`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="num rounded-full bg-loans px-1.5 text-xs text-white">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
