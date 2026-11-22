"use client";

import { useState } from "react";
import { ZeroHash } from "ethers";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { runSteps } from "@/lib/tx";
import { useKosha } from "@/lib/useKosha";
import { useWallet } from "@/lib/wallet";
import type { ProposalDetail } from "@/lib/types";

/** What the signed-in person can do with this proposal right now. */
export function Actions({ p, chainNow, onDone }: { p: ProposalDetail; chainNow: number; onDone: () => void }) {
  const w = useWallet();
  const { config, contracts } = useKosha();
  const [veto, setVeto] = useState(false);
  const s = p.onChain?.state ?? "not_submitted";
  const id = p.onChain?.proposalId;
  const isCommittee = !!w.roles?.committee;
  const iSigned = !!w.account && !!p.onChain?.confirmedBy?.includes(w.account);
  const ready = s === "scheduled" && !!p.onChain?.readyAt && p.onChain.readyAt <= chainNow;

  async function go(title: string, label: string, run: (c: Awaited<ReturnType<typeof contracts>>) => Promise<unknown>, done: string) {
    const c = await contracts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (await runSteps(title, [{ label, run: () => run(c) as any }], config, done)) onDone();
  }

  if (!p.signable || !p.submit) {
    return <p className="text-sm text-ink-soft">{p.status === "rejected" ? "The rules rejected this proposal, so it cannot be signed." : "Nothing to sign: the agent proposed no change."}</p>;
  }
  const sub = p.submit;

  return (
    <div className="space-y-3">
      {!isCommittee && s !== "scheduled" && <p className="text-sm text-ink-soft">Only the three committee members can sign. Connect one of their wallets to act.</p>}
      <div className="flex flex-wrap gap-2">
        {isCommittee && s === "not_submitted" && (
          <Button onClick={() => go("Sign and submit", "Sign the proposal", (c) => c.multisig.submit(sub.target, 0, sub.data, sub.salt, sub.proposalHash),
            "Signed. One more committee signature schedules it.")}>Sign and submit</Button>
        )}
        {isCommittee && s === "awaiting_signatures" && !iSigned && id && (
          <Button onClick={() => go("Add your signature", "Add the second signature", (c) => c.multisig.confirm(id), "Signed. The 24-hour wait has started.")}>Add my signature</Button>
        )}
        {isCommittee && s === "awaiting_signatures" && iSigned && id && (
          <Button variant="secondary" onClick={() => go("Withdraw your signature", "Withdraw the signature", (c) => c.multisig.revoke(id), "Signature withdrawn.")}>Withdraw my signature</Button>
        )}
        {ready && (
          <Button onClick={() => go("Run the approved change", "Run it on the chain", (c) => c.timelock.execute(sub.target, 0, sub.data, ZeroHash, sub.salt), "Done. The pool has moved.")}>Run it now</Button>
        )}
        {isCommittee && (s === "awaiting_signatures" || s === "scheduled") && id && (
          <Button variant="danger" onClick={() => setVeto(true)}>Veto</Button>
        )}
      </div>
      {s === "scheduled" && !ready && <p className="text-sm text-ink-soft">Anyone can run it once the 24 hours are over. The keeper usually does it automatically.</p>}

      <Modal open={veto} onClose={() => setVeto(false)} title="Veto this change?"
        footer={<>
          <Button variant="secondary" onClick={() => setVeto(false)}>Keep it</Button>
          <Button variant="danger" onClick={async () => { setVeto(false); if (id) await go("Veto", "Veto the change", (c) => c.multisig.cancel(id), "Vetoed. It will never run."); }}>Veto the change</Button>
        </>}>
        <p>One committee member is enough to stop a change. It cannot be undone: the agent would have to propose again and two members would have to sign again.</p>
      </Modal>
    </div>
  );
}
