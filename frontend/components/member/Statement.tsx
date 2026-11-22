import { Copy } from "@/components/ui/Copy";
import { dateTime, inr } from "@/lib/format";
import type { Me } from "@/lib/types";

const r = (wei?: string) => (wei ? Number(BigInt(wei) / 10n ** 16n) / 100 : 0);

/** Each line is an on-chain event about this member, with the transaction hash to look it up. */
function describe(e: Me["statement"][number]): string | null {
  const a = e.args;
  switch (`${e.contract}.${e.event}`) {
    case "gateway.DepositRequested": return `Deposit requested, ${inr(r(a.amount))}`;
    case "gateway.DepositSettled": return `Deposit added to the pool, ${inr(r(a.amount))}`;
    case "gateway.DepositRejected": return `Deposit returned by the partner, ${inr(r(a.amount))}`;
    case "gateway.DepositCancelled": return `Deposit cancelled, ${inr(r(a.amount))}`;
    case "gateway.CashIn": return `e-Rupee swapped to ARC, ${inr(r(a.amount))}`;
    case "gateway.CashOut": return `ARC cashed out to e-Rupee, ${inr(r(a.amount))}`;
    case "vault.Deposit": return `Pool shares issued for ${inr(r(a.assets))}`;
    case "vault.Withdraw": return `Withdrawal paid, ${inr(r(a.assets))}`;
    case "vault.LoanOpened": return `Loan #${a.id} paid out, ${inr(r(a.principal))}`;
    case "vault.LoanRepaid": return `Loan #${a.id} repaid, ${inr(r(a.principal))} + ${inr(r(a.interest), 2)} interest`;
    case "vault.RedeemRequested": return `Withdrawal #${a.id} queued`;
    case "vault.RedeemClaimed": return `Queued withdrawal #${a.id} collected, ${inr(r(a.assets))}`;
    case "vault.RedeemCancelled": return `Queued withdrawal #${a.id} cancelled`;
    case "kyc.KycSet": return a.verified ? "KYC verified by the partner" : "KYC removed by the partner";
    default: return null; // token-internal events (Transfer, Approval) mean nothing to a member
  }
}

export function Statement({ me }: { me: Me }) {
  const lines = me.statement.map((e) => ({ e, text: describe(e) })).filter((x) => x.text);
  if (!lines.length) return <p className="text-ink-soft">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {lines.map(({ e, text }, i) => (
        <li key={`${e.txHash}-${i}`} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="font-semibold">{text}</p>
            <p className="text-sm text-ink-soft">{dateTime(e.ts)}, block {e.block}</p>
          </div>
          <Copy value={e.txHash} />
        </li>
      ))}
    </ul>
  );
}
