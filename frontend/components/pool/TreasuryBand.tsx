import type { Pool } from "@/lib/types";
import { inr, inrWords, pct } from "@/lib/format";

const POCKETS = [
  { key: "buffer", label: "Buffer", note: "Ready cash for withdrawals", color: "bg-buffer", text: "text-buffer" },
  { key: "gsec", label: "Government securities", note: "Earning the T-bill rate", color: "bg-gsec", text: "text-gsec" },
  { key: "loans", label: "Invoice loans", note: "Lent to members", color: "bg-loans", text: "text-[#9a6a0d]" },
] as const;

/** The pool as one band: where every rupee sits right now. */
export function TreasuryBand({ pool }: { pool: Pool }) {
  const bps = { buffer: pool.allocation.bufferBps, gsec: pool.allocation.gsecBps, loans: pool.allocation.invoiceBps };
  return (
    <div>
      <div className="band-grow flex h-14 w-full overflow-hidden rounded-xl sm:h-16" role="img"
        aria-label={`Buffer ${pct(bps.buffer)}, government securities ${pct(bps.gsec)}, invoice loans ${pct(bps.loans)}`}>
        {POCKETS.map((p) => bps[p.key] > 0 && (
          <div key={p.key} className={`${p.color} relative h-full`} style={{ width: `${bps[p.key] / 100}%` }}>
            {/* a woven texture, quiet, so the band reads as cloth rather than a chart */}
            <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "repeating-linear-gradient(135deg, #fff 0 2px, transparent 2px 9px)" }} />
          </div>
        ))}
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        {POCKETS.map((p) => (
          <div key={p.key} className="flex gap-3">
            <span className={`mt-1.5 size-3 shrink-0 rounded-sm ${p.color}`} aria-hidden />
            <div>
              <dt className="font-semibold">{p.label}</dt>
              <dd className="num text-[22px] font-bold leading-tight">{pct(bps[p.key])}</dd>
              <dd className="num text-sm text-ink-soft">{inr(pool.amounts[p.key])} <span className="text-ink-faint">({inrWords(pool.amounts[p.key])})</span></dd>
              <dd className="text-sm text-ink-faint">{p.note}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Each pocket against the limit the contract enforces. */
export function CapMeters({ pool }: { pool: Pool }) {
  const rows = [
    { label: "Buffer", value: pool.allocation.bufferBps, limit: pool.caps.bufferMinBps, kind: "min" as const, color: "bg-buffer",
      note: `Must stay at least ${pct(pool.caps.bufferMinBps)} after any move. Policy aims for ${pct(pool.caps.policyBufferMinBps)}.` },
    { label: "Government securities", value: pool.allocation.gsecBps, limit: pool.caps.gsecMaxBps, kind: "max" as const, color: "bg-gsec",
      note: `At most ${pct(pool.caps.gsecMaxBps)} of the pool.` },
    { label: "Invoice loans", value: pool.allocation.invoiceBps, limit: pool.caps.invoiceMaxBps, kind: "max" as const, color: "bg-loans",
      note: `At most ${pct(pool.caps.invoiceMaxBps)} in total, and ${pct(pool.caps.memberMaxBps)} for any one member.` },
  ];
  return (
    <ul className="space-y-5">
      {rows.map((r) => {
        const inside = r.kind === "min" ? r.value >= r.limit : r.value <= r.limit;
        return (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{r.label}</span>
              <span className={`num text-sm font-semibold ${inside ? "text-ok" : "text-danger"}`}>
                {pct(r.value)} {r.kind === "min" ? "of at least" : "of at most"} {pct(r.limit)}
              </span>
            </div>
            <div className="relative mt-2 h-2.5 rounded-full bg-[#eceef6]">
              <div className={`h-full rounded-full ${r.color}`} style={{ width: `${Math.min(100, r.value / 100)}%` }} />
              <div className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `${r.limit / 100}%` }} aria-hidden />
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">{r.note}</p>
          </li>
        );
      })}
    </ul>
  );
}
