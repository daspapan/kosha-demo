"use client";

import { parseUnits } from "ethers";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { runSteps, type TxStep } from "@/lib/tx";
import { useKosha } from "@/lib/useKosha";
import { dateOnly, inr, pct } from "@/lib/format";
import type { Me } from "@/lib/types";

export function RepayList({ me, onDone }: { me: Me; onDone: () => void }) {
  const { config, contracts } = useKosha();
  const open = me.loans.filter((l) => l.status === "Active" || l.status === "WrittenOff");
  const closed = me.loans.filter((l) => l.status === "Repaid");

  async function repay(loan: Me["loans"][number]) {
    const c = await contracts();
    const owed = loan.principal + loan.interestDue;
    // Interest grows every second, so allow 0.1% (and at least ₹10) for the time it takes to sign
    const allowance = Math.ceil(owed * 1.001 + 10);
    const wei = parseUnits(String(allowance), 18);
    const steps: TxStep[] = [];
    const needArc = Math.max(0, allowance - Math.floor(me.arc));
    if (needArc > 0) {
      const needWei = parseUnits(String(needArc), 18);
      steps.push({ label: "Allow the gateway to take your e-Rupee", run: () => c.eInr.approve(config!.addresses.gateway, needWei) });
      steps.push({ label: "Swap e-Rupee for ARC", run: () => c.gateway.cashIn(needWei) });
    }
    steps.push({ label: "Allow the pool to take the repayment", run: () => c.arc.approve(config!.addresses.vault, wei) });
    steps.push({ label: "Repay the loan", run: () => c.vault.repayLoan(loan.id) });
    if (await runSteps(`Repay loan #${loan.id}`, steps, config, `Loan #${loan.id} repaid. The interest goes to every member.`)) onDone();
  }

  if (me.loans.length === 0) return <p className="text-ink-soft">You have no loans. Upload an invoice under Borrow to apply.</p>;
  return (
    <div className="space-y-4">
      {open.map((l) => (
        <div key={l.id} className="rounded-[var(--radius-control)] border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Loan #{l.id}</p>
              <p className="text-sm text-ink-soft">{pct(l.rateBps)} a year, due {dateOnly(l.dueDate)}</p>
            </div>
            {l.status === "WrittenOff" && <Badge tone="danger">Written off</Badge>}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-ink-soft">Borrowed</dt><dd className="num font-semibold">{inr(l.principal)}</dd></div>
            <div><dt className="text-ink-soft">Interest so far</dt><dd className="num font-semibold">{inr(l.interestDue, 2)}</dd></div>
            <div><dt className="text-ink-soft">To repay now</dt><dd className="num font-semibold">{inr(l.principal + l.interestDue, 2)}</dd></div>
          </dl>
          <Button className="mt-4" size="sm" onClick={() => repay(l)}>Repay {inr(l.principal + l.interestDue)}</Button>
        </div>
      ))}
      {closed.length > 0 && <p className="text-sm text-ink-soft">Repaid: {closed.map((l) => `#${l.id} (${inr(l.principal)})`).join(", ")}</p>}
    </div>
  );
}
