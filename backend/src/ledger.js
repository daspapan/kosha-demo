// Totals derived purely from indexed events (record B) and the partner bank ledger (record C).
export function ledgerTotals(db) {
  const sum = (contract, event, field, where = () => true) => db.prepare("SELECT args FROM ledger_events WHERE contract = ? AND event = ?").all(contract, event)
    .map((r) => JSON.parse(r.args)).filter(where).reduce((a, x) => a + BigInt(x[field]), 0n);
  const writtenOff = new Set(db.prepare("SELECT args FROM ledger_events WHERE contract='vault' AND event='LoanWrittenOff'").all().map((r) => JSON.parse(r.args).id));

  const gatewayEinr = sum("gateway", "DepositRequested", "amount") - sum("gateway", "DepositRejected", "amount") - sum("gateway", "DepositCancelled", "amount")
    + sum("gateway", "CashIn", "amount") - sum("gateway", "CashOut", "amount");
  const arcSupply = sum("gateway", "DepositSettled", "amount") + sum("gateway", "CashIn", "amount") - sum("gateway", "CashOut", "amount");
  const tvl = sum("vault", "Deposit", "assets") - sum("vault", "Withdraw", "assets") - sum("vault", "RedeemFulfilled", "assets")
    + sum("gsec", "CouponPaid", "amount") + sum("vault", "LoanRepaid", "interest") - sum("vault", "LoanWrittenOff", "principal")
    + sum("vault", "LoanRepaid", "principal", (x) => writtenOff.has(x.id));

  const bank = db.prepare("SELECT direction, amount_wei FROM partner_bank_ledger").all()
    .reduce((a, r) => a + (r.direction === "in" ? 1n : -1n) * BigInt(r.amount_wei), 0n);
  return { gatewayEinr, arcSupply, tvl, bankEinr: bank };
}
