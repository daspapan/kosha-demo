import type { ReactNode } from "react";

/** The one container style. Title and action sit in the header row; a hint explains what the panel is for. */
export function Panel({ title, hint, action, children, className = "", tone = "plain" }: {
  title?: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: "plain" | "quiet";
}) {
  return (
    <section className={`rounded-[var(--radius-panel)] ${tone === "plain" ? "border border-line bg-surface" : "bg-[#eceef6]"} ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {hint && <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
