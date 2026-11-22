"use client";

// Demo mode only: pick who you are from a list. No MetaMask, no pop-ups.
import { toast } from "sonner";
import { UsersRound } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { DEMO_ACCOUNTS } from "@/lib/demoAccounts";

export function DemoSwitcher() {
  const w = useWallet();

  function choose(address: string) {
    const person = DEMO_ACCOUNTS.find((p) => p.address === address);
    w.actAs(address);
    toast.success(`You are now ${person?.name}`);
  }

  return (
    <label className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface py-1.5 pl-2 pr-1 text-sm">
      <UsersRound className="size-4 text-ink-soft" aria-hidden />
      <span className="sr-only">Act as</span>
      <select
        className="bg-transparent py-0.5 font-semibold outline-none"
        value={w.account ?? ""}
        onChange={(e) => choose(e.target.value)}
      >
        {!w.account && <option value="">Choose who you are</option>}
        {DEMO_ACCOUNTS.map((p) => (
          <option key={p.address} value={p.address}>
            {p.name} ({p.role})
          </option>
        ))}
      </select>
    </label>
  );
}