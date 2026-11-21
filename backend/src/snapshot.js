// The data snapshot the agent reasons over and the validator re-checks. Every field is read from
// the chain at one pinned block or from a data file, by plain code. Same block -> same snapshot -> same hash.
import { readCsv, registry } from "./lib/registry.js";
import { rolling7dStats } from "./lib/stats.js";
import { toRupees } from "./lib/money.js";
import { hashOf } from "./lib/hash.js";

const BPS = 10000n;

export async function buildSnapshot(c, provider, blockNumber) {
  const blockTag = blockNumber ?? (await provider.getBlockNumber());
  const at = { blockTag };
  const block = await provider.getBlock(blockTag);
  const { policy } = registry();

  const [total, idle, gsecValue, loansOut, aprBps, pendingShares, gwEinr, arcSupply, pendingDeposits, paused, nextLoanId, decimals] = await Promise.all([
    c.vault.totalAssets(at), c.vault.idleAssets(at), c.gsec.totalValue(at), c.vault.loansOutstanding(at), c.gsec.aprBps(at),
    c.vault.pendingRedeemShares(at), c.eInr.balanceOf(c.addresses.gateway, at), c.arc.totalSupply(at), c.gateway.pendingDeposits(at),
    c.vault.paused(at), c.vault.nextLoanId(at), c.vault.decimals(at),
  ]);
  const share = 10n ** BigInt(decimals);
  const sharePriceWei = await c.vault.convertToAssets(share, at);
  const pendingAssets = pendingShares > 0n ? await c.vault.previewRedeem(pendingShares, at) : 0n;

  let activeLoans = 0, overdue = 0;
  for (let id = 1n; id < nextLoanId; id++) {
    const l = await c.vault.loans(id, at);
    if (l.status === 1n) { activeLoans++; if (l.dueDate < BigInt(block.timestamp)) overdue++; }
  }

  const bps = (x) => (total === 0n ? 0 : Number((x * BPS) / total));
  const yields = readCsv("tbill_yields.csv").map((r) => ({ date: r.auction_date, bps: Number(r.tbill_91d_yield_bps) }));
  const history = readCsv("redemption_history.csv").map((r) => Number(r.redemptions_inr));
  const stats = rolling7dStats(history);

  return {
    version: 1,
    chainId: Number((await provider.getNetwork()).chainId),
    blockNumber: Number(blockTag),
    blockTimestamp: block.timestamp,
    vault: c.addresses.vault,
    tvl: toRupees(total),
    sharePriceMicroRupees: Number((sharePriceWei * 1000000n) / 10n ** 18n), // 1000000 = Rs 1.000000
    // buffer takes the rounding remainder so the three always add up to 10,000 bps
    allocation: total === 0n ? { bufferBps: 0, gsecBps: 0, invoiceBps: 0 }
      : { bufferBps: 10000 - bps(gsecValue) - bps(loansOut), gsecBps: bps(gsecValue), invoiceBps: bps(loansOut) },
    amounts: { buffer: toRupees(idle), gsec: toRupees(gsecValue), loans: toRupees(loansOut) },
    gsec: { aprBps: Number(aprBps) },
    tbill: { latestBps: yields.at(-1).bps, trend4w: yields.slice(-4) },
    redemptions: { pendingAssets: toRupees(pendingAssets), expected7d: stats.expected7d, history: { days: stats.days, mean7d: stats.mean, sd7d: stats.sd, max7d: stats.max7d, formula: stats.formula } },
    loans: { activeCount: activeLoans, overdueCount: overdue },
    reserve: { ok: gwEinr === arcSupply + pendingDeposits, gatewayEinr: toRupees(gwEinr), arcSupply: toRupees(arcSupply), pendingDeposits: toRupees(pendingDeposits) },
    paused,
    policy,
  };
}

export const snapshotHash = (s) => hashOf(s);

/** Values the agent may cite, by name. Rupee fields are whole rupees, Bps fields basis points. */
export const CITABLE = {
  tvlArc: (s) => s.tvl,
  bufferBps: (s) => s.allocation.bufferBps,
  gsecBps: (s) => s.allocation.gsecBps,
  invoiceBps: (s) => s.allocation.invoiceBps,
  bufferArc: (s) => s.amounts.buffer,
  gsecArc: (s) => s.amounts.gsec,
  loansArc: (s) => s.amounts.loans,
  tbillAprBps: (s) => s.gsec.aprBps,
  pendingRedemptionsArc: (s) => s.redemptions.pendingAssets,
  expected7dRedemptionsArc: (s) => s.redemptions.expected7d,
  activeLoans: (s) => s.loans.activeCount,
  overdueLoans: (s) => s.loans.overdueCount,
};
