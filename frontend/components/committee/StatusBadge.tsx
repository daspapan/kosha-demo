import { Badge } from "@/components/ui/Badge";

/** One status, worded the same everywhere a proposal appears. */
export function StatusBadge({ p }: { p: { status: string; onChain: { state: string } | null } }) {
  if (p.status === "rejected") return <Badge tone="danger">Rejected by the rules</Badge>;
  if (p.status === "no_action") return <Badge>No change proposed</Badge>;
  switch (p.onChain?.state) {
    case "awaiting_signatures": return <Badge tone="warn">Needs a second signature</Badge>;
    case "scheduled": return <Badge tone="info">Approved, waiting 24 h</Badge>;
    case "executed": return <Badge tone="ok">Done</Badge>;
    case "cancelled": return <Badge tone="danger">Vetoed</Badge>;
    default: return <Badge tone="warn">Ready for the committee</Badge>;
  }
}

