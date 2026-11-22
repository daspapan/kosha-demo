"use client";

import { useState } from "react";
import { isAddress, getAddress } from "ethers";
import { Panel } from "@/components/ui/Panel";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Field, Input } from "@/components/ui/Field";
import { Gate } from "@/components/layout/Gate";
import { PageHead } from "@/components/layout/PageHead";
import { InvoiceReview } from "@/components/partner/InvoiceReview";
import { INVOICE_STATUS } from "@/components/invoice/InvoiceReport";
import { api } from "@/lib/api";
import { runApi } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";
import { useLoans, usePartnerQueue, useRegistry } from "@/lib/hooks";
import { dateOnly, dateTime, inr, pct, shortAddr } from "@/lib/format";
import type { Invoice } from "@/lib/types";

type Tab = "deposits" | "invoices" | "loans" | "kyc";

export default function PartnerPage() {
  return (
    <>
      <PageHead title="Partner desk" lead="Kalinga Finserv, the licensed partner: settle deposits, review invoices, keep KYC current." />
      <Gate need="work the partner desk" role="partner"><Desk /></Gate>
    </>
  );
}

function Desk() {
  const { data: q, mutate } = usePartnerQueue();
  const [tab, setTab] = useState<Tab>("deposits");
  const toReview = q?.invoices.filter((i) => i.status === "verified" || i.status === "flagged").length ?? 0;
  return (
    <Panel>
      <div className="mb-5">
        <Tabs<Tab> label="Partner work" value={tab} onChange={setTab} tabs={[
          { id: "deposits", label: "Deposits", count: q?.deposits.length },
          { id: "invoices", label: "Invoices", count: toReview },
          { id: "loans", label: "Loan book" },
          { id: "kyc", label: "KYC" },
        ]} />
      </div>
      {tab === "deposits" && <Deposits rows={q?.deposits ?? []} onDone={mutate} />}
      {tab === "invoices" && <Invoices rows={q?.invoices ?? []} onDone={mutate} />}
      {tab === "loans" && <LoanBook />}
      {tab === "kyc" && <Kyc />}
    </Panel>
  );
}

function useName() {
  const { data: reg } = useRegistry();
  return (address: string) => reg?.members.find((m) => m.address === address)?.name ?? shortAddr(address);
}

function Deposits({ rows, onDone }: { rows: { id: number; member: string; amount: number; createdAt: number }[]; onDone: () => void }) {
  const { token } = useWallet();
  const name = useName();
  const act = async (id: number, kind: "settle" | "reject") => {
    const r = await runApi(kind === "settle" ? "Settle deposit" : "Return deposit", () => api(`/partner/deposits/${id}/${kind}`, { method: "POST", token }),
      () => (kind === "settle" ? "Settled: e-Rupee converted 1:1 and added to the pool" : "Deposit returned to the member"));
    if (r) onDone();
  };
  if (!rows.length) return <Empty title="No deposits waiting">When a member sends e-Rupee, it appears here to convert and add to the pool.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{name(d.member)}</p>
            <p className="num text-sm text-ink-soft">{inr(d.amount)}, requested {dateTime(d.createdAt)}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => act(d.id, "reject")}>Return</Button>
            <Button size="sm" onClick={() => act(d.id, "settle")}>Settle {inr(d.amount)}</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Invoices({ rows, onDone }: { rows: Invoice[]; onDone: () => void }) {
  const name = useName();
  const [open, setOpen] = useState<Invoice | null>(null);
  if (!rows.length) return <Empty title="No invoices yet">Members upload invoices from their account page.</Empty>;
  const order = { flagged: 0, verified: 1, error: 2, rejected: 3, approved: 4 };
  const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status] || b.id - a.id);
  return (
    <>
      <ul className="divide-y divide-line">
        {sorted.map((inv) => (
          <li key={inv.id}>
            <button onClick={() => setOpen(inv)} className="flex w-full flex-col gap-2 py-3 text-left hover:bg-paper sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="block font-semibold">{name(inv.member)}{inv.extraction ? `, invoice ${inv.extraction.invoiceNo}` : ""}</span>
                <span className="num block text-sm text-ink-soft">
                  {inv.extraction ? `${inr(inv.extraction.amountInr)} from ${inv.extraction.buyerName}` : inv.reason}
                </span>
              </span>
              <Badge tone={INVOICE_STATUS[inv.status].tone}>{INVOICE_STATUS[inv.status].label}</Badge>
            </button>
          </li>
        ))}
      </ul>
      <InvoiceReview key={open?.id ?? 0} inv={open} onClose={() => setOpen(null)} onDone={onDone} />
    </>
  );
}

function LoanBook() {
  const { token } = useWallet();
  const { data, mutate } = useLoans();
  if (!data?.loans.length) return <Empty title="No loans yet">Approved invoices become loans here.</Empty>;
  const writeOff = async (id: number) => {
    const r = await runApi(`Write off loan #${id}`, () => api(`/partner/loans/${id}/write-off`, { method: "POST", token }), () => `Loan #${id} written off. The loss is shared by all members.`);
    if (r) mutate();
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="border-b border-line text-left text-ink-soft">
          <th className="py-2 pr-3 font-semibold">Loan</th><th className="py-2 pr-3 font-semibold">Borrower</th>
          <th className="py-2 pr-3 text-right font-semibold">Amount</th><th className="py-2 pr-3 font-semibold">Due</th>
          <th className="py-2 pr-3 font-semibold">Status</th><th className="py-2 font-semibold"><span className="sr-only">Action</span></th>
        </tr></thead>
        <tbody>
          {data.loans.map((l) => (
            <tr key={l.id} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-3 font-semibold">#{l.id}</td>
              <td className="py-2.5 pr-3">{l.name ?? shortAddr(l.borrower)}<span className="block text-ink-soft">{l.business}</span></td>
              <td className="num py-2.5 pr-3 text-right">{inr(l.principal)}<span className="block text-ink-soft">+{inr(l.interestDue, 2)} at {pct(l.rateBps)}</span></td>
              <td className="py-2.5 pr-3">{dateOnly(l.dueDate)}</td>
              <td className="py-2.5 pr-3">
                <Badge tone={l.status === "Repaid" ? "ok" : l.status === "WrittenOff" ? "danger" : l.overdue ? "warn" : "info"}>{l.overdue && l.status === "Active" ? "Overdue" : l.status === "WrittenOff" ? "Written off" : l.status}</Badge>
              </td>
              <td className="py-2.5 text-right">
                {l.status === "Active" && data.now >= l.writeOffFrom && <Button size="sm" variant="danger" onClick={() => writeOff(l.id)}>Write off</Button>}
                {l.status === "Active" && l.overdue && data.now < l.writeOffFrom && <span className="text-ink-soft">Write-off from {dateOnly(l.writeOffFrom)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kyc() {
  const { token } = useWallet();
  const [addr, setAddr] = useState("");
  const valid = isAddress(addr.trim());
  const set = async (verified: boolean) => {
    await runApi(verified ? "Verify wallet" : "Remove verification",
      () => api(`/partner/kyc`, { method: "POST", token, body: { address: getAddress(addr.trim()), verified } }),
      () => (verified ? "Wallet verified. It can now deposit and hold pool shares." : "Verification removed. The wallet can still withdraw."));
  };
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-ink-soft">Only verified wallets can deposit or hold pool shares. Removing verification never traps money: the member can still withdraw and cash out.</p>
      <Field label="Wallet address" hint={addr && !valid ? <span className="text-danger">That is not a valid address.</span> : undefined}>
        <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" className="font-mono text-sm" />
      </Field>
      <div className="flex gap-2">
        <Button disabled={!valid} onClick={() => set(true)}>Verify</Button>
        <Button variant="secondary" disabled={!valid} onClick={() => set(false)}>Remove verification</Button>
      </div>
    </div>
  );
}
