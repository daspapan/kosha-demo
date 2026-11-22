import { CheckCircle2, XCircle } from "lucide-react";
import type { ProposalDetail } from "@/lib/types";
import { inr, pct } from "@/lib/format";

const LABEL: Record<string, string> = {
  tvlArc: "Pool size", bufferBps: "Buffer share", gsecBps: "G-sec share", invoiceBps: "Loan share", bufferArc: "Buffer amount", gsecArc: "G-sec amount",
  loansArc: "Loans outstanding", tbillAprBps: "T-bill yield", pendingRedemptionsArc: "Queued withdrawals", expected7dRedemptionsArc: "Expected withdrawals, 7 days",
  activeLoans: "Active loans", overdueLoans: "Overdue loans",
};
const show = (name: string, v: number | null) => (v === null ? "unknown" : name.endsWith("Bps") ? pct(v, 2) : name.endsWith("Arc") ? inr(v) : String(v));

/** Every number the AI quoted, next to what the chain actually says. */
export function Evidence({ p }: { p: ProposalDetail }) {
  const rows = p.validation.evidence ?? [];
  if (!rows.length) return <p className="text-ink-soft">This proposal cited no figures.</p>;
  return (
    <>
      {/* Phones: one row per figure, stacked */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((e) => (
          <li key={e.name} className="flex items-start justify-between gap-3 py-2.5 text-sm">
            <span>
              <span className="block font-semibold">{LABEL[e.name] ?? e.name}</span>
              <span className="num block text-ink-soft">AI said <b className={e.match ? "text-ink" : "text-danger"}>{show(e.name, e.cited)}</b>, chain says <b className="text-ink">{show(e.name, e.chain)}</b></span>
            </span>
            {e.match ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-label="Matches" /> : <XCircle className="size-5 shrink-0 text-danger" aria-label="Does not match" />}
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-line text-left text-ink-soft">
            <th className="py-2 pr-3 font-semibold">Figure</th>
            <th className="py-2 pr-3 text-right font-semibold">AI said</th>
            <th className="py-2 pr-3 text-right font-semibold">On the chain</th>
            <th className="py-2 text-right font-semibold"><span className="sr-only">Match</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.name} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-3">{LABEL[e.name] ?? e.name}</td>
              <td className={`num py-2.5 pr-3 text-right font-semibold ${e.match ? "" : "text-danger"}`}>{show(e.name, e.cited)}</td>
              <td className="num py-2.5 pr-3 text-right">{show(e.name, e.chain)}</td>
              <td className="py-2.5 text-right">
                {e.match ? <CheckCircle2 className="ml-auto size-5 text-ok" aria-label="Matches" /> : <XCircle className="ml-auto size-5 text-danger" aria-label="Does not match" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const RULE_PLAIN: Record<string, string> = {
  R1: "The proposal has exactly the expected fields",
  R2: "It uses fresh data (under 20 blocks old)",
  R3: "It saw the same data the backend reads",
  R4: "Every number it quotes is real",
  R5: "It starts from the real current split",
  R6: "The split adds up and the move goes the stated way",
  R7: "It stays inside the investment policy",
  R8: "It moves at most 10% in a day",
  R9: "The buffer still covers expected withdrawals",
  R10: "The AI is confident enough",
  R11: "The explanation has no links, addresses or instructions",
};

/** The validator's eleven rules, in plain words, with what failed. */
export function Rules({ p }: { p: ProposalDetail }) {
  const failed = new Map<string, string[]>();
  for (const v of p.validation.violations) failed.set(v.rule, [...(failed.get(v.rule) ?? []), v.msg]);
  const ids = Object.keys(RULE_PLAIN);
  return (
    <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {ids.map((id) => {
        const msgs = failed.get(id);
        const skipped = !msgs && !p.validation.passed.includes(id);
        return (
          <li key={id} className="flex gap-2 text-sm">
            {msgs ? <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : skipped ? <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-line" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />}
            <span>
              <span className={msgs ? "font-semibold text-danger" : ""}>{RULE_PLAIN[id]}</span>
              {msgs?.map((m) => <span key={m} className="block text-ink-soft">{m}</span>)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
