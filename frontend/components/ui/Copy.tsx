"use client";

import { useState } from "react";
import { Check, Copy as CopyIcon } from "lucide-react";
import { shortHash } from "@/lib/format";

/** A hash or address shown short, with a copy button. Mono because people compare these character by character. */
export function Copy({ value, label, full = false }: { value: string; label?: string; full?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <code className="truncate font-mono text-[13px] text-ink-soft" title={value}>{label ?? (full ? value : shortHash(value))}</code>
      <button onClick={copy} aria-label={done ? "Copied" : "Copy to clipboard"} className="shrink-0 rounded p-1 text-ink-faint hover:bg-paper hover:text-ink">
        {done ? <Check className="size-3.5 text-ok" /> : <CopyIcon className="size-3.5" />}
      </button>
    </span>
  );
}
