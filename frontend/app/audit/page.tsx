"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Copy } from "@/components/ui/Copy";
import { Field, Input } from "@/components/ui/Field";
import { PageHead } from "@/components/layout/PageHead";
import { StatusBadge } from "@/components/committee/StatusBadge";
import { api } from "@/lib/api";
import { useAuditEvents, useProposals, useReconcilerRuns } from "@/lib/hooks";
import { ACTION_LABEL, dateTime } from "@/lib/format";

type Tab = "events" | "proposals" | "books";

export default function AuditPage() {
  return <Suspense><Audit /></Suspense>;
}

function Audit() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("verify") ? "proposals" : "events");
  return (
    <div>
      <PageHead title="Audit trail" lead="Anyone can check what happened and why. Every event comes from the chain; every proposal can be re-hashed and compared with the hash the committee signed." />
      <Panel>
        <div className="mb-5">
          <Tabs<Tab> label="Audit views" value={tab} onChange={setTab}
            tabs={[{ id: "events", label: "Chain events" }, { id: "proposals", label: "Proposals" }, { id: "books", label: "Book checks" }]} />
        </div>
        {tab === "events" && <Events />}
        {tab === "proposals" && <Proposals initial={params.get("verify") ?? ""} />}
        {tab === "books" && <Books />}
      </Panel>
    </div>
  );
}

const CONTRACT_NAME: Record<string, string> = { vault: "Pool", gateway: "Partner gateway", multisig: "Committee", timelock: "Timelock", gsec: "G-sec strategy", kyc: "KYC registry" };

function Events() {
  const { data } = useAuditEvents();
  const [filter, setFilter] = useState("all");
  const [shown, setShown] = useState(40);
  const all = (data?.events ?? []).filter((e) => filter === "all" || e.contract === filter);
  const events = all.slice(0, shown);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {["all", ...Object.keys(CONTRACT_NAME)].map((c) => (
          <button key={c} onClick={() => setFilter(c)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === c ? "bg-ink text-white" : "bg-[#eceef6] text-ink-soft hover:text-ink"}`}>
            {c === "all" ? "Everything" : CONTRACT_NAME[c]}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {events.map((e) => (
          <li key={e.id} className="grid min-w-0 gap-1 py-2.5 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
            <span className="text-sm text-ink-soft">{dateTime(e.ts)}<span className="block">block {e.block}</span></span>
            <span className="min-w-0">
              <span className="font-semibold">{e.event}</span> <span className="text-ink-soft">on {CONTRACT_NAME[e.contract] ?? e.contract}</span>
              <span className="block truncate font-mono text-[12px] text-ink-faint">{Object.entries(e.args).map(([k, v]) => `${k}=${String(v).length > 20 ? String(v).slice(0, 10) + "…" : v}`).join("  ")}</span>
            </span>
            <Copy value={e.tx_hash} />
          </li>
        ))}
      </ul>
      {!events.length && <p className="text-ink-soft">No events yet.</p>}
      {all.length > shown && <Button className="mt-4" variant="secondary" onClick={() => setShown((n) => n + 40)}>Show 40 more ({all.length - shown} left)</Button>}
    </div>
  );
}

type Verify = { hash: string; recomputed: string; fileMatches: boolean; onChain: { proposalId: number; txHash: string; block: number } | null };

function Proposals({ initial }: { initial: string }) {
  const { data } = useProposals();
  const [hash, setHash] = useState(initial);
  const [result, setResult] = useState<Verify | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(h = hash) {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await api<Verify>(`/audit/verify/${h.trim()}`)); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  useEffect(() => { if (initial) verify(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-control)] bg-[#eceef6] p-4">
        <Field label="Verify a proposal" hint="Kosha re-reads the stored proposal file, hashes it again, and looks for that hash on the chain.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x… proposal hash" className="font-mono text-sm" />
            <Button busy={busy} disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash.trim())} onClick={() => verify()}>Verify</Button>
          </div>
        </Field>
        {error && <p className="mt-3 text-danger">{error}</p>}
        {result && (
          <ul className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-center gap-2">{result.fileMatches ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}
              {result.fileMatches ? "The stored file hashes to exactly this value. It has not been changed." : "The stored file does not match this hash."}</li>
            <li className="flex items-center gap-2">{result.onChain ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-ink-faint" />}
              {result.onChain ? `Recorded on the chain with committee proposal #${result.onChain.proposalId}, block ${result.onChain.block}.` : "Not on the chain yet. No committee member has signed it."}</li>
          </ul>
        )}
      </div>
      <ul className="divide-y divide-line">
        {(data?.proposals ?? []).map((p) => (
          <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">#{p.id} {ACTION_LABEL[p.action ?? ""] ?? "Unreadable"} {p.source === "forged" && <Badge tone="danger">Forged</Badge>}</p>
              <Copy value={p.proposalHash} />
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge p={p} />
              <Button size="sm" variant="secondary" onClick={() => { setHash(p.proposalHash); verify(p.proposalHash); }}>Verify</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Books() {
  const { data } = useReconcilerRuns();
  const runs = data?.runs ?? [];
  if (!runs.length) return <p className="text-ink-soft">No checks yet. They run every minute.</p>;
  return (
    <ul className="divide-y divide-line">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            {r.ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}
            <span className="font-semibold">{r.ok ? "Books agree" : `Mismatch: ${r.details.filter((d) => !d.ok).map((d) => d.name).join(", ")}`}</span>
          </span>
          <span className="text-sm text-ink-soft">
            {new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}, block {r.block}
            {r.pause_tx ? ", pool paused" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
