import { CheckCircle2, XCircle } from "lucide-react";
import type { Pool } from "@/lib/types";

const NICE: Record<string, string> = {
  "eINR held by the gateway": "e-Rupee held by the partner matches its bank record",
  "mARC supply": "Every ARC token is backed 1:1",
  "Vault TVL": "Pool value matches the event ledger",
  "Both RPC paths agree": "Two independent chain connections agree",
};

export function ReconcilerCard({ pool }: { pool: Pool }) {
  const r = pool.reconciler;
  if (!r) return <p className="text-ink-soft">The books have not been checked yet. The reconciler runs every minute in the demo.</p>;
  return (
    <div>
      <p className={`flex items-center gap-2 font-semibold ${r.ok ? "text-ok" : "text-danger"}`}>
        {r.ok ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
        {r.ok ? "The books agree" : "The books do not agree"}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        Checked at block {r.block}, {new Date(r.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.
        {!r.ok && " New deposits, allocations and loans were paused automatically."}
      </p>
      <ul className="mt-3 space-y-1.5">
        {r.details.map((d) => (
          <li key={d.name} className="flex items-start gap-2 text-sm">
            {d.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
            <span>{NICE[d.name] ?? d.name}{d.error ? `: ${d.error}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
