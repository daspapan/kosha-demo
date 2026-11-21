import { registry, readCsv } from "../../src/lib/registry.js";
import { rolling7dStats } from "../../src/lib/stats.js";
import { snapshotHash } from "../../src/snapshot.js";

/** Day 1 of the demo: Rs 1.2 crore, all in the buffer. Same shape buildSnapshot() returns. */
export function day1Snapshot(over = {}) {
  const stats = rolling7dStats(readCsv("redemption_history.csv").map((r) => Number(r.redemptions_inr)));
  const s = {
    version: 1, chainId: 31337, blockNumber: 120, blockTimestamp: 1_800_000_000, vault: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    tvl: 12_000_000, sharePriceMicroRupees: 1_000_000,
    allocation: { bufferBps: 10000, gsecBps: 0, invoiceBps: 0 },
    amounts: { buffer: 12_000_000, gsec: 0, loans: 0 },
    gsec: { aprBps: 550 },
    tbill: { latestBps: 550, trend4w: [] },
    redemptions: { pendingAssets: 0, expected7d: stats.expected7d, history: { days: stats.days, mean7d: stats.mean, sd7d: stats.sd, max7d: stats.max7d, formula: stats.formula } },
    loans: { activeCount: 0, overdueCount: 0 },
    reserve: { ok: true, gatewayEinr: 12_500_000, arcSupply: 12_500_000, pendingDeposits: 0 },
    paused: false,
    policy: registry().policy,
  };
  return structuredClone({ ...s, ...over });
}

export function day1Proposal(snapshot = day1Snapshot()) {
  return {
    blockNumber: snapshot.blockNumber,
    snapshotHash: snapshotHash(snapshot),
    action: "ALLOCATE_TO_GSEC",
    current: { bufferBps: 10000, gsecBps: 0, invoiceBps: 0 },
    target: { bufferBps: 9000, gsecBps: 1000, invoiceBps: 0 },
    dataPoints: [
      { name: "bufferBps", value: 10000 },
      { name: "tbillAprBps", value: 550 },
      { name: "expected7dRedemptionsArc", value: 1027000 },
      { name: "pendingRedemptionsArc", value: 0 },
      { name: "tvlArc", value: 12000000 },
    ],
    confidence: "high",
    rationale: "Move 10% (Rs 12,00,000) from the buffer to government securities. All Rs 1.2 crore is idle and earning nothing, while 91-day T-bills pay 5.50%. Expected redemptions over the next 7 days are at most Rs 10.27 lakh, and the buffer would still hold Rs 1.08 crore. 10% is the policy's daily limit, so I will propose the next step tomorrow.",
    wouldChangeIf: "A redemption request above Rs 20 lakh arrives before the timelock ends.",
  };
}

export const ctxFor = (s) => ({ currentBlock: s.blockNumber + 1, now: s.blockTimestamp + 60 });
