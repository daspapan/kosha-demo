import type { ReactNode } from "react";

export function PageHead({ title, lead, action }: { title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[34px]">{title}</h1>
        {lead && <p className="mt-2 text-[17px] text-ink-soft">{lead}</p>}
      </div>
      {action}
    </div>
  );
}
