"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useWallet } from "@/lib/wallet";
import type { Roles } from "@/lib/types";
import { DEMO_MODE } from "@/lib/demoAccounts";

/**
 * Shows the right next step until the wallet is connected, on the right network and signed in,
 * and (optionally) holds the role a page needs. The contracts enforce permissions anyway; this just guides people.
 */
export function Gate({ need, role, children }: { need: string; role?: keyof Roles; children: ReactNode }) {
  const w = useWallet();
  const run = (fn: () => Promise<void>) => fn().catch((e) => toast.error((e as Error).message));

  let title = "", body = "", action: ReactNode = null;
  if (w.status === "loading") return null;
  if (w.status === "no-wallet") {
    title = "Install a wallet to continue";
    body = "Kosha uses MetaMask to sign deposits and approvals. Install it, then reload this page.";
    action = <a className="font-semibold text-gsec underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask</a>;
  } else if (w.status === "disconnected" && DEMO_MODE) {
    title = "Choose who you are";
    body = `Pick a person from the list at the top right to ${need}.`;
  } else if (w.status === "disconnected") {
    title = "Connect your wallet";
    body = `Connect the wallet you use for Kosha to ${need}.`;
    action = <Button icon={<Wallet className="size-4" />} onClick={() => run(w.connect)}>Connect wallet</Button>;
  } else if (w.status === "wrong-network") {
    title = "Switch to the Kosha chain";
    body = "Your wallet is on a different network. Switching adds the Kosha chain to MetaMask if it is missing.";
    action = <Button onClick={() => run(w.switchNetwork)}>Switch network</Button>;
  } else if (!w.token) {
    title = "Sign in";
    body = "Sign a short message so Kosha knows this wallet is yours. It does not move any money or cost gas.";
    action = <Button onClick={() => run(w.signIn)}>Sign in with this wallet</Button>;
  } else if (role && w.roles && !w.roles[role]) {
    const names: Partial<Record<keyof Roles, string>> = { partner: "the licensed partner", committee: "a risk committee member", member: "a pool member" };
    title = "This wallet cannot use this page";
    body = `This page is for ${names[role] ?? role}. ${DEMO_MODE ? "Pick that person from the list at the top right." : "Switch to that account in MetaMask."}`;
  } else {
    return <>{children}</>;
  }

  return (
    <Panel>
      <div className="mx-auto max-w-md py-6 text-center">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-ink-soft">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </Panel>
  );
}
