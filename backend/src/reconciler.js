// Three records (chain, indexer ledger, partner bank ledger) and two RPC paths must agree to the last wei.
// Any difference pauses new allocations, deposits and loans. Withdrawals keep working (contract rule).
import { indexOnce } from "./indexer.js";
import { ledgerTotals } from "./ledger.js";
import { meta } from "./lib/db.js";
import { contractsFor } from "./lib/chain.js";

export async function reconcileOnce(ctx) {
  const { db, c, provider, providerB } = ctx;
  await indexOnce(db, c, provider);
  const block = Number(meta.get(db, "last_block"));
  const at = { blockTag: block };
  const B = ledgerTotals(db);
  const [gwEinr, arcSupply, tvl, paused] = await Promise.all([
    c.eInr.balanceOf(c.addresses.gateway, at), c.arc.totalSupply(at), c.vault.totalAssets(at), c.vault.paused(at)]);
  const checks = [
    { name: "eINR held by the gateway", chain: gwEinr, ledger: B.gatewayEinr, bank: B.bankEinr },
    { name: "mARC supply", chain: arcSupply, ledger: B.arcSupply },
    { name: "Vault TVL", chain: tvl, ledger: B.tvl },
  ].map((k) => ({ ...k, ok: k.chain === k.ledger && (k.bank === undefined || k.bank === k.chain) }));

  let rpc;
  try {
    const cB = contractsFor(providerB, c.deployment);
    const [hA, hB, tB] = await Promise.all([provider.getBlock(block), providerB.getBlock(block), cB.vault.totalAssets(at)]);
    rpc = { name: "Both RPC paths agree", chain: hA.hash, ledger: hB?.hash ?? null, extra: { totalAssetsA: tvl.toString(), totalAssetsB: tB.toString() }, ok: hA.hash === hB?.hash && tB === tvl };
  } catch (e) {
    rpc = { name: "Both RPC paths agree", ok: false, error: `second RPC unreachable: ${e.shortMessage || e.message}` };
  }
  checks.push(rpc);
  const ok = checks.every((k) => k.ok);
  let pauseTx = null;
  if (!ok && !paused) {
    try { pauseTx = (await (await c.vault.connect(ctx.signer("reconciler")).pause()).wait()).hash; } catch (e) { (await import("./lib/signer.js")).resetSigners(); pauseTx = `pause failed: ${e.shortMessage || e.message}`; }
  }
  const details = checks.map((k) => Object.fromEntries(Object.entries(k).map(([key, v]) => [key, typeof v === "bigint" ? v.toString() : v])));
  db.prepare("INSERT INTO reconciler_runs(at, block, ok, details_json, pause_tx) VALUES (?,?,?,?,?)").run(new Date().toISOString(), block, ok ? 1 : 0, JSON.stringify(details), pauseTx);
  return { ok, block, details, pauseTx };
}

export function startReconciler(ctx, intervalMs, log = console) {
  let busy = false;
  return setInterval(async () => {
    if (busy) return; busy = true;
    try { const r = await reconcileOnce(ctx); if (!r.ok) log.warn("[reconciler] MISMATCH", JSON.stringify(r.details)); } catch (e) { log.error("[reconciler]", e.message); } finally { busy = false; }
  }, intervalMs);
}
