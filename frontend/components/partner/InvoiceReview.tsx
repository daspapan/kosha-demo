"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, TextArea } from "@/components/ui/Field";
import { InvoiceReport } from "@/components/invoice/InvoiceReport";
import { api } from "@/lib/api";
import { runApi } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { inr } from "@/lib/format";
import type { Invoice } from "@/lib/types";

/** The partner's review of one invoice: approve (with a note when the guard flagged it) or reject. */
export function InvoiceReview({ inv, onClose, onDone }: { inv: Invoice | null; onClose: () => void; onDone: () => void }) {
  const { token } = useWallet();
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!inv) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;

  const canDecide = inv.status === "verified" || inv.status === "flagged";
  const flagged = inv.status === "flagged";

  async function approve() {
    setBusy(true);
    const r = await runApi(`Pay out the loan on ${inv!.extraction?.invoiceNo}`,
      () => api<Invoice>(`/partner/invoices/${inv!.id}/approve`, { method: "POST", token, body: flagged ? { override: true, note } : {} }),
      (x) => `Loan #${x.loanId} paid out: ${inr(x.principal)}`);
    setBusy(false);
    if (r) { onDone(); onClose(); }
  }

  async function reject() {
    setBusy(true);
    const r = await runApi("Reject invoice", () => api<Invoice>(`/partner/invoices/${inv!.id}/reject`, { method: "POST", token, body: { reason } }), () => "Invoice rejected");
    setBusy(false);
    if (r) { onDone(); onClose(); }
  }

  return (
    <Modal open onClose={onClose} title={`Invoice ${inv.extraction?.invoiceNo ?? `#${inv.id}`}`}
      footer={canDecide ? (
        <>
          <Button variant="secondary" busy={busy} disabled={!reason.trim()} onClick={reject}>Reject</Button>
          <Button busy={busy} disabled={flagged && (!note.trim() || !checked)} onClick={approve}>Pay out {inr(inv.principal)}</Button>
        </>
      ) : undefined}>
      <InvoiceReport inv={inv} />
      {canDecide && (
        <div className="mt-6 space-y-4 border-t border-line pt-5">
          {flagged && (
            <>
              <Field label="Your review note" hint="Required for a flagged invoice. It is stored with the loan.">
                <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: called the buyer, amount and date confirmed" />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--color-ink)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                I checked this invoice myself and I ignore any instructions written inside it.
              </label>
            </>
          )}
          <Field label="Reason, if you reject it">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown to the member" className="min-h-16" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
