"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/committee/StatusBadge";
import { TreasuryBand, CapMeters } from "@/components/pool/TreasuryBand";
import { ReconcilerCard } from "@/components/pool/ReconcilerCard";
import { usePool, useProposals, useRegistry } from "@/lib/hooks";
import { ACTION_LABEL, dateTime, inr, inrWords, pct } from "@/lib/format";

export default function PoolPage() {
  const { data: pool, isLoading } = usePool();
  const { data: reg } = useRegistry();
  const { data: props } = useProposals();

  if (isLoading || !pool) return <PoolSkeleton />;
  const members = reg?.members.filter((m) => m.kyc === "verified") ?? [];
  const latest = props?.proposals.find((p) => p.source === "agent");

  return (
    <div className="space-y-8">
      <section>
        <p className="text-ink-soft">{dateTime(pool.timestamp)}, block {pool.block}</p>
        <h1 className="num mt-1 text-[32px] font-bold leading-tight tracking-tight sm:text-[44px]">
          {inr(pool.tvl)} held for {members.length || 20} businesses
        </h1>
        <p className="mt-2 max-w-2xl text-[17px] text-ink-soft">{summary(pool)}</p>
        <div className="mt-6"><TreasuryBand pool={pool} /></div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Panel title="Limits the contract enforces" hint="No committee vote or AI proposal can move the pool past these lines.">
          <CapMeters pool={pool} />
        </Panel>

        <Panel title="Today's numbers" hint="Read straight from the chain and the data files.">
          <dl className="divide-y divide-line">
            <Fact label="Value of one share" value={`₹${pool.sharePrice.toFixed(6)}`} note="Rises as T-bill coupons and loan interest come in." />
            <Fact label="91-day T-bill yield" value={pct(pool.tbillAprBps, 2)} note="What the government securities pocket earns a year." />
            <Fact label="Expected withdrawals, next 7 days" value={inr(pool.redemptions.expected7d)}
              note={`Worked out from ${pool.redemptions.history.days} days of history: average week ${inr(pool.redemptions.history.mean7d)} plus two standard deviations.`} />
            <Fact label="Withdrawals waiting in the queue" value={inr(pool.redemptions.pendingAssets)} />
            <Fact label="Invoice loans" value={`${pool.loans.activeCount} active`} note={pool.loans.overdueCount ? `${pool.loans.overdueCount} past their due date` : "None overdue"} />
          </dl>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Are the books right?" hint="Every minute, four independent records are compared to the last rupee.">
          <ReconcilerCard pool={pool} />
        </Panel>

        <Panel title="Latest AI proposal" hint="The treasury agent suggests one change a day. People decide."
          action={<Link href={latest ? `/committee?id=${latest.id}` : "/committee"} className="text-sm font-semibold text-gsec underline">Open</Link>}>
          {latest ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{ACTION_LABEL[latest.action ?? ""] ?? "Proposal"}</span>
                <StatusBadge p={latest} />
              </div>
              {latest.rationale && <blockquote className="mt-3 border-l-4 border-gsec pl-4 text-[15px] text-ink-soft">{latest.rationale}</blockquote>}
            </div>
          ) : (
            <p className="text-ink-soft">No proposal yet today. The agent runs once a day, or from Demo controls.</p>
          )}
        </Panel>
      </div>

      <Panel title="Who is in the pool" hint="Fictional businesses for the demo, each verified by the licensed partner.">
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <li key={m.member_id} className="flex gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[#eceef6] text-sm font-bold text-ink-soft" aria-hidden>
                {m.name.split(" ").map((x) => x[0]).join("")}
              </span>
              <span className="leading-tight">
                <span className="block font-semibold">{m.business}</span>
                <span className="block text-sm text-ink-soft">{m.name}, {m.location}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function summary(pool: ReturnType<typeof usePool>["data"] & object): string {
  const parts: string[] = [];
  const b = pool.allocation.bufferBps;
  if (b >= 9500) parts.push(`Almost all of it is idle in the buffer, ${inrWords(pool.amounts.buffer)} that earns nothing yet.`);
  else parts.push(`${pct(b)} sits in the buffer for withdrawals, the rest earns in government securities and member loans.`);
  if (pool.paused) parts.push("New activity is paused.");
  else if (pool.redemptions.pendingAssets > 0) parts.push(`${inr(pool.redemptions.pendingAssets)} of withdrawals are queued.`);
  return parts.join(" ");
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-ink-soft">{label}</dt>
        <dd className="num text-lg font-semibold">{value}</dd>
      </div>
      {note && <p className="mt-0.5 text-sm text-ink-faint">{note}</p>}
    </div>
  );
}

function PoolSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy>
      <div className="h-5 w-48 rounded bg-line" />
      <div className="h-12 w-3/4 rounded bg-line" />
      <div className="h-16 w-full rounded-xl bg-line" />
      <div className="grid gap-6 lg:grid-cols-2"><div className="h-64 rounded-xl bg-line" /><div className="h-64 rounded-xl bg-line" /></div>
    </div>
  );
}
