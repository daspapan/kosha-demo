import { Countdown } from "@/components/ui/Countdown";
import type { OnChain } from "@/lib/types";
import { personName } from "@/lib/people";

/** A proposal's on-chain life. This is a real sequence, so numbered steps fit. */
export function Timeline({ onChain, chainNow }: { onChain: OnChain | null; chainNow: number }) {
  const s = onChain?.state ?? "not_submitted";
  const steps = [
    { label: "First committee signature", done: s !== "not_submitted" },
    { label: "Second signature schedules it", done: ["scheduled", "executed"].includes(s) || (s === "cancelled" && !!onChain?.readyAt) },
    { label: "24-hour wait, anyone on the committee can veto", done: s === "executed" || (s === "scheduled" && !!onChain?.readyAt && onChain.readyAt <= chainNow) },
    { label: "Runs on the chain", done: s === "executed" },
  ];
  return (
    <ol className="space-y-3">
      {steps.map((st, i) => (
        <li key={st.label} className="flex items-start gap-3">
          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${st.done ? "bg-ok text-white" : "bg-[#eceef6] text-ink-soft"}`}>{i + 1}</span>
          <span className="pt-0.5">
            <span className={st.done ? "font-semibold" : "text-ink-soft"}>{st.label}</span>
            {i === 2 && s === "scheduled" && onChain?.readyAt && onChain.readyAt > chainNow && (
              <span className="block text-sm text-gsec">Time left: <Countdown until={onChain.readyAt} chainNow={chainNow} /></span>
            )}
          </span>
        </li>
      ))}
      {!!onChain?.confirmedBy?.length && (
        <li className="text-sm text-ink-soft">Signed by {onChain.confirmedBy.map((a) => personName(a) ?? a.slice(0, 8)).join(" and ")}</li>
      )}
      {s === "cancelled" && <li className="rounded-[var(--radius-control)] bg-[#fbe6e4] px-3 py-2 text-sm text-danger">Vetoed by {personName(onChain?.cancelledBy) ?? "a committee member"}. It will never run.</li>}
    </ol>
  );
}
