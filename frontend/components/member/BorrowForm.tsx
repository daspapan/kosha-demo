"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { InvoiceReport, INVOICE_STATUS } from "@/components/invoice/InvoiceReport";
import { api } from "@/lib/api";
import { runApi } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { useMyInvoices } from "@/lib/hooks";
import { inr } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export function BorrowForm() {
  const { token } = useWallet();
  const { data, mutate } = useMyInvoices();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Invoice | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    const inv = await runApi("Checking your invoice", () => api<Invoice>("/invoices", { method: "POST", form, token }),
      (r) => `Invoice checked: ${INVOICE_STATUS[r.status].label.toLowerCase()}`);
    setBusy(false);
    if (inv) { setFile(null); if (input.current) input.current.value = ""; mutate(); setOpen(inv); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <p className="text-ink-soft">Upload an unpaid tax invoice from a buyer. Kosha reads it, checks it against the GST registry, and the partner can lend you up to 80% of it the same day.</p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-panel)] border-2 border-dashed border-line px-4 py-8 text-center hover:border-ink-faint">
          <FileUp className="size-7 text-ink-faint" aria-hidden />
          <span className="font-semibold">{file ? file.name : "Choose the invoice PDF"}</span>
          <span className="text-sm text-ink-soft">PDF, up to 5 MB. The demo invoices are in data/invoices.</span>
          <input ref={input} type="file" accept="application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button className="w-full sm:w-auto" busy={busy} disabled={!file} onClick={upload}>Check this invoice</Button>
      </div>
      <div>
        <h3 className="font-semibold">Your invoices</h3>
        {!data?.invoices.length ? <p className="mt-2 text-sm text-ink-soft">None uploaded yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                <button onClick={() => setOpen(inv)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-paper">
                  <span>
                    <span className="block font-semibold">{inv.extraction?.invoiceNo ?? `Upload #${inv.id}`}</span>
                    <span className="num block text-sm text-ink-soft">{inv.extraction ? inr(inv.extraction.amountInr) : ""}{inv.principal ? `, loan ${inr(inv.principal)}` : ""}</span>
                  </span>
                  <Badge tone={INVOICE_STATUS[inv.status].tone}>{INVOICE_STATUS[inv.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Invoice check">
        {open && <InvoiceReport inv={open} />}
      </Modal>
    </div>
  );
}
