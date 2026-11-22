"use client";

import { useState } from "react";
import { parseUnits } from "ethers";
import { Button } from "@/components/ui/Button";
import { AmountInput, Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import { runSteps } from "@/lib/tx";
import { useKosha } from "@/lib/useKosha";
import { useWallet } from "@/lib/wallet";
import { inr, dateTime } from "@/lib/format";
import type { Me } from "@/lib/types";

const STATUS_TONE = { Pending: "warn", Settled: "ok", Rejected: "danger", Cancelled: "neutral" } as const;

export function DepositForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const { token } = useWallet();
  const { config, contracts } = useKosha();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Number(amount || 0);
  const tooMuch = value > me.eInr;

  async function deposit() {
    setBusy(true);
    const wei = parseUnits(String(value), 18);
    // A fresh key from the backend: if this click is retried, the gateway refuses a second deposit
    const intent = await api<{ clientKey: string; gateway: string }>("/deposits/intent", { method: "POST", token }).catch(() => null);
    const c = await contracts();
    const ok = await runSteps(`Deposit ${inr(value)}`, [
      { label: "Allow the partner gateway to take your e-Rupee", run: () => c.eInr.approve(intent?.gateway ?? config!.addresses.gateway, wei) },
      { label: "Send the deposit request", run: () => c.gateway.requestDeposit(wei, intent?.clientKey ?? "0x" + "0".repeat(64)) },
    ], config, `Deposit of ${inr(value)} requested. The partner settles it next.`);
    setBusy(false);
    if (ok) { setAmount(""); onDone(); }
  }

  async function cancel(id: number) {
    const c = await contracts();
    if (await runSteps("Cancel deposit", [{ label: "Cancel the request", run: () => c.gateway.cancelDeposit(id) }], config, "Deposit cancelled. Your e-Rupee is back.")) onDone();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Amount to deposit" hint={tooMuch ? <span className="text-danger">You have {inr(me.eInr)} in e-Rupee.</span> : `You have ${inr(me.eInr)} in e-Rupee.`}>
          <AmountInput value={amount} onChange={setAmount} max={me.eInr} />
        </Field>
        <Button className="w-full sm:w-auto" busy={busy} disabled={!value || tooMuch} onClick={deposit}>Deposit {value ? inr(value) : ""}</Button>
        <p className="text-sm text-ink-soft">
          Two wallet confirmations: one lets the gateway take the e-Rupee, one sends the request. The licensed partner then converts it 1:1 and adds
          it to the pool in your name. If they do nothing within 3 days, you can cancel and get it back.
        </p>
      </div>
      <div>
        <h3 className="font-semibold">Your deposit requests</h3>
        {me.deposits.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {[...me.deposits].reverse().map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="num font-semibold">{inr(d.amount)}</p>
                  <p className="text-sm text-ink-soft">{dateTime(d.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[d.status as keyof typeof STATUS_TONE] ?? "neutral"}>{d.status}</Badge>
                  {d.status === "Pending" && <Button size="sm" variant="ghost" onClick={() => cancel(d.id)}>Cancel</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
