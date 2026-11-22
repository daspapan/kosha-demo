"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Copy } from "@/components/ui/Copy";
import { Empty } from "@/components/ui/Empty";
import { PageHead } from "@/components/layout/PageHead";
import { StatusBadge } from "@/components/committee/StatusBadge";
import { SplitChange } from "@/components/committee/SplitChange";
import { Evidence, Rules } from "@/components/committee/Evidence";
import { Timeline } from "@/components/committee/Timeline";
import { Actions } from "@/components/committee/Actions";
import { usePool, useProposal, useProposals } from "@/lib/hooks";
import { ACTION_LABEL, inr } from "@/lib/format";

export default function CommitteePage() {
  return <Suspense><Committee /></Suspense>;
}

function Committee() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: list, mutate: refreshList } = useProposals();
  const proposals = list?.proposals ?? [];
  const selected = Number(params.get("id")) || null;

  return (
    <div>
      <PageHead title="Risk committee" lead="The AI proposes one change a day. Two of the three committee members must sign, then everyone gets 24 hours to see it before it runs." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className={`min-w-0 ${selected ? "hidden lg:block" : ""}`}>
          {proposals.length === 0 ? (
            <Empty title="No proposals yet">The agent writes one a day. In the demo, use Demo controls to run it now.</Empty>
          ) : (
            <ul className="space-y-2">
              {proposals.map((p) => (
                <li key={p.id}>
                  <button onClick={() => router.push(`/committee?id=${p.id}`)}
                    className={`w-full rounded-[var(--radius-control)] border p-3 text-left ${p.id === selected ? "border-gsec bg-surface" : "border-line bg-surface hover:border-ink-faint"}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm text-ink-soft">#{p.id}, {new Date(p.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      {p.source === "forged" && <span className="text-xs font-semibold text-danger">Forged for demo</span>}
                    </span>
                    <span className="mt-1 block font-semibold">{ACTION_LABEL[p.action ?? ""] ?? "Unreadable proposal"}</span>
                    <span className="mt-2 block"><StatusBadge p={p} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          {selected ? <Detail id={selected} onChange={() => refreshList()} /> : (
            <div className="hidden lg:block"><Empty title="Pick a proposal">Its reasoning, the figures it relied on and the rule checks appear here.</Empty></div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ id, onChange }: { id: number; onChange: () => void }) {
  const { data: p, mutate } = useProposal(id);
  const { data: pool } = usePool();
  if (!p || !pool) return <div className="h-96 animate-pulse rounded-xl bg-line" />;
  const pr = p.proposal;

  return (
    <div className="space-y-5">
      <Link href="/committee" className="inline-flex items-center gap-1 text-sm font-semibold text-gsec lg:hidden"><ArrowLeft className="size-4" /> All proposals</Link>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge p={p} />
            <span className="text-sm text-ink-soft">Proposal #{p.id}{p.model ? `, written by ${p.model}` : ""}</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold">{ACTION_LABEL[pr?.action ?? ""] ?? "Unreadable proposal"}</h2>
          {p.submit && <p className="num mt-1 text-ink-soft">Amount: {inr(Number(BigInt(p.submit.amountWei) / 10n ** 18n))}</p>}
          {pr && <div className="mt-5"><SplitChange from={pr.current} to={pr.target} /></div>}
          {pr?.rationale && (
            <figure className="mt-6">
              <blockquote className="border-l-4 border-gsec pl-4 text-[17px] leading-relaxed">{pr.rationale}</blockquote>
              <figcaption className="mt-2 pl-5 text-sm text-ink-soft">
                The AI&apos;s explanation, confidence {pr.confidence}. It would change its mind if: {pr.wouldChangeIf}
              </figcaption>
            </figure>
          )}
          {p.source === "forged" && (
            <p className="mt-4 rounded-[var(--radius-control)] bg-[#fbe6e4] p-3 text-sm text-danger">
              This proposal was forged in Demo controls to show what happens if an AI followed hidden instructions in an invoice.
            </p>
          )}
        </Panel>
        <Panel title="Approval">
          <Timeline onChain={p.onChain} chainNow={pool.timestamp} />
          <div className="mt-5 border-t border-line pt-4"><Actions p={p} chainNow={pool.timestamp} onDone={() => { mutate(); onChange(); }} /></div>
        </Panel>
      </div>

      <Panel title="Is it backed by the data?" hint={`Every figure the AI quoted, checked against the chain at block ${p.blockNumber}.`}>
        <Evidence p={p} />
      </Panel>

      <Panel title="Rule checks" hint={`${p.validation.passed.length} of 11 passed. Plain code, no AI.`}>
        <Rules p={p} />
        {p.validation.notes.map((n) => <p key={n} className="mt-3 text-sm text-ink-soft">{n}</p>)}
      </Panel>

      <Panel title="Tamper check" hint="The hash of this proposal and its data is recorded on the chain when the first committee member signs.">
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-ink-soft">Proposal hash</dt><dd><Copy value={p.proposalHash} /></dd></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-ink-soft">Data snapshot hash</dt><dd><Copy value={p.snapshotHash} /></dd></div>
        </dl>
        <Link href={`/audit?verify=${p.proposalHash}`} className="mt-3 inline-block text-sm font-semibold text-gsec underline">Recompute and verify</Link>
      </Panel>
    </div>
  );
}
