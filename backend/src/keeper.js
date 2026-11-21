// Convenience loop. Everything it does is also callable by anyone on-chain, so it is never a dependency.
import { ZeroHash } from "ethers";
import { events, indexOnce } from "./indexer.js";
import { resetSigners } from "./lib/signer.js";

export async function keeperTick(ctx) {
  const { db, c, provider } = ctx;
  await indexOnce(db, c, provider);
  const signer = ctx.signer("keeper");
  const did = [];
  const head = await provider.getBlock("latest");

  // 1. Execute timelock operations whose delay has passed
  for (const e of events(db, { contract: "multisig", event: "Scheduled", limit: 100000 })) {
    const op = e.args.operationId;
    if (!(await c.timelock.isOperationReady(op))) continue;
    const p = await c.multisig.getProposal(BigInt(e.args.id));
    if (p.cancelled) continue;
    try {
      const rc = await (await c.timelock.connect(signer).execute(p.target, p.value, p.data, ZeroHash, p.salt)).wait();
      did.push({ kind: "executed", proposalId: Number(e.args.id), txHash: rc.hash });
    } catch (err) {
      resetSigners();
      let reason = err.revert?.name;
      try { reason ??= c.interfaces.vault.parseError(err.data)?.name; } catch {}
      did.push({ kind: "execute_failed", proposalId: Number(e.args.id), error: reason || err.shortMessage || err.message });
    }
  }

  // 2. Redemption queue: fulfil what the buffer covers, pull the rest from G-secs (T+1)
  let shortfall = 0n;
  for (const e of events(db, { contract: "vault", event: "RedeemRequested", limit: 100000 })) {
    const q = await c.vault.redeemRequests(BigInt(e.args.id));
    if (q.status !== 1n) continue;
    const assets = await c.vault.previewRedeem(q.shares);
    if (assets <= (await c.vault.idleAssets())) {
      const rc = await (await c.vault.connect(signer).fulfilRedeem(BigInt(e.args.id))).wait();
      did.push({ kind: "fulfilled", requestId: Number(e.args.id), txHash: rc.hash });
    } else shortfall += assets;
  }
  const [pending, readyAt, gsecValue, idle] = await Promise.all([c.gsec.pendingWithdrawal(), c.gsec.readyAt(), c.gsec.totalValue(), c.vault.idleAssets()]);
  if (pending > 0n && BigInt(head.timestamp) >= readyAt) {
    const rc = await (await c.vault.connect(signer).claimFromGsec()).wait();
    did.push({ kind: "claimed_gsec", txHash: rc.hash });
  } else if (pending === 0n && shortfall > idle && gsecValue > 0n) {
    // +1%: coupons and loan interest raise the share price during the T+1 wait, so the queue grows a little
    const need = ((shortfall - idle) * 101n) / 100n;
    const amount = need < gsecValue ? need : gsecValue;
    const rc = await (await c.vault.connect(signer).requestFromGsec(amount)).wait();
    did.push({ kind: "requested_gsec", amountWei: amount.toString(), txHash: rc.hash });
  }
  ctx.keeperLast = { at: new Date().toISOString(), block: head.number, did };
  return did;
}

export function startKeeper(ctx, intervalMs, log = console) {
  let busy = false, lastLog = "";
  return setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const d = await keeperTick(ctx);
      const line = JSON.stringify(d);
      if (d.length && line !== lastLog) log.info("[keeper]", line); // a failing operation is retried quietly; cancel it from /committee
      lastLog = line;
    } catch (e) { resetSigners(); log.error("[keeper]", e.shortMessage || e.message); } finally { busy = false; }
  }, intervalMs);
}
