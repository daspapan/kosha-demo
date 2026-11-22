"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { Bot, Clock, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { AmountInput, Field, Input } from "@/components/ui/Field";
import { PageHead } from "@/components/layout/PageHead";
import { api } from "@/lib/api";
import { runApi } from "@/lib/tx";
import { useConfig, useOpsStatus, useRegistry } from "@/lib/hooks";
import { dateTime, inr } from "@/lib/format";

export default function OpsPage() {
  const { data: config } = useConfig();
  const { data: s } = useOpsStatus();
  const { data: reg } = useRegistry();
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const [confirmReset, setConfirmReset] = useState(false);
  const [inject, setInject] = useState("");
  const [payer, setPayer] = useState("M01");
  const [amount, setAmount] = useState("250000");

  // After any demo action, refresh every page's data at once
  const refreshAll = () => mutate(() => true);
  const post = async <T,>(title: string, path: string, body: unknown, done: (r: T) => string) => {
    const r = await runApi<T>(title, () => api<T>(path, { method: "POST", body }), done);
    refreshAll();
    return r;
  };

  if (config && !config.demo) return <PageHead title="Demo controls" lead="Demo controls only work on the local test chain." />;

  return (
    <div>
      <PageHead title="Demo controls" lead="For recording the demo: move chain time forward, run the agent, and break things on purpose to show the safety checks." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Chain time" hint="Skips ahead on the local chain. T-bill coupons for the skipped time are paid in automatically.">
          {s && <p className="mb-4"><span className="text-ink-soft">Chain time now:</span> <b>{dateTime(s.timestamp)}</b>, block {s.block}</p>}
          <div className="flex flex-wrap gap-2">
            {[["1 hour", 3600], ["1 day", 86400], ["24 hours + 1 minute", 86460], ["30 days", 30 * 86400]].map(([label, secs]) => (
              <Button key={label} variant="secondary" icon={<Clock className="size-4" />}
                onClick={() => post<{ coupon: string }>(`Skip ${label}`, "/ops/time-travel", { seconds: secs }, (r) => `Skipped ${label}${BigInt(r.coupon) > 0n ? ", coupon paid" : ""}`)}>
                +{label}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <Button variant="secondary" icon={<Wrench className="size-4" />} onClick={() => post<{ did: unknown[] }>("Run the keeper", "/ops/keeper", {}, (r) => (r.did.length ? `Keeper did ${r.did.length} thing(s)` : "Keeper: nothing to do"))}>Run keeper now</Button>
            <Button variant="secondary" onClick={() => post<{ ok: boolean }>("Check the books", "/ops/reconcile", {}, (r) => (r.ok ? "Books agree" : "Mismatch found, pool paused"))}>Check books now</Button>
          </div>
        </Panel>

        <Panel title="Treasury agent" hint={s?.agentLastSeen ? `Agent last checked in ${Math.round((Date.now() - s.agentLastSeen) / 1000)} s ago.` : "The agent is not running. Start it with npm run dev and make sure Ollama is up."}>
          <Field label="Show the agent an uploaded invoice (optional)" hint="Use the injection invoice INV-07's upload number to show the agent ignoring hidden instructions.">
            <Input inputMode="numeric" value={inject} onChange={(e) => setInject(e.target.value.replace(/\D/g, ""))} placeholder="Invoice upload number, for example 7" />
          </Field>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<Bot className="size-4" />} onClick={async () => {
              await post("Ask the agent", "/ops/run-agent", inject ? { injectInvoiceId: Number(inject) } : {}, () => "Asked. The proposal appears in Committee in a few seconds.");
              setTimeout(refreshAll, 6000);
            }}>Run the agent now</Button>
            <Button variant="danger" icon={<ShieldAlert className="size-4" />}
              onClick={async () => { const r = await post<{ id: number }>("Forge a 60% proposal", "/ops/forge-proposal", {}, () => "Forged proposal stored. See how the rules treat it."); if (r) router.push(`/committee?id=${r.id}`); }}>
              Forge a bad proposal
            </Button>
          </div>
        </Panel>

        <Panel title="Second RPC connection" hint="Makes the reconciler's second chain connection misbehave. The next book check pauses the pool.">
          <Tabs label="RPC behaviour" value={s?.chaos ?? "off"} onChange={(mode) => post("Change RPC behaviour", "/ops/chaos", { mode }, () => `Second RPC now: ${mode}`)}
            tabs={[{ id: "off", label: "Honest" }, { id: "stale", label: "10 blocks behind" }, { id: "lie", label: "Lies by 1 wei" }]} />
          <p className="mt-3 text-sm text-ink-soft">Unpausing needs a committee proposal and the 24-hour wait, exactly as it would in production.</p>
        </Panel>

        <Panel title="Story shortcuts">
          <div className="space-y-5">
            <div>
              <p className="font-semibold">The exporter pays a member</p>
              <p className="mb-3 text-sm text-ink-soft">The mock RBI sends e-Rupee to the member, as if the buyer paid. She can then repay her loan.</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
                <select value={payer} onChange={(e) => setPayer(e.target.value)} className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3" aria-label="Member">
                  {(reg?.members ?? []).filter((m) => m.kyc === "verified").map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
                </select>
                <AmountInput value={amount} onChange={setAmount} />
                <Button variant="secondary" disabled={!Number(amount)} onClick={() => post("Exporter pays", "/ops/exporter-pays", { memberId: payer, amountInr: Number(amount) }, () => `Paid ${inr(Number(amount))}`)}>Pay</Button>
              </div>
            </div>
            <div className="border-t border-line pt-5">
              <p className="font-semibold">Tight pool</p>
              <p className="mb-3 text-sm text-ink-soft">Lends up to 35%, fills G-secs to the buffer floor, then two members withdraw. A big withdrawal after this has to queue.</p>
              <Button variant="secondary" onClick={() => post("Set up a tight pool", "/ops/preset/tight", {}, () => "Pool is now tight")}>Set up a tight pool</Button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-6 flex flex-col items-start gap-2 rounded-[var(--radius-panel)] border border-[#f0c4bf] bg-[#fdf3f2] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Reset the demo</p>
          <p className="text-sm text-ink-soft">Back to the freshly seeded pool: ₹1,20,00,000, all in the buffer, no proposals, no loans.</p>
        </div>
        <Button variant="danger" icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>Reset demo</Button>
      </div>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset the demo?"
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { setConfirmReset(false); await post("Reset the demo", "/ops/reset", {}, () => "Demo reset to the seeded pool"); }}>Reset everything</Button>
        </>}>
        <p>This rewinds the local chain and clears the database. MetaMask may then show old transactions: clear its activity under Settings, Advanced.</p>
      </Modal>
    </div>
  );
}
