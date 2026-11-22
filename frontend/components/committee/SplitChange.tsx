import type { Split } from "@/lib/types";
import { pct } from "@/lib/format";

/** Before and after, as two thin bands, so the size of the change is visible at a glance. */
export function SplitChange({ from, to }: { from: Split; to: Split }) {
  const Band = ({ s, label }: { s: Split; label: string }) => (
    <div>
      <p className="mb-1 text-sm text-ink-soft">{label}</p>
      <div className="flex h-4 overflow-hidden rounded-md" aria-label={`${label}: buffer ${pct(s.bufferBps)}, G-secs ${pct(s.gsecBps)}, loans ${pct(s.invoiceBps)}`} role="img">
        <div className="bg-buffer" style={{ width: `${s.bufferBps / 100}%` }} />
        <div className="bg-gsec" style={{ width: `${s.gsecBps / 100}%` }} />
        <div className="bg-loans" style={{ width: `${s.invoiceBps / 100}%` }} />
      </div>
      <p className="num mt-1 text-sm">Buffer {pct(s.bufferBps)}, G-secs {pct(s.gsecBps)}, loans {pct(s.invoiceBps)}</p>
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Band s={from} label="Now" />
      <Band s={to} label="After this change" />
    </div>
  );
}
