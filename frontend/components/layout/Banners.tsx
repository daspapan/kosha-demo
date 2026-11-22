"use client";

import Link from "next/link";
import { usePool, useProposals, useConfig } from "@/lib/hooks";
import { Countdown } from "@/components/ui/Countdown";
import { ACTION_LABEL } from "@/lib/format";

/** Site-wide notices: test-money warning, pause state, and any change waiting in the timelock. */
export function Banners() {
  const { data: config } = useConfig();
  const { data: pool, error } = usePool();
  const { data: props } = useProposals();
  const waiting = props?.proposals.find((p) => p.onChain?.state === "scheduled");

  return (
    <div className="space-y-px">
      {config?.demo && (
        <p className="bg-[#fbf0d9] px-4 py-1.5 text-center text-[13px] text-[#7a4f0c]">
          Local demo on a test chain. The e-Rupee here is a mock token with no value.
        </p>
      )}
      {error && (
        <p role="alert" className="bg-danger px-4 py-2 text-center text-sm text-white">
          Cannot reach the Kosha backend. Start everything with <code className="font-mono">npm run dev</code>, then reload.
        </p>
      )}
      {pool?.paused && (
        <p role="status" className="bg-danger px-4 py-2 text-center text-sm text-white">
          New deposits, allocations and loans are paused{pool.reconciler && !pool.reconciler.ok ? " because the books did not agree" : ""}. Withdrawals still work.
          Only a committee decision can lift the pause.
        </p>
      )}
      {waiting && pool && (
        <Link href={`/committee?id=${waiting.id}`} className="block bg-gsec px-4 py-2 text-center text-sm text-white hover:bg-[#2f3d8f]">
          Approved change waiting: {ACTION_LABEL[waiting.action ?? ""]?.toLowerCase()}.{" "}
          {waiting.onChain?.readyAt && waiting.onChain.readyAt > pool.timestamp
            ? <>Can run in <Countdown until={waiting.onChain.readyAt} chainNow={pool.timestamp} />.</>
            : <>Ready to run now.</>}
        </Link>
      )}
    </div>
  );
}
