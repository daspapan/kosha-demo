"use client";

import { useState } from "react";
import { parseUnits } from "ethers";
import { Button } from "@/components/ui/Button";
import { AmountInput, Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { runSteps } from "@/lib/tx";
import { useKosha } from "@/lib/useKosha";
import { inr } from "@/lib/format";
import type { Me } from "@/lib/types";

export function WithdrawForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const { config, contracts, account } = useKosha();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const shares = BigInt(me.shares);
  const maxShares = BigInt(me.maxRedeemShares);
  // What the buffer can pay this member today, in rupees
  const availableNow = shares > 0n ? Math.floor(me.value * Number(maxShares) / Number(shares)) : 0;
  const value = Number(amount || 0);
  const instant = value > 0 && value <= availableNow;
  const tooMuch = value > Math.floor(me.value);

  async function withdraw() {
    setBusy(true);
    const c = await contracts();
    const wei = parseUnits(String(value), 18);
    let ok: boolean;
    if (instant) {
      ok = await runSteps(`Withdraw ${inr(value)}`, [{ label: "Withdraw from the buffer", run: () => c.vault.withdraw(wei, account, account) }], config,
        `${inr(value)} withdrawn as ARC. Cash it out to e-Rupee below.`);
    } else {
      const sharesNeeded: bigint = await c.vault.convertToShares(wei);
      ok = await runSteps(`Queue a withdrawal of ${inr(value)}`, [{ label: "Queue the withdrawal", run: () => c.vault.requestRedeem(sharesNeeded) }], config,
        "Withdrawal queued. The keeper frees the money from government securities, usually in a day.");
    }
    setBusy(false);
    if (ok) { setAmount(""); onDone(); }
  }

  async function cashOut() {
    const c = await contracts();
    const wei = parseUnits(String(me.arc), 18);
    if (await runSteps(`Cash out ${inr(me.arc)}`, [
      { label: "Allow the gateway to take your ARC", run: () => c.arc.approve(config!.addresses.gateway, wei) },
      { label: "Swap ARC for e-Rupee", run: () => c.gateway.cashOut(wei) },
    ], config, `${inr(me.arc)} is back in your e-Rupee wallet.`)) onDone();
  }

  async function act(fn: "claimRedeem" | "cancelRedeem", id: number) {
    const c = await contracts();
    const label = fn === "claimRedeem" ? "Collect your queued withdrawal" : "Cancel the queued withdrawal";
    if (await runSteps(label, [{ label, run: () => c.vault[fn](id) }], config)) onDone();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Field label="Amount to withdraw"
          hint={tooMuch ? <span className="text-danger">Your share of the pool is worth {inr(me.value)}.</span>
            : <>Available today: <b className="num">{inr(availableNow)}</b>. Anything above that joins the queue.</>}>
          <AmountInput value={amount} onChange={setAmount} max={me.value} />
        </Field>
        <Button className="w-full sm:w-auto" busy={busy} disabled={!value || tooMuch} onClick={withdraw}>
          {value && !instant ? `Queue ${inr(value)}` : `Withdraw ${value ? inr(value) : ""}`}
        </Button>
        <p className="text-sm text-ink-soft">Withdrawals work even when the pool is paused. A queued withdrawal is priced when it is ready, so it includes any gains until then.</p>

        {me.arc >= 1 && (
          <div className="rounded-[var(--radius-control)] bg-[#e3f2ef] p-4">
            <p className="font-semibold">You hold {inr(me.arc)} in ARC</p>
            <p className="mt-1 text-sm text-ink-soft">Swap it back to e-Rupee 1:1 through the partner.</p>
            <Button size="sm" className="mt-3" onClick={cashOut}>Cash out to e-Rupee</Button>
          </div>
        )}
      </div>
      <div>
        <h3 className="font-semibold">Queued withdrawals</h3>
        {me.redeems.length === 0 ? <p className="mt-2 text-sm text-ink-soft">None.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {[...me.redeems].reverse().map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="num font-semibold">{r.status === "Pending" ? "Being prepared" : inr(r.assets)}</p>
                  <p className="text-sm text-ink-soft">Request #{r.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={r.status === "Claimable" ? "ok" : r.status === "Pending" ? "warn" : "neutral"}>{r.status === "Claimable" ? "Ready" : r.status}</Badge>
                  {r.status === "Claimable" && <Button size="sm" onClick={() => act("claimRedeem", r.id)}>Collect</Button>}
                  {r.status === "Pending" && <Button size="sm" variant="ghost" onClick={() => act("cancelRedeem", r.id)}>Cancel</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
