"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Tabs } from "@/components/ui/Tabs";
import { Gate } from "@/components/layout/Gate";
import { PageHead } from "@/components/layout/PageHead";
import { DepositForm } from "@/components/member/DepositForm";
import { WithdrawForm } from "@/components/member/WithdrawForm";
import { BorrowForm } from "@/components/member/BorrowForm";
import { RepayList } from "@/components/member/RepayList";
import { Statement } from "@/components/member/Statement";
import { useMe, usePool } from "@/lib/hooks";
import { inr, inrWords, pct } from "@/lib/format";

type Tab = "deposit" | "withdraw" | "borrow" | "repay";

export default function MemberPage() {
  return (
    <>
      <Gate need="see your balance, deposit, withdraw and borrow">
        <Account />
      </Gate>
    </>
  );
}

function Account() {
  const { data: me, mutate } = useMe();
  const { data: pool } = usePool();
  const [tab, setTab] = useState<Tab>("deposit");
  if (!me) return <div className="h-64 animate-pulse rounded-xl bg-line" />;

  const share = pool && pool.tvl > 0 ? Math.round((me.value / pool.tvl) * 10000) : 0;
  const activeLoans = me.loans.filter((l) => l.status === "Active").length;
  const refresh = () => { mutate(); };

  return (
    <div className="space-y-6">
      <PageHead
        title={me.member ? me.member.business : "My account"}
        lead={me.member ? `${me.member.name}, ${me.member.location}` : me.roles.verified ? "Verified wallet" : "This wallet is not KYC-verified yet. Ask the partner to verify it before depositing."}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[var(--radius-panel)] bg-ink p-5 text-white sm:col-span-1">
          <p className="text-[#c9cfea]">Your share of the pool</p>
          <p className="num mt-1 text-[30px] font-bold leading-tight">{inr(me.value)}</p>
          <p className="text-sm text-[#c9cfea]">{inrWords(me.value)}, {pct(share)} of the pool</p>
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="text-ink-soft">e-Rupee in your wallet</p>
          <p className="num mt-1 text-[24px] font-bold">{inr(me.eInr)}</p>
          <p className="text-sm text-ink-faint">Ready to deposit or repay</p>
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="text-ink-soft">ARC in your wallet</p>
          <p className="num mt-1 text-[24px] font-bold">{inr(me.arc)}</p>
          <p className="text-sm text-ink-faint">{activeLoans ? `${activeLoans} open loan${activeLoans > 1 ? "s" : ""}` : "Loans and withdrawals arrive as ARC"}</p>
        </div>
      </section>

      <Panel>
        <div className="mb-5">
          <Tabs<Tab> label="What do you want to do" value={tab} onChange={setTab}
            tabs={[{ id: "deposit", label: "Deposit" }, { id: "withdraw", label: "Withdraw" }, { id: "borrow", label: "Borrow on an invoice" }, { id: "repay", label: "Repay", count: activeLoans }]} />
        </div>
        {tab === "deposit" && <DepositForm me={me} onDone={refresh} />}
        {tab === "withdraw" && <WithdrawForm me={me} onDone={refresh} />}
        {tab === "borrow" && <BorrowForm />}
        {tab === "repay" && <RepayList me={me} onDone={refresh} />}
      </Panel>

      <Panel title="Statement" hint="Every line is a transaction on the chain. Copy its hash to look it up.">
        <Statement me={me} />
      </Panel>
    </div>
  );
}
