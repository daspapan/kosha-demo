import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { inr } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export const INVOICE_STATUS: Record<Invoice["status"], { label: string; tone: Tone }> = {
  verified: { label: "Checks passed", tone: "ok" },
  flagged: { label: "Needs a person to review", tone: "warn" },
  rejected: { label: "Not accepted", tone: "danger" },
  approved: { label: "Loan paid out", tone: "info" },
  error: { label: "Could not be read", tone: "danger" },
};

/** Everything about one invoice: what was read from the PDF, every check against the GST registry, and the AI guard. */
export function InvoiceReport({ inv }: { inv: Invoice }) {
  const x = inv.extraction;
  const st = INVOICE_STATUS[inv.status];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        {x && <span className="font-semibold">Invoice {x.invoiceNo}</span>}
      </div>
      {inv.reason && inv.status !== "flagged" && (
        <p className={inv.status === "rejected" || inv.status === "error" ? "text-danger" : "text-ink-soft"}>{inv.reason.charAt(0).toUpperCase() + inv.reason.slice(1)}</p>
      )}

      {inv.guard?.flagged && (
        <div className="rounded-[var(--radius-control)] border border-[#ecd29b] bg-[#fdf6e7] p-4">
          <p className="flex items-center gap-2 font-semibold text-[#7a4f0c]"><ShieldAlert className="size-5" /> Possible instructions to the AI found</p>
          <ul className="mt-2 space-y-2 text-sm">
            {inv.guard.hidden.map((h, i) => <li key={`h${i}`}><b>Hidden text:</b> {h.why}. <q className="italic">{h.quote}</q></li>)}
            {inv.guard.rules.map((r, i) => <li key={`r${i}`}><b>Rule check:</b> {r.why}: <q className="italic">{r.quote}</q></li>)}
            {inv.guard.model?.injection && <li><b>AI classifier:</b> <q className="italic">{inv.guard.model.evidence}</q></li>}
          </ul>
          <p className="mt-2 text-sm text-ink-soft">The invoice data can still be genuine. A person must look at it before any loan.</p>
        </div>
      )}

      {x && (
        <div>
          <h4 className="font-semibold">Read from the PDF</h4>
          <p className="text-sm text-ink-soft">The AI only copies these fields. Plain code then checks each one.</p>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row k="Seller" v={`${x.sellerName}`} />
            <Row k="Seller GSTIN" v={x.sellerGstin} mono />
            <Row k="Buyer" v={x.buyerName} />
            <Row k="Buyer GSTIN" v={x.buyerGstin} mono />
            <Row k="Invoice date" v={x.invoiceDate} />
            <Row k="Due date" v={x.dueDate} />
            <Row k="Amount" v={inr(x.amountInr)} />
            <Row k="Goods" v={x.goods} />
          </dl>
        </div>
      )}

      {inv.checks.length > 0 && (
        <div>
          <h4 className="font-semibold">Checks</h4>
          <ul className="mt-2 divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {inv.checks.map((c) => (
              <li key={c.name} className="flex gap-3 px-3 py-2.5 text-sm">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <div className="min-w-0">
                  <p className="font-semibold">{c.name}</p>
                  {c.detail && <p className="text-ink-soft">{c.detail}</p>}
                  {!c.ok && c.expected !== null && (
                    <p className="text-ink-soft">Registry says <b className="num text-ink">{fmt(c.expected)}</b>, the PDF says <b className="num text-danger">{fmt(c.actual)}</b></p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inv.principal !== null && inv.status !== "rejected" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[#e7e9f7] p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gsec" />
          <span>Loan on offer: <b className="num">{inr(inv.principal)}</b> at 12% a year for 60 days. It is the smaller of 80% of the invoice and the pool&apos;s limits.</span>
        </p>
      )}
    </div>
  );
}

const fmt = (v: string | number | null) => (typeof v === "number" ? inr(v) : v ?? "–");

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1 sm:block sm:border-0 sm:py-0">
      <dt className="text-ink-soft">{k}</dt>
      <dd className={`text-right font-semibold sm:text-left ${mono ? "font-mono text-[13px]" : ""}`}>{v || "–"}</dd>
    </div>
  );
}
