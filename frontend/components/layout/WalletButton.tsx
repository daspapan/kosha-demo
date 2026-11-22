"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { useRegistry } from "@/lib/hooks";
import { DEMO_PEOPLE } from "@/lib/people";

export function roleName(roles: ReturnType<typeof useWallet>["roles"]): string | null {
  if (!roles) return null;
  if (roles.partner) return "Partner";
  if (roles.committee) return "Committee";
  if (roles.keeper) return "Keeper";
  if (roles.member) return "Member";
  if (roles.verified) return "Verified";
  return "Not verified";
}

export function WalletButton() {
  const w = useWallet();
  const { data: reg } = useRegistry();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (w.status === "loading") return <div className="h-9 w-32" />;
  if (w.status === "no-wallet")
    return <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="text-sm font-semibold text-gsec underline">Install MetaMask</a>;
  if (w.status === "disconnected")
    return <Button size="sm" busy={busy} icon={<Wallet className="size-4" />} onClick={() => act(w.connect)}>Connect wallet</Button>;
  if (w.status === "wrong-network")
    return <Button size="sm" variant="danger" busy={busy} onClick={() => act(w.switchNetwork)}>Switch to Kosha chain</Button>;

  const member = reg?.members.find((m) => m.address === w.account);
  const known = w.account ? DEMO_PEOPLE[w.account] : undefined;
  const person = member ?? (known ? { name: known.name, business: known.role, location: "demo account" } : undefined);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface py-1.5 pl-2 pr-3 text-left hover:border-ink-faint" aria-expanded={open}>
        <span className={`size-2.5 rounded-full ${w.token ? "bg-ok" : "bg-warn"}`} aria-hidden />
        <span className="leading-tight">
          <span className="block text-sm font-semibold">{member ? member.name.split(" ")[0] : known?.name ?? shortAddr(w.account)}</span>
          <span className="block text-xs text-ink-soft">{roleName(w.roles)}{w.token ? "" : ", not signed in"}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[0_12px_32px_rgba(30,42,94,.16)]">
          <p className="font-mono text-[13px] break-all text-ink-soft">{w.account}</p>
          {person && <p className="mt-1 text-sm">{person.business}, {person.location}</p>}
          <div className="mt-4 flex flex-col gap-2">
            {!w.token ? (
              <Button size="sm" busy={busy} onClick={() => act(async () => { await w.signIn(); setOpen(false); toast.success("Signed in"); })}>Sign in with this wallet</Button>
            ) : (
              <Button size="sm" variant="secondary" icon={<LogOut className="size-4" />} onClick={() => { w.signOut(); setOpen(false); }}>Sign out</Button>
            )}
            <p className="text-xs text-ink-soft">Signing in proves you own this wallet. It never moves money. To use another account, switch it in MetaMask.</p>
          </div>
        </div>
      )}
    </div>
  );
}
